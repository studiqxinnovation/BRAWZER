import { BROWSER_LIMITS, type SiteRulesForEgress } from "@brawzer/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import { Readable } from "node:stream";
import type { ProxyTarget } from "@brawzer/proxy-client";
import type { AppConfig } from "../config/env.js";
import {
  EGRESS_CAPABILITIES,
  EGRESS_HEALTH_PORT,
  EGRESS_PROXY_PORT,
  EgressService,
} from "../egress/egress.service.js";
import { type RuntimeHost, RuntimeHostsService } from "../egress/runtime-hosts.service.js";
import seccompProfile from "./runtime-seccomp.json" with { type: "json" };

export { DOCKER } from "../egress/egress.service.js";

/** The label every runtime container carries; its value is the session id. */
export const SESSION_LABEL = "brawzer.session";
const AGENT_PORT = 7000;
export const EGRESS_LABEL = "brawzer.egress";
/** On a warm pool's containers: when the pair was made, so a stale one can be told apart. */
export const POOL_LABEL = "brawzer.pool";
const MiB = 1024 * 1024;

/** A started egress and runtime, ready for a session's data and engine start. */
export interface RuntimePair {
  /** The runtime host's name. */
  host: string;
  sessionId: string;
  egressId: string;
  containerId: string;
  agentAddress: string;
  engine: "bee" | "firefox";
}

export interface StartedRuntime {
  host: string;
  containerId: string;
  /** host:port on this machine where the agent answers. */
  agentAddress: string;
}

const logger = new Logger("Orchestrator");
/** Closing the engine and archiving a large profile can take a while. */
const PACK_TIMEOUT_MS = 120_000;

/**
 * Starts and stops runtime containers on the local Docker engine (Phase 3
 * decision 5; Kubernetes is Phase 7). Each container: the runtime image,
 * a read-only root, no capabilities, the seccomp profile that keeps
 * Chromium's own sandbox working, memory, CPU and process limits, and a
 * network of its own where containers can't see each other.
 */
