import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MaintenanceModule } from "../maintenance/retention.js";
import { BrowserModule } from "../browser/browser.module.js";
import { AccountModule } from "../account/account.module.js";
import { DriveModule } from "../drive/drive.module.js";
import { SupportModule } from "../support/support.module.js";
import { CareModule } from "../care/care.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminService } from "./admin.service.js";
import { StaffAuditService } from "./audit.service.js";
import { CompanyService } from "./company.service.js";
import { ConsoleController } from "./console.controller.js";
import { CustomersService } from "./customers.service.js";
import { StaffGuard } from "./staff.guard.js";
import { SupportConsoleController } from "./support-console.controller.js";
import { CareConsoleController } from "./care-console.controller.js";

/** Administration (Phase 6) and the admin console (Phase 11). */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    BillingModule,
    MaintenanceModule,
    BrowserModule,
    DriveModule,
    AccountModule,
    SupportModule,
    CareModule,
  ],
  controllers: [
    AdminController,
    ConsoleController,
    SupportConsoleController,
    CareConsoleController,
  ],
  providers: [
    AdminService,
    AdminGuard,
    StaffGuard,
    StaffAuditService,
    CustomersService,
    CompanyService,
  ],
  exports: [AdminService, StaffAuditService],
})
export class AdminModule {}
