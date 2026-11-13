import {
  type ComplianceList,
  complianceItemRequestSchema,
  complianceListSchema,
  complianceToggleSchema,
  completePrivacyRequestSchema,
  type DataMap,
  dataMapSchema,
  type GoalList,
  goalListSchema,
  goalProgressSchema,
  goalRequestSchema,
  logPrivacyRequestSchema,
  type PrivacyRequestList,
  privacyKindNames,
  privacyRequestListSchema,
  type WeeklyPreview,
  weeklyPreviewSchema,
  weeklySettingsSchema,
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
import { ComplianceConsoleService } from "./compliance-console.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/** Privacy requests, the compliance checklist, the data map, goals and the weekly email (Phase 11.5). */
@ApiTags("Console")
@Controller({ path: "console/compliance", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class ComplianceConsoleController {
  constructor(
    @Inject(ComplianceConsoleService) private readonly compliance: ComplianceConsoleService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  /* ── Privacy requests ── */

  @Get("privacy")
  @Permission("dsar")
  @SerializeOptions({ schema: privacyRequestListSchema })
  @ApiOperation({ summary: "Privacy requests with their one-month deadlines" })
  @ApiOkResponse({ standardSchema: privacyRequestListSchema })
  privacy(@CurrentAuth() auth: AuthContext): Promise<PrivacyRequestList> {
    return this.compliance.privacy(auth);
  }

  @Post("privacy")
  @Permission("dsar")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: privacyRequestListSchema })
  @ApiOperation({ summary: "Log a request that came in" })
  @ApiOkResponse({ standardSchema: privacyRequestListSchema })
  async logPrivacy(
    @Body({ schema: logPrivacyRequestSchema }) body: z.output<typeof logPrivacyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PrivacyRequestList> {
    const id = await this.compliance.logPrivacy(auth, body);
    await this.audit.record(auth, {
      action: "Logged a privacy request",
      target: body.customerId,
      detail: `${privacyKindNames[body.kind]} · ${id}`,
      meta: requestMeta(request),
    });
    return this.compliance.privacy(auth);
  }

  @Post("privacy/:id/complete")
  @Permission("dsar")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: privacyRequestListSchema })
  @ApiOperation({
    summary: "Complete it; a deletion request deletes the account unless a hold stops it",
  })
  @ApiOkResponse({ standardSchema: privacyRequestListSchema })
  async completePrivacy(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: completePrivacyRequestSchema })
    body: z.output<typeof completePrivacyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PrivacyRequestList> {
    const { userId, kind } = await this.compliance.completePrivacy(
      auth,
      id,
      body.note,
      requestMeta(request),
    );
    await this.audit.record(auth, {
      action: kind === "delete" ? "Completed a deletion request" : "Completed a privacy request",
      target: userId,
      detail: `${privacyKindNames[kind]} · ${body.note}`,
      meta: requestMeta(request),
    });
    return this.compliance.privacy(auth);
  }

  /* ── Compliance checklist ── */

  @Get("checklist")
  @Permission("dsar")
  @SerializeOptions({ schema: complianceListSchema })
  @ApiOperation({ summary: "The controls the team keeps itself honest about" })
  @ApiOkResponse({ standardSchema: complianceListSchema })
  checklist(): Promise<ComplianceList> {
    return this.compliance.checklist();
  }

  @Post("checklist")
  @Permission("dsar")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: complianceListSchema })
  @ApiOperation({ summary: "Add a control" })
  @ApiOkResponse({ standardSchema: complianceListSchema })
  async addItem(
    @Body({ schema: complianceItemRequestSchema })
    body: z.output<typeof complianceItemRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ComplianceList> {
    await this.compliance.addItem(body.framework, body.item);
    await this.audit.record(auth, {
      action: "Added a control",
      target: body.framework,
      detail: body.item,
      meta: requestMeta(request),
    });
    return this.compliance.checklist();
  }

  @Patch("checklist/:id")
  @Permission("dsar")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: complianceListSchema })
  @ApiOperation({ summary: "Mark a control done or not done" })
  @ApiOkResponse({ standardSchema: complianceListSchema })
  async toggleItem(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: complianceToggleSchema }) body: z.output<typeof complianceToggleSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ComplianceList> {
    const item = await this.compliance.toggleItem(auth, id, body.done);
    await this.audit.record(auth, {
      action: body.done ? "Marked a control done" : "Marked a control not done",
      target: item.framework,
      detail: item.item,
      meta: requestMeta(request),
    });
    return this.compliance.checklist();
  }

  @Delete("checklist/:id")
  @Permission("dsar")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: complianceListSchema })
  @ApiOperation({ summary: "Remove a control" })
  @ApiOkResponse({ standardSchema: complianceListSchema })
  async removeItem(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ComplianceList> {
    const item = await this.compliance.removeItem(id);
    await this.audit.record(auth, {
      action: "Removed a control",
      target: item.framework,
      detail: item.item,
      meta: requestMeta(request),
    });
    return this.compliance.checklist();
  }

  /* ── Data map ── */

  @Get("datamap")
  @Permission("dsar")
  @SerializeOptions({ schema: dataMapSchema })
  @ApiOperation({
    summary: "Suppliers, retention and locations, from what the installation configures",
  })
  @ApiOkResponse({ standardSchema: dataMapSchema })
  dataMap(): Promise<DataMap> {
    return Promise.resolve(this.compliance.dataMap());
  }

  /* ── Goals ── */

  @Get("goals")
  @Permission("goals")
  @SerializeOptions({ schema: goalListSchema })
  @ApiOperation({ summary: "This quarter's goals" })
  @ApiOkResponse({ standardSchema: goalListSchema })
  goals(): Promise<GoalList> {
    return this.compliance.goals();
  }

  @Post("goals")
  @Permission("staff")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: goalListSchema })
  @ApiOperation({ summary: "Add a goal" })
  @ApiOkResponse({ standardSchema: goalListSchema })
  async addGoal(
    @Body({ schema: goalRequestSchema }) body: z.output<typeof goalRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<GoalList> {
    await this.compliance.addGoal(body);
    await this.audit.record(auth, {
      action: "Added a goal",
      target: body.name,
      detail: `${String(body.current)} of ${String(body.target)} ${body.unit}`,
      meta: requestMeta(request),
    });
    return this.compliance.goals();
  }

  @Put("goals/:id")
  @Permission("goals")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: goalListSchema })
  @ApiOperation({ summary: "Update a goal's numbers" })
  @ApiOkResponse({ standardSchema: goalListSchema })
  async updateGoal(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: goalProgressSchema }) body: z.output<typeof goalProgressSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<GoalList> {
    const goal = await this.compliance.updateGoal(id, body.current, body.target);
    await this.audit.record(auth, {
      action: "Updated a goal",
      target: goal.name,
      detail: `${String(goal.current)} of ${String(goal.target)} ${goal.unit}`,
      meta: requestMeta(request),
    });
    return this.compliance.goals();
  }

  @Delete("goals/:id")
  @Permission("staff")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: goalListSchema })
  @ApiOperation({ summary: "Remove a goal" })
  @ApiOkResponse({ standardSchema: goalListSchema })
  async removeGoal(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<GoalList> {
    const goal = await this.compliance.removeGoal(id);
    await this.audit.record(auth, {
      action: "Removed a goal",
      target: goal.name,
      meta: requestMeta(request),
    });
    return this.compliance.goals();
  }

  /* ── Weekly email ── */

  @Get("weekly")
  @Permission("weekly")
  @SerializeOptions({ schema: weeklyPreviewSchema })
  @ApiOperation({ summary: "The weekly email's settings and what it would say now" })
  @ApiOkResponse({ standardSchema: weeklyPreviewSchema })
  weekly(@CurrentAuth() auth: AuthContext): Promise<WeeklyPreview> {
    return this.compliance.weeklyPreview(auth);
  }

  @Put("weekly")
  @Permission("weekly")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: weeklyPreviewSchema })
  @ApiOperation({ summary: "Change when and to whom it goes" })
  @ApiOkResponse({ standardSchema: weeklyPreviewSchema })
  async setWeekly(
    @Body({ schema: weeklySettingsSchema }) body: z.output<typeof weeklySettingsSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<WeeklyPreview> {
    await this.compliance.setWeekly(body);
    await this.audit.record(auth, {
      action: body.on ? "Changed the weekly email" : "Turned off the weekly email",
      detail: `${String(body.recipients.length)} recipients · Mondays ${String(body.hourUtc)}:00 UTC`,
      meta: requestMeta(request),
    });
    return this.compliance.weeklyPreview(auth);
  }

  @Post("weekly/test")
  @Permission("weekly")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Send this week's email to yourself now" })
  async testWeekly(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.compliance.sendWeeklyTo(auth, [{ email: auth.user.email, version: "full" }], false);
    await this.audit.record(auth, {
      action: "Sent a weekly email test",
      target: auth.user.email,
      meta: requestMeta(request),
    });
  }
}
