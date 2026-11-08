import {
  createProfileRequestSchema,
  MAX_PROFILES,
  type Profile,
  type ProfileList,
  profileListSchema,
  profileSchema,
  reorderProfilesRequestSchema,
  updateProfileRequestSchema,
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
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { ProfilesService } from "./profiles.service.js";

const profileIdSchema = z.uuid({ error: "That isn’t a profile ID." });

@ApiTags("Profiles")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "profiles", version: "1" })
export class ProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get()
  @SerializeOptions({ schema: profileListSchema })
  @ApiOperation({ summary: "This account's profiles", description: "In the account's order." })
  @ApiOkResponse({
    description: "Profiles and the account's limit.",
    standardSchema: profileListSchema,
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<ProfileList> {
    return { profiles: await this.profiles.list(auth.user.id), limit: MAX_PROFILES };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: profileSchema })
  @ApiOperation({ summary: "Create a profile", description: "Added at the end of the list." })
  @ApiCreatedResponse({ description: "The new profile.", standardSchema: profileSchema })
  @ApiConflictResponse({ description: "The name is taken, or the account has reached its limit." })
  create(
    @Body({ schema: createProfileRequestSchema }) body: z.output<typeof createProfileRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Profile> {
    return this.profiles.create(auth, body, requestMeta(request));
  }

  @Put("order")
  @SerializeOptions({ schema: profileListSchema })
  @ApiOperation({
    summary: "Reorder profiles",
    description: "List every profile ID in the new order.",
  })
  @ApiOkResponse({ description: "Profiles in their new order.", standardSchema: profileListSchema })
  @ApiConflictResponse({ description: "The list doesn't match the account's profiles." })
  async reorder(
    @Body({ schema: reorderProfilesRequestSchema })
    body: z.output<typeof reorderProfilesRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ProfileList> {
    return { profiles: await this.profiles.reorder(auth.user.id, body.ids), limit: MAX_PROFILES };
  }

  @Patch(":id")
  @SerializeOptions({ schema: profileSchema })
  @ApiOperation({ summary: "Rename or recolour a profile, choose its proxy or what it keeps" })
  @ApiOkResponse({ description: "The updated profile.", standardSchema: profileSchema })
  @ApiNotFoundResponse({ description: "No such profile on this account." })
  update(
    @Param("id", { schema: profileIdSchema }) id: string,
    @Body({ schema: updateProfileRequestSchema }) body: z.output<typeof updateProfileRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Profile> {
    return this.profiles.update(auth.user.id, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Delete a profile",
    description: "An account always keeps at least one.",
  })
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiConflictResponse({ description: "It's the account's last profile." })
  async remove(
    @Param("id", { schema: profileIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.profiles.remove(auth, id, requestMeta(request));
  }

  @Delete(":id/data")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: profileSchema })
  @ApiOperation({
    summary: "Clear a profile's browsing data",
    description: "Forgets the cookies, history and site data kept between sessions.",
  })
  @ApiOkResponse({ description: "The profile, without saved data.", standardSchema: profileSchema })
  @ApiNotFoundResponse({ description: "No such profile on this account." })
  clearData(
    @Param("id", { schema: profileIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Profile> {
    return this.profiles.clearData(auth, id, requestMeta(request));
  }
}
