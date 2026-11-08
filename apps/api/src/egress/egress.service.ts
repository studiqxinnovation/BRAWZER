import { randomBytes } from "node:crypto";
import type { ProxyTarget, ProxyTestOutcome } from "@brawzer/proxy-client";
import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { DockerClient, DockerError } from "../browser/docker.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";

export const DOCKER = Symbol.for("brawzer.api.docker");

const logger = new Logger("Egress");
const MiB = 1024 * 1024;
export const TESTER_PORT = 7001;
export const EGRESS_HEALTH_PORT = 7002;
export const EGRESS_PROXY_PORT = 3129;
export const TESTER_LABEL = "brawzer.egress-tester";
const READY_TIMEOUT_MS = 30_000;

/** What an egress container is allowed beyond nothing: the firewall needs these (ADR 0014). */
export const EGRESS_CAPABILITIES = ["NET_ADMIN", "SETUID", "SETGID"] as const;

/**
 * The egress tester: one long-lived container of the egress image, started
 * on first use, that runs proxy tests away from the API's network. Each API
 * instance keeps its own, named after itself, with a secret made at start.
 */
@Injectable()
export class EgressService implements OnApplicationShutdown {
  private tester: Promise<{ containerId: string; address: string; secret: string }> | null = null;
  private readonly instance = randomBytes(4).toString("hex");

  constructor(
    @Inject(DOCKER) private readonly docker: DockerClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The egress settings every egress container gets. */
  commonEnv(): string[] {
    return [
      ...(this.config.proxyTests.allowPrivate ? ["EGRESS_ALLOW_PRIVATE=true"] : []),
      ...(this.config.egress.loopbackHost
        ? [`EGRESS_LOOPBACK_HOST=${this.config.egress.loopbackHost}`]
        : []),
    ];
  }

  /** Development: lets containers reach this machine under the loopback alias. */
  extraHosts(): string[] {
    const host = this.config.egress.loopbackHost;
    return host && host !== "host.docker.internal" ? [] : host ? [`${host}:host-gateway`] : [];
  }

  async ping(): Promise<void> {
    await this.docker.ping();
    if (!(await this.docker.hasImage(this.config.egress.image))) {
      throw new Error(`Egress image ${this.config.egress.image} is missing`);
    }
  }

  /** Runs a proxy test in the tester container. */
  async test(target: ProxyTarget): Promise<ProxyTestOutcome> {
    const tester = await this.ensureTester();
    const response = await fetch(`http://${tester.address}/test`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tester.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ target, echoUrl: this.config.proxyTests.url }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`The egress tester answered ${String(response.status)}`);
    return (await response.json()) as ProxyTestOutcome;
  }

  private ensureTester(): Promise<{ containerId: string; address: string; secret: string }> {
    this.tester ??= this.startTester().catch((error: unknown) => {
      this.tester = null;
      throw error;
    });
    return this.tester;
  }

  private async startTester() {
    const secret = randomBytes(32).toString("base64url");
    const name = `brawzer-egress-tester-${this.instance}`;
    await this.docker.ensureNetwork(this.config.browser.network);
    const containerId = await this.docker.createContainer({
      name,
      image: this.config.egress.image,
      env: ["EGRESS_MODE=tester", `EGRESS_SECRET=${secret}`, ...this.commonEnv()],
      labels: { "brawzer.managed": "true", [TESTER_LABEL]: this.instance },
      publishPorts: [TESTER_PORT],
      network: this.config.browser.network,
      capAdd: [...EGRESS_CAPABILITIES],
      extraHosts: this.extraHosts(),
      memoryBytes: 256 * MiB,
      cpus: 1,
      pidsLimit: 128,
    });
    try {
      await this.docker.startContainer(containerId);
      const address = await this.waitUntilReady(containerId, TESTER_PORT);
      logger.log(`Egress tester ${name} ready at ${address}`);
      return { containerId, address, secret };
    } catch (error) {
      await this.docker.remove(containerId).catch(() => undefined);
      throw error;
    }
  }

  /** Polls a container's health route on its published port until it answers. */
  async waitUntilReady(containerId: string, port: number): Promise<string> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await this.docker.inspect(containerId);
      if (!state) throw new Error("The egress container disappeared while starting");
      if (!state.running) {
        throw new Error(
          `The egress container exited while starting (code ${String(state.exitCode)})`,
        );
      }
      const hostPort = state.hostPorts[port];
      if (hostPort) {
        const address = `127.0.0.1:${String(hostPort)}`;
        try {
          const response = await fetch(`http://${address}/healthz`, {
            signal: AbortSignal.timeout(1_000),
          });
          if (response.ok) return address;
        } catch {
          // Not listening yet.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("The egress container didn't become ready in time");
  }

  /** Testers left behind by earlier API processes. */
  async removeStaleTesters(): Promise<void> {
    let containers: { id: string; labels: Record<string, string> }[];
    try {
      containers = await this.docker.listByLabel(TESTER_LABEL);
    } catch (error) {
      if (error instanceof DockerError) return;
      throw error;
    }
    for (const container of containers) {
      if (container.labels[TESTER_LABEL] !== this.instance) {
        await this.docker.remove(container.id).catch(() => undefined);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const tester = await this.tester?.catch(() => null);
    if (tester) await this.docker.remove(tester.containerId).catch(() => undefined);
  }
}
