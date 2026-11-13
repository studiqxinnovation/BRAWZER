import { securityEventPageSchema, securityOverviewSchema } from "@brawzer/contracts";
import { apiRequest } from "./client";

/** Shield's state: what's recommended, two-factor, passkeys, failed sign-ins. */
export const fetchSecurityOverview = () =>
  apiRequest("/security/overview", { schema: securityOverviewSchema });

/** The latest entries of the security history, newest first. */
export const fetchSecurityEvents = (limit = 3) =>
  apiRequest(`/security/events?limit=${String(limit)}`, { schema: securityEventPageSchema });
