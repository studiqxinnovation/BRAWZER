import {
  createTeamRequestSchema,
  inviteTeamMemberRequestSchema,
  renameTeamRequestSchema,
  type TeamOverview,
  teamOverviewSchema,
  transferTeamRequestSchema,
  updateTeamMemberRequestSchema,
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
  Req,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
import { TeamsService } from "./teams.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/** Every answer is the caller's whole Team page, so the page never has to guess. */
@ApiTags("Team")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "team", version: "1" })
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly teams: TeamsService) {}

  @Get()
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({
    summary: "The caller's team, or the invitations waiting for them",
    description: "Invitations go to an email address; the verified account with it sees them here.",
  })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  overview(@CurrentAuth() auth: AuthContext): Promise<TeamOverview> {
    return this.teams.overview(auth);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({ summary: "Start a team; the caller owns it and pays for it" })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  @ApiConflictResponse({ description: "Already in a team, or the plan has no team." })
  create(
    @Body({ schema: createTeamRequestSchema }) body: z.output<typeof createTeamRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamOverview> {
    return this.teams.create(auth, body.name, requestMeta(request));
  }

  @Patch()
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({ summary: "Rename the team (owner or admins)" })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  @ApiForbiddenResponse({ description: "Not the owner or an admin." })
  rename(
    @Body({ schema: renameTeamRequestSchema }) body: z.output<typeof renameTeamRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TeamOverview> {
    return this.teams.rename(auth, body.name);
  }

  @Delete()
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({
    summary: "Delete the team (owner, after confirming it's them)",
    description:
      "Its shared proxies and Drive space are deleted; every member keeps their own profiles and files.",
  })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  remove(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<TeamOverview> {
    return this.teams.delete(auth, requestMeta(request));
  }

  @Post("invitations")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({
    summary: "Invite someone by email (owner or admins)",
    description: "Waiting invitations count against the plan's team size. Inviting again renews.",
  })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  @ApiConflictResponse({ description: "Already a member, or the team is full." })
  invite(
    @Body({ schema: inviteTeamMemberRequestSchema })
    body: z.output<typeof inviteTeamMemberRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamOverview> {
    return this.teams.invite(auth, body.email, body.role, requestMeta(request));
  }

  @Delete("invitations/:id")
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({ summary: "Withdraw an invitation (owner or admins)" })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  @ApiNotFoundResponse({ description: "No such invitation in the team." })
  withdraw(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TeamOverview> {
    return this.teams.withdrawInvitation(auth, id);
  }

  @Post("invitations/:id/join")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({
    summary: "Join a team from an invitation to the caller's address",
    description:
      "Refused while the caller is in a team or pays for a subscription of their own: in a team, the owner's plan applies.",
  })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  @ApiConflictResponse({ description: "Already in a team, subscribed, or the team is full." })
  join(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamOverview> {
    return this.teams.join(auth, id, requestMeta(request));
  }

  @Post("invitations/:id/decline")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({ summary: "Decline an invitation to the caller's address" })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  decline(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<TeamOverview> {
    return this.teams.decline(auth, id);
  }

  @Patch("members/:userId")
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({ summary: "Make a member an admin, or an admin a member (owner)" })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  setRole(
    @Param("userId", { schema: idSchema }) userId: string,
    @Body({ schema: updateTeamMemberRequestSchema })
    body: z.output<typeof updateTeamMemberRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamOverview> {
    return this.teams.setRole(auth, userId, body.role, requestMeta(request));
  }

  @Delete("members/:userId")
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({
    summary: "Remove someone from the team",
    description:
      "The owner removes anyone else; admins remove members. Their files in the team's Drive stay with the team.",
  })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  removeMember(
    @Param("userId", { schema: idSchema }) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamOverview> {
    return this.teams.remove(auth, userId, requestMeta(request));
  }

  @Post("leave")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({ summary: "Leave the team (anyone but the owner)" })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  leave(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<TeamOverview> {
    return this.teams.leave(auth, requestMeta(request));
  }

  @Post("transfer")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RecentAuthGuard)
  @SerializeOptions({ schema: teamOverviewSchema })
  @ApiOperation({
    summary: "Hand the team to another member (owner, after confirming it's them)",
    description: "The new owner's plan then applies to everyone; the old owner becomes an admin.",
  })
  @ApiOkResponse({ standardSchema: teamOverviewSchema })
  transfer(
    @Body({ schema: transferTeamRequestSchema }) body: z.output<typeof transferTeamRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TeamOverview> {
    return this.teams.transfer(auth, body.userId, requestMeta(request));
  }
}
