import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { CryptoModule } from "../crypto/crypto.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { DriveModule } from "../drive/drive.module.js";
import { EgressModule } from "../egress/egress.module.js";
import { ProfilesModule } from "../profiles/profiles.module.js";
import { ProxiesModule } from "../proxies/proxies.module.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { RedisModule } from "../redis/redis.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { BrowserController } from "./browser.controller.js";
import { BrowserService } from "./browser.service.js";
import { OrchestratorService } from "./orchestrator.service.js";
import { StreamGateway } from "./stream-gateway.js";
import { StreamTickets } from "./stream-tickets.js";

/**
 * The cloud browser: sessions, the orchestrator and the stream relay (Phase
 * 3), with Drive for downloads and file choosers and profiles for the data
 * kept between sessions.
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    CryptoModule,
    RedisModule,
    RateLimitModule,
    SecurityEventsModule,
    ProfilesModule,
    DriveModule,
    EgressModule,
    ProxiesModule,
    BillingModule,
  ],
  controllers: [BrowserController],
  providers: [OrchestratorService, StreamTickets, BrowserService, StreamGateway],
  exports: [BrowserService, StreamGateway, OrchestratorService],
})
export class BrowserModule {}
