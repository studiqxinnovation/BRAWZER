import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isUnsafeMethod, requestMeta } from "./request-meta.js";

const allowed = ["http://localhost:3100", "http://127.0.0.1:3100"];

describe("isAllowedOrigin", () => {
  it("accepts Brawzer's own origins", () => {
    expect(isAllowedOrigin({ origin: "http://localhost:3100" }, allowed)).toBe(true);
    expect(isAllowedOrigin({ origin: "http://127.0.0.1:3100" }, allowed)).toBe(true);
  });

  it("rejects other sites, look-alikes and opaque origins", () => {
    for (const origin of [
      "https://evil.example",
      "http://localhost:3000",
      "http://localhost:3100.evil.example",
      "null",
    ]) {
      expect(isAllowedOrigin({ origin }, allowed)).toBe(false);
    }
  });

  it("falls back to Fetch Metadata when Origin is missing", () => {
    expect(isAllowedOrigin({ "sec-fetch-site": "same-origin" }, allowed)).toBe(true);
    expect(isAllowedOrigin({ "sec-fetch-site": "same-site" }, allowed)).toBe(false);
    expect(isAllowedOrigin({ "sec-fetch-site": "cross-site" }, allowed)).toBe(false);
  });

  it("rejects requests that carry neither header", () => {
    expect(isAllowedOrigin({}, allowed)).toBe(false);
  });

  it("does not let Fetch Metadata override a foreign Origin", () => {
    expect(
      isAllowedOrigin({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }, allowed),
    ).toBe(false);
  });
});

describe("isUnsafeMethod", () => {
  it("covers every state-changing method", () => {
    expect(["POST", "PUT", "PATCH", "DELETE", "post"].every(isUnsafeMethod)).toBe(true);
    expect(["GET", "HEAD", "OPTIONS"].some(isUnsafeMethod)).toBe(false);
  });
});

describe("requestMeta", () => {
  it("records the address and a bounded user agent, nothing else", () => {
    const meta = requestMeta({
      ip: "203.0.113.7",
      headers: { "user-agent": "x".repeat(2000), cookie: "secret", authorization: "secret" },
    });
    expect(meta).toEqual({ ip: "203.0.113.7", userAgent: "x".repeat(512) });
  });
});
