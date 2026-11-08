import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Inject, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiException } from "../common/api-exception.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { MetricsService } from "./metrics.service.js";

/** GET /api/metrics (also /api/v1/metrics): for a scraper, behind METRICS_TOKEN when one is set. */
@ApiExcludeController()
@Controller({ path: "metrics", version: [VERSION_NEUTRAL, "1"] })
export class MetricsController {
  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async scrape(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const token = this.config.metricsToken;
    if (token) {
      const header = request.headers.authorization ?? "";
      const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
      const expected = Buffer.from(token);
      const given = Buffer.from(presented);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new ApiException("unauthorized", 401, "A metrics token is required.");
      }
    }
    // The text type only once the answer is the text: a refusal stays JSON.
    void reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    void reply.header("cache-control", "no-store");
    return this.metrics.render();
  }
}
