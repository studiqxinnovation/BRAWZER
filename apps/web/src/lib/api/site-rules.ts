import { type CreateSiteRuleRequest, siteRuleSchema } from "@brawzer/contracts";
import { apiRequest } from "./client";

export const createSiteRule = (body: CreateSiteRuleRequest) =>
  apiRequest("/site-rules", { method: "POST", body, schema: siteRuleSchema });

export const deleteSiteRule = (id: string) =>
  apiRequest<undefined>(`/site-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
