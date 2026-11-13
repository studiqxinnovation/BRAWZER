import {
  createTicketRequestSchema,
  type Ticket,
  type TicketList,
  ticketListSchema,
  ticketRatingRequestSchema,
  ticketReplyRequestSchema,
  ticketSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { SupportService } from "./support.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/** Help: a customer's own support requests. */
@ApiTags("Support")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "support/tickets", version: "1" })
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  @SerializeOptions({ schema: ticketListSchema })
  @ApiOperation({ summary: "Your requests, newest activity first" })
  @ApiOkResponse({ standardSchema: ticketListSchema })
  async list(@CurrentAuth() auth: AuthContext): Promise<TicketList> {
    return { tickets: await this.support.listFor(auth.user.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: ticketSchema })
  @ApiOperation({
    summary: "Ask Brawzer's team for help",
    description: "Brawzer's team replies here and by email.",
  })
  @ApiCreatedResponse({ standardSchema: ticketSchema })
  @ApiTooManyRequestsResponse({ description: "Too many requests in the last hour." })
  create(
    @Body({ schema: createTicketRequestSchema })
    body: z.output<typeof createTicketRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Ticket> {
    return this.support.create(auth, body);
  }

  @Get(":id")
  @SerializeOptions({ schema: ticketSchema })
  @ApiOperation({ summary: "One request with its messages" })
  @ApiOkResponse({ standardSchema: ticketSchema })
  one(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Ticket> {
    return this.support.oneFor(auth.user.id, id);
  }

  @Post(":id/messages")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: ticketSchema })
  @ApiOperation({ summary: "Reply; a solved request opens again" })
  @ApiOkResponse({ standardSchema: ticketSchema })
  reply(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: ticketReplyRequestSchema }) body: z.output<typeof ticketReplyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Ticket> {
    return this.support.replyFor(auth, id, body.body);
  }

  @Post(":id/solve")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: ticketSchema })
  @ApiOperation({ summary: "Mark your request solved" })
  @ApiOkResponse({ standardSchema: ticketSchema })
  solve(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Ticket> {
    return this.support.solveFor(auth, id);
  }

  @Post(":id/rating")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: ticketSchema })
  @ApiOperation({ summary: "Rate how a solved request went; 3 or less reopens it" })
  @ApiOkResponse({ standardSchema: ticketSchema })
  rate(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: ticketRatingRequestSchema }) body: z.output<typeof ticketRatingRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Ticket> {
    return this.support.rateFor(auth, id, body.rating, body.comment);
  }
}
