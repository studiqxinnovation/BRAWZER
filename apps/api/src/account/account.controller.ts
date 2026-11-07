import {
  type AccountExport,
  accountExportSchema,
  changeEmailRequestSchema,
  confirmEmailChangeRequestSchema,
  confirmEmailChangeResponseSchema,
  deleteAccountRequestSchema,
  type MessageResponse,
  messageResponseSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { RecentAuthGuard } from "../auth/recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import { type AuthContext, SessionService } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { AccountService } from "./account.service.js";

@ApiTags("Account")
@Controller({ path: "account", version: "1" })
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("email")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({
    summary: "Change the email address",
    description: "Sends a confirmation link to the new address and a notice to the current one.",
  })
  @ApiAcceptedResponse({
    description: "Check the new inbox.",
    standardSchema: messageResponseSchema,
  })
  async requestEmailChange(
    @Body({ schema: changeEmailRequestSchema }) body: z.output<typeof changeEmailRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<MessageResponse> {
    await this.account.requestEmailChange(auth, body.email, requestMeta(request));
    return { message: "Check the new inbox for a link to confirm the change." };
  }

  @Post("email/confirm")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: confirmEmailChangeResponseSchema })
  @ApiOperation({
    summary: "Confirm a new email address",
    description: "With the token from the emailed link.",
  })
  @ApiOkResponse({ description: "Changed.", standardSchema: confirmEmailChangeResponseSchema })
  @ApiBadRequestResponse({ description: "The link is invalid, expired or used." })
  async confirmEmailChange(
    @Body({ schema: confirmEmailChangeRequestSchema })
    body: z.output<typeof confirmEmailChangeRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ email: string }> {
    return { email: await this.account.confirmEmailChange(body.token, requestMeta(request)) };
  }

  @Post("delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Delete the account",
    description:
      "Immediate and irreversible. Needs a recent sign-in and the email address typed to confirm.",
  })
  @ApiNoContentResponse({ description: "Deleted; this device is signed out." })
  async delete(
    @Body({ schema: deleteAccountRequestSchema }) body: z.output<typeof deleteAccountRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.account.deleteAccount(auth, body.email);
    this.sessions.clearCookie(reply);
    void reply.header(
      "Clear-Site-Data",
      this.config.secureCookies ? '"cache", "cookies", "storage"' : '"cache", "storage"',
    );
  }

  @Get("export")
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: accountExportSchema })
  @ApiOperation({
    summary: "Download your data",
    description: "Everything except secrets, as JSON.",
  })
  @ApiOkResponse({ description: "The account's data.", standardSchema: accountExportSchema })
  async export(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountExport> {
    const date = new Date().toISOString().slice(0, 10);
    void reply.header("Content-Disposition", `attachment; filename="brawzer-account-${date}.json"`);
    return this.account.export(auth, requestMeta(request));
  }
}
