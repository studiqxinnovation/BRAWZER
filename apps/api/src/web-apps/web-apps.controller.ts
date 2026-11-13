import { Controller, Get, HttpStatus, Inject, Param, Res, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ApiException } from "../common/api-exception.js";
import { WebAppsService } from "./web-apps.service.js";

const idSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

@ApiTags("Web apps")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "web-apps", version: "1" })
export class WebAppsController {
  constructor(@Inject(WebAppsService) private readonly webApps: WebAppsService) {}

  @Get(":id/icon")
  @ApiOperation({
    summary: "A web app's icon",
    description:
      "The site's own icon, fetched by Brawzer from the site itself and kept for a day. Only the App Store's listed sites.",
  })
  @ApiOkResponse({ description: "The icon, as an image." })
  @ApiNotFoundResponse({ description: "Not a listed web app, or its site offers no icon." })
  async icon(
    @Param("id", { schema: idSchema }) id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pending = this.webApps.icon(id);
    const icon = pending ? await pending : null;
    if (!icon) {
      throw new ApiException("not_found", HttpStatus.NOT_FOUND, "This site offers no icon.");
    }
    await reply
      .header("content-type", icon.type)
      .header("content-length", String(icon.bytes.length))
      .header("cache-control", "private, max-age=86400")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .send(icon.bytes);
  }
}
