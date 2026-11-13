import {
  type AccountExport,
  accountExportSchema,
  changeEmailRequestSchema,
  confirmEmailChangeRequestSchema,
  confirmEmailChangeResponseSchema,
  deleteAccountRequestSchema,
  type MessageResponse,
  messageResponseSchema,
  undoEmailChangeRequestSchema,
  undoEmailChangeResponseSchema,
  accountEmailSchema,
  unsubscribeRequestSchema,
  unsubscribeResponseSchema,
  updateEmailPreferencesRequestSchema,
  accountNameSchema,
  updateNameRequestSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
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

  @Post("email/undo")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: undoEmailChangeResponseSchema })
  @ApiOperation({
    summary: "Undo an email change",
    description:
      "With the token from the link sent to the old address: restores it, sets the new password and signs out every device.",
  })
  @ApiOkResponse({ description: "Restored.", standardSchema: undoEmailChangeResponseSchema })
  @ApiBadRequestResponse({ description: "The link is invalid, expired or used." })
  async undoEmailChange(
    @Body({ schema: undoEmailChangeRequestSchema })
    body: z.output<typeof undoEmailChangeRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ email: string }> {
    return {
      email: await this.account.undoEmailChange(body.token, body.password, requestMeta(request)),
    };
  }

  @Get("email")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: accountEmailSchema })
  @ApiOperation({
    summary: "What the account's address receives",
    description:
      "Which optional emails are on (security and billing emails are always sent), and whether the provider has reported the address as unreachable.",
  })
  @ApiOkResponse({ standardSchema: accountEmailSchema })
  emailSettings(@CurrentAuth() auth: AuthContext) {
    return this.account.emailSettings(auth);
  }

  @Patch("email-preferences")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: accountEmailSchema })
  @ApiOperation({
    summary: "Turn optional emails on or off",
    description: "Usage notices and team updates. Kept with the account.",
  })
  @ApiOkResponse({ standardSchema: accountEmailSchema })
  updateEmailPreferences(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: updateEmailPreferencesRequestSchema })
    body: z.infer<typeof updateEmailPreferencesRequestSchema>,
  ) {
    return this.account.updateEmailPreferences(auth, body);
  }

  @Patch("name")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: accountNameSchema })
  @ApiOperation({
    summary: "Change the name on the account",
    description:
      "What Brawzer calls the person, in the app and in email. One line, up to 80 characters.",
  })
  @ApiOkResponse({ standardSchema: accountNameSchema })
  updateName(
    @CurrentAuth() auth: AuthContext,
    @Body({ schema: updateNameRequestSchema }) body: z.infer<typeof updateNameRequestSchema>,
  ) {
    return this.account.updateName(auth, body.name);
  }

  @Post("unsubscribe")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: unsubscribeResponseSchema })
  @ApiOperation({
    summary: "Stop one kind of optional email",
    description:
      "Opened from an email's footer, signed in or not: the token says which account and which kind. The link works once and lasts 90 days.",
  })
  @ApiOkResponse({ standardSchema: unsubscribeResponseSchema })
  @ApiBadRequestResponse({ description: "The link is invalid, expired or used." })
  unsubscribe(
    @Body({ schema: unsubscribeRequestSchema }) body: z.infer<typeof unsubscribeRequestSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.account.unsubscribe(body.token, requestMeta(request));
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
