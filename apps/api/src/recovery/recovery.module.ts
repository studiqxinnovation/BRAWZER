import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { RecoveryController } from "./recovery.controller.js";
import { RecoveryService } from "./recovery.service.js";

/** Account recovery (Phase 11.2). The console's side lives in AdminModule. */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    EmailModule,
    RateLimitModule,
    SecurityEventsModule,
    BillingModule,
  ],
  controllers: [RecoveryController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
