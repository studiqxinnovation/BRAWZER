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
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Hashes identifiers so Redis never stores raw emails or tokens in key names. */
export function rateLimitSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

const logger = new Logger("RateLimiter");

/**
 * Fixed-window counters in Redis. If Redis is unreachable the limiter fails
 * open (requests continue) and logs loudly; the health check reports it too.
 */
@Injectable()
export class RateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private key(rule: RateLimitRule, subject: string): string {
    return `rl:${rule.name}:${rateLimitSubject(subject)}`;
  }

  private limitOf(rule: RateLimitRule): number {
    return rule.limit * this.config.rateLimitScale;
  }

  /** Counts one attempt and reports whether it is within the limit. */
  async hit(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = this.key(rule, subject);
    try {
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, rule.windowSeconds, "NX")
        .ttl(key)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? rule.windowSeconds);
      return {
        allowed: count <= this.limitOf(rule),
        retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds,
      };
    } catch (error) {
      logger.warn(
        `Rate limiting unavailable (${error instanceof Error ? error.message : "unknown"})`,
      );
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  /** Reports whether the limit is already reached, without counting an attempt. */
  async isBlocked(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
    const key = this.key(rule, subject);
    try {
      const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
      return {
        allowed: Number(count ?? 0) < this.limitOf(rule),
        retryAfterSeconds: ttl > 0 ? ttl : 0,
      };
    } catch {
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  /** Counts an attempt and throws a 429 when the limit is exceeded. */
  async enforce(rule: RateLimitRule, subject: string): Promise<void> {
    const result = await this.hit(rule, subject);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  }

  async reset(rule: RateLimitRule, subject: string): Promise<void> {
    try {
      await this.redis.del(this.key(rule, subject));
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
