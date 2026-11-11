import {
  createFolderRequestSchema,
  type DownloadTicket,
  downloadTicketQuerySchema,
  downloadTicketSchema,
  type DriveFile,
  type DriveFileList,
  type DrivePhoneLink,
  drivePhoneLinkSchema,
  driveFileListSchema,
  driveFileQuerySchema,
  driveFileSchema,
  type DriveFolder,
  driveFolderSchema,
  type DriveOverview,
  driveOverviewSchema,
  driveSpaceQuerySchema,
  driveSpaceSchema,
  updateFileRequestSchema,
  updateFolderRequestSchema,
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
  Put,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { SESSION_AUTH } from "../auth/auth.controller.js";
import { RecentAuthGuard } from "../auth/recent-auth.guard.js";
import { CurrentAuth, SessionGuard } from "../auth/session.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { ApiException } from "../common/api-exception.js";
import { requestMeta } from "../common/request-meta.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { contentDisposition, responseContentType } from "./content-type.js";
import { DriveService, type OpenedFile } from "./drive.service.js";

const idSchema = z.uuid({ error: "That isn’t a valid ID." });
const uploadQuerySchema = z.object({
  folderId: z.uuid({ error: "That isn’t a folder ID." }).optional(),
  /** Where a file without a folder goes: the person's own Drive or their team's. */
  space: driveSpaceSchema.default("personal"),
});

/**
 * Sends decrypted content. Images and text are sandboxed so they can never
 * act as a page on Brawzer's origin; a PDF gets the viewer's minimum (a
 * sandbox would stop Chromium showing it) and still can't reach the page
 * that embeds it.
 */
function sendContent(reply: FastifyReply, opened: OpenedFile, kind: "inline" | "attachment") {
  const { file, body } = opened;
  const policy =
    kind === "inline" && file.contentType === "application/pdf"
      ? "default-src 'none'; frame-ancestors 'self'"
      : "default-src 'none'; sandbox; frame-ancestors 'self'";
  return reply
    .header("Content-Type", responseContentType(file.contentType))
    .header("Content-Length", String(file.size))
    .header("Content-Disposition", contentDisposition(kind, file.name))
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Security-Policy", policy)
    .header("Referrer-Policy", "no-referrer")
    .send(body);
}

@ApiTags("Drive")
@Controller({ path: "drive", version: "1" })
export class DriveController {
  constructor(
    @Inject(DriveService) private readonly drive: DriveService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiUnauthorizedResponse({ description: "No valid session." })
  @SerializeOptions({ schema: driveOverviewSchema })
  @ApiOperation({
    summary: "Folders and storage usage",
    description:
      "`space=team` gives the team's shared Drive, with the team's usage against its owner's plan.",
  })
  @ApiOkResponse({
    description: "Every folder of the space and its usage.",
    standardSchema: driveOverviewSchema,
  })
  overview(
    @Query({ schema: driveSpaceQuerySchema }) query: z.output<typeof driveSpaceQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveOverview> {
    return this.drive.overview(auth.user.id, query.space);
  }

  @Get("files")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: driveFileListSchema })
  @ApiOperation({
    summary: "Files in a folder, or a search",
    description: "Without `folderId`, the top level. With `q`, every file whose name contains it.",
  })
  @ApiOkResponse({ description: "Files, sorted by name.", standardSchema: driveFileListSchema })
  async listFiles(
    @Query({ schema: driveFileQuerySchema }) query: z.output<typeof driveFileQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveFileList> {
    return {
      files: await this.drive.listFiles(auth.user.id, {
        folderId: query.folderId ?? null,
        q: query.q === "" ? undefined : query.q,
        kind: query.kind,
        space: query.space,
      }),
    };
  }

  @Post("files")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiConsumes("multipart/form-data")
  @SerializeOptions({ schema: driveFileSchema })
  @ApiOperation({
    summary: "Upload a file",
    description:
      "One file as multipart form data. It is scanned and stored encrypted as it arrives; the type comes from the content, not the name. An infected file is kept in quarantine.",
  })
  @ApiCreatedResponse({ description: "The stored file.", standardSchema: driveFileSchema })
  @ApiPayloadTooLargeResponse({ description: "Over the per-file limit." })
  @ApiConflictResponse({ description: "Drive is full." })
  @ApiServiceUnavailableResponse({ description: "The scanner is unavailable; nothing was stored." })
  async upload(
    @Query({ schema: uploadQuerySchema }) query: z.output<typeof uploadQuerySchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<DriveFile> {
    if (!request.isMultipart()) {
      throw new ApiException(
        "unsupported_media_type",
        415,
        "Send the file as multipart form data.",
      );
    }
    const part = await request.file();
    if (!part) {
      throw new ApiException("validation_failed", 400, "Choose a file to upload.", {
        details: ["file: Choose a file to upload."],
      });
    }
    return this.drive.upload(
      auth,
      query.folderId ?? null,
      { filename: part.filename, stream: part.file },
      requestMeta(request),
      query.space,
    );
  }

  @Patch("files/:id")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: driveFileSchema })
  @ApiOperation({
    summary: "Rename or move a file",
    description: "`folderId: null` moves it to the top level.",
  })
  @ApiOkResponse({ description: "The updated file.", standardSchema: driveFileSchema })
  @ApiNotFoundResponse({ description: "No such file or folder on this account." })
  @ApiConflictResponse({ description: "A file with that name is already there." })
  updateFile(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: updateFileRequestSchema }) body: z.output<typeof updateFileRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveFile> {
    return this.drive.updateFile(auth, id, body);
  }

  @Delete("files/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Delete a file",
    description:
      "Moves it to Trash, where it's kept 30 days (and still counts towards storage). A quarantined file is removed at once.",
  })
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiNotFoundResponse({ description: "No such file on this account." })
  async deleteFile(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.drive.deleteFile(auth, id, requestMeta(request));
  }

  @Put("files/:id/content")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiConsumes("multipart/form-data")
  @SerializeOptions({ schema: driveFileSchema })
  @ApiOperation({
    summary: "Save a new version of a file",
    description:
      "Replaces the file's content, keeping its name, folder and id. Scanned and encrypted like an upload.",
  })
  @ApiOkResponse({ description: "Saved.", standardSchema: driveFileSchema })
  @ApiNotFoundResponse({ description: "No such file on this account." })
  @ApiPayloadTooLargeResponse({ description: "Over the per-file limit." })
  @ApiServiceUnavailableResponse({ description: "The scanner is unavailable; nothing changed." })
  async replaceContent(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<DriveFile> {
    if (!request.isMultipart()) {
      throw new ApiException(
        "unsupported_media_type",
        415,
        "Send the file as multipart form data.",
      );
    }
    const part = await request.file();
    if (!part) {
      throw new ApiException("validation_failed", 400, "Choose a file to upload.", {
        details: ["file: Choose a file to upload."],
      });
    }
    return this.drive.replaceContent(
      auth,
      id,
      { filename: part.filename, stream: part.file },
      requestMeta(request),
    );
  }

  @Get("trash")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: driveFileListSchema })
  @ApiOperation({
    summary: "What's in Trash",
    description:
      "Deleted files, newest first. Each is removed for good 30 days after it was deleted.",
  })
  @ApiOkResponse({ description: "The files.", standardSchema: driveFileListSchema })
  async trash(
    @Query({ schema: driveSpaceQuerySchema }) query: z.output<typeof driveSpaceQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveFileList> {
    return { files: await this.drive.listTrash(auth.user.id, query.space) };
  }

  @Post("files/:id/restore")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: driveFileSchema })
  @ApiOperation({ summary: "Put a file back from Trash" })
  @ApiOkResponse({ description: "Back in its folder.", standardSchema: driveFileSchema })
  @ApiNotFoundResponse({ description: "No such file in Trash." })
  restore(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveFile> {
    return this.drive.restoreFile(auth, id);
  }

  @Delete("trash/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({ summary: "Delete a file in Trash for good" })
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiNotFoundResponse({ description: "No such file in Trash." })
  async deleteForever(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.drive.deleteForever(auth, id, requestMeta(request));
  }

  @Delete("trash")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({ summary: "Empty Trash" })
  @ApiNoContentResponse({ description: "Emptied." })
  async emptyTrash(
    @Query({ schema: driveSpaceQuerySchema }) query: z.output<typeof driveSpaceQuerySchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.drive.emptyTrash(auth, query.space, requestMeta(request));
  }

  @Get("files/:id/phone-link")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: drivePhoneLinkSchema })
  @ApiOperation({
    summary: "A link to the file for a phone",
    description:
      "Drive's page for the file and its QR code. Opening it needs a sign-in; the link grants nothing by itself.",
  })
  @ApiOkResponse({ description: "The link.", standardSchema: drivePhoneLinkSchema })
  @ApiNotFoundResponse({ description: "No such file on this account." })
  phoneLink(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DrivePhoneLink> {
    return this.drive.phoneLink(auth.user.id, id);
  }

  @Get("files/:id/preview")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({
    summary: "Show a file in the browser",
    description: "Images, PDFs and plain text only, served so they can never run as a page.",
  })
  @ApiOkResponse({ description: "The file's content, inline." })
  @ApiForbiddenResponse({ description: "The file is quarantined." })
  @ApiUnsupportedMediaTypeResponse({ description: "This type can't be shown; save it instead." })
  async preview(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = await this.drive.openForPreview(auth.user.id, id);
    await sendContent(reply, opened, "inline");
  }

  @Post("files/:id/download-ticket")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard, RecentAuthGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: downloadTicketSchema })
  @ApiOperation({
    summary: "Get a link to save the file to this computer",
    description:
      "Needs a recent sign-in. The link works once, for 60 seconds, without the session cookie. Recorded in the security history.",
  })
  @ApiOkResponse({ description: "The single-use link.", standardSchema: downloadTicketSchema })
  @ApiForbiddenResponse({ description: "Confirm it's you first, or the file is quarantined." })
  issueTicket(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<DownloadTicket> {
    return this.drive.issueDownloadTicket(auth, id, requestMeta(request));
  }

  @Get("files/:id/content")
  @ApiOperation({
    summary: "Download a file with a ticket",
    description:
      "No session needed: the ticket from `download-ticket` is the credential. It works once.",
  })
  @ApiOkResponse({ description: "The file, as an attachment." })
  @ApiBadRequestResponse({ description: "The ticket is invalid, expired or used." })
  async content(
    @Param("id", { schema: idSchema }) id: string,
    @Query({ schema: downloadTicketQuerySchema }) query: z.output<typeof downloadTicketQuerySchema>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.limiter.enforce(RATE_LIMITS.driveContentPerIp, requestMeta(request).ip ?? "unknown");
    const opened = await this.drive.openWithTicket(id, query.ticket);
    await sendContent(reply, opened, "attachment");
  }

  @Post("folders")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: driveFolderSchema })
  @ApiOperation({ summary: "Create a folder" })
  @ApiCreatedResponse({ description: "The new folder.", standardSchema: driveFolderSchema })
  @ApiConflictResponse({
    description: "A folder with that name is already there, or the limit is reached.",
  })
  createFolder(
    @Body({ schema: createFolderRequestSchema }) body: z.output<typeof createFolderRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveFolder> {
    return this.drive.createFolder(auth, {
      name: body.name,
      parentId: body.parentId ?? null,
      space: body.space,
    });
  }

  @Patch("folders/:id")
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @SerializeOptions({ schema: driveFolderSchema })
  @ApiOperation({
    summary: "Rename or move a folder",
    description: "`parentId: null` moves it to the top level.",
  })
  @ApiOkResponse({ description: "The updated folder.", standardSchema: driveFolderSchema })
  @ApiNotFoundResponse({ description: "No such folder on this account." })
  @ApiConflictResponse({ description: "A folder with that name is already there." })
  updateFolder(
    @Param("id", { schema: idSchema }) id: string,
    @Body({ schema: updateFolderRequestSchema }) body: z.output<typeof updateFolderRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ): Promise<DriveFolder> {
    return this.drive.updateFolder(auth, id, body);
  }

  @Delete("folders/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiCookieAuth(SESSION_AUTH)
  @ApiOperation({ summary: "Delete a folder", description: "With everything in it, immediately." })
  @ApiNoContentResponse({ description: "Deleted." })
  @ApiNotFoundResponse({ description: "No such folder on this account." })
  async deleteFolder(
    @Param("id", { schema: idSchema }) id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.drive.deleteFolder(auth, id, requestMeta(request));
  }
}
