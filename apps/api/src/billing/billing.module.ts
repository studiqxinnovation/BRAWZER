import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { createStripe, STRIPE } from "./stripe.js";

/** Plans, limits, Stripe checkout and webhooks (Phase 6, ADR 0015). */
@Module({
  imports: [AuthModule, DatabaseModule, SecurityEventsModule],
  controllers: [BillingController],
  providers: [
    {
      provide: STRIPE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createStripe(config.billing),
    },
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
