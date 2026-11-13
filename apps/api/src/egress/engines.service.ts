import type { BrowserEngine } from "@brawzer/contracts";
import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { RuntimeHostsService } from "./runtime-hosts.service.js";

/** How long an answer about the runtime image stands before it is asked again. */
const REFRESH_MS = 5 * 60_000;

/**
 * The browsers offered right now: those the operator lists in
 * `BROWSER_ENGINES` that the runtime image can run. Microsoft ships Edge for
 * x86-64 Linux only, so the image installs it there and nowhere else; Edge is
 * offered when every runtime host's image is x86-64, never as a tile that
 * can't start.
 */
@Injectable()
export class EnginesService {
  private cached: { at: number; engines: readonly BrowserEngine[] } | null = null;

  constructor(
    @Inject(RuntimeHostsService) private readonly hosts: RuntimeHostsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async offered(): Promise<readonly BrowserEngine[]> {
    const configured = this.config.browser.engines;
    if (!configured.includes("edge")) return configured;
    if (this.cached && Date.now() - this.cached.at < REFRESH_MS) return this.cached.engines;
    let edge: boolean;
    let fresh = true;
    try {
      const architectures = await Promise.all(
        this.hosts.all().map((host) => host.docker.imageArchitecture(this.config.browser.image)),
      );
      edge =
        architectures.length > 0 && architectures.every((architecture) => architecture === "amd64");
    } catch {
      // A host that can't be asked: keep the last answer, or leave Edge out until one can be.
      edge = this.cached?.engines.includes("edge") ?? false;
      fresh = false;
    }
    const engines = configured.filter((engine) => engine !== "edge" || edge);
    if (fresh) this.cached = { at: Date.now(), engines };
    return engines;
  }
}
