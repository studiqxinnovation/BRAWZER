import { randomBytes, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { OrchestratorService, POOL_LABEL, type RuntimePair } from "./orchestrator.service.js";

const logger = new Logger("WarmPool");

/** A pair that waited this long is discarded and made afresh (the image may have moved on). */
export const POOL_MAX_AGE_MS = 60 * 60_000;

/** A pooled pair with the secret its agent and sidecar were given. */
export interface WarmPair extends RuntimePair {
  secret: string;
  madeAt: Date;
}

/**
 * Keeps a few egress-plus-runtime pairs started and waiting, so a session
 * that needs nothing special (Bee, no proxy, no site rules) starts in well
 * under a second instead of a few. A pair carries a session id reserved for
 * it and a secret; claiming it makes the session row with that id. Pairs
 * belong to the instance that made them; stale ones are reaped by whoever
 * reconciles (ADR 0016).
 */
@Injectable()
export class WarmPoolService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly pairs: WarmPair[] = [];
  private timers: NodeJS.Timeout[] = [];
  private filling = false;
  private stopping = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OrchestratorService) private readonly orchestrator: OrchestratorService,
  ) {}

  get size(): number {
    return this.config.browser.warmPool;
  }

  get waiting(): number {
    return this.pairs.length;
  }

  /** Read through a call: the flag flips from another turn of the loop, which narrowing can't see. */
  private isStopping(): boolean {
    return this.stopping;
  }

  onApplicationBootstrap(): void {
    if (this.size === 0) return;
    const first = setTimeout(() => void this.fill(), 3_000);
    const repeat = setInterval(() => void this.fill(), 20_000);
    first.unref();
    repeat.unref();
    this.timers = [first, repeat];
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearTimeout(timer);
    // Pairs are cheap to make again; leaving them would only make orphans.
    const pairs = this.pairs.splice(0);
    await Promise.all(
      pairs.map((pair) => this.orchestrator.discardPair(pair).catch(() => undefined)),
    );
  }

  /** A waiting pair for `engine`, checked once more, or null when none is ready. */
  async claim(engine: "bee" | "firefox"): Promise<WarmPair | null> {
    for (;;) {
      const index = this.pairs.findIndex((pair) => pair.engine === engine);
      if (index === -1) return null;
      const [pair] = this.pairs.splice(index, 1);
      if (!pair) return null;
      const fresh = Date.now() - pair.madeAt.getTime() < POOL_MAX_AGE_MS;
      if (fresh && (await this.orchestrator.isWaiting(pair))) {
        void this.fill();
        return pair;
      }
      await this.orchestrator.discardPair(pair).catch(() => undefined);
    }
  }

  /** Gives a claimed pair back (the session could not be made after all). */
  release(pair: WarmPair): void {
    if (!this.stopping) this.pairs.unshift(pair);
  }

  /** Tops the pool up, one pair at a time; a failure waits for the next tick. */
  async fill(): Promise<void> {
    if (this.filling || this.isStopping()) return;
    this.filling = true;
    try {
      while (!this.isStopping() && this.pairs.length < this.size) {
        const sessionId = randomUUID();
        const secret = randomBytes(32).toString("base64url");
        const madeAt = new Date();
        const pair = await this.orchestrator.createPair(
          sessionId,
          secret,
          null,
          "bee",
          { privateViaUpstream: false, siteRules: null },
          { [POOL_LABEL]: madeAt.toISOString() },
        );
        if (this.isStopping()) {
          await this.orchestrator.discardPair(pair).catch(() => undefined);
          return;
        }
        this.pairs.push({ ...pair, secret, madeAt });
        logger.log(`Warm pair ready (${String(this.pairs.length)}/${String(this.size)})`);
      }
    } catch (error) {
      logger.warn(
        `Could not add a warm pair: ${error instanceof Error ? error.message : "unknown"}`,
      );
    } finally {
      this.filling = false;
    }
  }
}
