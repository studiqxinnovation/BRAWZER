import { Module } from "@nestjs/common";
import { DockerClient } from "../browser/docker.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DOCKER, EgressService } from "./egress.service.js";
import { RuntimeHostsService } from "./runtime-hosts.service.js";

/**
 * The egress service's host-side half (ADR 0014): the container engine
 * client and the proxy tester container. The cloud browser's orchestrator
 * builds on it for each session's egress sidecar.
 */
@Module({
  providers: [
    {
      provide: DOCKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new DockerClient(config.browser.docker),
    },
    RuntimeHostsService,
    EgressService,
  ],
  exports: [DOCKER, EgressService, RuntimeHostsService],
})
export class EgressModule {}
