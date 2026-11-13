import {
  type SavedReplyList,
  savedReplyListSchema,
  savedReplyRequestSchema,
  type StaffTicket,
  type StaffTicketList,
  staffReplyRequestSchema,
  staffTicketListSchema,
  staffTicketQuerySchema,
  staffTicketSchema,
  type SupportStats,
  supportStatsSchema,
  ticketPriorityNames,
  updateTicketRequestSchema,
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
  Patch,
  Post,
  Put,
  Query,
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { RecentAuthGuard } from "../auth/recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { maskEmail } from "../email/transports.js";
import { SupportService } from "../support/support.service.js";
import { StaffAuditService } from "./audit.service.js";
import { CustomersService } from "./customers.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });
const assigneeSchema = z.object({ id: z.uuid(), email: z.string() });
const assigneeListSchema = z.object({ assignees: z.array(assigneeSchema) });

/** The console's support inbox, saved replies and support performance (Phase 11.2). */
@ApiTags("Console")
@Controller({ path: "console/support", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class SupportConsoleController {
  constructor(
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  @Get("tickets")
  @Permission("tickets")
  @SerializeOptions({ schema: staffTicketListSchema })
  @ApiOperation({ summary: "The inbox: requests closest to missing their response target first" })
  @ApiOkResponse({ standardSchema: staffTicketListSchema })
  list(
    @Query({ schema: staffTicketQuerySchema }) query: z.output<typeof staffTicketQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StaffTicketList> {
    return this.support.list(auth, query);
  }

  @Get("assignees")
  @Permission("tickets")
  @SerializeOptions({ schema: assigneeListSchema })
  @ApiOperation({ summary: "Who requests can be assigned to" })
  @ApiOkResponse({ standardSchema: assigneeListSchema })
  async assignees(): Promise<z.infer<typeof assigneeListSchema>> {
    return { assignees: await this.support.assignees() };
  }

  @Get("tickets/:id")
  @Permission("tickets")
  @SerializeOptions({ schema: staffTicketSchema })
  @ApiOperation({ summary: "One request with every message and the customer's account" })
  @ApiOkResponse({ standardSchema: staffTicketSchema })
  async one(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StaffTicket> {
    const ticket = await this.support.one(auth, id);
    const account = await this.customers.one(auth, ticket.customer.id);
    return { ...ticket, account };
  }

  @Patch("tickets/:id")
  @Permission("tickets")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: staffTicketSchema })
  @ApiOperation({ summary: "Change status, priority, category or who it's assigned to" })
  @ApiOkResponse({ standardSchema: staffTicketSchema })
  async update(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: updateTicketRequestSchema }) body: z.output<typeof updateTicketRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffTicket> {
    const { before, after } = await this.support.update(auth, id, body);
    const changes: string[] = [];
    if (body.status !== undefined && body.status !== before.status)
      changes.push(`status ${after.status}`);
    if (body.priority !== undefined && body.priority !== before.priority) {
      changes.push(`priority ${ticketPriorityNames[after.priority]}`);
    }
    if (body.category !== undefined && body.category !== before.category) {
      changes.push(`category ${after.category}`);
    }
    if (body.assigneeId !== undefined && body.assigneeId !== before.assigneeId) {
      changes.push(after.assigneeId ? "assigned" : "unassigned");
    }
    if (changes.length) {
      await this.audit.record(auth, {
        action: "Changed a support request",
        target: before.userId,
        detail: `#${String(before.number)} · ${changes.join(", ")}`,
        meta: requestMeta(request),
      });
    }
    return this.one(id, auth);
  }

  @Post("tickets/:id/messages")
  @Permission("tickets")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: staffTicketSchema })
  @ApiOperation({ summary: "Reply to the customer (emailed) or leave an internal note" })
  @ApiOkResponse({ standardSchema: staffTicketSchema })
  async reply(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: staffReplyRequestSchema }) body: z.output<typeof staffReplyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffTicket> {
    const { ticket, emailedTo } = await this.support.reply(auth, id, body);
    await this.audit.record(auth, {
      action: body.kind === "note" ? "Noted on a support request" : "Replied to a support request",
      target: ticket.userId,
      detail:
        body.kind === "note"
          ? `#${String(ticket.number)}`
          : `#${String(ticket.number)} · emailed ${emailedTo ? maskEmail(emailedTo) : "nobody"} · now ${ticket.status}`,
      meta: requestMeta(request),
    });
    return this.one(id, auth);
  }

  /* ── Saved replies ── */

  @Get("replies")
  @Permission("replies")
  @SerializeOptions({ schema: savedReplyListSchema })
  @ApiOperation({ summary: "The team's saved replies" })
  @ApiOkResponse({ standardSchema: savedReplyListSchema })
  async replies(): Promise<SavedReplyList> {
    return { replies: await this.support.savedReplies() };
  }

  @Post("replies")
  @Permission("replies")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: savedReplyListSchema })
  @ApiOperation({ summary: "Add a saved reply" })
  @ApiOkResponse({ standardSchema: savedReplyListSchema })
  async addReply(
    @Body({ schema: savedReplyRequestSchema }) body: z.output<typeof savedReplyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<SavedReplyList> {
    await this.support.saveReply(auth, null, body);
    await this.audit.record(auth, {
      action: "Added a saved reply",
      detail: body.name,
      meta: requestMeta(request),
    });
    return this.replies();
  }

  @Put("replies/:id")
  @Permission("replies")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: savedReplyListSchema })
  @ApiOperation({ summary: "Change a saved reply" })
  @ApiOkResponse({ standardSchema: savedReplyListSchema })
  async editReply(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: savedReplyRequestSchema }) body: z.output<typeof savedReplyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<SavedReplyList> {
    await this.support.saveReply(auth, id, body);
    await this.audit.record(auth, {
      action: "Changed a saved reply",
      detail: body.name,
      meta: requestMeta(request),
    });
    return this.replies();
  }

  @Delete("replies/:id")
  @Permission("replies")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: savedReplyListSchema })
  @ApiOperation({ summary: "Delete a saved reply" })
  @ApiOkResponse({ standardSchema: savedReplyListSchema })
  async deleteReply(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<SavedReplyList> {
    const name = await this.support.deleteReply(id);
    await this.audit.record(auth, {
      action: "Deleted a saved reply",
      detail: name,
      meta: requestMeta(request),
    });
    return this.replies();
  }

  /* ── Support performance ── */

  @Get("stats")
  @Permission("tickets")
  @SerializeOptions({ schema: supportStatsSchema })
  @ApiOperation({ summary: "Support performance, from the requests themselves" })
  @ApiOkResponse({ standardSchema: supportStatsSchema })
  stats(@CurrentAuth() auth: AuthContext): Promise<SupportStats> {
    return this.support.stats(auth);
  }
}
