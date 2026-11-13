import {
  type MessageResponse,
  messageResponseSchema,
  type RecoveryConfirmed,
  recoveryConfirmedSchema,
  recoveryStartRequestSchema,
  recoveryTokenRequestSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  SerializeOptions,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { requestMeta } from "../common/request-meta.js";
import { RecoveryService } from "./recovery.service.js";

/** Account recovery, for someone signed out who lost every way in. */
@ApiTags("Account recovery")
@Controller({ path: "auth/recovery", version: "1" })
export class RecoveryController {
  constructor(@Inject(RecoveryService) private readonly recovery: RecoveryService) {}

  @Post("start")
  @HttpCode(HttpStatus.ACCEPTED)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({
    summary: "Ask to recover an account",
    description: "The answer is the same whether or not the address has an account.",
  })
  @ApiAcceptedResponse({ standardSchema: messageResponseSchema })
  @ApiTooManyRequestsResponse({ description: "Too many requests from this address." })
  async start(
    @Body({ schema: recoveryStartRequestSchema }) body: z.output<typeof recoveryStartRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MessageResponse> {
    await this.recovery.start(body.email, requestMeta(request));
    return {
      message:
        "If that address has a Brawzer account, we’ve emailed it a link to confirm the recovery.",
    };
  }

  @Post("confirm")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: recoveryConfirmedSchema })
  @ApiOperation({ summary: "Confirm the recovery from the email link; the 48-hour wait begins" })
  @ApiOkResponse({ standardSchema: recoveryConfirmedSchema })
  @ApiBadRequestResponse({ description: "The link is used, expired or not ours." })
  confirm(
    @Body({ schema: recoveryTokenRequestSchema }) body: z.output<typeof recoveryTokenRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryConfirmed> {
    return this.recovery.confirm(body.token, requestMeta(request));
  }

  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: messageResponseSchema })
  @ApiOperation({ summary: "The owner cancels: nothing changes, and security is told" })
  @ApiOkResponse({ standardSchema: messageResponseSchema })
  @ApiBadRequestResponse({ description: "The link is used, expired or not ours." })
  async cancel(
    @Body({ schema: recoveryTokenRequestSchema }) body: z.output<typeof recoveryTokenRequestSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MessageResponse> {
    await this.recovery.cancel(body.token, requestMeta(request));
    return { message: "The recovery is cancelled. Nothing has changed on your account." };
  }
}
