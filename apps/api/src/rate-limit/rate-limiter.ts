import { createHash } from "node:crypto";
import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import type { Redis } from "ioredis";
import { rateLimited } from "../common/api-exception.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { REDIS, RedisModule } from "../redis/redis.module.js";

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Limits per client IP and per account. Production values; development scales them up. */
export const RATE_LIMITS = {
  signInPerIp: { name: "sign-in-ip", limit: 30, windowSeconds: 15 * 60 },
  signInFailuresPerAccount: { name: "sign-in-fail", limit: 8, windowSeconds: 15 * 60 },
  registerPerIp: { name: "register-ip", limit: 10, windowSeconds: 60 * 60 },
  emailsPerIp: { name: "email-ip", limit: 10, windowSeconds: 60 * 60 },
  emailsPerAccount: { name: "email-account", limit: 3, windowSeconds: 60 * 60 },
  linkAttemptsPerIp: { name: "link-ip", limit: 30, windowSeconds: 15 * 60 },
  linkPasswordFailures: { name: "link-fail", limit: 5, windowSeconds: 60 * 60 },
  passwordChangeFailures: { name: "password-change-fail", limit: 5, windowSeconds: 15 * 60 },
  reauthFailures: { name: "reauth-fail", limit: 5, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Hashes identifiers so Redis never stores raw emails or tokens in key names. */
export function rateLimitSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

interface Counter {
  count: number;
  expiresAt: number;
}

/**
 * Fixed-window counters in this process's memory. Used only while Redis is
 * unreachable, so limits keep applying (per API instance) instead of
 * switching off. Bounded, so an attacker can't grow it without limit.
 */
export class MemoryCounters {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly maxEntries = 100_000) {}

  hit(key: string, windowSeconds: number, now = Date.now()): { count: number; ttlSeconds: number } {
    let counter = this.counters.get(key);
    if (!counter || counter.expiresAt <= now) {
      this.makeRoom(now);
      counter = { count: 0, expiresAt: now + windowSeconds * 1000 };
      this.counters.set(key, counter);
    }
    counter.count += 1;
    return { count: counter.count, ttlSeconds: Math.ceil((counter.expiresAt - now) / 1000) };
  }

  peek(key: string, now = Date.now()): { count: number; ttlSeconds: number } {
    const counter = this.counters.get(key);
    if (!counter || counter.expiresAt <= now) return { count: 0, ttlSeconds: 0 };
    return { count: counter.count, ttlSeconds: Math.ceil((counter.expiresAt - now) / 1000) };
  }

  delete(key: string): void {
    this.counters.delete(key);
  }

  get size(): number {
    return this.counters.size;
  }

  private makeRoom(now: number): void {
    if (this.counters.size < this.maxEntries) return;
    for (const [key, counter] of this.counters) {
      if (counter.expiresAt <= now) this.counters.delete(key);
    }
    // Still full: drop the oldest windows first (Maps iterate in insertion order).
    for (const key of this.counters.keys()) {
      if (this.counters.size < this.maxEntries) break;
      this.counters.delete(key);
    }
  }
}

const logger = new Logger("RateLimiter");

/**
 * Fixed-window counters in Redis, shared by every API instance. If Redis is
 * unreachable, each instance falls back to its own memory counters and logs
 * it; the health check reports Redis as down meanwhile.
 */
@Injectable()
export class RateLimiter {
  private readonly fallback = new MemoryCounters();
  private usingFallback = false;

  constructor(
    @Inject(REDIS) private readonly redis: Pick<Redis, "multi" | "get" | "ttl" | "del">,
    @Inject(APP_CONFIG) private readonly config: Pick<AppConfig, "rateLimitScale">,
  ) {}

  private key(rule: RateLimitRule, subject: string): string {
    return `rl:${rule.name}:${rateLimitSubject(subject)}`;
  }

  private limitOf(rule: RateLimitRule): number {
    return rule.limit * this.config.rateLimitScale;
  }

  private redisFailed(error: unknown): void {
    if (this.usingFallback) return;
    this.usingFallback = true;
    logger.warn(
      `Rate limiting falls back to in-memory counters: Redis unavailable (${error instanceof Error ? error.message : "unknown"})`,
    );
  }

  private redisWorked(): void {
    if (!this.usingFallback) return;
    this.usingFallback = false;
    logger.log("Rate limiting is using Redis again");
  }

  /** Counts one attempt and reports whether it is within the limit. */
  async hit(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = this.key(rule, subject);
    let count: number;
    let ttl: number;
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, rule.windowSeconds, "NX")
        .ttl(key)
        .exec();
      const failure = results?.find(([error]) => error)?.[0];
      if (!results || failure) throw failure ?? new Error("Rate-limit transaction aborted");
      count = Number(results[0]?.[1] ?? 0);
      ttl = Number(results[2]?.[1] ?? rule.windowSeconds);
      this.redisWorked();
    } catch (error) {
      this.redisFailed(error);
      ({ count, ttlSeconds: ttl } = this.fallback.hit(key, rule.windowSeconds));
    }
    return {
      allowed: count <= this.limitOf(rule),
      retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds,
    };
  }

  /** Reports whether the limit is already reached, without counting an attempt. */
  async isBlocked(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = this.key(rule, subject);
    let count: number;
    let ttl: number;
    try {
      const [stored, storedTtl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
      count = Number(stored ?? 0);
      ttl = storedTtl;
      this.redisWorked();
    } catch (error) {
      this.redisFailed(error);
      ({ count, ttlSeconds: ttl } = this.fallback.peek(key));
    }
    return { allowed: count < this.limitOf(rule), retryAfterSeconds: ttl > 0 ? ttl : 0 };
  }

  /** Counts an attempt and throws a 429 when the limit is exceeded. */
  async enforce(rule: RateLimitRule, subject: string): Promise<void> {
    const result = await this.hit(rule, subject);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  }

  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    const key = this.key(rule, subject);
    this.fallback.delete(key);
    try {
      await this.redis.del(key);
    } catch {
      // Counters expire on their own.
    }
  }
}

@Module({
  imports: [RedisModule],
  providers: [RateLimiter],
  exports: [RateLimiter],
})
export class RateLimitModule {}
