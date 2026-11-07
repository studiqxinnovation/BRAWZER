import { type CurrentSessionResponse, currentSessionResponseSchema } from "@brawzer/contracts";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE_NAMES } from "./session-cookie";

export type SessionState =
  | { kind: "signed-in"; data: CurrentSessionResponse }
  | { kind: "signed-out" }
  | { kind: "unavailable" };

const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";

/**
 * Server only: asks the API who is signed in, forwarding just the session
 * cookie. Deduplicated per request, so a layout and a page can both call it.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  const jar = await cookies();
  const name = SESSION_COOKIE_NAMES.find((candidate) => jar.has(candidate));
  const value = name ? jar.get(name)?.value : undefined;
  if (!name || !value) return { kind: "signed-out" };

  try {
    const response = await fetch(`${apiOrigin}/api/v1/auth/session`, {
      headers: { accept: "application/json", cookie: `${name}=${value}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401) return { kind: "signed-out" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = currentSessionResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "signed-in", data: parsed.data } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
});
