import { z } from "zod";

/** Must match the database enum `site_rule_kind` (a test in the API enforces this). */
export const siteRuleKinds = ["allow", "block"] as const;
export const siteRuleKindSchema = z.enum(siteRuleKinds, { error: "Choose allow or block." });

/** Rules per account; plenty for a family or a team's list, small enough to read. */
export const MAX_SITE_RULES = 200;

/**
 * A host as someone types it: the API checks it in full (international names
 * to ASCII, no surprising addresses). A leading "*." or "www." is accepted
 * and dropped: a rule always covers the host and every subdomain.
 */
export const siteRuleHostSchema = z
  .string({ error: "Enter a website’s host name, such as example.com." })
  .trim()
  .min(1, "Enter a website’s host name, such as example.com.")
  .max(255, "That host name is too long.")
  .refine((value) => !/[\s/@?#]/.test(value), {
    error: "Enter only the host name, without a scheme, path or anything else.",
  });

export const siteRuleSchema = z.object({
  id: z.uuid(),
  kind: siteRuleKindSchema,
  host: z.string(),
  createdAt: z.iso.datetime(),
});

export const siteRuleListSchema = z.object({
  rules: z.array(siteRuleSchema),
  limit: z.number().int().positive(),
});

export const createSiteRuleRequestSchema = z.object({
  kind: siteRuleKindSchema,
  host: siteRuleHostSchema,
});

/** What a session's egress applies: lower-cased hosts, each covering its subdomains. */
export const siteRulesForEgressSchema = z.object({
  allow: z.array(z.string().max(253)).max(MAX_SITE_RULES),
  block: z.array(z.string().max(253)).max(MAX_SITE_RULES),
});

/** True when `host` is `rule` or lies under it. */
export function hostMatchesRule(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}

/**
 * The decision the egress takes for `host`: a blocked host never opens; with
 * any allowed hosts, only those open. Block wins over allow.
 */
export function siteRulesDecision(
  host: string,
  rules: SiteRulesForEgress,
): "allowed" | "blocked" | "not_allowed" {
  const lower = host.toLowerCase();
  if (rules.block.some((rule) => hostMatchesRule(lower, rule))) return "blocked";
  if (rules.allow.length > 0 && !rules.allow.some((rule) => hostMatchesRule(lower, rule))) {
    return "not_allowed";
  }
  return "allowed";
}

export type SiteRuleKind = (typeof siteRuleKinds)[number];
export type SiteRule = z.infer<typeof siteRuleSchema>;
export type SiteRuleList = z.infer<typeof siteRuleListSchema>;
export type CreateSiteRuleRequest = z.infer<typeof createSiteRuleRequestSchema>;
export type SiteRulesForEgress = z.infer<typeof siteRulesForEgressSchema>;
