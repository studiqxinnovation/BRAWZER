import {
  type BrowserOverview,
  browserOverviewSchema,
  type BrowserSession,
  browserSessionSchema,
  startBrowserSessionRequestSchema,
  type StreamTicket,
  streamTicketSchema,
} from "@brawzer/contracts";
import {
  Body,
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
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { BrowserService } from "./browser.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

@ApiTags("Browser")
@Controller({ path: "browser", version: "1" })
@UseGuards(SessionGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
export class BrowserController {
  constructor(@Inject(BrowserService) private readonly browser: BrowserService) {}

  @Get()
  @SerializeOptions({ schema: browserOverviewSchema })
  @ApiOperation({ summary: "The account's live cloud browser session, limits and runtime status" })
  @ApiOkResponse({ standardSchema: browserOverviewSchema })
  overview(@CurrentAuth() auth: AuthContext): Promise<BrowserOverview> {
    return this.browser.overview(auth.user.id);
  }

  @Post("sessions")
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: browserSessionSchema })
  @ApiOperation({
    summary: "Start a cloud browser session",
    description:
      "Starts an isolated container with the engine and waits until it is ready. One live session per account. The session ends when this sign-in ends.",
  })
  @ApiCreatedResponse({ description: "The running session.", standardSchema: browserSessionSchema })
  @ApiConflictResponse({ description: "A session is already running." })
  @ApiServiceUnavailableResponse({ description: "The runtime couldn't start." })
  start(
    @Body({ schema: startBrowserSessionRequestSchema })
    body: z.output<typeof startBrowserSessionRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<BrowserSession> {
    return this.browser.start(
      auth,
      body.profileId ?? null,
      requestMeta(request),
      body.resume,
      body.engine,
    );
  }

  @Post("sessions/:id/hand-off")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "End a session to continue it on another device",
    description:
      "Like ending it, with its open tabs kept for the profile's next session, which can reopen them on any device (ADR 0020). Not for a temporary session or a profile that keeps nothing.",
  })
  @ApiNoContentResponse({ description: "Ended; the tabs wait for the next session." })
  @ApiNotFoundResponse({ description: "No such live session on this account." })
  @ApiConflictResponse({ description: "The session keeps nothing to continue from." })
  async handOff(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.browser.handOff(auth.user.id, id, requestMeta(request));
  }

  @Delete("sessions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "End a session",
    description: "The container is destroyed; nothing is kept.",
  })
  @ApiNoContentResponse({ description: "Ended." })
  @ApiNotFoundResponse({ description: "No such session on this account." })
  async end(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.browser.end(auth.user.id, id, requestMeta(request));
  }

  @Post("sessions/:id/ticket")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: streamTicketSchema })
  @ApiOperation({
    summary: "Get a ticket to open the session's stream",
    description:
      "The ticket works once, for 60 seconds, and is sent as the first message on the stream's WebSocket (`GET /browser/sessions/:id/stream`), which never sees the session cookie.",
  })
  @ApiOkResponse({ standardSchema: streamTicketSchema })
  @ApiNotFoundResponse({ description: "No running session with that id on this account." })
  ticket(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StreamTicket> {
    return this.browser.issueTicket(auth, id);
  }
}
