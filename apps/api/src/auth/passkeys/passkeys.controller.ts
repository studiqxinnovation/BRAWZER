import {
  type CurrentSessionResponse,
  currentSessionResponseSchema,
  type Passkey,
  type PasskeyList,
  passkeyConfirmationRequestSchema,
  passkeyListSchema,
  type PasskeyOptionsResponse,
  passkeyOptionsResponseSchema,
  passkeyRegistrationRequestSchema,
  passkeySchema,
  passkeySignInRequestSchema,
  type ReauthenticateResponse,
  reauthenticateResponseSchema,
  renamePasskeyRequestSchema,
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
  Res,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requestMeta } from "../../common/request-meta.js";
import { SESSION_AUTH } from "../auth.controller.js";
import { RECENT_AUTH_SECONDS, RecentAuthGuard } from "../recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../session.guard.js";
import { type AuthContext, SessionService } from "../session.service.js";
import { PasskeyService } from "./passkey.service.js";

const passkeyIdSchema = z.uuid({ error: "That isn’t a passkey ID." });

@ApiTags("Passkeys")
@Controller({ path: "auth/passkeys", version: "1" })
export class PasskeysController {
  constructor(
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: passkeyListSchema })
  @ApiOperation({ summary: "This account's passkeys" })
  @ApiOkResponse({ description: "Passkeys, newest first.", standardSchema: passkeyListSchema })
  async list(@CurrentAuth() auth: AuthContext): Promise<PasskeyList> {
    return { passkeys: await this.passkeys.list(auth.user.id) };
  }

  @Post("registration/options")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: passkeyOptionsResponseSchema })
  @ApiOperation({
    summary: "Start adding a passkey",
    description:
      "Needs a recent sign-in. On a shared-computer session, only phones and security keys are offered.",
  })
  @ApiOkResponse({
    description: "WebAuthn creation options.",
    standardSchema: passkeyOptionsResponseSchema,
  })
  registrationOptions(@CurrentAuth() auth: AuthContext): Promise<PasskeyOptionsResponse> {
    return this.passkeys.registrationOptions(auth);
  }

  @Post("registration/verify")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: passkeySchema })
  @ApiOperation({ summary: "Finish adding a passkey" })
  @ApiOkResponse({ description: "The saved passkey.", standardSchema: passkeySchema })
  @ApiBadRequestResponse({ description: "The passkey couldn't be verified." })
  register(
    @Body({ schema: passkeyRegistrationRequestSchema })
    body: z.output<typeof passkeyRegistrationRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<Passkey> {
    return this.passkeys.register(auth, body, requestMeta(request));
  }

  @Post("authentication/options")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: passkeyOptionsResponseSchema })
  @ApiOperation({ summary: "Start signing in with a passkey" })
  @ApiOkResponse({
    description: "WebAuthn request options.",
    standardSchema: passkeyOptionsResponseSchema,
  })
  signInOptions(@Req() request: FastifyRequest): Promise<PasskeyOptionsResponse> {
    return this.passkeys.signInOptions(requestMeta(request));
  }

  @Post("authentication/verify")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: currentSessionResponseSchema })
  @ApiOperation({
    summary: "Finish signing in with a passkey",
    description: "Sets the session cookie, like password sign-in. No second factor is needed.",
  })
  @ApiOkResponse({ description: "Signed in.", standardSchema: currentSessionResponseSchema })
  @ApiUnauthorizedResponse({ description: "The passkey couldn't be verified." })
  async signIn(
    @Body({ schema: passkeySignInRequestSchema }) body: z.output<typeof passkeySignInRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CurrentSessionResponse> {
    const { user, issued } = await this.passkeys.signIn(
      body,
      requestMeta(request),
      this.sessions.readToken(request),
    );
    this.sessions.setCookie(reply, issued);
    return {
      account: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        role: user.role,
        planCode: user.planCode,
        createdAt: user.createdAt.toISOString(),
      },
      session: this.sessions.describe(issued.session),
    };
  }

  @Post("confirmation/options")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: passkeyOptionsResponseSchema })
  @ApiOperation({ summary: "Start confirming it's you with a passkey" })
  @ApiOkResponse({
    description: "WebAuthn request options.",
    standardSchema: passkeyOptionsResponseSchema,
  })
  confirmationOptions(@CurrentAuth() auth: AuthContext): Promise<PasskeyOptionsResponse> {
    return this.passkeys.confirmationOptions(auth);
  }

  @Post("confirmation/verify")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: reauthenticateResponseSchema })
  @ApiOperation({ summary: "Finish confirming it's you with a passkey" })
  @ApiOkResponse({ description: "Confirmed.", standardSchema: reauthenticateResponseSchema })
  async confirm(
    @Body({ schema: passkeyConfirmationRequestSchema })
    body: z.output<typeof passkeyConfirmationRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<ReauthenticateResponse> {
    const at = await this.passkeys.confirm(auth, body, requestMeta(request));
    return { confirmedUntil: new Date(at.getTime() + RECENT_AUTH_SECONDS * 1000).toISOString() };
  }

  @Patch(":id")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: passkeySchema })
  @ApiOperation({ summary: "Rename a passkey" })
  @ApiOkResponse({ description: "Renamed.", standardSchema: passkeySchema })
  rename(
    @Param("id", { schema: passkeyIdSchema }) id: string,
    @Body({ schema: renamePasskeyRequestSchema }) body: z.output<typeof renamePasskeyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Passkey> {
    return this.passkeys.rename(auth.user.id, id, body.name);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({ summary: "Remove a passkey", description: "Needs a recent sign-in." })
  @ApiNoContentResponse({ description: "Removed." })
  async remove(
    @Param("id", { schema: passkeyIdSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.passkeys.remove(auth, id, requestMeta(request));
  }
}
