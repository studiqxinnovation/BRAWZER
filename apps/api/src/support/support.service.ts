import {
  type createTicketRequestSchema,
  responseTargetMinutes,
  type SavedReply,
  type SavedReplyRequest,
  type StaffReplyRequest,
  type StaffTicketSummary,
  type staffTicketQuerySchema,
  type SupportStats,
  type Ticket,
  type TicketCategory,
  ticketCategoryNames,
  type TicketMessage,
  type TicketStatus,
  type TicketSummary,
  type UpdateTicketRequest,
} from "@brawzer/contracts";
import {
  and,
  count,
  type DatabaseHandle,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { z } from "zod";
import { BillingService } from "../billing/billing.service.js";
import type { AuthContext } from "../auth/session.service.js";
import { ApiException } from "../common/api-exception.js";
import { DATABASE } from "../database/database.module.js";
import { EmailService } from "../email/email.js";
import { maskEmail } from "../email/transports.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";

type TicketRow = typeof schema.supportTickets.$inferSelect;
type MessageRow = typeof schema.supportMessages.$inferSelect;

/** Who is doing something in the console. */
export interface StaffViewer {
  user: { id: string; email: string; role: string };
}

const DAY = 86_400_000;
const MINUTE = 60_000;
/** How many requests the inbox lists at once. */
const LIST_LIMIT = 200;

const notFound = () => new ApiException("not_found", 404, "That request doesn’t exist.");

const handleOf = (email: string) => email.split("@")[0] ?? email;

/** The first line of a message, cut for a list. */
function previewOf(body: string): string {
  const line = body.split("\n").find((part) => part.trim()) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * Support requests (Phase 11.2). Customers write from Help; staff answer from
 * the console's inbox; replies also go by email. Internal notes stay with
 * staff. Nothing is invented: response targets are Brawzer's own, by priority.
 */
@Injectable()
export class SupportService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.metrics.gauge("brawzer_support_tickets_open", "Support requests waiting.", async () => {
      const [row] = await this.database.db
        .select({ value: count() })
        .from(schema.supportTickets)
        .where(eq(schema.supportTickets.status, "open"));
      return [{ value: row?.value ?? 0 }];
    });
  }

  /* ── The customer's side ── */

  async create(
    auth: AuthContext,
    body: z.output<typeof createTicketRequestSchema>,
  ): Promise<Ticket> {
    await this.limiter.enforce(RATE_LIMITS.supportTicketsPerAccount, auth.user.id);
    const ticket = await this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.supportTickets)
        .values({ userId: auth.user.id, subject: body.subject, category: body.category })
        .returning();
      if (!created) throw new Error("The request was not created");
      await tx.insert(schema.supportMessages).values({
        ticketId: created.id,
        authorId: auth.user.id,
        kind: "customer",
        body: body.body,
      });
      return created;
    });
    this.email.sendTicketReceived(auth.user.email, ticket.number, ticket.subject, ticket.id);
    this.email.notifyAdmins(
      "ticket",
      [
        ["Request", `#${String(ticket.number)}`],
        ["Subject", ticket.subject],
        ["About", ticketCategoryNames[ticket.category]],
        ["From", maskEmail(auth.user.email)],
      ],
      `ticket:${ticket.id}`,
    );
    return this.oneFor(auth.user.id, ticket.id);
  }

  async listFor(userId: string): Promise<TicketSummary[]> {
    const rows = await this.database.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.userId, userId))
      .orderBy(desc(schema.supportTickets.updatedAt))
      .limit(100);
    const previews = await this.previews(
      rows.map((row) => row.id),
      false,
    );
    return rows.map((row) => this.summary(row, previews.get(row.id) ?? ""));
  }

  async oneFor(userId: string, id: string): Promise<Ticket> {
    const row = await this.rowFor(userId, id);
    const messages = await this.messages(id, false);
    return {
      ...this.summary(row, previewOf(messages.at(-1)?.body ?? "")),
      messages,
    };
  }

  /** A customer's reply: the request is open again, whatever it was. */
  async replyFor(auth: AuthContext, id: string, body: string): Promise<Ticket> {
    await this.limiter.enforce(RATE_LIMITS.supportMessagesPerAccount, auth.user.id);
    const row = await this.rowFor(auth.user.id, id);
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx
        .insert(schema.supportMessages)
        .values({ ticketId: id, authorId: auth.user.id, kind: "customer", body });
      if (row.status === "solved") {
        await tx.insert(schema.supportMessages).values({
          ticketId: id,
          kind: "system",
          body: "Reopened by the customer’s reply.",
        });
      }
      await tx
        .update(schema.supportTickets)
        .set({ status: "open", lastCustomerMessageAt: now, updatedAt: now })
        .where(eq(schema.supportTickets.id, id));
    });
    return this.oneFor(auth.user.id, id);
  }

  /** The customer marks it solved themselves. */
  async solveFor(auth: AuthContext, id: string): Promise<Ticket> {
    const row = await this.rowFor(auth.user.id, id);
    if (row.status !== "solved") {
      const now = new Date();
      await this.database.db.transaction(async (tx) => {
        await tx
          .insert(schema.supportMessages)
          .values({ ticketId: id, kind: "system", body: "Marked solved by the customer." });
        await tx
          .update(schema.supportTickets)
          .set({ status: "solved", solvedAt: now, updatedAt: now })
          .where(eq(schema.supportTickets.id, id));
      });
    }
    return this.oneFor(auth.user.id, id);
  }

  /** A rating once solved. Three or less reopens the request for a follow-up. */
  async rateFor(
    auth: AuthContext,
    id: string,
    rating: number,
    comment: string | undefined,
  ): Promise<Ticket> {
    const row = await this.rowFor(auth.user.id, id);
    if (row.status !== "solved") {
      throw new ApiException("conflict", 409, "Rate a request once it’s solved.");
    }
    const now = new Date();
    const low = rating <= 3;
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(schema.supportTickets)
        .set({
          rating,
          ratingComment: comment?.trim() ? comment.trim() : null,
          ratedAt: now,
          updatedAt: now,
          ...(low ? { status: "open" as const } : {}),
        })
        .where(eq(schema.supportTickets.id, id));
      await tx.insert(schema.supportMessages).values({
        ticketId: id,
        kind: "system",
        body: low
          ? `Rated ${String(rating)} of 5. Reopened for a follow-up.`
          : `Rated ${String(rating)} of 5.`,
      });
    });
    return this.oneFor(auth.user.id, id);
  }

  /* ── The console's inbox ── */

  async list(
    viewer: StaffViewer,
    query: z.output<typeof staffTicketQuerySchema>,
  ): Promise<{ tickets: StaffTicketSummary[]; counts: Record<TicketStatus | "all", number> }> {
    const db = this.database.db;
    const conditions = [];
    if (query.view !== "all") conditions.push(eq(schema.supportTickets.status, query.view));
    if (query.mine) conditions.push(eq(schema.supportTickets.assigneeId, viewer.user.id));
    const rows = await db
      .select({ ticket: schema.supportTickets, email: schema.users.email })
      .from(schema.supportTickets)
      .innerJoin(schema.users, eq(schema.users.id, schema.supportTickets.userId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.supportTickets.updatedAt))
      .limit(LIST_LIMIT);
    const q = query.q?.toLowerCase() ?? "";
    const kept = q
      ? rows.filter(({ ticket, email }) =>
          `#${String(ticket.number)} ${ticket.subject} ${email} ${ticket.id}`
            .toLowerCase()
            .includes(q),
        )
      : rows;
    const tickets = await this.staffSummaries(
      viewer,
      kept.map((row) => row.ticket),
    );
    // Closest to missing a first reply first; then whoever has waited longest.
    tickets.sort((a, b) => {
      const dueA = a.responseDueAt ? Date.parse(a.responseDueAt) : Number.POSITIVE_INFINITY;
      const dueB = b.responseDueAt ? Date.parse(b.responseDueAt) : Number.POSITIVE_INFINITY;
      if (dueA !== dueB) return dueA - dueB;
      return Date.parse(a.lastCustomerMessageAt) - Date.parse(b.lastCustomerMessageAt);
    });
    const countRows = await db
      .select({ status: schema.supportTickets.status, value: count() })
      .from(schema.supportTickets)
      .where(query.mine ? eq(schema.supportTickets.assigneeId, viewer.user.id) : undefined)
      .groupBy(schema.supportTickets.status);
    const counts: Record<TicketStatus | "all", number> = { open: 0, pending: 0, solved: 0, all: 0 };
    for (const row of countRows) {
      counts[row.status] = row.value;
      counts.all += row.value;
    }
    return { tickets, counts };
  }

  /** One request for staff: every message, notes included. The account itself is added by the caller. */
  async one(
    viewer: StaffViewer,
    id: string,
  ): Promise<StaffTicketSummary & { messages: TicketMessage[] }> {
    const [row] = await this.database.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.id, id))
      .limit(1);
    if (!row) throw notFound();
    const [summary] = await this.staffSummaries(viewer, [row]);
    if (!summary) throw notFound();
    return { ...summary, messages: await this.messages(id, true) };
  }

  async update(
    actor: StaffViewer,
    id: string,
    body: UpdateTicketRequest,
  ): Promise<{ before: TicketRow; after: TicketRow }> {
    const before = await this.row(id);
    if (body.assigneeId) {
      const [assignee] = await this.database.db
        .select({ role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, body.assigneeId))
        .limit(1);
      if (!assignee || !["admin", "care"].includes(assignee.role)) {
        throw new ApiException("validation_failed", 422, "Assign requests to customer care staff.");
      }
    }
    const now = new Date();
    const after = await this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.supportTickets)
        .set({
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.status === "solved" ? { solvedAt: now } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
          updatedAt: now,
        })
        .where(eq(schema.supportTickets.id, id))
        .returning();
      if (!updated) throw notFound();
      if (body.status !== undefined && body.status !== before.status) {
        await tx.insert(schema.supportMessages).values({
          ticketId: id,
          authorId: actor.user.id,
          kind: "system",
          body: `Status: ${body.status === "pending" ? "waiting on customer" : body.status} (${handleOf(actor.user.email)}).`,
        });
      }
      return updated;
    });
    return { before, after };
  }

  /** A reply goes to the customer by email; a note stays here. */
  async reply(
    actor: StaffViewer,
    id: string,
    body: StaffReplyRequest,
  ): Promise<{ ticket: TicketRow; emailedTo: string | null }> {
    const row = await this.row(id);
    const now = new Date();
    if (body.kind === "note") {
      await this.database.db.transaction(async (tx) => {
        await tx
          .insert(schema.supportMessages)
          .values({ ticketId: id, authorId: actor.user.id, kind: "note", body: body.body });
        await tx
          .update(schema.supportTickets)
          .set({ updatedAt: now })
          .where(eq(schema.supportTickets.id, id));
      });
      return { ticket: row, emailedTo: null };
    }
    const status = body.setStatus ?? "pending";
    const updated = await this.database.db.transaction(async (tx) => {
      await tx
        .insert(schema.supportMessages)
        .values({ ticketId: id, authorId: actor.user.id, kind: "staff", body: body.body });
      const [after] = await tx
        .update(schema.supportTickets)
        .set({
          status,
          updatedAt: now,
          ...(row.firstResponseAt ? {} : { firstResponseAt: now }),
          ...(status === "solved" ? { solvedAt: now } : {}),
        })
        .where(eq(schema.supportTickets.id, id))
        .returning();
      if (!after) throw notFound();
      return after;
    });
    const [customer] = await this.database.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, row.userId))
      .limit(1);
    if (customer) {
      this.email.sendTicketReply(
        customer.email,
        row.number,
        row.subject,
        body.body,
        status === "solved",
        id,
      );
    }
    return { ticket: updated, emailedTo: customer?.email ?? null };
  }

  /** Who a request can be assigned to: customer care and founders. */
  async assignees(): Promise<{ id: string; email: string }[]> {
    return this.database.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.role, ["admin", "care"]))
      .orderBy(schema.users.email);
  }

  /* ── Saved replies ── */

  async savedReplies(): Promise<SavedReply[]> {
    const rows = await this.database.db
      .select({ reply: schema.supportSavedReplies, by: schema.users.email })
      .from(schema.supportSavedReplies)
      .leftJoin(schema.users, eq(schema.users.id, schema.supportSavedReplies.updatedById))
      .orderBy(schema.supportSavedReplies.name);
    return rows.map(({ reply, by }) => ({
      id: reply.id,
      name: reply.name,
      body: reply.body,
      updatedAt: reply.updatedAt.toISOString(),
      updatedBy: by,
    }));
  }

  async saveReply(actor: StaffViewer, id: string | null, body: SavedReplyRequest): Promise<void> {
    const db = this.database.db;
    if (id === null) {
      await db
        .insert(schema.supportSavedReplies)
        .values({ name: body.name, body: body.body, updatedById: actor.user.id });
      return;
    }
    const updated = await db
      .update(schema.supportSavedReplies)
      .set({ name: body.name, body: body.body, updatedById: actor.user.id, updatedAt: new Date() })
      .where(eq(schema.supportSavedReplies.id, id))
      .returning({ id: schema.supportSavedReplies.id });
    if (updated.length === 0) {
      throw new ApiException("not_found", 404, "That saved reply is gone.");
    }
  }

  async deleteReply(id: string): Promise<string> {
    const deleted = await this.database.db
      .delete(schema.supportSavedReplies)
      .where(eq(schema.supportSavedReplies.id, id))
      .returning({ name: schema.supportSavedReplies.name });
    const [row] = deleted;
    if (!row) throw new ApiException("not_found", 404, "That saved reply is gone.");
    return row.name;
  }

  /* ── Support performance ── */

  async stats(viewer: StaffViewer): Promise<SupportStats> {
    const db = this.database.db;
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY);
    const fortnightAgo = new Date(now - 14 * DAY);
    const [open, recent, rated, ratingRows] = await Promise.all([
      db
        .select({ ticket: schema.supportTickets, assignee: schema.users.email })
        .from(schema.supportTickets)
        .leftJoin(schema.users, eq(schema.users.id, schema.supportTickets.assigneeId))
        .where(inArray(schema.supportTickets.status, ["open", "pending"])),
      db
        .select({ ticket: schema.supportTickets, assignee: schema.users.email })
        .from(schema.supportTickets)
        .leftJoin(schema.users, eq(schema.users.id, schema.supportTickets.assigneeId))
        .where(gte(schema.supportTickets.updatedAt, fortnightAgo)),
      db
        .select({
          value: count(),
          total: sql<number>`coalesce(sum(${schema.supportTickets.rating}), 0)`,
        })
        .from(schema.supportTickets)
        .where(isNotNull(schema.supportTickets.rating)),
      db
        .select({ ticket: schema.supportTickets, email: schema.users.email })
        .from(schema.supportTickets)
        .innerJoin(schema.users, eq(schema.users.id, schema.supportTickets.userId))
        .where(and(isNotNull(schema.supportTickets.rating), lte(schema.supportTickets.rating, 3)))
        .orderBy(desc(schema.supportTickets.ratedAt))
        .limit(50),
    ]);

    const pastTarget = open.filter(
      ({ ticket }) =>
        ticket.status === "open" &&
        ticket.firstResponseAt === null &&
        ticket.createdAt.getTime() + responseTargetMinutes[ticket.priority] * MINUTE < now,
    ).length;
    const firstReplies = recent
      .map(({ ticket }) => ticket)
      .filter(
        (ticket) =>
          ticket.firstResponseAt !== null && ticket.firstResponseAt.getTime() >= weekAgo.getTime(),
      );
    const waits = firstReplies
      .map(
        (ticket) =>
          ((ticket.firstResponseAt?.getTime() ?? 0) - ticket.createdAt.getTime()) / MINUTE,
      )
      .sort((a, b) => a - b);
    const median = waits.length
      ? waits.length % 2
        ? (waits[(waits.length - 1) / 2] ?? 0)
        : ((waits[waits.length / 2 - 1] ?? 0) + (waits[waits.length / 2] ?? 0)) / 2
      : null;
    const withinTarget = firstReplies.filter(
      (ticket) =>
        ((ticket.firstResponseAt?.getTime() ?? 0) - ticket.createdAt.getTime()) / MINUTE <=
        responseTargetMinutes[ticket.priority],
    ).length;
    const solved7d = recent.filter(
      ({ ticket }) => ticket.solvedAt !== null && ticket.solvedAt.getTime() >= weekAgo.getTime(),
    );

    const byCategory = new Map<TicketCategory, number>();
    for (const { ticket } of open) {
      if (ticket.status === "open")
        byCategory.set(ticket.category, (byCategory.get(ticket.category) ?? 0) + 1);
    }
    const byAgent = new Map<string, { open: number; solved7d: number }>();
    for (const { ticket, assignee } of open) {
      if (!assignee || ticket.status !== "open") continue;
      const entry = byAgent.get(assignee) ?? { open: 0, solved7d: 0 };
      entry.open += 1;
      byAgent.set(assignee, entry);
    }
    for (const { assignee } of solved7d) {
      if (!assignee) continue;
      const entry = byAgent.get(assignee) ?? { open: 0, solved7d: 0 };
      entry.solved7d += 1;
      byAgent.set(assignee, entry);
    }

    const perDay: SupportStats["perDay"] = [];
    for (let back = 13; back >= 0; back -= 1) {
      const day = new Date(now - back * DAY).toISOString().slice(0, 10);
      perDay.push({
        day,
        opened: recent.filter(({ ticket }) => ticket.createdAt.toISOString().slice(0, 10) === day)
          .length,
        solved: recent.filter(({ ticket }) => ticket.solvedAt?.toISOString().slice(0, 10) === day)
          .length,
      });
    }

    const founder = viewer.user.role === "admin";
    const ratedRow = rated[0];
    const assigneesById = new Map(
      [...open, ...recent].map(({ ticket, assignee }) => [ticket.id, assignee] as const),
    );
    // A low rating counts as followed up once staff wrote after it.
    const followUps = ratingRows.length
      ? await db
          .select({
            ticketId: schema.supportMessages.ticketId,
            at: sql<Date>`max(${schema.supportMessages.createdAt})`,
          })
          .from(schema.supportMessages)
          .where(
            and(
              inArray(
                schema.supportMessages.ticketId,
                ratingRows.map(({ ticket }) => ticket.id),
              ),
              eq(schema.supportMessages.kind, "staff"),
            ),
          )
          .groupBy(schema.supportMessages.ticketId)
      : [];
    const lastStaffAt = new Map(followUps.map((row) => [row.ticketId, new Date(row.at).getTime()]));

    return {
      open: open.filter(({ ticket }) => ticket.status === "open").length,
      pending: open.filter(({ ticket }) => ticket.status === "pending").length,
      pastTarget,
      solved7d: solved7d.length,
      firstResponse: {
        count: firstReplies.length,
        medianMinutes: median === null ? null : Math.round(median),
        withinTargetPercent: firstReplies.length
          ? Math.round((withinTarget / firstReplies.length) * 100)
          : null,
      },
      ratings: {
        count: ratedRow?.value ?? 0,
        average: ratedRow?.value ? Math.round((ratedRow.total / ratedRow.value) * 10) / 10 : null,
        low: ratingRows.length,
      },
      byCategory: [...byCategory.entries()]
        .map(([category, value]) => ({ category, open: value }))
        .sort((a, b) => b.open - a.open),
      byAgent: [...byAgent.entries()]
        .map(([email, value]) => ({ email, ...value }))
        .sort((a, b) => b.open - a.open),
      perDay,
      lowRatings: ratingRows.map(({ ticket, email }) => ({
        id: ticket.id,
        number: ticket.number,
        subject: ticket.subject,
        rating: ticket.rating ?? 0,
        comment: ticket.ratingComment,
        ratedAt: (ticket.ratedAt ?? ticket.updatedAt).toISOString(),
        customer: founder ? email : handleOf(email),
        assignee: assigneesById.get(ticket.id) ?? null,
        followedUp: (lastStaffAt.get(ticket.id) ?? 0) > (ticket.ratedAt?.getTime() ?? 0),
      })),
    };
  }

  /* ── Shared ── */

  private async row(id: string): Promise<TicketRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.supportTickets)
      .where(eq(schema.supportTickets.id, id))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  private async rowFor(userId: string, id: string): Promise<TicketRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.supportTickets)
      .where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.userId, userId)))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  private summary(row: TicketRow, preview: string): TicketSummary {
    return {
      id: row.id,
      number: row.number,
      subject: row.subject,
      category: row.category,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      preview,
      rating: row.rating,
    };
  }

  /** The newest message shown to a customer (or, for staff, any) per request. */
  private async previews(ids: readonly string[], withNotes: boolean): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.database.db
      .select({ ticketId: schema.supportMessages.ticketId, body: schema.supportMessages.body })
      .from(schema.supportMessages)
      .where(
        and(
          inArray(schema.supportMessages.ticketId, [...ids]),
          withNotes ? undefined : inArray(schema.supportMessages.kind, ["customer", "staff"]),
        ),
      )
      .orderBy(schema.supportMessages.createdAt);
    const out = new Map<string, string>();
    for (const row of rows) out.set(row.ticketId, previewOf(row.body));
    return out;
  }

  private async messages(id: string, withNotes: boolean): Promise<TicketMessage[]> {
    const rows = await this.database.db
      .select({ message: schema.supportMessages, email: schema.users.email })
      .from(schema.supportMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.supportMessages.authorId))
      .where(
        and(
          eq(schema.supportMessages.ticketId, id),
          withNotes
            ? undefined
            : inArray(schema.supportMessages.kind, ["customer", "staff", "system"]),
        ),
      )
      .orderBy(schema.supportMessages.createdAt);
    return rows.map(({ message, email }) => this.message(message, email, withNotes));
  }

  private message(row: MessageRow, email: string | null, staffView: boolean): TicketMessage {
    const author =
      row.kind === "system"
        ? "Brawzer"
        : row.kind === "customer"
          ? email
            ? staffView
              ? email
              : handleOf(email)
            : "Customer"
          : staffView
            ? (email ?? "staff")
            : "Brawzer support";
    return {
      id: row.id,
      kind: row.kind,
      author,
      body: row.body,
      at: row.createdAt.toISOString(),
    };
  }

  private async staffSummaries(
    viewer: StaffViewer,
    rows: readonly TicketRow[],
  ): Promise<StaffTicketSummary[]> {
    if (rows.length === 0) return [];
    const db = this.database.db;
    const userIds = [...new Set(rows.map((row) => row.userId))];
    const assigneeIds = [
      ...new Set(rows.flatMap((row) => (row.assigneeId ? [row.assigneeId] : []))),
    ];
    const [users, assignees, plans, planCodes, teams, previews] = await Promise.all([
      db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds)),
      assigneeIds.length
        ? db
            .select({ id: schema.users.id, email: schema.users.email })
            .from(schema.users)
            .where(inArray(schema.users.id, assigneeIds))
        : Promise.resolve([]),
      this.billing.publicPlans(),
      this.billing.plansOf(userIds),
      db
        .select({ userId: schema.teamMembers.userId, name: schema.teams.name })
        .from(schema.teamMembers)
        .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
        .where(inArray(schema.teamMembers.userId, userIds)),
      this.previews(
        rows.map((row) => row.id),
        true,
      ),
    ]);
    const founder = viewer.user.role === "admin";
    const userBy = new Map(users.map((user) => [user.id, user.email]));
    const assigneeBy = new Map(assignees.map((user) => [user.id, user.email]));
    const planBy = new Map(plans.map((plan) => [plan.code, plan.name]));
    const teamBy = new Map(teams.map((team) => [team.userId, team.name]));
    return rows.map((row) => {
      const email = userBy.get(row.userId) ?? "";
      const planCode = planCodes.get(row.userId) ?? "free";
      return {
        ...this.summary(row, previews.get(row.id) ?? ""),
        priority: row.priority,
        lastCustomerMessageAt: row.lastCustomerMessageAt.toISOString(),
        firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
        solvedAt: row.solvedAt?.toISOString() ?? null,
        ratingComment: row.ratingComment,
        responseDueAt:
          row.firstResponseAt === null && row.status !== "solved"
            ? new Date(
                row.createdAt.getTime() + responseTargetMinutes[row.priority] * MINUTE,
              ).toISOString()
            : null,
        assignee: row.assigneeId
          ? { id: row.assigneeId, email: assigneeBy.get(row.assigneeId) ?? "(account gone)" }
          : null,
        customer: {
          id: row.userId,
          handle: handleOf(email),
          email: founder ? email : maskEmail(email),
          planName: planBy.get(planCode) ?? planCode,
          teamName: teamBy.get(row.userId) ?? null,
        },
      };
    });
  }
}
