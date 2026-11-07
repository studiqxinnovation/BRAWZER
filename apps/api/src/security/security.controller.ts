import {
  type SecurityEventPage,
  securityEventPageSchema,
  securityEventQuerySchema,
  type SecurityOverview,
  securityOverviewSchema,
} from "@brawzer/contracts";
import { Controller, Get, Inject, Query, SerializeOptions, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { SecurityHistoryService } from "./security.service.js";

/** Shield: the account's security centre. */
@ApiTags("Security")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "security", version: "1" })
export class SecurityController {
  constructor(@Inject(SecurityHistoryService) private readonly history: SecurityHistoryService) {}

  @Get("overview")
  @SerializeOptions({ schema: securityOverviewSchema })
  @ApiOperation({
    summary: "Shield overview",
    description: "Protection status, recommendations and new-device sign-ins.",
  })
  @ApiOkResponse({ description: "Overview.", standardSchema: securityOverviewSchema })
  overview(@CurrentAuth() auth: AuthContext): Promise<SecurityOverview> {
    return this.history.overview(auth);
  }

  @Get("events")
  @SerializeOptions({ schema: securityEventPageSchema })
  @ApiOperation({
    summary: "Security history",
    description:
      "Sign-ins, failed attempts, sign-outs and password changes, newest first. Pass nextCursor as `before` for older events.",
  })
  @ApiOkResponse({ description: "One page of events.", standardSchema: securityEventPageSchema })
  events(
    @CurrentAuth() auth: AuthContext,
    @Query({ schema: securityEventQuerySchema }) query: z.output<typeof securityEventQuerySchema>,
  ): Promise<SecurityEventPage> {
    return this.history.page(auth.user.id, query);
  }
}
