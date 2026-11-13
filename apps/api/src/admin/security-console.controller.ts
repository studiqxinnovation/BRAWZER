import {
  type AbuseReportList,
  abuseDecisionSchema,
  abuseReportListSchema,
  blockAddressRequestSchema,
  holdRequestSchema,
  type Legal,
  legalDecisionSchema,
  legalSchema,
  logAbuseRequestSchema,
  logLegalRequestSchema,
  type Threats,
  threatsSchema,
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
import { StaffAuditService } from "./audit.service.js";
import { SecurityConsoleService } from "./security-console.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/** The console's security and compliance pages (Phase 11.5). */
@ApiTags("Console")
@Controller({ path: "console/security", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class SecurityConsoleController {
  constructor(
    @Inject(SecurityConsoleService) private readonly security: SecurityConsoleService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  @Get("threats")
  @Permission("blockIp")
  @SerializeOptions({ schema: threatsSchema })
  @ApiOperation({
    summary: "Sign-in trouble, blocked addresses, second-factor take-up, staff sign-ins",
  })
  @ApiOkResponse({ standardSchema: threatsSchema })
  threats(@CurrentAuth() auth: AuthContext): Promise<Threats> {
    return this.security.threats(auth);
  }

  @Post("blocked")
  @Permission("blockIp")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: threatsSchema })
  @ApiOperation({ summary: "Block an address or network from signing in and registering" })
  @ApiOkResponse({ standardSchema: threatsSchema })
  async block(
    @Body({ schema: blockAddressRequestSchema }) body: z.output<typeof blockAddressRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Threats> {
    const cidr = await this.security.block(auth, body);
    await this.audit.record(auth, {
      action: "Blocked an address",
      target: cidr,
      detail: `${body.reason}${body.hours ? ` · for ${String(body.hours)} h` : ""}`,
      meta: requestMeta(request),
    });
    return this.security.threats(auth);
  }

  @Delete("blocked/:id")
  @Permission("blockIp")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: threatsSchema })
  @ApiOperation({ summary: "Lift a block" })
  @ApiOkResponse({ standardSchema: threatsSchema })
  async unblock(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Threats> {
    const cidr = await this.security.unblock(id);
    await this.audit.record(auth, {
      action: "Unblocked an address",
      target: cidr,
      meta: requestMeta(request),
    });
    return this.security.threats(auth);
  }

  /* ── Abuse ── */

  @Get("abuse")
  @Permission("abuse")
  @SerializeOptions({ schema: abuseReportListSchema })
  @ApiOperation({ summary: "Abuse reports and what was done" })
  @ApiOkResponse({ standardSchema: abuseReportListSchema })
  abuse(@CurrentAuth() auth: AuthContext): Promise<AbuseReportList> {
    return this.security.abuse(auth);
  }

  @Post("abuse")
  @Permission("abuse")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: abuseReportListSchema })
  @ApiOperation({ summary: "Log a report" })
  @ApiOkResponse({ standardSchema: abuseReportListSchema })
  async logAbuse(
    @Body({ schema: logAbuseRequestSchema }) body: z.output<typeof logAbuseRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<AbuseReportList> {
    const id = await this.security.logAbuse(auth, body);
    await this.audit.record(auth, {
      action: "Logged an abuse report",
      target: body.customerId,
      detail: `${body.kind} · from ${body.source} · ${id}`,
      meta: requestMeta(request),
    });
    return this.security.abuse(auth);
  }

  @Post("abuse/:id/decision")
  @Permission("abuse")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: abuseReportListSchema })
  @ApiOperation({
    summary: "Warn (emailed), suspend with the evidence held, or close as not abuse",
  })
  @ApiOkResponse({ standardSchema: abuseReportListSchema })
  async decideAbuse(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: abuseDecisionSchema }) body: z.output<typeof abuseDecisionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<AbuseReportList> {
    const { userId, kind } = await this.security.decideAbuse(auth, id, body, requestMeta(request));
    await this.audit.record(auth, {
      action:
        body.action === "warn"
          ? "Warned an account about abuse"
          : body.action === "suspend"
            ? "Suspended an account for abuse, evidence held"
            : "Closed an abuse report as not abuse",
      target: userId,
      detail: `${kind} · ${body.note}`,
      meta: requestMeta(request),
    });
    return this.security.abuse(auth);
  }

  /* ── Legal ── */

  @Get("legal")
  @Permission("legal")
  @SerializeOptions({ schema: legalSchema })
  @ApiOperation({ summary: "Requests from police and courts, and the holds in force" })
  @ApiOkResponse({ standardSchema: legalSchema })
  legal(@CurrentAuth() auth: AuthContext): Promise<Legal> {
    return this.security.legal(auth);
  }

  @Post("legal/requests")
  @Permission("legal")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: legalSchema })
  @ApiOperation({ summary: "Log a legal request, with a hold if asked" })
  @ApiOkResponse({ standardSchema: legalSchema })
  async logLegal(
    @Body({ schema: logLegalRequestSchema }) body: z.output<typeof logLegalRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Legal> {
    const id = await this.security.logLegal(auth, body);
    await this.audit.record(auth, {
      action: "Logged a legal request",
      target: body.customerId ?? body.fromWhom,
      detail: `${body.kind} from ${body.fromWhom} · ${id}${body.hold ? " · hold placed" : ""}`,
      meta: requestMeta(request),
    });
    return this.security.legal(auth);
  }

  @Post("legal/requests/:id/decision")
  @Permission("legal")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: legalSchema })
  @ApiOperation({ summary: "Record that a request was answered or refused" })
  @ApiOkResponse({ standardSchema: legalSchema })
  async decideLegal(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: legalDecisionSchema }) body: z.output<typeof legalDecisionSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Legal> {
    await this.security.decideLegal(id, body.status, body.note);
    await this.audit.record(auth, {
      action: body.status === "answered" ? "Answered a legal request" : "Refused a legal request",
      target: id,
      detail: body.note,
      meta: requestMeta(request),
    });
    return this.security.legal(auth);
  }

  @Post("legal/holds")
  @Permission("legal")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: legalSchema })
  @ApiOperation({ summary: "Put an account under a legal hold: nothing of it can be deleted" })
  @ApiOkResponse({ standardSchema: legalSchema })
  async hold(
    @Body({ schema: holdRequestSchema }) body: z.output<typeof holdRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Legal> {
    await this.security.hold(auth, body.customerId, body.why);
    await this.audit.record(auth, {
      action: "Placed a legal hold",
      target: body.customerId,
      detail: body.why,
      meta: requestMeta(request),
    });
    return this.security.legal(auth);
  }

  @Delete("legal/holds/:customerId")
  @Permission("legal")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: legalSchema })
  @ApiOperation({ summary: "Release a hold" })
  @ApiOkResponse({ standardSchema: legalSchema })
  async release(
    @Param("customerId", { schema: idSchema }) customerId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Legal> {
    const why = await this.security.release(customerId);
    await this.audit.record(auth, {
      action: "Released a legal hold",
      target: customerId,
      detail: why,
      meta: requestMeta(request),
    });
    return this.security.legal(auth);
  }
}
