import path from "node:path";
import { Redis } from "ioredis";

/**
 * Every run creates fresh accounts from the same local address, so rate-limit
 * counters from earlier runs would eventually block sign-ups. Start each run
 * with none, as the API's integration tests do. Local development data only.
 */
export default async function globalSetup(): Promise<void> {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
  } catch {
    // No .env: use the environment or the default port.
  }
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    const keys = await redis.keys("rl:*");
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
