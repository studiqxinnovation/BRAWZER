import {
  type RecoveryCaseList,
  recoveryCaseListSchema,
  recoveryCheckNames,
  recoveryCheckRequestSchema,
  recoveryReleaseRequestSchema,
  recoveryStartForCustomerSchema,
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
import { RecoveryService } from "../recovery/recovery.service.js";
import { StaffAuditService } from "./audit.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });
const reasonSchema = z.object({ reason: z.string().trim().min(4).max(500) });

/** The console's account recovery cases (Phase 11.2). */
@ApiTags("Console")
@Controller({ path: "console/recovery", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class RecoveryConsoleController {
  constructor(
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  @Get()
  @Permission("recovery")
  @SerializeOptions({ schema: recoveryCaseListSchema })
  @ApiOperation({ summary: "Every recovery case, newest first" })
  @ApiOkResponse({ standardSchema: recoveryCaseListSchema })
  list(@CurrentAuth() auth: AuthContext): Promise<RecoveryCaseList> {
    return this.recovery.list(auth);
  }

  @Post()
  @Permission("recovery")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: recoveryCaseListSchema })
  @ApiOperation({ summary: "Start a case for a customer; they confirm from their email" })
  @ApiOkResponse({ standardSchema: recoveryCaseListSchema })
  async start(
    @Body({ schema: recoveryStartForCustomerSchema })
    body: z.output<typeof recoveryStartForCustomerSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCaseList> {
    const id = await this.recovery.startForCustomer(auth, body.customerId, requestMeta(request));
    await this.audit.record(auth, {
      action: "Started account recovery",
      target: body.customerId,
      detail: id,
      meta: requestMeta(request),
    });
    return this.recovery.list(auth);
  }

  @Post(":id/checks")
  @Permission("recovery")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: recoveryCaseListSchema })
  @ApiOperation({ summary: "Record an identity check" })
  @ApiOkResponse({ standardSchema: recoveryCaseListSchema })
  async check(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: recoveryCheckRequestSchema }) body: z.output<typeof recoveryCheckRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCaseList> {
    await this.recovery.recordCheck(auth, id, body.check, body.ok, body.note);
    await this.audit.record(auth, {
      action: "Recorded a recovery check",
      target: id,
      detail: `${recoveryCheckNames[body.check]}: ${body.ok ? "passed" : "failed"}${body.note ? ` · ${body.note}` : ""}`,
      meta: requestMeta(request),
    });
    return this.recovery.list(auth);
  }

  @Post(":id/reviewed")
  @Permission("recovery")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: recoveryCaseListSchema })
  @ApiOperation({ summary: "Mark the checks complete; a different person releases" })
  @ApiOkResponse({ standardSchema: recoveryCaseListSchema })
  async reviewed(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCaseList> {
    await this.recovery.markReviewed(auth, id);
    await this.audit.record(auth, {
      action: "Completed recovery checks",
      target: id,
      meta: requestMeta(request),
    });
    return this.recovery.list(auth);
  }

  @Post(":id/release")
  @Permission("recoveryApprove")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: recoveryCaseListSchema })
  @ApiOperation({
    summary: "Release the account: lost methods removed, devices signed out, password link sent",
  })
  @ApiOkResponse({ standardSchema: recoveryCaseListSchema })
  async release(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: recoveryReleaseRequestSchema })
    body: z.output<typeof recoveryReleaseRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCaseList> {
    const { userEmail, early } = await this.recovery.release(
      auth,
      id,
      body.reason,
      body.early,
      requestMeta(request),
    );
    await this.audit.record(auth, {
      action: "Approved account recovery",
      target: id,
      detail: `${maskEmail(userEmail)}${early ? " · EARLY" : ""} · ${body.reason}`,
      meta: requestMeta(request),
    });
    return this.recovery.list(auth);
  }

  @Post(":id/deny")
  @Permission("recovery")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: recoveryCaseListSchema })
  @ApiOperation({ summary: "Deny the case" })
  @ApiOkResponse({ standardSchema: recoveryCaseListSchema })
  async deny(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonSchema }) body: z.output<typeof reasonSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCaseList> {
    const userId = await this.recovery.deny(auth, id, body.reason, requestMeta(request));
    await this.audit.record(auth, {
      action: "Denied account recovery",
      target: userId,
      detail: `${id} · ${body.reason}`,
      meta: requestMeta(request),
    });
    return this.recovery.list(auth);
  }
}
