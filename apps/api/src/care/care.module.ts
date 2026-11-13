import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { HealthModule } from "../health/health.module.js";
import { AnnouncementsService } from "./announcements.service.js";
import { AnnouncementsController, StatusController } from "./care.controller.js";
import { IncidentsService } from "./incidents.service.js";

/** Announcements, incidents and the status page (Phase 11.2). The console's side lives in AdminModule. */
@Module({
  imports: [AuthModule, DatabaseModule, BillingModule, HealthModule],
  controllers: [AnnouncementsController, StatusController],
  providers: [AnnouncementsService, IncidentsService],
  exports: [AnnouncementsService, IncidentsService],
})
export class CareModule {}
