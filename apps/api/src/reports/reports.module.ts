import { Module } from "@nestjs/common";
import { AdminGuard } from "../admin/admin.guard.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { AdminReportsController, ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

/** Report a page (Phase 8, idea 12). */
@Module({
  imports: [AuthModule, DatabaseModule, EmailModule, RateLimitModule, SecurityEventsModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService, AdminGuard],
  exports: [ReportsService],
})
export class ReportsModule {}
