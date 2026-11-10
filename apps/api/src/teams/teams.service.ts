import {
  type InvitationForMe,
  type Team,
  TEAM_LIMITS,
  type TeamOverview,
  type TeamRole,
} from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseExecutor,
  type DatabaseHandle,
  eq,
  gt,
  lt,
  ne,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AuthContext } from "../auth/session.service.js";
import { BillingService } from "../billing/billing.service.js";
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { RATE_LIMITS, RateLimiter, rateLimitSubject } from "../rate-limit/rate-limiter.js";
import { SecurityEventsService } from "../security-events/security-events.js";

const logger = new Logger("Teams");

const DAY_MS = 24 * 60 * 60 * 1000;

const noTeam = () => new ApiException("not_found", 404, "You aren’t in a team.");
const notAllowed = (what: string) =>
  new ApiException("forbidden", 403, `Only the team’s ${what} can do that.`);
const conflict = (message: string) => new ApiException("conflict", 409, message);

export interface Membership {
  teamId: string;
  role: TeamRole;
}

/** Work to do once the change that asked for it is committed. */
export type AfterCommit = () => Promise<void>;

/** What other modules do when someone leaves a team or the team goes (ADR 0019). */
export interface TeamExitHook {
  /** Inside the change: `userId` leaves `teamId` (or is removed); its owner is `ownerId`. */
  memberLeft?(
    tx: DatabaseExecutor,
    teamId: string,
    userId: string,
    ownerId: string,
  ): Promise<AfterCommit | undefined>;
  /** Inside the change, before the team's rows go. */
  teamDeleting?(tx: DatabaseExecutor, teamId: string): Promise<AfterCommit | undefined>;
}

/**
 * Team accounts (Phase 8, idea 19; ADR 0019). A person belongs to at most
 * one team; the owner's plan applies to every member. Invitations are to an
 * email address and are taken up by the verified account with that address,
 * from its Team page: no link in the email does anything by itself.
 */
@Injectable()
export class TeamsService {
  private readonly hooks: TeamExitHook[] = [];

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** Proxies and Drive register what they do with a team's shared things. */
  register(hook: TeamExitHook): void {
    this.hooks.push(hook);
  }

