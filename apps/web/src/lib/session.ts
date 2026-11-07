import { type CurrentSessionResponse, currentSessionResponseSchema } from "@brawzer/contracts";
import { cache } from "react";
import { type ServerResult, serverGet } from "./server-api";

/**
 * Server only: who is signed in. Deduplicated per request, so the layout and
 * the page can both ask without a second API call.
 */
export const getSession = cache((): Promise<ServerResult<CurrentSessionResponse>> =>
  serverGet("/auth/session", currentSessionResponseSchema),
);
