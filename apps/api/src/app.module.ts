import { type DynamicModule, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { ConfigModule } from "./config/config.module.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import type { AppConfig } from "./config/env.js";
import { HealthModule } from "./health/health.module.js";
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
        HealthModule,
        AuthModule,
        SecurityModule,
        MaintenanceModule,
      ],
    };
  }
}
