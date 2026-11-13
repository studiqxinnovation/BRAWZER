import type {
  Announcement,
  AnnouncementRequest,
  StaffAnnouncement,
  StaffAnnouncementList,
} from "@brawzer/contracts";
import {
  and,
  count,
  type DatabaseHandle,
  desc,
  eq,
  inArray,
  isNotNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import { BillingService } from "../billing/billing.service.js";
import { ApiException } from "../common/api-exception.js";
import { DATABASE } from "../database/database.module.js";

type AnnouncementRow = typeof schema.announcements.$inferSelect;

const notFound = () => new ApiException("not_found", 404, "That announcement is gone.");

/**
 * Banners inside Brawzer (Phase 11.2). Staff publish them to an audience;
 * every account sees the ones meant for it until it dismisses them. Views
 * and clicks are counted per account.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  /* ── What a person sees ── */

  /** The live banners for this account, not yet dismissed. Seeing them is recorded. */
  async forUser(userId: string): Promise<Announcement[]> {
    const db = this.database.db;
    const now = new Date();
    const [user] = await db
      .select({ planCode: schema.users.planCode })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) return [];
    const live = await db
      .select()
      .from(schema.announcements)
      .where(
        and(eq(schema.announcements.on, true), sql`${schema.announcements.startsAt} <= ${now}`),
      )
      .orderBy(desc(schema.announcements.startsAt));
    const current = live.filter(
      (row) => row.endsAt === null || row.endsAt.getTime() > now.getTime(),
    );
    if (current.length === 0) return [];
    const [memberships, views] = await Promise.all([
      db
        .select({ teamId: schema.teamMembers.teamId })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.userId, userId))
        .limit(1),
      db
        .select({ id: schema.announcementViews.announcementId })
        .from(schema.announcementViews)
        .where(
          and(
            eq(schema.announcementViews.userId, userId),
            isNotNull(schema.announcementViews.dismissedAt),
            inArray(
              schema.announcementViews.announcementId,
              current.map((row) => row.id),
            ),
          ),
        ),
    ]);
    const dismissed = new Set(views.map((view) => view.id));
    const inTeam = memberships.length > 0;
    const shown = current.filter(
      (row) =>
        !dismissed.has(row.id) &&
        (row.audience === "everyone" ||
          (row.audience === "teams" && inTeam) ||
          row.audience === `plan:${user.planCode}`),
    );
    if (shown.length > 0) {
      await db
        .insert(schema.announcementViews)
        .values(shown.map((row) => ({ announcementId: row.id, userId })))
        .onConflictDoNothing();
    }
    return shown.map((row) => this.forPerson(row));
  }

  async dismiss(userId: string, id: string): Promise<void> {
    await this.mark(userId, id, { dismissedAt: new Date() });
  }

  async click(userId: string, id: string): Promise<void> {
    await this.mark(userId, id, { clickedAt: new Date() });
  }

  private async mark(
    userId: string,
    id: string,
    patch: { dismissedAt?: Date; clickedAt?: Date },
  ): Promise<void> {
    const [exists] = await this.database.db
      .select({ id: schema.announcements.id })
      .from(schema.announcements)
      .where(eq(schema.announcements.id, id))
      .limit(1);
    if (!exists) throw notFound();
    await this.database.db
      .insert(schema.announcementViews)
      .values({ announcementId: id, userId, ...patch })
      .onConflictDoUpdate({
        target: [schema.announcementViews.announcementId, schema.announcementViews.userId],
        set: patch,
      });
  }

  /* ── The console ── */

  async list(): Promise<StaffAnnouncementList> {
    const db = this.database.db;
    const [rows, plans, counts] = await Promise.all([
      db
        .select({ announcement: schema.announcements, by: schema.users.email })
        .from(schema.announcements)
        .leftJoin(schema.users, eq(schema.users.id, schema.announcements.createdById))
        .orderBy(desc(schema.announcements.createdAt)),
      this.billing.publicPlans(),
      db
        .select({
          id: schema.announcementViews.announcementId,
          views: count(),
          clicks: count(schema.announcementViews.clickedAt),
        })
        .from(schema.announcementViews)
        .groupBy(schema.announcementViews.announcementId),
    ]);
    const countBy = new Map(counts.map((row) => [row.id, row]));
    return {
      announcements: rows.map(({ announcement, by }) => ({
        ...this.forPerson(announcement),
        audience: announcement.audience,
        on: announcement.on,
        endsAt: announcement.endsAt?.toISOString() ?? null,
        incidentId: announcement.incidentId,
        createdBy: by,
        createdAt: announcement.createdAt.toISOString(),
        views: countBy.get(announcement.id)?.views ?? 0,
        clicks: countBy.get(announcement.id)?.clicks ?? 0,
      })),
      plans: plans.map((plan) => ({ code: plan.code, name: plan.name })),
    };
  }

  async create(
    actorId: string,
    body: AnnouncementRequest,
    incidentId: string | null = null,
  ): Promise<StaffAnnouncement["id"]> {
    const [row] = await this.database.db
      .insert(schema.announcements)
      .values({
        title: body.title,
        body: body.body,
        kind: body.kind,
        audience: body.audience,
        link: body.link ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : new Date(),
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        incidentId,
        createdById: actorId,
      })
      .returning({ id: schema.announcements.id });
    if (!row) throw new Error("The announcement was not created");
    return row.id;
  }

  async update(id: string, body: AnnouncementRequest): Promise<void> {
    const updated = await this.database.db
      .update(schema.announcements)
      .set({
        title: body.title,
        body: body.body,
        kind: body.kind,
        audience: body.audience,
        link: body.link ?? null,
        ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined
          ? { endsAt: body.endsAt ? new Date(body.endsAt) : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.announcements.id, id))
      .returning({ id: schema.announcements.id });
    if (updated.length === 0) throw notFound();
  }

  async toggle(id: string, on: boolean): Promise<string> {
    const [row] = await this.database.db
      .update(schema.announcements)
      .set({ on, updatedAt: new Date() })
      .where(eq(schema.announcements.id, id))
      .returning({ title: schema.announcements.title });
    if (!row) throw notFound();
    return row.title;
  }

  /** Turns off every banner that belongs to an incident (when it is resolved). */
  async turnOffForIncident(incidentId: string): Promise<void> {
    await this.database.db
      .update(schema.announcements)
      .set({ on: false, updatedAt: new Date() })
      .where(eq(schema.announcements.incidentId, incidentId));
  }

  async remove(id: string): Promise<string> {
    const [row] = await this.database.db
      .delete(schema.announcements)
      .where(eq(schema.announcements.id, id))
      .returning({ title: schema.announcements.title });
    if (!row) throw notFound();
    return row.title;
  }

  /** Maintenance banners that are on, for the status page. */
  async maintenance(): Promise<AnnouncementRow[]> {
    const now = new Date();
    const rows = await this.database.db
      .select()
      .from(schema.announcements)
      .where(and(eq(schema.announcements.on, true), eq(schema.announcements.kind, "maintenance")))
      .orderBy(schema.announcements.startsAt);
    return rows.filter((row) => row.endsAt === null || row.endsAt.getTime() > now.getTime());
  }

  private forPerson(row: AnnouncementRow): Announcement {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      startsAt: row.startsAt.toISOString(),
    };
  }
}
