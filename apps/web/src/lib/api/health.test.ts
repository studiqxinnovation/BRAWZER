import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "./health";

const report = {
  status: "ok",
  service: "brawzer-api",
  version: "0.0.0",
  environment: "development",
  uptimeSeconds: 4,
  timestamp: "2026-11-06T12:00:00.000Z",
  checks: { database: { status: "up", latencyMs: 1 }, redis: { status: "up", latencyMs: 1 } },
};

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHealth", () => {
  it("returns the report when the API is healthy", async () => {
    respondWith(report);
    expect(await fetchHealth()).toEqual({ kind: "ok", report });
  });

  it("reports degraded dependencies, which arrive with HTTP 503", async () => {
    const degraded = { ...report, status: "degraded" };
    respondWith(degraded, 503);
    expect(await fetchHealth()).toEqual({ kind: "degraded", report: degraded });
  });

  it("treats a response that breaks the contract as unreachable", async () => {
    respondWith({ hello: "world" });
    expect(await fetchHealth()).toEqual({ kind: "unreachable" });
  });

  it("treats a network failure as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await fetchHealth()).toEqual({ kind: "unreachable" });
  });

  it("calls the same-origin API path without caching", async () => {
    respondWith(report);
    await fetchHealth();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
