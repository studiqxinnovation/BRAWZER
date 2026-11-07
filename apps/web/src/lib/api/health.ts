import { type HealthResponse, healthResponseSchema } from "@brawzer/contracts";

export type HealthResult =
  { kind: "ok" | "degraded"; report: HealthResponse } | { kind: "unreachable" };

/**
 * Asks the API for its health through the web app's own origin (/api/v1 is
 * forwarded server-side). Any failure, including a malformed response, is
 * reported as "unreachable" rather than thrown.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResult> {
  try {
    const response = await fetch("/api/v1/health", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    const parsed = healthResponseSchema.safeParse(await response.json());
    if (!parsed.success) return { kind: "unreachable" };
    return { kind: parsed.data.status, report: parsed.data };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "unreachable" };
  }
}
