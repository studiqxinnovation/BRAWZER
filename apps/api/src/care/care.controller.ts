import {
  type AnnouncementList,
  announcementListSchema,
  type PublicStatus,
  publicStatusSchema,
} from "@brawzer/contracts";
import {
  Controller,
  Get,
  Header,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { AnnouncementsService } from "./announcements.service.js";
import { IncidentsService } from "./incidents.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/** Banners inside Brawzer, for the signed-in person. */
@ApiTags("Announcements")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "announcements", version: "1" })
export class AnnouncementsController {
  constructor(@Inject(AnnouncementsService) private readonly announcements: AnnouncementsService) {}

  @Get()
  @SerializeOptions({ schema: announcementListSchema })
  @ApiOperation({ summary: "Banners meant for you that you haven't dismissed" })
  @ApiOkResponse({ standardSchema: announcementListSchema })
  async list(@CurrentAuth() auth: AuthContext): Promise<AnnouncementList> {
    return { announcements: await this.announcements.forUser(auth.user.id) };
  }

  @Post(":id/dismiss")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Dismiss a banner; it stays dismissed on every device" })
  @ApiNoContentResponse()
  async dismiss(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.announcements.dismiss(auth.user.id, id);
  }

  @Post(":id/click")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Count that the banner's link was followed" })
  @ApiNoContentResponse()
  async click(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.announcements.click(auth.user.id, id);
  }
}

/** The public status page's data: no sign-in needed, nothing personal in it. */
@ApiTags("Status")
@Controller({ path: "status", version: "1" })
export class StatusController {
  constructor(@Inject(IncidentsService) private readonly incidents: IncidentsService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=30")
  @SerializeOptions({ schema: publicStatusSchema })
  @ApiOperation({ summary: "Is Brawzer up? Components, open incidents and planned maintenance" })
  @ApiOkResponse({ standardSchema: publicStatusSchema })
  status(): Promise<PublicStatus> {
    return this.incidents.publicStatus();
  }
}
