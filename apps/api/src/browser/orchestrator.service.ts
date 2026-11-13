import { BROWSER_LIMITS } from "@brawzer/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import { Readable } from "node:stream";
import type { AppConfig } from "../config/env.js";
import { DockerClient } from "./docker.js";
import seccompProfile from "./runtime-seccomp.json" with { type: "json" };

export const DOCKER = Symbol.for("brawzer.api.docker");

/** The label every runtime container carries; its value is the session id. */
export const SESSION_LABEL = "brawzer.session";
const AGENT_PORT = 7000;
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
  ) {}

  /** Engine reachable and the runtime image present. */
  async ping(): Promise<void> {
    await this.docker.ping();
    if (!(await this.docker.hasImage(this.config.browser.image))) {
      throw new Error(`Runtime image ${this.config.browser.image} is missing`);
    }
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
  ): Promise<StartedRuntime> {
    const { browser } = this.config;
    await this.docker.ensureNetwork(browser.network);
    const containerId = await this.docker.createContainer({
      name: `brawzer-runtime-${sessionId}`,
      image: browser.image,
      env: [
        `BRAWZER_SESSION_SECRET=${secret}`,
        `BRAWZER_SESSION_ID=${sessionId}`,
        `BRAWZER_AGENT_PORT=${String(AGENT_PORT)}`,
        `BRAWZER_MAX_FILE_BYTES=${String(this.config.drive.maxFileBytes)}`,
        ...(browser.testSite ? ["BRAWZER_TEST_SITE=true"] : []),
      ],
      labels: { "brawzer.managed": "true", [SESSION_LABEL]: sessionId },
      publishPort: AGENT_PORT,
      network: browser.network,
      seccompProfile,
      memoryBytes: 2048 * MiB,
      cpus: 2,
      pidsLimit: 1024,
      shmBytes: 512 * MiB,
      tmpfsBytes: 1024 * MiB,
    });
    try {
      await this.docker.startContainer(containerId);
      const agentAddress = await this.waitUntilReady(containerId);
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
      await this.stop(containerId);
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

  /** Polls the agent's health route until the agent answers, or gives up. */
  private async waitUntilReady(containerId: string): Promise<string> {
    const deadline = Date.now() + BROWSER_LIMITS.startTimeoutSeconds * 1000;
    let address: string | null = null;
    while (Date.now() < deadline) {
      const state = await this.docker.inspect(containerId);
      if (!state) throw new Error("The runtime container disappeared while starting");
      if (!state.running) {
        throw new Error(`The runtime exited while starting (code ${String(state.exitCode)})`);
      }
      if (state.hostPort) {
        address = `127.0.0.1:${String(state.hostPort)}`;
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
        `Could not remove runtime ${containerId.slice(0, 12)}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  /** Every runtime container on the engine, by session id. */
  async listRuntimes(): Promise<{ containerId: string; sessionId: string }[]> {
    const containers = await this.docker.listByLabel(SESSION_LABEL);
    return containers.map((container) => ({
      containerId: container.id,
      sessionId: container.labels[SESSION_LABEL] ?? "",
    }));
  }
}
