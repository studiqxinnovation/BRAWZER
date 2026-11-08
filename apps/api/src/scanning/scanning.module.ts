import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { ClamdScanner, type Scanner, ScannerUnavailableError } from "./clamd.js";

export const SCANNER = Symbol.for("brawzer.api.scanner");

/** The scanner, with each scan's time and every outage counted for the metrics. */
function measured(scanner: Scanner, metrics: MetricsService): Scanner {
  return {
    ping: () => scanner.ping(),
    async scan(content) {
      const started = process.hrtime.bigint();
      try {
        return await scanner.scan(content);
      } catch (error) {
        if (error instanceof ScannerUnavailableError) {
          metrics.count(
            "brawzer_scanner_unavailable_total",
            "Scans refused because the scanner was away.",
          );
        }
        throw error;
      } finally {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        metrics.observe("brawzer_scan_seconds", "Scanner time per file, in seconds.", seconds);
      }
    },
  };
}

@Module({
  providers: [
    {
      provide: SCANNER,
      inject: [APP_CONFIG, MetricsService],
      useFactory: (config: AppConfig, metrics: MetricsService): Scanner =>
        measured(new ClamdScanner(config.scanner), metrics),
    },
  ],
  exports: [SCANNER],
})
export class ScanningModule {}
