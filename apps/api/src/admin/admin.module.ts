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
import { RecoveryModule } from "../recovery/recovery.module.js";
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
import { RecoveryConsoleController } from "./recovery-console.controller.js";
import { BillingConsoleController } from "./billing-console.controller.js";
import { BillingConsoleService } from "./billing-console.service.js";
import { TechConsoleController } from "./tech-console.controller.js";
import { TechConsoleService } from "./tech-console.service.js";
import { HealthModule } from "../health/health.module.js";
import { EmailModule } from "../email/email.js";
import { RateLimitModule } from "../rate-limit/rate-limiter.js";
import { SecurityEventsModule } from "../security-events/security-events.js";
import { SecurityConsoleController } from "./security-console.controller.js";
import { SecurityConsoleService } from "./security-console.service.js";
import { EgressModule } from "../egress/egress.module.js";

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
    RecoveryModule,
    HealthModule,
    EgressModule,
    EmailModule,
    RateLimitModule,
    SecurityEventsModule,
  ],
  controllers: [
    AdminController,
    ConsoleController,
    SupportConsoleController,
    CareConsoleController,
    RecoveryConsoleController,
    BillingConsoleController,
    TechConsoleController,
    SecurityConsoleController,
  ],
  providers: [
    AdminService,
    AdminGuard,
    StaffGuard,
    StaffAuditService,
    CustomersService,
    CompanyService,
    BillingConsoleService,
    TechConsoleService,
    SecurityConsoleService,
  ],
  exports: [AdminService, StaffAuditService],
})
export class AdminModule {}
