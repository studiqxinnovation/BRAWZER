import type { DependencyCheck, HealthResponse } from "@brawzer/contracts";
import type { DatabaseHandle } from "@brawzer/db";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { OrchestratorService } from "../browser/orchestrator.service.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DATABASE } from "../database/database.module.js";
import { REDIS } from "../redis/redis.module.js";
import type { Scanner } from "../scanning/clamd.js";
import { SCANNER } from "../scanning/scanning.module.js";
import type { ObjectStore } from "../storage/object-store.js";
import { OBJECT_STORE } from "../storage/storage.module.js";

const PROBE_TIMEOUT_MS = 1_500;

/** Runs `check` with a deadline and reports reachability plus latency. */
export async function probe(
  check: () => Promise<unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<DependencyCheck> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });

  try {
    await Promise.race([check(), deadline]);
    return { status: "up", latencyMs: Math.round((performance.now() - started) * 10) / 10 };
  } catch {
    return { status: "down", latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

type Pingable = Pick<DatabaseHandle, "ping">;
type RedisPingable = Pick<Redis, "ping">;
type StorePingable = Pick<ObjectStore, "ping">;
type ScannerPingable = Pick<Scanner, "ping">;
type RuntimePingable = Pick<OrchestratorService, "ping">;

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(DATABASE) private readonly database: Pingable,
    @Inject(REDIS) private readonly redis: RedisPingable,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORE) private readonly store: StorePingable,
    @Inject(SCANNER) private readonly scanner: ScannerPingable,
    @Inject(OrchestratorService) private readonly runtime: RuntimePingable,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, redis, storage, scanner, runtime] = await Promise.all([
      probe(() => this.database.ping()),
      probe(() => this.redis.ping()),
      probe(() => this.store.ping()),
      probe(() => this.scanner.ping()),
      probe(() => this.runtime.ping()),
    ]);
    const checks = { database, redis, storage, scanner, runtime };

    return {
      status: Object.values(checks).every((check) => check.status === "up") ? "ok" : "degraded",
      service: "brawzer-api",
      version: this.config.version,
      environment: this.config.env,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      // Dependency details describe internal topology: development only.
      ...(this.config.isProduction ? {} : { checks }),
    };
  }
}
