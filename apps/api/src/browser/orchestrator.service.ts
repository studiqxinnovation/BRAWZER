import { BROWSER_LIMITS } from "@brawzer/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import { Readable } from "node:stream";
import type { ProxyTarget } from "@brawzer/proxy-client";
import type { AppConfig } from "../config/env.js";
import {
  DOCKER,
  EGRESS_CAPABILITIES,
  EGRESS_HEALTH_PORT,
  EGRESS_PROXY_PORT,
  EgressService,
} from "../egress/egress.service.js";
import { DockerClient } from "./docker.js";
import seccompProfile from "./runtime-seccomp.json" with { type: "json" };

export { DOCKER } from "../egress/egress.service.js";

/** The label every runtime container carries; its value is the session id. */
export const SESSION_LABEL = "brawzer.session";
const AGENT_PORT = 7000;
export const EGRESS_LABEL = "brawzer.egress";
const MiB = 1024 * 1024;

export interface StartedRuntime {
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
    @Inject(DOCKER) private readonly docker: DockerClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EgressService) private readonly egress: EgressService,
  ) {}

  /** Engine reachable and the runtime image present. */
  async ping(): Promise<void> {
    await this.docker.ping();
    if (!(await this.docker.hasImage(this.config.browser.image))) {
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
    sessionId: string,
    secret: string,
    profileData: Readable | null = null,
    upstream: ProxyTarget | null = null,
  ): Promise<StartedRuntime> {
    const { browser } = this.config;
    await this.docker.ensureNetwork(browser.network);
    // The egress sidecar owns the session's network namespace and its
    // published ports; the runtime joins that namespace and has no network
    // of its own (ADR 0014). The sidecar is the only process allowed out.
    const egressId = await this.docker.createContainer({
      name: `brawzer-egress-${sessionId}`,
      image: this.config.egress.image,
      env: [
        "EGRESS_MODE=session",
        `EGRESS_SECRET=${secret}`,
        ...(upstream ? [`EGRESS_UPSTREAM=${JSON.stringify(upstream)}`] : []),
        ...this.egress.commonEnv(),
      ],
      labels: { "brawzer.managed": "true", [SESSION_LABEL]: sessionId, [EGRESS_LABEL]: "true" },
      publishPorts: [AGENT_PORT, EGRESS_HEALTH_PORT],
      publishHostIp: this.config.browser.agentBind,
      network: browser.network,
      capAdd: [...EGRESS_CAPABILITIES],
      extraHosts: this.egress.extraHosts(),
      memoryBytes: 256 * MiB,
      cpus: 1,
      pidsLimit: 128,
    });
    let containerId = "";
    try {
      await this.docker.startContainer(egressId);
      await this.egress.waitUntilReady(egressId, EGRESS_HEALTH_PORT);
      containerId = await this.docker.createContainer({
        name: `brawzer-runtime-${sessionId}`,
        image: browser.image,
        env: [
          `BRAWZER_SESSION_SECRET=${secret}`,
          `BRAWZER_SESSION_ID=${sessionId}`,
          `BRAWZER_AGENT_PORT=${String(AGENT_PORT)}`,
          `BRAWZER_MAX_FILE_BYTES=${String(this.config.drive.maxFileBytes)}`,
          `BRAWZER_EGRESS_PROXY=127.0.0.1:${String(EGRESS_PROXY_PORT)}`,
          ...(browser.testSite ? ["BRAWZER_TEST_SITE=true"] : []),
        ],
        labels: { "brawzer.managed": "true", [SESSION_LABEL]: sessionId },
        publishPorts: [],
        publishHostIp: this.config.browser.agentBind,
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
      await this.docker.startContainer(containerId);
      const agentAddress = await this.waitUntilReady(containerId, egressId);
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
      return { containerId, agentAddress };
    } catch (error) {
      if (profileData && !profileData.destroyed) profileData.destroy();
      if (containerId) await this.stop(containerId);
      await this.stop(egressId);
      throw error;
    }
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
  private async waitUntilReady(containerId: string, egressId: string): Promise<string> {
    const deadline = Date.now() + BROWSER_LIMITS.startTimeoutSeconds * 1000;
    let address: string | null = null;
    while (Date.now() < deadline) {
      const state = await this.docker.inspect(containerId);
      if (!state) throw new Error("The runtime container disappeared while starting");
      if (!state.running) {
        throw new Error(`The runtime exited while starting (code ${String(state.exitCode)})`);
      }
      const egressState = await this.docker.inspect(egressId);
      if (!egressState?.running) throw new Error("The egress sidecar stopped while starting");
      const hostPort = egressState.hostPorts[AGENT_PORT];
      if (hostPort) {
        address = `${this.config.browser.agentHost}:${String(hostPort)}`;
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
  async isRunning(containerId: string): Promise<boolean> {
    const state = await this.docker.inspect(containerId);
    return state?.running ?? false;
  }

  async stop(containerId: string): Promise<void> {
    try {
      await this.docker.remove(containerId);
    } catch (error) {
      logger.warn(
        `Could not remove container ${containerId.slice(0, 12)}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /** Removes a session's runtime and its egress sidecar. */
  async stopSession(sessionId: string, containerId: string | null): Promise<void> {
    if (containerId) await this.stop(containerId);
    for (const container of await this.listSessionContainers()) {
      if (container.sessionId === sessionId && container.containerId !== containerId) {
        await this.stop(container.containerId);
      }
    }
  }

  /** Every runtime container on the engine, by session id (egress sidecars included). */
  async listRuntimes(): Promise<{ containerId: string; sessionId: string }[]> {
    return (await this.listSessionContainers()).filter((container) => !container.egress);
  }

  private async listSessionContainers(): Promise<
    { containerId: string; sessionId: string; egress: boolean }[]
  > {
    const containers = await this.docker.listByLabel(SESSION_LABEL);
    return containers.map((container) => ({
      containerId: container.id,
      sessionId: container.labels[SESSION_LABEL] ?? "",
      egress: container.labels[EGRESS_LABEL] === "true",
    }));
  }
}
