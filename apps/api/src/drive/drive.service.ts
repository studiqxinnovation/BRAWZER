import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  DRIVE_LIMITS,
  type DriveFile,
  type DriveFolder,
  type DriveOverview,
  type DriveUsage,
  isPreviewable,
} from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseExecutor,
  type DatabaseHandle,
  type DriveFileRow,
  type DriveFolderRow,
  eq,
  ilike,
  inArray,
  isNull,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AuthContext } from "../auth/session.service.js";
import { lockAccount } from "../common/account-lock.js";
import { ApiException } from "../common/api-exception.js";
import { isUniqueViolation } from "../common/database-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import { RATE_LIMITS, RateLimiter } from "../rate-limit/rate-limiter.js";
import { type Scanner, ScannerUnavailableError } from "../scanning/clamd.js";
import { SCANNER } from "../scanning/scanning.module.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { createDecryptStream, generateFileKey } from "../storage/encrypted-chunks.js";
import type { ObjectStore } from "../storage/object-store.js";
import { OBJECT_STORE } from "../storage/storage.module.js";
import { numberedName, sanitizeFilename } from "./content-type.js";
import { DownloadTickets } from "./tickets.js";
import { FileTooLargeError, storeUpload } from "./upload.js";

const logger = new Logger("Drive");

const fileNotFound = () => new ApiException("not_found", 404, "That file doesn’t exist.");
const folderNotFound = () => new ApiException("not_found", 404, "That folder doesn’t exist.");

const fileNameTaken = () =>
  new ApiException("conflict", 409, "There’s already a file with that name here.", {
    details: ["name: There’s already a file with that name here."],
  });

const folderNameTaken = () =>
  new ApiException("conflict", 409, "There’s already a folder with that name here.", {
    details: ["name: There’s already a folder with that name here."],
  });

const quarantined = () =>
  new ApiException(
    "forbidden",
    403,
    "This file was quarantined because the malware scan found a threat. It can be deleted, but not opened or saved.",
  );

/** Files' keys are sealed for one account and one object (ADR 0011). */
const keyContext = (userId: string, objectId: string) => `drive-file:${userId}:${objectId}`;

const objectKeyFor = (userId: string, objectId: string) => `drive/${userId}/${objectId}`;
const objectIdOf = (objectKey: string) => objectKey.slice(objectKey.lastIndexOf("/") + 1);

/** `%`, `_` and `\` mean something in LIKE patterns. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

function toFolder(row: DriveFolderRow): DriveFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFile(row: DriveFileRow): DriveFile {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    size: row.size,
    contentType: row.contentType,
    status: row.status,
    threat: row.threat,
    previewable: row.status === "clean" && isPreviewable(row.contentType),
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface UploadInput {
  /** As the browser sent it; cleaned up here. */
  filename: string;
  stream: Readable;
}

export interface OpenedFile {
  file: DriveFile;
  /** Decrypted content; verified chunk by chunk as it streams. */
  body: Readable;
}

/**
 * Brawzer Drive: folders and files that stay with the account. Content lives
 * encrypted in the object store (ADR 0011); only records live here.
 */
