import {
  type ReauthenticateResponse,
  reauthenticateRequestSchema,
  reauthenticateResponseSchema,
  changePasswordRequestSchema,
  type CurrentSessionResponse,
  currentSessionResponseSchema,
  emailRequestSchema,
  type LoginResponse,
  loginRequestSchema,
  loginResponseSchema,
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
import { RECENT_AUTH_SECONDS } from "./recent-auth.guard.js";
import { type AuthContext, SessionService } from "./session.service.js";
import { CurrentAuth, PassiveSession, SessionGuard } from "./session.guard.js";

/** Name of the cookie security scheme in the OpenAPI document. */
export const SESSION_AUTH = "session";

function accountOf(user: User): CurrentSessionResponse["account"] {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    planCode: user.planCode,
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
  @SerializeOptions({ schema: loginResponseSchema })
  @ApiOperation({
    summary: "Sign in",
    description:
      "Sets the session cookie, or, for accounts with two-factor authentication, returns a ticket for POST /auth/mfa/verify. Without keepSignedIn the cookie ends with the browser and the session ends after 30 idle minutes.",
  })
  @ApiOkResponse({
    description: "Signed in, or a two-factor challenge.",
    standardSchema: loginResponseSchema,
  })
  @ApiUnauthorizedResponse({ description: "Email or password is incorrect." })
  @ApiForbiddenResponse({
    description: "The email address isn't confirmed yet; a new link was sent.",
  })
  @ApiTooManyRequestsResponse({ description: "Too many attempts." })
  async login(
    @Body({ schema: loginRequestSchema }) body: z.output<typeof loginRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(
      body,
      requestMeta(request),
      this.sessions.readToken(request),
    );
    if ("mfa" in result) {
      return {
        mfaRequired: true,
        ticket: result.mfa.ticket,
        expiresAt: result.mfa.expiresAt.toISOString(),
      };
    }
    this.sessions.setCookie(reply, result.issued);
    return {
      account: accountOf(result.user),
      session: this.sessions.describe(result.issued.session),
    };
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

  @Get("session/status")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @PassiveSession()
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Is this session still valid?",
    description:
      "For background checks by open pages. Unlike other requests it doesn't count as activity, so it never keeps an idle session alive.",
  })
  @ApiNoContentResponse({ description: "The session is valid." })
  @ApiUnauthorizedResponse({ description: "The session has ended." })
  sessionStatus(): void {
    // The guard did the work.
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

  @Post("reauthenticate")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: reauthenticateResponseSchema })
  @ApiOperation({
    summary: "Confirm it's you",
    description:
      "Proves who you are again before a sensitive change. Valid for 10 minutes on this session.",
  })
  @ApiOkResponse({ description: "Confirmed.", standardSchema: reauthenticateResponseSchema })
  @ApiBadRequestResponse({ description: "Wrong password." })
  @ApiTooManyRequestsResponse({ description: "Too many wrong passwords." })
  async reauthenticate(
    @Body({ schema: reauthenticateRequestSchema })
    body: z.output<typeof reauthenticateRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ReauthenticateResponse> {
    const at = await this.auth.reauthenticate(auth, body.password, body.code, requestMeta(request));
    return { confirmedUntil: new Date(at.getTime() + RECENT_AUTH_SECONDS * 1000).toISOString() };
  }

  @Post("password/change")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({
    summary: "Change the password",
    description:
      "Needs the current password. Signs out every other device and gives this one a new session cookie.",
  })
  @ApiOkResponse({ description: "Password changed.", standardSchema: messageResponseSchema })
  @ApiBadRequestResponse({ description: "Wrong current password, or a weak new one." })
  @ApiUnauthorizedResponse({ description: "No valid session." })
  @ApiTooManyRequestsResponse({ description: "Too many wrong current passwords." })
  async changePassword(
    @Body({ schema: changePasswordRequestSchema })
    body: z.output<typeof changePasswordRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MessageResponse> {
    const { issued, signedOut } = await this.auth.changePassword(auth, body, requestMeta(request));
    if (issued) this.sessions.setCookie(reply, issued);
    if (signedOut === 0) return { message: "Your password has been changed." };
    return {
      message:
        signedOut === 1
          ? "Your password has been changed and 1 other device was signed out."
          : `Your password has been changed and ${String(signedOut)} other devices were signed out.`,
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
