import {
  type CurrentSessionResponse,
  currentSessionResponseSchema,
  type MfaStatus,
  mfaStatusSchema,
  mfaVerifyRequestSchema,
  type RecoveryCodesResponse,
  recoveryCodesResponseSchema,
  totpConfirmRequestSchema,
  type TotpSetupResponse,
  totpSetupResponseSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Delete,
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
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { requestMeta } from "../../common/request-meta.js";
import { SESSION_AUTH } from "../auth.controller.js";
import { RecentAuthGuard } from "../recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../session.guard.js";
import { type AuthContext, SessionService } from "../session.service.js";
import { MfaService } from "./mfa.service.js";

@ApiTags("Two-factor authentication")
@Controller({ path: "auth/mfa", version: "1" })
export class MfaController {
  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: mfaStatusSchema })
  @ApiOperation({ summary: "Two-factor status" })
  @ApiOkResponse({ description: "Status.", standardSchema: mfaStatusSchema })
  status(@CurrentAuth() auth: AuthContext): Promise<MfaStatus> {
    return this.mfa.status(auth.user.id);
  }

  @Post("totp/setup")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: totpSetupResponseSchema })
  @ApiOperation({
    summary: "Start setting up an authenticator app",
    description: "Needs a recent sign-in.",
  })
  @ApiOkResponse({ description: "Secret and QR code.", standardSchema: totpSetupResponseSchema })
  setup(@CurrentAuth() auth: AuthContext): Promise<TotpSetupResponse> {
    return this.mfa.startSetup(auth);
  }

  @Post("totp/confirm")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: recoveryCodesResponseSchema })
  @ApiOperation({
    summary: "Finish setup with a first code",
    description: "Returns recovery codes once.",
  })
  @ApiOkResponse({
    description: "On; recovery codes.",
    standardSchema: recoveryCodesResponseSchema,
  })
  @ApiBadRequestResponse({ description: "Wrong code." })
  async confirm(
    @Body({ schema: totpConfirmRequestSchema }) body: z.output<typeof totpConfirmRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    return { recoveryCodes: await this.mfa.confirmSetup(auth, body.code, requestMeta(request)) };
  }

  @Delete("totp")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Turn two-factor authentication off",
    description: "Needs a recent sign-in.",
  })
  @ApiNoContentResponse({ description: "Off." })
  async disable(@CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<void> {
    await this.mfa.disable(auth, requestMeta(request));
  }

  @Post("recovery-codes")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: recoveryCodesResponseSchema })
  @ApiOperation({ summary: "Create new recovery codes", description: "Old codes stop working." })
  @ApiOkResponse({ description: "New codes.", standardSchema: recoveryCodesResponseSchema })
  async regenerate(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(auth, requestMeta(request)) };
  }

  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: currentSessionResponseSchema })
  @ApiOperation({
    summary: "Second sign-in step",
    description:
      "Exchanges the ticket from sign-in and an authenticator or recovery code for a session.",
  })
  @ApiOkResponse({ description: "Signed in.", standardSchema: currentSessionResponseSchema })
  @ApiBadRequestResponse({ description: "Wrong code; the ticket stays valid." })
  @ApiUnauthorizedResponse({
    description: "The ticket expired, was used, or had too many wrong codes.",
  })
  async verify(
    @Body({ schema: mfaVerifyRequestSchema }) body: z.output<typeof mfaVerifyRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CurrentSessionResponse> {
    const { user, issued } = await this.mfa.verifyTicket(
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
        createdAt: user.createdAt.toISOString(),
      },
      session: this.sessions.describe(issued.session),
    };
  }
}
