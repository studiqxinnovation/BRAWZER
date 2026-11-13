import {
  type AssistantChatResponse,
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  assistantStatusSchema,
  type StudyResult,
  studyRequestSchema,
  studyResultSchema,
} from "@brawzer/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { AssistantService } from "./assistant.service.js";

@ApiTags("Assistant")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@UseGuards(SessionGuard)
@Controller({ path: "assistant", version: "1" })
export class AssistantController {
  constructor(@Inject(AssistantService) private readonly assistant: AssistantService) {}

  @Get()
  @SerializeOptions({ schema: assistantStatusSchema })
  @ApiOperation({ summary: "Whether the assistant is set up on this Brawzer" })
  @ApiOkResponse({ description: "Its state.", standardSchema: assistantStatusSchema })
  status(): { available: boolean } {
    return { available: this.assistant.available };
  }

  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: assistantChatResponseSchema })
  @ApiOperation({
    summary: "Ask the assistant",
    description:
      "The conversation so far, ending with the person's message; Claude's reply. Nothing is stored. 60 requests an hour.",
  })
  @ApiOkResponse({ description: "The reply.", standardSchema: assistantChatResponseSchema })
  @ApiTooManyRequestsResponse({ description: "Too many requests this hour." })
  @ApiServiceUnavailableResponse({ description: "Not set up, or Claude can't answer now." })
  chat(
    @Body({ schema: assistantChatRequestSchema }) body: z.output<typeof assistantChatRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<AssistantChatResponse> {
    return this.assistant.chat(auth.user.id, body.messages);
  }

  @Post("study")
  @HttpCode(HttpStatus.OK)
  @SerializeOptions({ schema: studyResultSchema })
  @ApiOperation({
    summary: "Study material from notes",
    description: "A summary, flashcards or a quiz from the notes given, using only what they say.",
  })
  @ApiOkResponse({ description: "The material.", standardSchema: studyResultSchema })
  @ApiTooManyRequestsResponse({ description: "Too many requests this hour." })
  @ApiServiceUnavailableResponse({ description: "Not set up, or Claude can't answer now." })
  study(
    @Body({ schema: studyRequestSchema }) body: z.output<typeof studyRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<StudyResult> {
    return this.assistant.study(auth.user.id, body.notes, body.kind);
  }
}
