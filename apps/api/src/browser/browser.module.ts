import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { RedisModule } from "../redis/redis.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { BrowserController } from "./browser.controller.js";
import { BrowserService } from "./browser.service.js";
import { DockerClient } from "./docker.js";
import { DOCKER, OrchestratorService } from "./orchestrator.service.js";
import { StreamGateway } from "./stream-gateway.js";
import { StreamTickets } from "./stream-tickets.js";

/** The cloud browser: sessions, the orchestrator and the stream relay (Phase 3). */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    CryptoModule,
    RedisModule,
    RateLimitModule,
    SecurityEventsModule,
  ],
  controllers: [BrowserController],
  providers: [
    {
      provide: DOCKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new DockerClient(config.browser.dockerSocket),
    },
    OrchestratorService,
    StreamTickets,
    BrowserService,
    StreamGateway,
  ],
  exports: [BrowserService, StreamGateway, OrchestratorService],
})
export class BrowserModule {}
