import { Global, Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller.js";
import { MetricsService } from "./metrics.service.js";

/** Counters and gauges for the runbook's "watch" section, available everywhere. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
