import {
  type PhoneApproval,
  phoneApprovalSchema,
  phoneApproveRequestSchema,
  phoneDenyRequestSchema,
  type PhoneSignInPoll,
  phoneSignInPollRequestSchema,
  phoneSignInPollResponseSchema,
  type PhoneSignInStart,
  phoneSignInStartResponseSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requestMeta } from "../../common/request-meta.js";
import { SESSION_AUTH } from "../auth.controller.js";
import { RecentAuthGuard } from "../recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../session.guard.js";
import { type AuthContext, SessionService } from "../session.service.js";
import { PhoneSignInService } from "./phone-sign-in.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid request." });
const keyQuerySchema = z.object({ key: z.string().min(20).max(128) });

@ApiTags("Auth")
@Controller({ path: "auth/phone", version: "1" })
export class PhoneSignInController {
  constructor(
    @Inject(PhoneSignInService) private readonly phone: PhoneSignInService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post("start")
  @HttpCode(HttpStatus.CREATED)
  @SerializeOptions({ schema: phoneSignInStartResponseSchema })
  @ApiOperation({
    summary: "Start signing in with a phone",
    description:
      "For the computer: a QR code to scan with a signed-in phone, a two-digit number to match, and a token to poll with. Expires in 2 minutes.",
  })
  @ApiOkResponse({ standardSchema: phoneSignInStartResponseSchema })
  start(@Req() request: FastifyRequest): Promise<PhoneSignInStart> {
    return this.phone.start(requestMeta(request));
  }

  @Post(":id/poll")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: phoneSignInPollResponseSchema })
  @ApiOperation({
    summary: "Has the phone answered?",
    description:
      "Once approved, this signs the computer in (shared-computer session) and works only once.",
  })
  @ApiOkResponse({ standardSchema: phoneSignInPollResponseSchema })
  async poll(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: phoneSignInPollRequestSchema })
    body: z.output<typeof phoneSignInPollRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PhoneSignInPoll> {
    const result = await this.phone.poll(
      id,
      body.pollToken,
      requestMeta(request),
      this.sessions.readToken(request),
    );
    if (result.state !== "approved") return { state: result.state };
    this.sessions.setCookie(reply, result.issued);
    const { user, issued } = result;
    return {
      state: "approved",
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

  @Get(":id")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: phoneApprovalSchema })
  @ApiOperation({
    summary: "For the phone: where the request came from, and the numbers to pick from",
  })
  @ApiOkResponse({ standardSchema: phoneApprovalSchema })
  @ApiNotFoundResponse({ description: "Expired, used, or the key is wrong." })
  describe(
    @Param("id", { schema: idSchema }) id: string,
    @Query({ schema: keyQuerySchema }) query: z.output<typeof keyQuerySchema>,
  ): Promise<PhoneApproval> {
    return this.phone.describe(id, query.key);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: phoneApprovalSchema })
  @ApiOperation({
    summary: "Approve the sign-in from the phone",
    description:
      "Needs the number the computer shows and a recent sign-in on the phone. Three wrong numbers refuse the request.",
  })
  @ApiOkResponse({ standardSchema: phoneApprovalSchema })
  approve(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: phoneApproveRequestSchema }) body: z.output<typeof phoneApproveRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PhoneApproval> {
    return this.phone.approve(auth, id, body.key, body.code, requestMeta(request));
  }

  @Post(":id/deny")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: phoneApprovalSchema })
  @ApiOperation({ summary: "Refuse the sign-in from the phone" })
  @ApiOkResponse({ standardSchema: phoneApprovalSchema })
  deny(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: phoneDenyRequestSchema }) body: z.output<typeof phoneDenyRequestSchema>,
  ): Promise<PhoneApproval> {
    return this.phone.deny(id, body.key);
  }
}