  async membership(
    userId: string,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<Membership | null> {
    const [row] = await executor
      .select({ teamId: schema.teamMembers.teamId, role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId))
      .limit(1);
    return row ?? null;
  }

  private async ownerOf(teamId: string, executor: DatabaseExecutor): Promise<string> {
    const [row] = await executor
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.role, "owner")))
      .limit(1);
    if (!row) throw new Error(`Team ${teamId} has no owner`);
    return row.userId;
  }

  /** Locks the caller's team for a change and checks their role. */
  private async lockMine(
    tx: DatabaseExecutor,
    userId: string,
    roles: readonly TeamRole[],
    what: string,
  ): Promise<Membership & { name: string }> {
    const membership = await this.membership(userId, tx);
    if (!membership) throw noTeam();
    const [team] = await tx
      .select({ name: schema.teams.name })
      .from(schema.teams)
      .where(eq(schema.teams.id, membership.teamId))
      .for("update");
    // Read again under the lock: the role may have changed meanwhile.
    const current = await this.membership(userId, tx);
    if (!team || current?.teamId !== membership.teamId) throw noTeam();
    if (!roles.includes(current.role)) throw notAllowed(what);
    return { ...current, name: team.name };
  }

  // ── Reads ───────────────────────────────────────────────────────────

  async overview(auth: AuthContext): Promise<TeamOverview> {
    const [membership, invitations, limits] = await Promise.all([
      this.membership(auth.user.id),
      this.invitationsFor(auth.user.email),
      this.billing.limitsFor(auth.user.id),
    ]);
    return {
      team: membership ? await this.describe(membership) : null,
      invitations: membership ? [] : invitations,
      seats: limits.teamMembers,
    };
  }

  private async describe(membership: Membership): Promise<Team> {
    const { teamId, role } = membership;
    const [team] = await this.database.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId));
    if (!team) throw noTeam();
    const members = await this.database.db
      .select({
        userId: schema.teamMembers.userId,
        email: schema.users.email,
        role: schema.teamMembers.role,
        joinedAt: schema.teamMembers.joinedAt,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
      .where(eq(schema.teamMembers.teamId, teamId))
      .orderBy(
        sql`case ${schema.teamMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
        asc(schema.users.email),
      );
    const owner = members.find((member) => member.role === "owner");
    const invitations =
      role === "member"
        ? []
        : await this.database.db
            .select({
              id: schema.teamInvitations.id,
              email: schema.teamInvitations.email,
              role: schema.teamInvitations.role,
              invitedBy: schema.users.email,
              createdAt: schema.teamInvitations.createdAt,
              expiresAt: schema.teamInvitations.expiresAt,
            })
            .from(schema.teamInvitations)
            .leftJoin(schema.users, eq(schema.users.id, schema.teamInvitations.invitedBy))
            .where(
              and(
                eq(schema.teamInvitations.teamId, teamId),
                gt(schema.teamInvitations.expiresAt, new Date()),
              ),
            )
            .orderBy(asc(schema.teamInvitations.email));
    const plan = owner ? await this.billing.planOf(owner.userId) : null;
    return {
      id: team.id,
      name: team.name,
      role,
      createdAt: team.createdAt.toISOString(),
      members: members.map((member) => ({
        ...member,
        joinedAt: member.joinedAt.toISOString(),
      })),
      invitations: invitations.map((invitation) => ({
        ...invitation,
        role: invitation.role === "admin" ? "admin" : "member",
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      })),
      seats: plan?.limits.teamMembers ?? TEAM_LIMITS.defaultMembers,
      planName: plan?.name ?? "Free",
    };
  }

  private async invitationsFor(email: string): Promise<InvitationForMe[]> {
    const rows = await this.database.db
      .select({
        id: schema.teamInvitations.id,
        teamName: schema.teams.name,
        invitedBy: schema.users.email,
        role: schema.teamInvitations.role,
        expiresAt: schema.teamInvitations.expiresAt,
      })
      .from(schema.teamInvitations)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamInvitations.teamId))
      .leftJoin(schema.users, eq(schema.users.id, schema.teamInvitations.invitedBy))
      .where(
        and(
          eq(schema.teamInvitations.email, email),
          gt(schema.teamInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.teams.name));
    return rows.map((row) => ({
      ...row,
      role: row.role === "admin" ? "admin" : "member",
      expiresAt: row.expiresAt.toISOString(),
    }));
  }

  // ── Changes ─────────────────────────────────────────────────────────

  async create(auth: AuthContext, name: string, meta: RequestMeta): Promise<TeamOverview> {
    const limits = await this.billing.limitsFor(auth.user.id);
    if (limits.teamMembers < 2) {
      throw conflict("Your plan doesn’t include a team. Choose a plan with team members first.");
    }
    if (await this.membership(auth.user.id)) {
      throw conflict("You’re already in a team. Leave it to start your own.");
    }
    await this.database.db.transaction(async (tx) => {
      const [team] = await tx.insert(schema.teams).values({ name }).returning();
      if (!team) throw new Error("The team was not created");
      try {
        await tx
          .insert(schema.teamMembers)
          .values({ teamId: team.id, userId: auth.user.id, role: "owner" });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("You’re already in a team. Leave it to start your own.");
        }
        throw error;
      }
      // Invitations to this person from other teams no longer apply.
      await tx
        .delete(schema.teamInvitations)
        .where(eq(schema.teamInvitations.email, auth.user.email));
    });
    await this.record(auth, meta, "team.created", { team: name });
    return this.overview(auth);
  }

  async rename(auth: AuthContext, name: string): Promise<TeamOverview> {
    await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner", "admin"], "owner or admins");
      await tx
        .update(schema.teams)
        .set({ name, updatedAt: new Date() })
        .where(eq(schema.teams.id, mine.teamId));
    });
    return this.overview(auth);
  }

  async invite(
    auth: AuthContext,
    email: string,
    role: "admin" | "member",
    meta: RequestMeta,
  ): Promise<TeamOverview> {
    await this.limiter.enforce(RATE_LIMITS.teamInvitationsPerAccount, auth.user.id);
    const address = email.trim().toLowerCase();
    // Inviting again re-sends the email: an address isn't mailed more than a few times a day.
    await this.limiter.enforce(RATE_LIMITS.teamInvitationsPerAddress, rateLimitSubject(address));
    const team = await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner", "admin"], "owner or admins");
      const owner = await this.ownerOf(mine.teamId, tx);
      const seats = (await this.billing.limitsFor(owner)).teamMembers;
      // One connection in a transaction: one query at a time.
      const members = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.teamId, mine.teamId));
      const pending = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.teamInvitations)
        .where(
          and(
            eq(schema.teamInvitations.teamId, mine.teamId),
            gt(schema.teamInvitations.expiresAt, new Date()),
            ne(schema.teamInvitations.email, address),
          ),
        );
      const already = await tx
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
        .where(and(eq(schema.teamMembers.teamId, mine.teamId), eq(schema.users.email, address)));
      if (already.length > 0) throw conflict("That person is already in the team.");
      if ((members[0]?.count ?? 0) + (pending[0]?.count ?? 0) >= seats) {
        throw conflict(
          `The team’s plan allows ${String(seats)} people, invitations included. Remove someone or withdraw an invitation first.`,
        );
      }
      const expiresAt = new Date(Date.now() + TEAM_LIMITS.invitationDays * DAY_MS);
      // Inviting the same address again renews the invitation.
      await tx
        .insert(schema.teamInvitations)
        .values({ teamId: mine.teamId, email: address, role, invitedBy: auth.user.id, expiresAt })
        .onConflictDoUpdate({
          target: [schema.teamInvitations.teamId, schema.teamInvitations.email],
          set: { role, invitedBy: auth.user.id, expiresAt, createdAt: new Date() },
        });
      return mine.name;
    });
    this.email.sendTeamInvitation(address, team, auth.user.email);
    await this.record(auth, meta, "team.invitation_sent", { team, role });
    return this.overview(auth);
  }

  async withdrawInvitation(auth: AuthContext, id: string): Promise<TeamOverview> {
    await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner", "admin"], "owner or admins");
      const removed = await tx
        .delete(schema.teamInvitations)
        .where(
          and(eq(schema.teamInvitations.id, id), eq(schema.teamInvitations.teamId, mine.teamId)),
        )
        .returning({ id: schema.teamInvitations.id });
      if (removed.length === 0) {
        throw new ApiException("not_found", 404, "That invitation doesn’t exist.");
      }
    });
    return this.overview(auth);
  }

  async decline(auth: AuthContext, id: string): Promise<TeamOverview> {
    const removed = await this.database.db
      .delete(schema.teamInvitations)
      .where(
        and(eq(schema.teamInvitations.id, id), eq(schema.teamInvitations.email, auth.user.email)),
      )
      .returning({ id: schema.teamInvitations.id });
    if (removed.length === 0) {
      throw new ApiException("not_found", 404, "That invitation doesn’t exist.");
    }
    return this.overview(auth);
  }

  async join(auth: AuthContext, id: string, meta: RequestMeta): Promise<TeamOverview> {
    if (auth.user.emailVerifiedAt === null) {
      throw conflict("Confirm your email address before joining a team.");
    }
    if (await this.billing.hasOwnSubscription(auth.user.id)) {
      throw conflict(
        "You have a subscription of your own. End it from your Account page first: in a team, the owner’s plan applies.",
      );
    }
    const team = await this.database.db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(schema.teamInvitations)
        .where(
          and(
            eq(schema.teamInvitations.id, id),
            eq(schema.teamInvitations.email, auth.user.email),
            gt(schema.teamInvitations.expiresAt, new Date()),
          ),
        );
      if (!invitation) {
        throw new ApiException("not_found", 404, "That invitation doesn’t exist or has expired.");
      }
      const [locked] = await tx
        .select({ name: schema.teams.name })
        .from(schema.teams)
        .where(eq(schema.teams.id, invitation.teamId))
        .for("update");
      if (!locked) throw new ApiException("not_found", 404, "That team no longer exists.");
      const owner = await this.ownerOf(invitation.teamId, tx);
      const seats = (await this.billing.limitsFor(owner)).teamMembers;
      const [members] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.teamId, invitation.teamId));
      if ((members?.count ?? 0) >= seats) {
        throw conflict("The team is full. Ask its owner to make room.");
      }
      try {
        await tx.insert(schema.teamMembers).values({
          teamId: invitation.teamId,
          userId: auth.user.id,
          role: invitation.role === "admin" ? "admin" : "member",
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict("You’re already in a team. Leave it to join another.");
        }
        throw error;
      }
      await tx
        .delete(schema.teamInvitations)
        .where(eq(schema.teamInvitations.email, auth.user.email));
      return locked.name;
    });
    await this.record(auth, meta, "team.joined", { team });
    return this.overview(auth);
  }

  async setRole(
    auth: AuthContext,
    userId: string,
    role: "admin" | "member",
    meta: RequestMeta,
  ): Promise<TeamOverview> {
    const team = await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner"], "owner");
      if (userId === auth.user.id) throw conflict("Hand the team to someone else instead.");
      const updated = await tx
        .update(schema.teamMembers)
        .set({ role })
        .where(
          and(eq(schema.teamMembers.teamId, mine.teamId), eq(schema.teamMembers.userId, userId)),
        )
        .returning({ userId: schema.teamMembers.userId });
      if (updated.length === 0)
        throw new ApiException("not_found", 404, "That person isn’t in the team.");
      return mine.name;
    });
    await this.record(auth, meta, "team.role_changed", { team, role }, userId);
    return this.overview(auth);
  }

  async remove(auth: AuthContext, userId: string, meta: RequestMeta): Promise<TeamOverview> {
    if (userId === auth.user.id) throw conflict("Leave the team instead.");
    const after: AfterCommit[] = [];
    const team = await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner", "admin"], "owner or admins");
      const [target] = await tx
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(eq(schema.teamMembers.teamId, mine.teamId), eq(schema.teamMembers.userId, userId)),
        );
      if (!target) throw new ApiException("not_found", 404, "That person isn’t in the team.");
      if (target.role === "owner") throw conflict("The owner can’t be removed.");
      if (mine.role === "admin" && target.role === "admin") throw notAllowed("owner");
      await this.depart(tx, mine.teamId, userId, after);
      return mine.name;
    });
    await this.runAfter(after);
    await this.record(auth, meta, "team.member_removed", { team }, userId);
    return this.overview(auth);
  }

  async leave(auth: AuthContext, meta: RequestMeta): Promise<TeamOverview> {
    const after: AfterCommit[] = [];
    const team = await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["admin", "member"], "admins and members");
      await this.depart(tx, mine.teamId, auth.user.id, after);
      return mine.name;
    });
    await this.runAfter(after);
    await this.record(auth, meta, "team.left", { team });
    return this.overview(auth);
  }

  /** The owner hands the team, and paying for it, to another member; they become an admin. */
  async transfer(auth: AuthContext, userId: string, meta: RequestMeta): Promise<TeamOverview> {
    if (userId === auth.user.id) throw conflict("You already own the team.");
    if (await this.billing.hasOwnSubscription(auth.user.id)) {
      // Nothing stops it, but the old owner keeps paying for their own subscription.
      logger.log(`Team owner ${auth.user.id} hands over a team while subscribed`);
    }
    const team = await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner"], "owner");
      const [target] = await tx
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(eq(schema.teamMembers.teamId, mine.teamId), eq(schema.teamMembers.userId, userId)),
        );
      if (!target) throw new ApiException("not_found", 404, "That person isn’t in the team.");
      // One owner at a time: step down first, then promote.
      await tx
        .update(schema.teamMembers)
        .set({ role: "admin" })
        .where(
          and(
            eq(schema.teamMembers.teamId, mine.teamId),
            eq(schema.teamMembers.userId, auth.user.id),
          ),
        );
      await tx
        .update(schema.teamMembers)
        .set({ role: "owner" })
        .where(
          and(eq(schema.teamMembers.teamId, mine.teamId), eq(schema.teamMembers.userId, userId)),
        );
      return mine.name;
    });
    await this.record(auth, meta, "team.ownership_transferred", { team, role: "owner" }, userId);
    await this.record(auth, meta, "team.ownership_transferred", { team, role: "admin" });
    return this.overview(auth);
  }

  /** Deletes the team and what it shares; every member keeps their own things. */
  async delete(auth: AuthContext, meta: RequestMeta): Promise<TeamOverview> {
    const after: AfterCommit[] = [];
    const { name, members } = await this.database.db.transaction(async (tx) => {
      const mine = await this.lockMine(tx, auth.user.id, ["owner"], "owner");
      return this.deleteLocked(tx, mine.teamId, mine.name, after);
    });
    await this.runAfter(after);
    await this.record(auth, meta, "team.deleted", { team: name });
    for (const userId of members) {
      if (userId !== auth.user.id)
        await this.record(auth, meta, "team.deleted", { team: name }, userId);
    }
    return this.overview(auth);
  }

  private async deleteLocked(
    tx: DatabaseExecutor,
    teamId: string,
    name: string,
    after: AfterCommit[],
  ) {
    const members = await tx
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, teamId));
    for (const hook of this.hooks) {
      const work = await hook.teamDeleting?.(tx, teamId);
      if (work) after.push(work);
    }
    await tx.delete(schema.teams).where(eq(schema.teams.id, teamId));
    return { name, members: members.map((member) => member.userId) };
  }

  /** Each module's follow-up; one failing doesn't stop the others. */
  private async runAfter(after: readonly AfterCommit[]): Promise<void> {
    for (const work of after) {
      try {
        await work();
      } catch (error) {
        logger.error(
          `Follow-up after a team change failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }
  }

  /**
   * Before an account is deleted: refused while it owns a team with other
   * members; a team it owns alone goes with it, and a team it is in keeps
   * what it shared.
   */
  async beforeAccountDeletion(userId: string): Promise<void> {
    const after: AfterCommit[] = [];
    await this.database.db.transaction(async (tx) => {
      const membership = await this.membership(userId, tx);
      if (!membership) return;
      await tx
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.id, membership.teamId))
        .for("update");
      if (membership.role !== "owner") {
        await this.depart(tx, membership.teamId, userId, after);
        return;
      }
      const others = await tx
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, membership.teamId),
            ne(schema.teamMembers.userId, userId),
          ),
        )
        .limit(1);
      if (others.length > 0) {
        throw conflict(
          "You own a team with other members. Hand it to one of them, or delete it, from the Team page first.",
        );
      }
      const [team] = await tx
        .select({ name: schema.teams.name })
        .from(schema.teams)
        .where(eq(schema.teams.id, membership.teamId));
      await this.deleteLocked(tx, membership.teamId, team?.name ?? "", after);
    });
    await this.runAfter(after);
  }

  private async depart(
    tx: DatabaseExecutor,
    teamId: string,
    userId: string,
    after: AfterCommit[],
  ): Promise<void> {
    const owner = await this.ownerOf(teamId, tx);
    for (const hook of this.hooks) {
      const work = await hook.memberLeft?.(tx, teamId, userId, owner);
      if (work) after.push(work);
    }
    await tx
      .delete(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  }

  /** For "download your data". */
  async forExport(userId: string) {
    const membership = await this.membership(userId);
    if (!membership) return null;
    const [team] = await this.database.db
      .select({ name: schema.teams.name })
      .from(schema.teams)
      .where(eq(schema.teams.id, membership.teamId));
    const [joined] = await this.database.db
      .select({ joinedAt: schema.teamMembers.joinedAt })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId));
    return {
      name: team?.name ?? "",
      role: membership.role,
      joinedAt: joined?.joinedAt.toISOString() ?? new Date(0).toISOString(),
    };
  }

  /** The retention job: invitations nobody took up. */
  async deleteExpiredInvitations(now = new Date()): Promise<number> {
    const removed = await this.database.db
      .delete(schema.teamInvitations)
      .where(lt(schema.teamInvitations.expiresAt, now))
      .returning({ id: schema.teamInvitations.id });
    return removed.length;
  }

  /** Every member of a team, for the modules that share things with it. */
  async memberIds(teamId: string): Promise<string[]> {
    const rows = await this.database.db
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, teamId));
    return rows.map((row) => row.userId);
  }

  private async record(
    auth: AuthContext,
    meta: RequestMeta,
    type:
      | "team.created"
      | "team.joined"
      | "team.left"
      | "team.member_removed"
      | "team.role_changed"
      | "team.ownership_transferred"
      | "team.deleted"
      | "team.invitation_sent",
    metadata: Record<string, string>,
    userId = auth.user.id,
  ): Promise<void> {
    const own = userId === auth.user.id;
    await this.events.record({
      type,
      userId,
      sessionId: own ? auth.session.id : null,
      // Someone else's history never shows the device or address of the person who acted.
      meta: own ? meta : { ip: null, userAgent: null },
      metadata,
    });
  }
}
