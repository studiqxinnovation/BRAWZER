import { Inject, Injectable, Logger } from "@nestjs/common";
import { DockerClient } from "../browser/docker.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig, RuntimeHostConfig } from "../config/env.js";

const logger = new Logger("RuntimeHosts");

/** A host's health is asked for at most this often. */
const HEALTH_TTL_MS = 30_000;

/** A runtime host with its engine client. */
export interface RuntimeHost extends Omit<RuntimeHostConfig, "docker"> {
  readonly docker: DockerClient;
}

/**
 * The runtime hosts sessions are placed on (Phase 8, idea 15): one per
 * engine endpoint, each with a capacity and a cached health. The scheduler
 * is small on purpose: the host with the most room among the healthy ones,
 * ties broken in turn. Sessions remember their host, so every later step
 * (stop, pack, reap) goes to the right engine.
 */
@Injectable()
export class RuntimeHostsService {
  private readonly hosts: readonly RuntimeHost[];
  private readonly health = new Map<string, { ok: boolean; at: number }>();
  private turn = 0;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.hosts = config.browser.hosts.map((host) => ({
      ...host,
      docker: new DockerClient(host.docker),
    }));
  }

  all(): readonly RuntimeHost[] {
    return this.hosts;
  }

  /** The first host: where this instance's proxy tester runs. */
  primary(): RuntimeHost {
    const first = this.hosts[0];
    if (!first) throw new Error("No runtime host is configured");
    return first;
  }

  /** The host a session was placed on; a name nothing matches (older rows) means the primary. */
  byName(name: string | null | undefined): RuntimeHost {
    return this.hosts.find((host) => host.name === name) ?? this.primary();
  }

  /** Reachable, as of the last half minute. */
  async healthy(host: RuntimeHost): Promise<boolean> {
    const known = this.health.get(host.name);
    if (known && Date.now() - known.at < HEALTH_TTL_MS) return known.ok;
    let ok = false;
    try {
      await host.docker.ping();
      ok = true;
    } catch (error) {
      logger.warn(
        `Runtime host ${host.name} unreachable: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    this.health.set(host.name, { ok, at: Date.now() });
    return ok;
  }

  /** Forgets a host's cached health, after a failure that suggests it changed. */
  forget(host: RuntimeHost): void {
    this.health.delete(host.name);
  }

  /** The healthy hosts, in order. */
  async healthyHosts(): Promise<RuntimeHost[]> {
    const checks = await Promise.all(this.hosts.map((host) => this.healthy(host)));
    return this.hosts.filter((_host, index) => checks[index]);
  }

  /**
   * Where the next session goes, given how many live sessions each host
   * holds: the healthy host with the most room, ties taken in turn. Null
   * when every healthy host is full, or none is healthy.
   */
  async pick(liveByHost: ReadonlyMap<string, number>): Promise<RuntimeHost | null> {
    const candidates = (await this.healthyHosts())
      .map((host) => ({ host, free: host.capacity - (liveByHost.get(host.name) ?? 0) }))
      .filter((entry) => entry.free > 0);
    if (candidates.length === 0) return null;
    const most = Math.max(...candidates.map((entry) => entry.free));
    const best = candidates.filter((entry) => entry.free === most);
    const chosen = best[this.turn % best.length] ?? best[0];
    this.turn = (this.turn + 1) % 1_000_000;
    return chosen?.host ?? null;
  }
}
