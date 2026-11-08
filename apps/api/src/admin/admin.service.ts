import {
  type AdminAccount,
  type AdminAccountList,
  type AdminAccountSummary,
  planSourceSchema,
  subscriptionStatusSchema,
} from "@brawzer/contracts";
import { and, count, type DatabaseHandle, desc, eq, ilike, isNull, lt, schema } from "@brawzer/db";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { BillingService } from "../billing/billing.service.js";

const logger = new Logger("Admin");

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

type UserRow = typeof schema.users.$inferSelect;

function summary(row: UserRow): AdminAccountSummary {
  const source = planSourceSchema.safeParse(row.planSource);
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    role: row.role,
    planCode: row.planCode,
    source: source.success ? source.data : "free",
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Administration (Phase 6): who is an administrator comes from the
 * installation's `ADMIN_EMAILS`, applied when those accounts are created and
 * again at every start. Administrators can look accounts up and set their
 * plan by hand, each change with a reason, recorded in that account's
 * security history.
 */
@Injectable()
export class AdminService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const emails = this.config.adminEmails;
    if (emails.length === 0) return;
    try {
      for (const email of emails) {
        await this.database.db
          .update(schema.users)
          .set({ role: "admin" })
          .where(and(eq(schema.users.email, email), eq(schema.users.role, "user")));
      }
    } catch (error) {
      logger.warn(`Could not apply ADMIN_EMAILS: ${error instanceof Error ? error.message : ""}`);
    }
  }

  /** Whether a new account with this address is an administrator. */
  isAdminEmail(email: string): boolean {
    return this.config.adminEmails.includes(email.trim().toLowerCase());
  }

  async list(query: { q?: string; before?: string; limit: number }): Promise<AdminAccountList> {
    const conditions = [];
    if (query.q) conditions.push(ilike(schema.users.email, `%${escapeLike(query.q)}%`));
    if (query.before) conditions.push(lt(schema.users.id, query.before));
    const rows = await this.database.db
      .select()
      .from(schema.users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.users.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      accounts: page.map(summary),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async account(id: string): Promise<AdminAccount> {
    const [row] = await this.database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    if (!row) throw new ApiException("not_found", 404, "That account doesn’t exist.");
    const [subscription] = await this.database.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, id))
      .limit(1);
    const [sessions] = await this.database.db
      .select({ count: count() })
      .from(schema.authSessions)
      .where(and(eq(schema.authSessions.userId, id), isNull(schema.authSessions.revokedAt)));
    const status = subscriptionStatusSchema.safeParse(subscription?.status);
    return {
      ...summary(row),
      usage: await this.billing.usage(id),
      limits: this.billing.plans.limits(row.planCode),
      subscription: subscription
        ? {
            status: status.success ? status.data : "canceled",
            planCode: subscription.planCode,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      activeSessions: sessions?.count ?? 0,
      planNote: row.planNote,
    };
  }

  async setPlan(
    actor: { user: { id: string }; session: { id: string } },
    id: string,
    planCode: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<AdminAccount> {
    await this.account(id);
    await this.billing.setPlanByAdmin(actor, id, planCode, reason, meta);
    return this.account(id);
  }
}
