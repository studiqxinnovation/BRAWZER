import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { TeamsController } from "./teams.controller.js";
import { TeamsService } from "./teams.service.js";

/** Team accounts (Phase 8, idea 19; ADR 0019). */
@Module({
  imports: [
    AuthModule,
    BillingModule,
    DatabaseModule,
    EmailModule,
    RateLimitModule,
    SecurityEventsModule,
  ],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
