import {
  type AnnouncementRequest,
  announcementRequestSchema,
  announcementToggleSchema,
  audienceName,
  declareIncidentRequestSchema,
  type Incident,
  type IncidentList,
  incidentListSchema,
  incidentSchema,
  incidentSeverityNames,
  incidentStatusNames,
  incidentUpdateRequestSchema,
  type StaffAnnouncementList,
  staffAnnouncementListSchema,
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
import { AnnouncementsService } from "../care/announcements.service.js";
import { IncidentsService } from "../care/incidents.service.js";
import { requestMeta } from "../common/request-meta.js";
import { StaffAuditService } from "./audit.service.js";
import { Permission, StaffGuard } from "./staff.guard.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/** The console's announcements and incidents (Phase 11.2). */
@ApiTags("Console")
@Controller({ path: "console", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class CareConsoleController {
  constructor(
    @Inject(AnnouncementsService) private readonly announcements: AnnouncementsService,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  /* ── Announcements ── */

  @Get("announcements")
  @Permission("announce")
  @SerializeOptions({ schema: staffAnnouncementListSchema })
  @ApiOperation({ summary: "Every banner, with who saw and clicked it" })
  @ApiOkResponse({ standardSchema: staffAnnouncementListSchema })
  list(): Promise<StaffAnnouncementList> {
    return this.announcements.list();
  }

  @Post("announcements")
  @Permission("announce")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: staffAnnouncementListSchema })
  @ApiOperation({ summary: "Publish a banner to an audience" })
  @ApiOkResponse({ standardSchema: staffAnnouncementListSchema })
  async publish(
    @Body({ schema: announcementRequestSchema }) body: AnnouncementRequest,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffAnnouncementList> {
    const id = await this.announcements.create(auth.user.id, body);
    await this.audit.record(auth, {
      action: "Published an announcement",
      target: id,
      detail: `${body.title} · ${audienceName(body.audience)}`,
      meta: requestMeta(request),
    });
    return this.announcements.list();
  }

  @Put("announcements/:id")
  @Permission("announce")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: staffAnnouncementListSchema })
  @ApiOperation({ summary: "Change a banner" })
  @ApiOkResponse({ standardSchema: staffAnnouncementListSchema })
  async edit(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: announcementRequestSchema }) body: AnnouncementRequest,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffAnnouncementList> {
    await this.announcements.update(id, body);
    await this.audit.record(auth, {
      action: "Changed an announcement",
      target: id,
      detail: body.title,
      meta: requestMeta(request),
    });
    return this.announcements.list();
  }

  @Patch("announcements/:id")
  @Permission("announce")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: staffAnnouncementListSchema })
  @ApiOperation({ summary: "Show or hide a banner" })
  @ApiOkResponse({ standardSchema: staffAnnouncementListSchema })
  async toggle(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: announcementToggleSchema }) body: z.output<typeof announcementToggleSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffAnnouncementList> {
    const title = await this.announcements.toggle(id, body.on);
    await this.audit.record(auth, {
      action: body.on ? "Showed an announcement" : "Hid an announcement",
      target: id,
      detail: title,
      meta: requestMeta(request),
    });
    return this.announcements.list();
  }

  @Delete("announcements/:id")
  @Permission("announce")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: staffAnnouncementListSchema })
  @ApiOperation({ summary: "Delete a banner" })
  @ApiOkResponse({ standardSchema: staffAnnouncementListSchema })
  async remove(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<StaffAnnouncementList> {
    const title = await this.announcements.remove(id);
    await this.audit.record(auth, {
      action: "Deleted an announcement",
      target: id,
      detail: title,
      meta: requestMeta(request),
    });
    return this.announcements.list();
  }

  /* ── Incidents ── */

  @Get("incidents")
  @Permission("notes")
  @SerializeOptions({ schema: incidentListSchema })
  @ApiOperation({ summary: "Every incident with its updates, newest first" })
  @ApiOkResponse({ standardSchema: incidentListSchema })
  async incidentList(): Promise<IncidentList> {
    return { incidents: await this.incidents.list() };
  }

  @Post("incidents")
  @Permission("incident")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: incidentSchema })
  @ApiOperation({ summary: "Declare an incident; a public one shows on /status and as a banner" })
  @ApiOkResponse({ standardSchema: incidentSchema })
  async declare(
    @Body({ schema: declareIncidentRequestSchema })
    body: z.output<typeof declareIncidentRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Incident> {
    const incident = await this.incidents.declare(auth.user, body);
    await this.audit.record(auth, {
      action: "Declared an incident",
      target: incident.id,
      detail: `${incidentSeverityNames[body.severity]} · ${body.title}${body.isPublic ? " · public" : " · internal"}`,
      meta: requestMeta(request),
    });
    return incident;
  }

  @Post("incidents/:id/updates")
  @Permission("incident")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: incidentSchema })
  @ApiOperation({ summary: "Post an update and set the status; resolving turns its banner off" })
  @ApiOkResponse({ standardSchema: incidentSchema })
  async update(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: incidentUpdateRequestSchema })
    body: z.output<typeof incidentUpdateRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Incident> {
    const incident = await this.incidents.postUpdate(auth.user, id, body);
    await this.audit.record(auth, {
      action: "Posted an incident update",
      target: id,
      detail: `${incidentStatusNames[body.status]} · ${body.body.slice(0, 120)}`,
      meta: requestMeta(request),
    });
    return incident;
  }
}
