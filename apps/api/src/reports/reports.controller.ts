import {
  type AdminPageReportList,
  type AdminPageReportPicture,
  adminPageReportListSchema,
  adminPageReportPictureSchema,
  adminPageReportQuerySchema,
  createPageReportRequestSchema,
  type PageReportCreated,
  pageReportCreatedSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AdminGuard } from "../admin/admin.guard.js";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { RecentAuthGuard } from "../auth/recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { ReportsService } from "./reports.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

@ApiTags("Reports")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "reports", version: "1" })
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: pageReportCreatedSchema })
  @ApiOperation({
    summary: "Report a page to Brawzer's team",
    description:
      "Only what is sent is kept: the message, and the page's address and a picture when the person includes them. A picture is deleted when the report is closed, or after 30 days.",
  })
  @ApiCreatedResponse({ description: "Sent.", standardSchema: pageReportCreatedSchema })
  @ApiTooManyRequestsResponse({ description: "Too many reports in the last hour." })
  create(
    @Body({ schema: createPageReportRequestSchema })
    body: z.output<typeof createPageReportRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PageReportCreated> {
    return this.reports.create(auth, body, requestMeta(request));
  }
}

@ApiTags("Admin")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiForbiddenResponse({ description: "Not an administrator, or no recent sign-in." })
@UseGuards(SessionGuard, AdminGuard, RecentAuthGuard)
@Controller({ path: "admin/reports", version: "1" })
export class AdminReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get()
  @SerializeOptions({ schema: adminPageReportListSchema })
  @ApiOperation({ summary: "Reported pages, newest first (open by default)" })
  @ApiOkResponse({ standardSchema: adminPageReportListSchema })
  list(
    @Query({ schema: adminPageReportQuerySchema })
    query: z.output<typeof adminPageReportQuerySchema>,
  ): Promise<AdminPageReportList> {
    return this.reports.list(query.state);
  }

  @Get(":id/picture")
  @Header("Cache-Control", "no-store")
  @SerializeOptions({ schema: adminPageReportPictureSchema })
  @ApiOperation({ summary: "The picture attached to a report, while the report is open" })
  @ApiOkResponse({ standardSchema: adminPageReportPictureSchema })
  @ApiNotFoundResponse({ description: "No such report, or no picture." })
  async picture(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AdminPageReportPicture> {
    return { picture: await this.reports.picture(id, auth.user.id) };
  }

  @Post(":id/close")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Close a report",
    description: "Its picture is deleted at once; the report itself after 90 days.",
  })
  @ApiNoContentResponse({ description: "Closed." })
  @ApiNotFoundResponse({ description: "No such report." })
  async close(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.reports.close(id, auth.user.id);
  }
}
