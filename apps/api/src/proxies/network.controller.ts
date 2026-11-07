import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requestMeta } from "../common/request-meta.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";

/** The destination of proxy tests: it tells the caller which address it came from. */
@ApiTags("Network")
@Controller({ path: "network", version: "1" })
export class NetworkController {
  constructor(@Inject(RateLimiter) private readonly limiter: RateLimiter) {}

  @Get("echo")
  @ApiOperation({
    summary: "Your address",
    description: "The address this request came from, as plain text. Used by proxy tests.",
  })
  @ApiOkResponse({ description: "An IP address." })
  async echo(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const ip = requestMeta(request).ip;
    await this.limiter.enforce(RATE_LIMITS.echoPerIp, ip ?? "unknown");
    await reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("cache-control", "no-store")
      .send(ip ?? "unknown");
  }
}
