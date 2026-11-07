import { describe, expect, it } from "vitest";
import { MemoryCounters, RATE_LIMITS, RateLimiter } from "./rate-limiter.js";

/** A Redis client that is down: every command rejects. */
const unreachableRedis = {
  multi: () => ({
    incr() {
      return this;
    },
    expire() {
      return this;
    },
    ttl() {
      return this;
    },
    exec: () => Promise.reject(new Error("Connection is closed.")),
  }),
  get: () => Promise.reject(new Error("Connection is closed.")),
  ttl: () => Promise.reject(new Error("Connection is closed.")),
  del: () => Promise.reject(new Error("Connection is closed.")),
} as unknown as ConstructorParameters<typeof RateLimiter>[0];

describe("MemoryCounters", () => {
  it("counts within a window and starts over when it ends", () => {
    const counters = new MemoryCounters();
    expect(counters.hit("k", 60, 0)).toEqual({ count: 1, ttlSeconds: 60 });
    expect(counters.hit("k", 60, 30_000)).toEqual({ count: 2, ttlSeconds: 30 });
    expect(counters.peek("k", 30_000)).toEqual({ count: 2, ttlSeconds: 30 });
    expect(counters.hit("k", 60, 61_000)).toEqual({ count: 1, ttlSeconds: 60 });
  });

  it("never grows past its bound", () => {
    const counters = new MemoryCounters(3);
    for (let index = 0; index < 10; index += 1) counters.hit(`k${String(index)}`, 60, 0);
    expect(counters.size).toBeLessThanOrEqual(3);
  });
});

describe("RateLimiter without Redis", () => {
  it("keeps enforcing limits with in-memory counters", async () => {
    const limiter = new RateLimiter(unreachableRedis, { rateLimitScale: 1 });
    const rule = RATE_LIMITS.signInFailuresPerAccount;

    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      expect((await limiter.hit(rule, "ana@example.com")).allowed).toBe(true);
    }
    expect((await limiter.isBlocked(rule, "ana@example.com")).allowed).toBe(false);
    await expect(limiter.enforce(rule, "ana@example.com")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect((await limiter.isBlocked(rule, "someone-else@example.com")).allowed).toBe(true);
  });

  it("clears a counter on reset", async () => {
    const limiter = new RateLimiter(unreachableRedis, { rateLimitScale: 1 });
    const rule = RATE_LIMITS.signInFailuresPerAccount;
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      await limiter.hit(rule, "ana@example.com");
    }
    await limiter.reset(rule, "ana@example.com");
    expect((await limiter.isBlocked(rule, "ana@example.com")).allowed).toBe(true);
  });
});
