import { type HealthResponse, healthResponseSchema } from "@brawzer/contracts";
import { Controller, Get, HttpStatus, Inject, Res, SerializeOptions } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { HealthService } from "./health.service.js";

@ApiTags("Health")
@Controller({ path: "health", version: "1" })
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @SerializeOptions({ schema: healthResponseSchema })
  @ApiOperation({
    summary: "Service health",
    description:
      "Reports whether the API can reach its database and Redis. Outside production the response includes per-dependency checks.",
  })
  @ApiOkResponse({
    description: "Every dependency is reachable.",
    standardSchema: healthResponseSchema,
  })
  @ApiServiceUnavailableResponse({
    description: "At least one dependency is unreachable.",
    standardSchema: healthResponseSchema,
  })
  async getHealth(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const report = await this.health.check();
    if (report.status !== "ok") void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
