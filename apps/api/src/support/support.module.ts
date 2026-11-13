import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SupportController } from "./support.controller.js";
import { SupportService } from "./support.service.js";

/** Support requests (Phase 11.2): Help for customers; the console's inbox reads the same service. */
@Module({
  imports: [AuthModule, DatabaseModule, BillingModule, EmailModule, RateLimitModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
