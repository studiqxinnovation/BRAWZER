import { Inject, Injectable, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";

/** Injection token for the shared Redis-protocol client (Valkey locally). */
export const REDIS = Symbol.for("brawzer.api.redis");

const logger = new Logger("Redis");

/**
 * Creates a client that fails fast while disconnected instead of queueing
 * commands, so request handlers and health checks never hang on Redis.
 * It keeps reconnecting in the background.
 */
export async function createRedisClient(url: string, connectTimeoutMs = 2_000): Promise<Redis> {
  const client = new Redis(url, {
    lazyConnect: true,
    connectionName: "brawzer-api",
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: connectTimeoutMs,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
  });

  // Log state changes once rather than on every reconnect attempt.
  let lastError: string | undefined;
  client.on("error", (error: Error) => {
    if (error.message === lastError) return;
    lastError = error.message;
    logger.warn(`Redis unavailable: ${error.message}`);
  });
  client.on("ready", () => {
    if (lastError) logger.log("Redis connection restored");
    lastError = undefined;
  });

  try {
    await client.connect();
  } catch {
    // Start anyway: the API reports "degraded" until Redis is reachable.
  }
  return client;
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Promise<Redis> => createRedisClient(config.redisUrl),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
