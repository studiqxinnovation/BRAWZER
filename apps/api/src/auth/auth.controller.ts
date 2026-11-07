import {
  type CurrentSessionResponse,
  currentSessionResponseSchema,
  emailRequestSchema,
  loginRequestSchema,
  type MessageResponse,
  messageResponseSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "@brawzer/contracts";
import type { User } from "@brawzer/db";
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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { requestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { AuthService } from "./auth.service.js";
import { type AuthContext, SessionService } from "./session.service.js";
import { CurrentAuth, SessionGuard } from "./session.guard.js";

/** Name of the cookie security scheme in the OpenAPI document. */
export const SESSION_AUTH = "session";

function accountOf(user: User): CurrentSessionResponse["account"] {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@ApiTags("Auth")
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("register")
  @HttpCode(HttpStatus.ACCEPTED)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({
    summary: "Create an account",
    description:
      "Sends a confirmation link. The response is the same whether or not the address already has an account.",
  })
  @ApiAcceptedResponse({ description: "Check your email.", standardSchema: messageResponseSchema })
  @ApiBadRequestResponse({ description: "Invalid email address or password." })
  @ApiTooManyRequestsResponse({ description: "Too many sign-ups from this network." })
  async register(
    @Body({ schema: registerRequestSchema }) body: z.output<typeof registerRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MessageResponse> {
    await this.auth.register(body, requestMeta(request));
    return { message: "Check your email for a link to finish creating your account." };
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: currentSessionResponseSchema })
  @ApiOperation({
    summary: "Confirm an email address",
    description:
      "Takes the token from the emailed link and the password chosen at sign-up, confirms the address and signs in.",
  })
  @ApiOkResponse({
    description: "Confirmed and signed in.",
    standardSchema: currentSessionResponseSchema,
  })
  @ApiBadRequestResponse({ description: "The link is invalid, expired or already used." })
  @ApiUnauthorizedResponse({ description: "Not the password chosen at sign-up." })
  async verifyEmail(
    @Body({ schema: verifyEmailRequestSchema }) body: z.output<typeof verifyEmailRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CurrentSessionResponse> {
    const { user, issued } = await this.auth.verifyEmail(body, requestMeta(request));
    this.sessions.setCookie(reply, issued);
    return { account: accountOf(user), session: this.sessions.describe(issued.session) };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: currentSessionResponseSchema })
  @ApiOperation({
    summary: "Sign in",
    description:
      "Sets the session cookie. Without keepSignedIn the cookie ends with the browser and the session ends after 30 idle minutes.",
  })
  @ApiOkResponse({ description: "Signed in.", standardSchema: currentSessionResponseSchema })
  @ApiUnauthorizedResponse({ description: "Email or password is incorrect." })
  @ApiForbiddenResponse({
    description: "The email address isn't confirmed yet; a new link was sent.",
  })
  @ApiTooManyRequestsResponse({ description: "Too many attempts." })
  async login(
    @Body({ schema: loginRequestSchema }) body: z.output<typeof loginRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CurrentSessionResponse> {
    const { user, issued } = await this.auth.login(
      body,
      requestMeta(request),
      this.sessions.readToken(request),
    );
    this.sessions.setCookie(reply, issued);
    return { account: accountOf(user), session: this.sessions.describe(issued.session) };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Sign out",
    description:
      "Ends the session, clears the cookie and asks the browser to clear Brawzer's site data.",
  })
  @ApiNoContentResponse({ description: "Signed out (also when there was no session)." })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(this.sessions.readToken(request), requestMeta(request));
    this.sessions.clearCookie(reply);
    // In development every localhost app shares cookies, so "cookies" would
    // sign you out of unrelated projects; the session cookie is cleared above.
    void reply.header(
      "Clear-Site-Data",
      this.config.secureCookies ? '"cache", "cookies", "storage"' : '"cache", "storage"',
    );
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: currentSessionResponseSchema })
  @ApiOperation({
    summary: "Rotate the session token",
    description:
      "Issues a new session cookie. Counts as activity; the absolute lifetime never grows.",
  })
  @ApiOkResponse({ description: "New cookie set.", standardSchema: currentSessionResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session." })
  async refresh(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CurrentSessionResponse> {
    const issued = await this.auth.refresh(auth);
    if (issued) this.sessions.setCookie(reply, issued);
    return {
      account: accountOf(auth.user),
      session: this.sessions.describe(issued?.session ?? auth.session),
    };
  }

  @Get("session")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: currentSessionResponseSchema })
  @ApiOperation({ summary: "Current account and session" })
  @ApiOkResponse({ description: "Signed in.", standardSchema: currentSessionResponseSchema })
  @ApiUnauthorizedResponse({ description: "No valid session." })
  getSession(@CurrentAuth() auth: AuthContext): CurrentSessionResponse {
    return { account: accountOf(auth.user), session: this.sessions.describe(auth.session) };
  }

  @Post("password/forgot")
  @HttpCode(HttpStatus.ACCEPTED)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({
    summary: "Request a password reset link",
    description: "The response is the same whether or not the address has an account.",
  })
  @ApiAcceptedResponse({ description: "Check your email.", standardSchema: messageResponseSchema })
  @ApiTooManyRequestsResponse({ description: "Too many requests from this network." })
  async forgotPassword(
    @Body({ schema: emailRequestSchema }) body: z.output<typeof emailRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MessageResponse> {
    await this.auth.forgotPassword(body.email, requestMeta(request));
    return {
      message:
        "If there’s an account for that address, we’ve emailed a link to reset the password.",
    };
  }

  @Post("password/reset")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({
    summary: "Choose a new password",
    description: "Uses the emailed reset token. Signs out every device; sign in again afterwards.",
  })
  @ApiOkResponse({ description: "Password changed.", standardSchema: messageResponseSchema })
  @ApiBadRequestResponse({ description: "Invalid link or a password that is too easy to guess." })
  async resetPassword(
    @Body({ schema: resetPasswordRequestSchema }) body: z.output<typeof resetPasswordRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MessageResponse> {
    await this.auth.resetPassword(body, requestMeta(request));
    return { message: "Your password has been changed. Sign in with your new password." };
  }
}
