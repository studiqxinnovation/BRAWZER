import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./env.js";

/** Injection token for the validated, immutable {@link AppConfig}. */
export const APP_CONFIG = Symbol.for("brawzer.api.config");

@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
