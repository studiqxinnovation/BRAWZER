import {
  type BrowserImages,
  browserImagesSchema,
  extensionStatusNames,
  type Fleet,
  fleetSchema,
  type LiveSessionList,
  liveSessionListSchema,
  type ModeratedExtensionList,
  moderatedExtensionListSchema,
  type Network,
  networkSchema,
  setExtensionStatusRequestSchema,
  type TechHealth,
  techHealthSchema,
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
import { Permission, StaffGuard } from "./staff.guard.js";
import { TechConsoleService } from "./tech-console.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });
const slugSchema = z.string().regex(/^[a-z0-9-]{2,40}$/, { error: "That isn’t a valid slug." });
const reasonSchema = z.object({ reason: z.string().trim().min(4).max(300) });

/** The console's technical pages (Phase 11.4). */
@ApiTags("Console")
@Controller({ path: "console/tech", version: "1" })
@UseGuards(SessionGuard, StaffGuard)
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not staff, or a role without this permission." })
export class TechConsoleController {
  constructor(
    @Inject(TechConsoleService) private readonly tech: TechConsoleService,
    @Inject(StaffAuditService) private readonly audit: StaffAuditService,
  ) {}

  @Get("fleet")
  @Permission("tech")
  @SerializeOptions({ schema: fleetSchema })
  @ApiOperation({ summary: "The runtime hosts, their capacity and today's starts" })
  @ApiOkResponse({ standardSchema: fleetSchema })
  fleet(): Promise<Fleet> {
    return this.tech.fleet();
  }

  @Get("sessions")
  @Permission("sessionEnd")
  @SerializeOptions({ schema: liveSessionListSchema })
  @ApiOperation({ summary: "Every live cloud browser: machine facts only" })
  @ApiOkResponse({ standardSchema: liveSessionListSchema })
  sessions(@CurrentAuth() auth: AuthContext): Promise<LiveSessionList> {
    return this.tech.sessions(auth);
  }

  @Post("sessions/:id/end")
  @Permission("sessionEnd")
  @UseGuards(RecentAuthGuard)
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: liveSessionListSchema })
  @ApiOperation({ summary: "End a session with a reason; the profile's data is saved" })
  @ApiOkResponse({ standardSchema: liveSessionListSchema })
  async endSession(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: reasonSchema }) body: z.output<typeof reasonSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<LiveSessionList> {
    await this.tech.endSession(id);
    await this.audit.record(auth, {
      action: "Ended a cloud browser session",
      target: id,
      detail: body.reason,
      meta: requestMeta(request),
    });
    return this.tech.sessions(auth);
  }

  @Get("images")
  @Permission("tech")
  @SerializeOptions({ schema: browserImagesSchema })
  @ApiOperation({ summary: "The images the containers run from, and the engines they offer" })
  @ApiOkResponse({ standardSchema: browserImagesSchema })
  images(): Promise<BrowserImages> {
    return this.tech.images();
  }

  @Get("extensions")
  @Permission("extModerate")
  @SerializeOptions({ schema: moderatedExtensionListSchema })
  @ApiOperation({ summary: "The extension catalogue with installs and moderation" })
  @ApiOkResponse({ standardSchema: moderatedExtensionListSchema })
  extensions(): Promise<ModeratedExtensionList> {
    return this.tech.extensions();
  }

  @Put("extensions/:slug")
  @Permission("extModerate")
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: moderatedExtensionListSchema })
  @ApiOperation({ summary: "Allow, put under review or block; blocking removes it everywhere" })
  @ApiOkResponse({ standardSchema: moderatedExtensionListSchema })
  async setExtension(
    @Param("slug", { schema: slugSchema }) slug: string,
    @Body({ schema: setExtensionStatusRequestSchema })
    body: z.output<typeof setExtensionStatusRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ModeratedExtensionList> {
    const { name, removedFrom } = await this.tech.setExtensionStatus(
      auth,
      slug,
      body.status,
      body.reason,
    );
    await this.audit.record(auth, {
      action: body.status === "blocked" ? "Blocked an extension" : "Changed an extension’s status",
      target: slug,
      detail: `${name}: ${extensionStatusNames[body.status]}${body.reason ? ` · ${body.reason}` : ""}${removedFrom ? ` · removed from ${String(removedFrom)} accounts’ profiles` : ""}`,
      meta: requestMeta(request),
    });
    return this.tech.extensions();
  }

  @Get("network")
  @Permission("tech")
  @SerializeOptions({ schema: networkSchema })
  @ApiOperation({ summary: "Saved proxies and their tests; site rules" })
  @ApiOkResponse({ standardSchema: networkSchema })
  network(): Promise<Network> {
    return this.tech.network();
  }

  @Get("health")
  @Permission("tech")
  @SerializeOptions({ schema: techHealthSchema })
  @ApiOperation({ summary: "What the API measures about itself" })
  @ApiOkResponse({ standardSchema: techHealthSchema })
  health(): Promise<TechHealth> {
    return this.tech.techHealth();
  }
}
