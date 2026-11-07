import { type ApiError, apiErrorSchema } from "@brawzer/contracts";
import type { z } from "zod";

export type ApiFailure = ApiError["error"];

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiFailure };

const unreachable: ApiFailure = {
  code: "service_unavailable",
  message: "Brawzer can’t be reached. Check your internet connection and try again.",
};

const unexpected: ApiFailure = {
  code: "internal_error",
  message: "Something went wrong on our side. Try again in a moment.",
};

/**
 * Calls Brawzer's API from the browser through the site's own origin
 * (/api/v1 is forwarded by the web server), so the session cookie is
 * first-party and never readable by scripts. Never throws: every outcome,
 * including a network failure, comes back as a result.
 */
export async function apiRequest<T>(
  path: `/${string}`,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    schema?: z.ZodType<T>;
  } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: unreachable };
  }

  const payload: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    // A gateway error page (the API is down behind the web server) has no envelope.
    const fallback = response.status >= 502 && response.status <= 504 ? unreachable : unexpected;
    return {
      ok: false,
      status: response.status,
      error: parsed.success ? parsed.data.error : fallback,
    };
  }

  if (!options.schema) return { ok: true, status: response.status, data: payload as T };
  const parsed = options.schema.safeParse(payload);
  return parsed.success
    ? { ok: true, status: response.status, data: parsed.data }
    : { ok: false, status: response.status, error: unexpected };
}

/** Turns the API's "field: message" details into one message per field. */
export function fieldErrorsFromDetails(
  details: readonly string[] | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const detail of details ?? []) {
    const separator = detail.indexOf(": ");
    if (separator <= 0) continue;
    const field = detail.slice(0, separator);
    errors[field] ??= detail.slice(separator + 2);
  }
  return errors;
}

/** One message per top-level field from a failed schema check, using the shared contract's wording. */
export function fieldErrorsFromIssues(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string") errors[field] ??= issue.message;
  }
  return errors;
}
