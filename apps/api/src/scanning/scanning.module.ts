import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { ClamdScanner, type Scanner } from "./clamd.js";

export const SCANNER = Symbol.for("brawzer.api.scanner");

@Module({
  providers: [
    {
      provide: SCANNER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Scanner => new ClamdScanner(config.scanner),
    },
  ],
  exports: [SCANNER],
})
export class ScanningModule {}
