import {
  type Bookmark,
  type BookmarkList,
  bookmarkListSchema,
  bookmarkSchema,
  createBookmarkRequestSchema,
  type HistoryPage,
  historyPageSchema,
  historyQuerySchema,
  updateBookmarkRequestSchema,
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
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { requestMeta } from "../common/request-meta.js";
import { HistoryService } from "./history.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });

/**
 * A profile's history and bookmarks (ADR 0020): the person's own, encrypted
 * with the profile's key, readable here and nowhere else.
 */
@ApiTags("History and bookmarks")
@ApiCookieAuth(SESSION_AUTH)
@ApiUnauthorizedResponse({ description: "No valid session." })
@ApiNotFoundResponse({ description: "No such profile on this account." })
@UseGuards(SessionGuard)
@Controller({ path: "profiles", version: "1" })
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

  @Get(":id/history")
  @SerializeOptions({ schema: historyPageSchema })
  @ApiOperation({
    summary: "A profile's history, newest first",
    description:
      "One entry per page, with its visits. `q` searches addresses and titles across every session; `cursor` gives the next page.",
  })
  @ApiOkResponse({ standardSchema: historyPageSchema })
  list(
    @Param("id", { schema: idSchema }) id: string,
    @Query({ schema: historyQuerySchema }) query: z.output<typeof historyQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<HistoryPage> {
    return this.history.history(auth.user.id, id, query);
  }

  @Delete(":id/history/:entryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Forget one page" })
  @ApiNoContentResponse({ description: "Forgotten." })
  async forget(
    @Param("id", { schema: idSchema }) id: string,
    @Param("entryId", { schema: idSchema }) entryId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.history.deleteEntry(auth.user.id, id, entryId);
  }

  @Delete(":id/history")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Clear the history",
    description:
      "The history and the saved tabs go; bookmarks stay. Recorded in the security history.",
  })
  @ApiNoContentResponse({ description: "Cleared." })
  async clear(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.history.clear(auth, id, requestMeta(request));
  }

  @Get(":id/bookmarks")
  @SerializeOptions({ schema: bookmarkListSchema })
  @ApiOperation({ summary: "A profile's bookmarks, oldest first" })
  @ApiOkResponse({ standardSchema: bookmarkListSchema })
  bookmarks(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<BookmarkList> {
    return this.history.bookmarks(auth.user.id, id);
  }

  @Post(":id/bookmarks")
  @SerializeOptions({ schema: bookmarkSchema })
  @ApiOperation({
    summary: "Bookmark a page",
    description:
      "201 with the new bookmark; 200 with the one there is when the page already has one.",
  })
  @ApiCreatedResponse({ standardSchema: bookmarkSchema })
  async addBookmark(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: createBookmarkRequestSchema })
    body: z.output<typeof createBookmarkRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Bookmark> {
    const { bookmark, created } = await this.history.addBookmark(auth.user.id, id, body);
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return bookmark;
  }

  @Patch(":id/bookmarks/:bookmarkId")
  @SerializeOptions({ schema: bookmarkSchema })
  @ApiOperation({ summary: "Rename a bookmark" })
  @ApiOkResponse({ standardSchema: bookmarkSchema })
  rename(
    @Param("id", { schema: idSchema }) id: string,
    @Param("bookmarkId", { schema: idSchema }) bookmarkId: string,
    @Body({ schema: updateBookmarkRequestSchema })
    body: z.output<typeof updateBookmarkRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Bookmark> {
    return this.history.renameBookmark(auth.user.id, id, bookmarkId, body.title);
  }

  @Delete(":id/bookmarks/:bookmarkId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a bookmark" })
  @ApiNoContentResponse({ description: "Removed." })
  async removeBookmark(
    @Param("id", { schema: idSchema }) id: string,
    @Param("bookmarkId", { schema: idSchema }) bookmarkId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.history.removeBookmark(auth.user.id, id, bookmarkId);
  }
}