@Injectable()
export class DriveService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(SCANNER) private readonly scanner: Scanner,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(DownloadTickets) private readonly tickets: DownloadTickets,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ── Reading ────────────────────────────────────────────────────────────

  async overview(userId: string): Promise<DriveOverview> {
    const [folders, usage] = await Promise.all([this.listFolders(userId), this.usage(userId)]);
    return { folders, usage };
  }

  async listFolders(userId: string): Promise<DriveFolder[]> {
    const rows = await this.database.db
      .select()
      .from(schema.driveFolders)
      .where(eq(schema.driveFolders.userId, userId))
      .orderBy(asc(sql`lower(${schema.driveFolders.name})`));
    return rows.map(toFolder);
  }

  async usage(userId: string, executor: DatabaseExecutor = this.database.db): Promise<DriveUsage> {
    const [files] = await executor
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(${schema.driveFiles.size}), 0)::bigint`,
      })
      .from(schema.driveFiles)
      .where(eq(schema.driveFiles.userId, userId));
    const [folders] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.driveFolders)
      .where(eq(schema.driveFolders.userId, userId));
    return {
      usedBytes: files ? Number(files.bytes) : 0,
      limitBytes: DRIVE_LIMITS.maxAccountBytes,
      fileCount: files?.count ?? 0,
      fileLimit: DRIVE_LIMITS.maxFiles,
      folderCount: folders?.count ?? 0,
      folderLimit: DRIVE_LIMITS.maxFolders,
      maxFileBytes: this.config.drive.maxFileBytes,
    };
  }

  /** The files in one folder (null: the top level), or every file matching `q`. */
  async listFiles(
    userId: string,
    query: { folderId: string | null; q?: string | undefined },
  ): Promise<DriveFile[]> {
    const where = query.q
      ? and(
          eq(schema.driveFiles.userId, userId),
          ilike(schema.driveFiles.name, `%${escapeLike(query.q)}%`),
        )
      : and(
          eq(schema.driveFiles.userId, userId),
          query.folderId
            ? eq(schema.driveFiles.folderId, query.folderId)
            : isNull(schema.driveFiles.folderId),
        );
    const rows = await this.database.db
      .select()
      .from(schema.driveFiles)
      .where(where)
      .orderBy(asc(sql`lower(${schema.driveFiles.name})`));
    return rows.map(toFile);
  }

  private async findFile(userId: string, id: string): Promise<DriveFileRow> {
    const [row] = await this.database.db
      .select()
      .from(schema.driveFiles)
      .where(and(eq(schema.driveFiles.id, id), eq(schema.driveFiles.userId, userId)))
      .limit(1);
    if (!row) throw fileNotFound();
    return row;
  }

  private async findFolder(
    userId: string,
    id: string,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<DriveFolderRow> {
    const [row] = await executor
      .select()
      .from(schema.driveFolders)
      .where(and(eq(schema.driveFolders.id, id), eq(schema.driveFolders.userId, userId)))
      .limit(1);
    if (!row) throw folderNotFound();
    return row;
  }

  /** The folder and everything below it. */
  private async descendantFolderIds(
    executor: DatabaseExecutor,
    userId: string,
    folderId: string,
  ): Promise<string[]> {
    const result = await executor.execute<{ id: string }>(sql`
      with recursive tree as (
        select id from ${schema.driveFolders}
          where id = ${folderId} and user_id = ${userId}
        union all
        select f.id from ${schema.driveFolders} f join tree on f.parent_id = tree.id
      )
      select id from tree
    `);
    return result.rows.map((row) => row.id);
  }

  // ── Folders ────────────────────────────────────────────────────────────

  async createFolder(
    auth: AuthContext,
    input: { name: string; parentId: string | null },
  ): Promise<DriveFolder> {
    const userId = auth.user.id;
    let row: DriveFolderRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
        await lockAccount(tx, userId);
        if (input.parentId) await this.findFolder(userId, input.parentId, tx);
        const usage = await this.usage(userId, tx);
        if (usage.folderCount >= DRIVE_LIMITS.maxFolders) {
          throw new ApiException(
            "limit_reached",
            409,
            `You can have up to ${String(DRIVE_LIMITS.maxFolders)} folders while Brawzer is in development.`,
          );
        }
        const [inserted] = await tx
          .insert(schema.driveFolders)
          .values({ userId, name: input.name, parentId: input.parentId })
          .returning();
        if (!inserted) throw new Error("Folder insert returned nothing");
        return inserted;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw folderNameTaken();
      throw error;
    }
    return toFolder(row);
  }

  async updateFolder(
    auth: AuthContext,
    id: string,
    input: { name?: string | undefined; parentId?: string | null | undefined },
  ): Promise<DriveFolder> {
    const userId = auth.user.id;
    const current = await this.findFolder(userId, id);
    if (
      input.parentId !== undefined &&
      input.parentId !== null &&
      input.parentId !== current.parentId
    ) {
      if (input.parentId === id) {
        throw new ApiException("validation_failed", 400, "A folder can’t be moved into itself.", {
          details: ["parentId: A folder can’t be moved into itself."],
        });
      }
      await this.findFolder(userId, input.parentId);
      const below = await this.descendantFolderIds(this.database.db, userId, id);
      if (below.includes(input.parentId)) {
        throw new ApiException(
          "validation_failed",
          400,
          "A folder can’t be moved into one of its own folders.",
          { details: ["parentId: A folder can’t be moved into one of its own folders."] },
        );
      }
    }
    let row: DriveFolderRow | undefined;
    try {
      [row] = await this.database.db
        .update(schema.driveFolders)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.driveFolders.id, id), eq(schema.driveFolders.userId, userId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw folderNameTaken();
      throw error;
    }
    if (!row) throw folderNotFound();
    return toFolder(row);
  }

  /** Deletes the folder, its folders and their files; the objects go too. */
  async deleteFolder(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    const objectKeys = await this.database.db.transaction(async (tx) => {
      await this.findFolder(userId, id, tx);
      const folderIds = await this.descendantFolderIds(tx, userId, id);
      const files = await tx
        .select({ objectKey: schema.driveFiles.objectKey })
        .from(schema.driveFiles)
        .where(
          and(eq(schema.driveFiles.userId, userId), inArray(schema.driveFiles.folderId, folderIds)),
        );
      await tx
        .delete(schema.driveFolders)
        .where(and(eq(schema.driveFolders.id, id), eq(schema.driveFolders.userId, userId)));
      return files.map((file) => file.objectKey);
    });
    await this.removeObjects(objectKeys);
    await this.events.record({
      type: "drive.folder_deleted",
      userId,
      sessionId: auth.session.id,
      meta,
      metadata: { count: objectKeys.length },
    });
  }

  // ── Files ──────────────────────────────────────────────────────────────

  /** A name no other file in the folder has, adding " (2)", " (3)"… if needed. */
  private async freeName(
    tx: DatabaseExecutor,
    userId: string,
    folderId: string | null,
    wanted: string,
  ): Promise<string> {
    const rows = await tx
      .select({ name: schema.driveFiles.name })
      .from(schema.driveFiles)
      .where(
        and(
          eq(schema.driveFiles.userId, userId),
          folderId ? eq(schema.driveFiles.folderId, folderId) : isNull(schema.driveFiles.folderId),
        ),
      );
    const taken = new Set(rows.map((row) => row.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = numberedName(wanted, n);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    throw fileNameTaken();
  }

  /**
   * Scans and stores the upload as it streams, then records it. An infected
   * file is kept in quarantine: visible and deletable, never openable.
   */
  async upload(
    auth: AuthContext,
    folderId: string | null,
    input: UploadInput,
    meta: RequestMeta,
  ): Promise<DriveFile> {
    const userId = auth.user.id;
    await this.limiter.enforce(RATE_LIMITS.driveUploadsPerAccount, userId);
    if (folderId) await this.findFolder(userId, folderId);
    const name = sanitizeFilename(input.filename);

    // Cheap checks first, so a full Drive doesn't receive a whole file for nothing.
    const before = await this.usage(userId);
    if (before.fileCount >= DRIVE_LIMITS.maxFiles) throw this.tooManyFiles();
    if (before.usedBytes >= DRIVE_LIMITS.maxAccountBytes) throw this.driveFull();

    const objectId = randomUUID();
    const objectKey = objectKeyFor(userId, objectId);
    const key = generateFileKey();
    let stored;
    try {
      stored = await storeUpload({
        source: input.stream,
        objectKey,
        objectId,
        key,
        maxBytes: this.config.drive.maxFileBytes,
        store: this.store,
        scanner: this.scanner,
      });
    } catch (error) {
      key.fill(0);
      await this.removeObjects([objectKey]);
      if (error instanceof FileTooLargeError) {
        throw new ApiException(
          "payload_too_large",
          413,
          `Files can be up to ${formatBytes(error.maxBytes)} while Brawzer is in development.`,
        );
      }
      if (error instanceof ScannerUnavailableError) {
        logger.warn(`Upload refused, scanner unavailable: ${error.message}`);
        throw new ApiException(
          "service_unavailable",
          503,
          "Brawzer’s malware scanner isn’t available right now, so the file wasn’t saved. Try again in a few minutes.",
          { headers: { "Retry-After": "60" } },
        );
      }
      throw error;
    }
    const wrappedKey = await this.box.seal(key.toString("base64"), keyContext(userId, objectId));
    key.fill(0);

    let row: DriveFileRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
        await lockAccount(tx, userId);
        const usage = await this.usage(userId, tx);
        if (usage.fileCount >= DRIVE_LIMITS.maxFiles) throw this.tooManyFiles();
        if (usage.usedBytes + stored.size > DRIVE_LIMITS.maxAccountBytes) throw this.driveFull();
        const [inserted] = await tx
          .insert(schema.driveFiles)
          .values({
            userId,
            folderId,
            name: await this.freeName(tx, userId, folderId, name),
            size: stored.size,
            contentType: stored.contentType,
            status: stored.verdict.verdict,
            threat: stored.verdict.verdict === "infected" ? stored.verdict.signature : null,
            source: "upload",
            wrappedKey,
            objectKey,
          })
          .returning();
        if (!inserted) throw new Error("File insert returned nothing");
        return inserted;
      });
    } catch (error) {
      await this.removeObjects([objectKey]);
      throw error;
    }

    await this.events.record({
      type: row.status === "infected" ? "drive.file_quarantined" : "drive.file_uploaded",
      userId,
      sessionId: auth.session.id,
      meta,
    });
    return toFile(row);
  }

  private tooManyFiles() {
    return new ApiException(
      "limit_reached",
      409,
      `Drive can hold up to ${String(DRIVE_LIMITS.maxFiles)} files while Brawzer is in development. Delete some files to make room.`,
    );
  }

  private driveFull() {
    return new ApiException(
      "limit_reached",
      409,
      `Drive can hold up to ${formatBytes(DRIVE_LIMITS.maxAccountBytes)} while Brawzer is in development. Delete some files to make room.`,
    );
  }

  async updateFile(
    auth: AuthContext,
    id: string,
    input: { name?: string | undefined; folderId?: string | null | undefined },
  ): Promise<DriveFile> {
    const userId = auth.user.id;
    await this.findFile(userId, id);
    if (input.folderId) await this.findFolder(userId, input.folderId);
    let row: DriveFileRow | undefined;
    try {
      [row] = await this.database.db
        .update(schema.driveFiles)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
          updatedAt: new Date(),
        })
        .where(and(eq(schema.driveFiles.id, id), eq(schema.driveFiles.userId, userId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw fileNameTaken();
      throw error;
    }
    if (!row) throw fileNotFound();
    return toFile(row);
  }

  async deleteFile(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    const deleted = await this.database.db
      .delete(schema.driveFiles)
      .where(and(eq(schema.driveFiles.id, id), eq(schema.driveFiles.userId, userId)))
      .returning({ objectKey: schema.driveFiles.objectKey });
    if (deleted.length === 0) throw fileNotFound();
    await this.removeObjects(deleted.map((row) => row.objectKey));
    await this.events.record({
      type: "drive.file_deleted",
      userId,
      sessionId: auth.session.id,
      meta,
    });
  }

  /** Removes objects whose records are gone. Failures are logged, never surfaced. */
  private async removeObjects(objectKeys: readonly string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    try {
      if (objectKeys.length === 1 && objectKeys[0]) await this.store.delete(objectKeys[0]);
      else await this.store.deleteMany(objectKeys);
    } catch (error) {
      logger.error(
        `Could not remove ${String(objectKeys.length)} object(s) from the store: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  // ── Content ────────────────────────────────────────────────────────────

  private async openRow(row: DriveFileRow): Promise<OpenedFile> {
    if (row.status !== "clean") throw quarantined();
    const objectId = objectIdOf(row.objectKey);
    const key = Buffer.from(
      await this.box.open(row.wrappedKey, keyContext(row.userId, objectId)),
      "base64",
    );
    const object = await this.store.get(row.objectKey);
    if (!object) {
      logger.error(`Drive file ${row.id} has no object in the store`);
      throw fileNotFound();
    }
    const body = createDecryptStream(key, objectId);
    object.on("error", (error) => body.destroy(error));
    return { file: toFile(row), body: object.pipe(body) };
  }

  /** For showing a clean, previewable file in the browser. */
  async openForPreview(userId: string, id: string): Promise<OpenedFile> {
    const row = await this.findFile(userId, id);
    if (row.status === "clean" && !isPreviewable(row.contentType)) {
      throw new ApiException(
        "unsupported_media_type",
        415,
        "This type of file can’t be shown here. Save it to a computer to open it.",
      );
    }
    return this.openRow(row);
  }

  /** A single-use ticket to save the file to a computer. Logged in the security history. */
  async issueDownloadTicket(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
  ): Promise<{ url: string; expiresAt: string }> {
    const userId = auth.user.id;
    await this.limiter.enforce(RATE_LIMITS.driveTicketsPerAccount, userId);
    const row = await this.findFile(userId, id);
    if (row.status !== "clean") throw quarantined();
    const { ticket, expiresAt } = await this.tickets.issue(userId, row.id);
    await this.events.record({
      type: "drive.file_saved",
      userId,
      sessionId: auth.session.id,
      meta,
      metadata: { persistent: auth.session.persistent },
    });
    return {
      url: `/api/v1/drive/files/${row.id}/content?ticket=${ticket}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Redeems a ticket and opens the file it was issued for. */
  async openWithTicket(id: string, ticket: string): Promise<OpenedFile> {
    const userId = await this.tickets.redeem(ticket, id);
    if (!userId) {
      throw new ApiException(
        "token_invalid",
        400,
        "This download link has expired or was already used. Go back to Drive and save the file again.",
      );
    }
    const row = await this.findFile(userId, id);
    return this.openRow(row);
  }

  // ── Account ────────────────────────────────────────────────────────────

  /** For "download your data": where things are, not what's in them. */
  async forExport(userId: string) {
    const [folders, files] = await Promise.all([
      this.listFolders(userId),
      this.database.db
        .select()
        .from(schema.driveFiles)
        .where(eq(schema.driveFiles.userId, userId))
        .orderBy(asc(schema.driveFiles.createdAt)),
    ]);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const pathOf = (folderId: string | null): string => {
      const parts: string[] = [];
      for (let current = folderId; current;) {
        const folder = byId.get(current);
        if (!folder) break;
        parts.unshift(folder.name);
        current = folder.parentId;
      }
      return `/${parts.join("/")}`;
    };
    return {
      folders: folders.map((folder) => ({
        path: pathOf(folder.id),
        createdAt: folder.createdAt,
      })),
      files: files.map((file) => ({
        path: `${pathOf(file.folderId).replace(/\/$/, "")}/${file.name}`,
        size: file.size,
        contentType: file.contentType,
        status: file.status,
        createdAt: file.createdAt.toISOString(),
      })),
    };
  }

  /** The object keys of everything the account has in the store. */
  async objectKeysOf(userId: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const key of this.store.listKeys(objectKeyFor(userId, ""))) keys.push(key);
    return keys;
  }

  /** After the account's rows are gone: removes its objects from the store. */
  async removeAllObjects(objectKeys: readonly string[]): Promise<void> {
    await this.removeObjects(objectKeys);
  }
}

/** "100 MB", "2 GB": binary units named the way people say them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${String(Math.round(bytes / 1024 ** 3))} GB`;
  if (bytes >= 1024 ** 2) return `${String(Math.round(bytes / 1024 ** 2))} MB`;
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(bytes)} bytes`;
}
