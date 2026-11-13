import {
  createSiteRuleRequestSchema,
  MAX_SITE_RULES,
  type SiteRule,
  type SiteRuleList,
  siteRuleListSchema,
  siteRuleSchema,
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
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { SiteRulesService } from "./site-rules.service.js";

const ruleIdSchema = z.uuid({ error: "That isn’t a rule ID." });

@ApiTags("Site rules")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "site-rules", version: "1" })
export class SiteRulesController {
  constructor(@Inject(SiteRulesService) private readonly rules: SiteRulesService) {}

  @Get()
  @SerializeOptions({ schema: siteRuleListSchema })
  @ApiOperation({
    summary: "The account's site rules",
    description:
      "Blocked hosts never open in the cloud browser; once any allowed host exists, only allowed hosts open. A rule covers the host and its subdomains.",
  })
  @ApiOkResponse({
    description: "Rules and the account's limit.",
    standardSchema: siteRuleListSchema,
  })
  async list(@CurrentAuth() auth: AuthContext): Promise<SiteRuleList> {
    return { rules: await this.rules.list(auth.user.id), limit: MAX_SITE_RULES };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: siteRuleSchema })
  @ApiOperation({ summary: "Add a rule", description: "Applies to sessions started from now on." })
  @ApiCreatedResponse({ description: "The new rule.", standardSchema: siteRuleSchema })
  @ApiConflictResponse({ description: "The host is already listed, or the limit is reached." })
  create(
    @Body({ schema: createSiteRuleRequestSchema })
    body: z.output<typeof createSiteRuleRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SiteRule> {
    return this.rules.create(auth.user.id, body.kind, body.host);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a rule" })
  @ApiNoContentResponse({ description: "Removed." })
  @ApiNotFoundResponse({ description: "No such rule on this account." })
  async remove(
    @Param("id", { schema: ruleIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.rules.remove(auth.user.id, id);
  }
}
