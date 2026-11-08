import { type DynamicModule, Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module.js";
import { ProfilesModule } from "./profiles/profiles.module.js";
import { ProxiesModule } from "./proxies/proxies.module.js";
import { SiteRulesModule } from "./site-rules/site-rules.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { BrowserModule } from "./browser/browser.module.js";
import { ConfigModule } from "./config/config.module.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import { DriveModule } from "./drive/drive.module.js";
import type { AppConfig } from "./config/env.js";
import { HealthModule } from "./health/health.module.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { MaintenanceModule } from "./maintenance/retention.js";
import { SecurityModule } from "./security/security.module.js";

@Module({})
export class AppModule {
  /** Builds the module graph around an already-validated configuration. */
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        CryptoModule,
        MetricsModule,
        HealthModule,
        AuthModule,
        SecurityModule,
        AccountModule,
        ProfilesModule,
        ProxiesModule,
        SiteRulesModule,
        DriveModule,
        BrowserModule,
        BillingModule,
        AdminModule,
        MaintenanceModule,
      ],
    };
  }
}
