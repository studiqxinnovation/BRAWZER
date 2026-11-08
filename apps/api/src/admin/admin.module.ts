import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";

/** Administration (Phase 6): account lookup and manual plans. */
@Module({
  imports: [AuthModule, DatabaseModule, BillingModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
  exports: [AdminService],
})
export class AdminModule {}
