import {
  MAX_SITE_RULES,
  type SiteRule,
  type SiteRuleKind,
  type SiteRulesForEgress,
} from "@brawzer/contracts";
import { and, asc, type DatabaseHandle, eq, schema, type SiteRuleRow } from "@brawzer/db";
import { parseHost } from "@brawzer/net-policy";
import { Inject, Injectable } from "@nestjs/common";
import { lockAccount } from "../common/account-lock.js";
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import { DATABASE } from "../database/database.module.js";

const notFound = () => new ApiException("not_found", 404, "That rule doesn’t exist.");

const invalid = (message: string) =>
  new ApiException("validation_failed", 400, "Some of the submitted values are invalid.", {
    details: [`host: ${message}`],
  });

function toRule(row: SiteRuleRow): SiteRule {
  return { id: row.id, kind: row.kind, host: row.host, createdAt: row.createdAt.toISOString() };
}

/**
 * An account's destination rules, applied by each session's egress (Phase 8,
 * idea 8): blocked hosts never open; once any allowed host exists, only
 * allowed hosts open. Hosts are stored lower-cased and in ASCII, and a rule
 * covers the host and its subdomains.
 */
@Injectable()
export class SiteRulesService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async list(userId: string): Promise<SiteRule[]> {
    const rows = await this.database.db
      .select()
      .from(schema.siteRules)
      .where(eq(schema.siteRules.userId, userId))
      .orderBy(asc(schema.siteRules.kind), asc(schema.siteRules.host));
    return rows.map(toRule);
  }

  async create(userId: string, kind: SiteRuleKind, input: string): Promise<SiteRule> {
    const host = this.normalize(input);
    return this.database.db.transaction(async (tx) => {
      await lockAccount(tx, userId);
      const existing = await tx
        .select({ id: schema.siteRules.id })
        .from(schema.siteRules)
        .where(eq(schema.siteRules.userId, userId));
      if (existing.length >= MAX_SITE_RULES) {
        throw new ApiException(
          "limit_reached",
          409,
          `You can have up to ${String(MAX_SITE_RULES)} site rules. Remove one to add another.`,
        );
      }
      try {
        const [row] = await tx.insert(schema.siteRules).values({ userId, kind, host }).returning();
        if (!row) throw notFound();
        return toRule(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiException("conflict", 409, "That host is already on this list.", {
            details: ["host: That host is already on this list."],
          });
        }
        throw error;
      }
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const removed = await this.database.db
      .delete(schema.siteRules)
      .where(and(eq(schema.siteRules.id, id), eq(schema.siteRules.userId, userId)))
      .returning({ id: schema.siteRules.id });
    if (removed.length === 0) throw notFound();
  }

  /** What a session's egress applies, or null when the account has no rules. */
  async forEgress(userId: string): Promise<SiteRulesForEgress | null> {
    const rules = await this.list(userId);
    if (rules.length === 0) return null;
    return {
      allow: rules.filter((rule) => rule.kind === "allow").map((rule) => rule.host),
      block: rules.filter((rule) => rule.kind === "block").map((rule) => rule.host),
    };
  }

  /** For "download your data". */
  async forExport(userId: string) {
    return (await this.list(userId)).map(({ kind, host, createdAt }) => ({
      kind,
      host,
      createdAt,
    }));
  }

  /** The stored form of a host: a leading "*." or "www." dropped, the rest as a resolver reads it. */
  private normalize(input: string): string {
    const trimmed = input
      .trim()
      .replace(/^\*\./, "")
      .replace(/^www\./i, "");
    const parsed = parseHost(trimmed);
    if (!parsed) throw invalid("Enter a website’s host name, such as example.com.");
    if (parsed.kind === "ip") return parsed.address;
    if (!parsed.name.includes(".")) throw invalid("Enter the full host name, such as example.com.");
    return parsed.name;
  }
}