@Injectable()
export class OrchestratorService {
  constructor(
    @Inject(RuntimeHostsService) private readonly hosts: RuntimeHostsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EgressService) private readonly egress: EgressService,
  ) {}

  /** At least one runtime host reachable, with the runtime image present. */
  async ping(): Promise<void> {
    const healthy = await this.hosts.healthyHosts();
    const first = healthy[0];
    if (!first) throw new Error("No runtime host is reachable");
    const docker = first.docker;
    if (!(await docker.hasImage(this.config.browser.image))) {
      throw new Error(`Runtime image ${this.config.browser.image} is missing`);
    }
    await this.egress.ping();
  }

  /**
   * Starts a container, restores the profile's data into it (if any) and
   * then starts the engine. The agent waits for that order: the data must be
   * in place before Chromium opens its profile.
   */
  async start(
    host: RuntimeHost,
    sessionId: string,
    secret: string,
    profileData: Readable | null = null,
    upstream: ProxyTarget | null = null,
    engine: "bee" | "firefox" = "bee",
    options: { privateViaUpstream: boolean; siteRules?: SiteRulesForEgress | null } = {
      privateViaUpstream: false,
    },
  ): Promise<StartedRuntime> {
    const pair = await this.createPair(host, sessionId, secret, upstream, engine, options);
    return this.launch(pair, secret, profileData);
  }

  /**
   * The egress sidecar and the runtime for a session, started and ready for
   * the profile's data: the agent waits for `launch`. A warm pool keeps
   * such pairs for sessions without a proxy (Phase 8, idea 14).
   */
  async createPair(
    host: RuntimeHost,
    sessionId: string,
    secret: string,
    upstream: ProxyTarget | null,
    engine: "bee" | "firefox",
    options: { privateViaUpstream: boolean; siteRules?: SiteRulesForEgress | null },
    extraLabels: Record<string, string> = {},
  ): Promise<RuntimePair> {
    const { browser } = this.config;
    const docker = host.docker;
    await docker.ensureNetwork(browser.network);
    // The egress sidecar owns the session's network namespace and its
    // published ports; the runtime joins that namespace and has no network
    // of its own (ADR 0014). The sidecar is the only process allowed out.
    const egressId = await docker.createContainer({
      name: `brawzer-egress-${sessionId}`,
      image: this.config.egress.image,
      env: [
        "EGRESS_MODE=session",
        `EGRESS_SECRET=${secret}`,
        ...(upstream ? [`EGRESS_UPSTREAM=${JSON.stringify(upstream)}`] : []),
        ...(options.privateViaUpstream ? ["EGRESS_PRIVATE_VIA_UPSTREAM=true"] : []),
        ...(options.siteRules ? [`EGRESS_SITE_RULES=${JSON.stringify(options.siteRules)}`] : []),
        ...this.egress.commonEnv(),
      ],
      labels: {
        "brawzer.managed": "true",
        [SESSION_LABEL]: sessionId,
        [EGRESS_LABEL]: "true",
        ...extraLabels,
      },
      publishPorts: [AGENT_PORT, EGRESS_HEALTH_PORT],
      publishHostIp: host.agentBind,
      network: browser.network,
      capAdd: [...EGRESS_CAPABILITIES],
      extraHosts: this.egress.extraHosts(),
      memoryBytes: 256 * MiB,
      cpus: 1,
      pidsLimit: 128,
    });
    let containerId = "";
    try {
      await docker.startContainer(egressId);
      await this.egress.waitUntilReady(egressId, EGRESS_HEALTH_PORT, host);
      containerId = await docker.createContainer({
        name: `brawzer-runtime-${sessionId}`,
        image: browser.image,
        env: [
          `BRAWZER_SESSION_SECRET=${secret}`,
          `BRAWZER_SESSION_ID=${sessionId}`,
          `BRAWZER_AGENT_PORT=${String(AGENT_PORT)}`,
          `BRAWZER_MAX_FILE_BYTES=${String(this.config.drive.maxFileBytes)}`,
          `BRAWZER_EGRESS_PROXY=127.0.0.1:${String(EGRESS_PROXY_PORT)}`,
          `BRAWZER_ENGINE=${engine}`,
          ...(options.privateViaUpstream ? ["BRAWZER_PRIVATE_VIA_EGRESS=true"] : []),
          ...(browser.testSite ? ["BRAWZER_TEST_SITE=true"] : []),
        ],
        labels: { "brawzer.managed": "true", [SESSION_LABEL]: sessionId, ...extraLabels },
        publishPorts: [],
        publishHostIp: host.agentBind,
        network: `container:${egressId}`,
        seccompProfile,
        memoryBytes: 2048 * MiB,
        cpus: 2,
        pidsLimit: 1024,
        shmBytes: 512 * MiB,
        tmpfsBytes: 1024 * MiB,
        // gVisor or another registered runtime in production (ADR 0016).
        runtime: this.config.browser.containerRuntime ?? undefined,
      });
      await docker.startContainer(containerId);
      const agentAddress = await this.waitUntilReady(host, containerId, egressId);
      return { host: host.name, sessionId, egressId, containerId, agentAddress, engine };
    } catch (error) {
      if (containerId) await this.stop(host, containerId);
      await this.stop(host, egressId);
      throw error;
    }
  }

  /** Restores the profile's data into a ready pair, then starts its engine. */
  async launch(
    pair: RuntimePair,
    secret: string,
    profileData: Readable | null = null,
  ): Promise<StartedRuntime> {
    const { containerId, agentAddress, egressId } = pair;
    try {
      const headers = { authorization: `Bearer ${secret}` };
      if (profileData) {
        const restored = await fetch(`http://${agentAddress}/profile`, {
          method: "PUT",
          headers,
          body: Readable.toWeb(profileData) as unknown as ReadableStream,
          duplex: "half",
          signal: AbortSignal.timeout(BROWSER_LIMITS.startTimeoutSeconds * 1000),
        });
        if (!restored.ok)
          throw new Error(`Restoring the profile failed (${String(restored.status)})`);
      }
      const started = await fetch(`http://${agentAddress}/start`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(BROWSER_LIMITS.startTimeoutSeconds * 1000),
      });
      if (!started.ok) {
        const body = (await started.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The engine didn't start (${String(started.status)})`);
      }
      return { host: pair.host, containerId, agentAddress };
    } catch (error) {
      if (profileData && !profileData.destroyed) profileData.destroy();
      const host = this.hosts.byName(pair.host);
      await this.stop(host, containerId);
      await this.stop(host, egressId);
      throw error;
    }
  }

  /** Whether a pair's agent is still waiting, healthy, for its session. */
  async isWaiting(pair: RuntimePair): Promise<boolean> {
    try {
      const response = await fetch(`http://${pair.agentAddress}/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { state?: string };
      return body.state === "waiting";
    } catch {
      return false;
    }
  }

  /** Removes a pair that was never given to a session. */
  async discardPair(pair: RuntimePair): Promise<void> {
    const host = this.hosts.byName(pair.host);
    await this.stop(host, pair.containerId);
    await this.stop(host, pair.egressId);
  }

  /**
   * Asks the agent to close the engine cleanly and hand over the profile's
   * data as an archive. The viewer is cut off first; the container is still
   * running afterwards and is stopped by the caller.
   */
  async packProfile(agentAddress: string, secret: string): Promise<Readable> {
    const response = await fetch(`http://${agentAddress}/pack`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(PACK_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Packing the profile failed (${String(response.status)})`);
    }
    return Readable.fromWeb(response.body);
  }

  /**
   * Polls the agent's health route until the agent answers, or gives up. The
   * agent's port is published by the egress sidecar, whose namespace it
   * shares, so that is where the host port is read from.
   */
  private async waitUntilReady(
    host: RuntimeHost,
    containerId: string,
    egressId: string,
  ): Promise<string> {
    const deadline = Date.now() + BROWSER_LIMITS.startTimeoutSeconds * 1000;
    let address: string | null = null;
    while (Date.now() < deadline) {
      const state = await host.docker.inspect(containerId);
      if (!state) throw new Error("The runtime container disappeared while starting");
      if (!state.running) {
        throw new Error(`The runtime exited while starting (code ${String(state.exitCode)})`);
      }
      const egressState = await host.docker.inspect(egressId);
      if (!egressState?.running) throw new Error("The egress sidecar stopped while starting");
      const hostPort = egressState.hostPorts[AGENT_PORT];
      if (hostPort) {
        address = `${host.agentHost}:${String(hostPort)}`;
        try {
          const response = await fetch(`http://${address}/healthz`, {
            signal: AbortSignal.timeout(1_000),
          });
          if (response.ok) return address;
        } catch {
          // Not listening yet.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("The runtime didn't become ready in time");
  }

  /** True while the container runs. */
  async isRunning(hostName: string | null, containerId: string): Promise<boolean> {
    const state = await this.hosts.byName(hostName).docker.inspect(containerId);
    return state?.running ?? false;
  }

  async stop(host: RuntimeHost, containerId: string): Promise<void> {
    try {
      await host.docker.remove(containerId);
    } catch (error) {
      logger.warn(
        `Could not remove container ${containerId.slice(0, 12)}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /** Removes a session's runtime and its egress sidecar. */
  async stopSession(
    hostName: string | null,
    sessionId: string,
    containerId: string | null,
  ): Promise<void> {
    const host = this.hosts.byName(hostName);
    if (containerId) await this.stop(host, containerId);
    for (const container of await this.listSessionContainers(host)) {
      if (container.sessionId === sessionId && container.containerId !== containerId) {
        await this.stop(host, container.containerId);
      }
    }
  }

  /** Every runtime container on every reachable host, by session id (egress sidecars excluded). */
  async listRuntimes(): Promise<
    { host: string; containerId: string; sessionId: string; pooledAt: Date | null }[]
  > {
    const found: { host: string; containerId: string; sessionId: string; pooledAt: Date | null }[] =
      [];
    for (const host of await this.hosts.healthyHosts()) {
      for (const container of await this.listSessionContainers(host)) {
        if (!container.egress) found.push(container);
      }
    }
    return found;
  }

  private async listSessionContainers(host: RuntimeHost): Promise<
    {
      host: string;
      containerId: string;
      sessionId: string;
      egress: boolean;
      pooledAt: Date | null;
    }[]
  > {
    const containers = await host.docker.listByLabel(SESSION_LABEL);
    return containers.map((container) => {
      const pooled = container.labels[POOL_LABEL];
      const pooledAt = pooled ? new Date(pooled) : null;
      return {
        host: host.name,
        containerId: container.id,
        sessionId: container.labels[SESSION_LABEL] ?? "",
        egress: container.labels[EGRESS_LABEL] === "true",
        pooledAt: pooledAt && !Number.isNaN(pooledAt.getTime()) ? pooledAt : null,
      };
    });
  }
}
