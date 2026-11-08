import { BROWSER_LIMITS } from "@brawzer/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
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

  async start(sessionId: string, secret: string): Promise<StartedRuntime> {
    const { browser } = this.config;
    await this.docker.ensureNetwork(browser.network);
    const containerId = await this.docker.createContainer({
      name: `brawzer-runtime-${sessionId}`,
      image: browser.image,
      env: [
        `BRAWZER_SESSION_SECRET=${secret}`,
        `BRAWZER_SESSION_ID=${sessionId}`,
        `BRAWZER_AGENT_PORT=${String(AGENT_PORT)}`,
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
      return { containerId, agentAddress };
    } catch (error) {
      await this.stop(containerId);
      throw error;
    }
  }

  /** Polls the agent's health route until it is ready, or gives up. */
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
