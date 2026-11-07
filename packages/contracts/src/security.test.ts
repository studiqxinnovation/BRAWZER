import { describe, expect, it } from "vitest";
import { securityEventQuerySchema, securityEventSchema } from "./security.ts";

describe("securityEventQuerySchema", () => {
  it("defaults to 20 events and coerces query-string numbers", () => {
    expect(securityEventQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(securityEventQuerySchema.parse({ limit: "5" })).toEqual({ limit: 5 });
  });

  it("rejects out-of-range limits and malformed cursors", () => {
    expect(securityEventQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(securityEventQuerySchema.safeParse({ before: "not-an-id" }).success).toBe(false);
  });
});

describe("securityEventSchema", () => {
  it("drops details that aren't on the allow-list", () => {
    const event = securityEventSchema.parse({
      id: "01a1b375-3674-7441-b1c2-5d6916907998",
      type: "sign_in.succeeded",
      occurredAt: "2026-11-06T16:00:00.000Z",
      device: "Chrome on Windows",
      ipAddress: "203.0.113.7",
      details: { method: "password", persistent: false, secret: "nope" },
    });
    expect(event.details).toEqual({ method: "password", persistent: false });
  });
});
