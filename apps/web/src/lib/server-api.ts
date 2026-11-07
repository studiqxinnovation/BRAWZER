import { cookies } from "next/headers";
import type { Route } from "next";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { SESSION_COOKIE_NAMES } from "./session-cookie";

/** `receivedAt` (ok only): when the data was read, for "5 minutes ago"-style times. */
export type ServerResult<T> =
  { kind: "ok"; data: T; receivedAt: number } | { kind: "signed-out" } | { kind: "unavailable" };

const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";

/**
 * Server only: reads from the API as the signed-in person. Only the session
 * cookie is forwarded, never the browser's other cookies or headers. Counts
 * as activity, like any page load.
 */
export async function serverGet<T>(
  path: `/${string}`,
  schema: z.ZodType<T>,
): Promise<ServerResult<T>> {
  const jar = await cookies();
  const name = SESSION_COOKIE_NAMES.find((candidate) => jar.has(candidate));
  const value = name ? jar.get(name)?.value : undefined;
  if (!name || !value) return { kind: "signed-out" };

  try {
    const response = await fetch(`${apiOrigin}/api/v1${path}`, {
      headers: { accept: "application/json", cookie: `${name}=${value}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401) return { kind: "signed-out" };
    if (!response.ok) return { kind: "unavailable" };
    const parsed = schema.safeParse(await response.json());
    return parsed.success
      ? { kind: "ok", data: parsed.data, receivedAt: Date.now() }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Sends someone whose session ended to sign in again, then back to `path`.
 * Visitors without any session cookie never get this far: proxy.ts
 * redirects them first.
 */
export function signInAgain(path: Route): never {
  redirect(`/sign-in?${new URLSearchParams({ next: path, expired: "1" }).toString()}` as Route);
}
