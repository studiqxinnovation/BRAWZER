import {
  type DeviceSessionList,
  deviceSessionListSchema,
  type RevokeOtherSessionsResponse,
  revokeOtherSessionsResponseSchema,
} from "@brawzer/contracts";
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { requestMeta } from "../common/request-meta.js";
import { SESSION_AUTH } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { RecentAuthGuard } from "./recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "./session.guard.js";
import { type AuthContext, SessionService } from "./session.service.js";

const sessionIdSchema = z.uuid({ error: "That isn’t a session ID." });

/** The devices signed in to the account, and ending them from anywhere. */
@ApiTags("Auth")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "auth/sessions", version: "1" })
export class SessionsController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get()
  @SerializeOptions({ schema: deviceSessionListSchema })
  @ApiOperation({
    summary: "Signed-in devices",
    description: "Every active session of the account, the current one first.",
  })
  @ApiOkResponse({ description: "Active sessions.", standardSchema: deviceSessionListSchema })
  async list(@CurrentAuth() auth: AuthContext): Promise<DeviceSessionList> {
    return { sessions: await this.sessions.listActive(auth) };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RecentAuthGuard)
  @ApiOperation({
    summary: "Sign out another device",
    description:
      "Ends one of the account's other sessions immediately. Use sign-out for this device.",
  })
  @ApiNoContentResponse({ description: "That device is signed out." })
  @ApiBadRequestResponse({ description: "The ID is this device's own session." })
  @ApiNotFoundResponse({ description: "No such active session on this account." })
  async end(
    @Param("id", { schema: sessionIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.auth.endSession(auth, id, requestMeta(request));
  }

  @Post("revoke-others")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: revokeOtherSessionsResponseSchema })
  @ApiOperation({
    summary: "Sign out every other device",
    description: "Ends every session of the account except the one making the request.",
  })
  @ApiOkResponse({
    description: "How many sessions were ended.",
    standardSchema: revokeOtherSessionsResponseSchema,
  })
  async endOthers(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RevokeOtherSessionsResponse> {
    return { revoked: await this.auth.endOtherSessions(auth, requestMeta(request)) };
  }
}
