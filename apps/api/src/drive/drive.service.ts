import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type { Readable } from "node:stream";
import {
  type DriveFile,
  type DriveFileKind,
  type DrivePhoneLink,
  type DriveFileSource,
  type DriveFolder,
  type DriveOverview,
  type DriveSpace,
  type DriveUsage,
  isPreviewable,
  type TeamRole,
} from "@brawzer/contracts";
import {
  and,
  asc,
  type DatabaseExecutor,
  type DatabaseHandle,
  type DriveFileRow,
  type DriveFolderRow,
  desc,
  eq,
  ilike,
  inArray,
  like,
  isNotNull,
  isNull,
  or,
  schema,
  sql,
} from "@brawzer/db";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { AuthContext } from "../auth/session.service.js";
import { lockAccount } from "../common/account-lock.js";
import { ApiException } from "../common/api-exception.js";
import { EmailService } from "../email/email.js";
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
import { BillingService } from "../billing/billing.service.js";
import { SecurityEventsService } from "../security-events/security-events.js";
import { createDecryptStream, generateFileKey } from "../storage/encrypted-chunks.js";
import type { ObjectStore } from "../storage/object-store.js";
import { OBJECT_STORE } from "../storage/storage.module.js";
import { TeamsService } from "../teams/teams.service.js";
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

const cannotDelete = () =>
  new ApiException(
    "forbidden",
    403,
    "In the team’s Drive, only whoever added it, the owner and admins can delete it.",
  );

const notInTeam = () => new ApiException("not_found", 404, "You aren’t in a team.");

/**
 * Whose rows a request works on: one person's own Drive, or their team's
 * shared space (ADR 0019), with who is asking and their role there.
 */
export type DriveScope =
  | { kind: "personal"; userId: string }
  | { kind: "team"; teamId: string; userId: string; role: TeamRole };

/**
 * Files' keys are sealed for one owner and one object (ADR 0011): a person's
 * own file to the person, a team's file to the team, so it stays readable
 * whoever added it.
 */
const keyContext = (row: { userId: string; teamId: string | null }, objectId: string) =>
  row.teamId === null
    ? `drive-file:${row.userId}:${objectId}`
    : `drive-file:team:${row.teamId}:${objectId}`;

const objectKeyFor = (scope: DriveScope, objectId: string) =>
  scope.kind === "team"
    ? `drive/teams/${scope.teamId}/${objectId}`
    : `drive/${scope.userId}/${objectId}`;
const objectIdOf = (objectKey: string) => objectKey.slice(objectKey.lastIndexOf("/") + 1);

/** `%`, `_` and `\` mean something in LIKE patterns. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** In someone's own Drive everything is theirs; in a team's, who added it, the owner and admins. */
function mayDelete(scope: DriveScope, row: { userId: string }): boolean {
  return scope.kind === "personal" || row.userId === scope.userId || scope.role !== "member";
}

function toFolder(row: DriveFolderRow, scope: DriveScope): DriveFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    canDelete: mayDelete(scope, row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toFile(row: DriveFileRow, scope: DriveScope): DriveFile {
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
    canDelete: mayDelete(scope, row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    trashedAt: row.trashedAt?.toISOString() ?? null,
  };
}

const KIND_TYPES: Record<DriveFileKind, string> = {
  images: "image/%",
  pdfs: "application/pdf",
  audio: "audio/%",
  text: "text/plain",
};
const kindFilter = (kind: DriveFileKind) => like(schema.driveFiles.contentType, KIND_TYPES[kind]);

/** Files in their folders, not in Trash. */
const notTrashed = isNull(schema.driveFiles.trashedAt);

const filesIn = (scope: DriveScope) =>
  scope.kind === "team"
    ? eq(schema.driveFiles.teamId, scope.teamId)
    : and(eq(schema.driveFiles.userId, scope.userId), isNull(schema.driveFiles.teamId));

const foldersIn = (scope: DriveScope) =>
  scope.kind === "team"
    ? eq(schema.driveFolders.teamId, scope.teamId)
    : and(eq(schema.driveFolders.userId, scope.userId), isNull(schema.driveFolders.teamId));

const sameSpace = (scope: DriveScope, row: { userId: string; teamId: string | null }) =>
  scope.kind === "team"
    ? row.teamId === scope.teamId
    : row.teamId === null && row.userId === scope.userId;

export interface UploadInput {
  /** As the browser sent it; cleaned up here. */
  filename: string;
  stream: Readable;
  /** This device (the default) or the cloud browser. */
  source?: DriveFileSource;
  /** For the security history: what the cloud browser produced. */
  kind?: "download" | "print";
}

export interface OpenedFile {
  file: DriveFile;
  /** Decrypted content; verified chunk by chunk as it streams. */
  body: Readable;
}

/**
 * Brawzer Drive: folders and files that stay with the account, and a team's
 * shared space (ADR 0019). Content lives encrypted in the object store (ADR
 * 0011); only records live here.
 */
@Injectable()
export class DriveService implements OnModuleInit {
  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(SCANNER) private readonly scanner: Scanner,
    @Inject(SecurityEventsService) private readonly events: SecurityEventsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(DownloadTickets) private readonly tickets: DownloadTickets,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(TeamsService) private readonly teams: TeamsService,
  ) {}

  /**
   * What someone added to a team's space stays with the team when they
   * leave (handed to the owner); a deleted team takes its space with it.
   */
  onModuleInit(): void {
    this.teams.register({
      memberLeft: async (tx, teamId, userId, ownerId) => {
        await tx
          .update(schema.driveFiles)
          .set({ userId: ownerId })
          .where(and(eq(schema.driveFiles.teamId, teamId), eq(schema.driveFiles.userId, userId)));
        await tx
          .update(schema.driveFolders)
          .set({ userId: ownerId })
          .where(
            and(eq(schema.driveFolders.teamId, teamId), eq(schema.driveFolders.userId, userId)),
          );
        return undefined;
      },
      teamDeleting: async (tx, teamId) => {
        const files = await tx
          .select({ objectKey: schema.driveFiles.objectKey })
          .from(schema.driveFiles)
          .where(eq(schema.driveFiles.teamId, teamId));
        const objectKeys = files.map((file) => file.objectKey);
        return objectKeys.length > 0 ? () => this.removeObjects(objectKeys) : undefined;
      },
    });
  }

  // ── Spaces ─────────────────────────────────────────────────────────────

  /** The space a request names; a team's needs the person to be in one. */
  async scopeFor(userId: string, space: DriveSpace): Promise<DriveScope> {
    if (space === "personal") return { kind: "personal", userId };
    const membership = await this.teams.membership(userId);
    if (!membership) throw notInTeam();
    return { kind: "team", teamId: membership.teamId, userId, role: membership.role };
  }

  /** The space a row is in, if the person may see it; null otherwise. */
  private async scopeOfRow(
    userId: string,
    row: { userId: string; teamId: string | null },
  ): Promise<DriveScope | null> {
    if (row.teamId === null) return row.userId === userId ? { kind: "personal", userId } : null;
    const membership = await this.teams.membership(userId);
    if (membership?.teamId !== row.teamId) return null;
    return { kind: "team", teamId: row.teamId, userId, role: membership.role };
  }

  /** A change counted against a space's limits waits for others to the same space. */
  private async lockScope(tx: DatabaseExecutor, scope: DriveScope): Promise<void> {
    if (scope.kind === "personal") {
      await lockAccount(tx, scope.userId);
      return;
    }
    await tx
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.id, scope.teamId))
      .for("update");
  }

  // ── Reading ────────────────────────────────────────────────────────────

  /** A read of a team's space by someone no longer in one shows their own Drive instead. */
  async overview(userId: string, wanted: DriveSpace = "personal"): Promise<DriveOverview> {
    const membership = await this.teams.membership(userId);
    const space: DriveSpace = wanted === "team" && membership ? "team" : "personal";
    const scope = await this.scopeFor(userId, space);
    const [folders, usage, team] = await Promise.all([
      this.listFolders(scope),
      this.usage(scope),
      membership
        ? this.database.db
            .select({ name: schema.teams.name })
            .from(schema.teams)
            .where(eq(schema.teams.id, membership.teamId))
        : Promise.resolve([]),
    ]);
    return { folders, usage, space, team: team[0] ? { name: team[0].name } : null };
  }

  async listFolders(scope: DriveScope): Promise<DriveFolder[]> {
    const rows = await this.database.db
      .select()
      .from(schema.driveFolders)
      .where(foldersIn(scope))
      .orderBy(asc(sql`lower(${schema.driveFolders.name})`));
    return rows.map((row) => toFolder(row, scope));
  }

  /** What a space holds, against the plan in force (in a team, the owner's). */
  async usage(
    scope: DriveScope,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<DriveUsage> {
    const [files] = await executor
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(${schema.driveFiles.size}), 0)::bigint`,
      })
      .from(schema.driveFiles)
      .where(filesIn(scope));
    const [folders] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.driveFolders)
      .where(foldersIn(scope));
    const limits = await this.billing.limitsFor(scope.userId);
    return {
      usedBytes: files ? Number(files.bytes) : 0,
      limitBytes: limits.driveBytes,
      fileCount: files?.count ?? 0,
      fileLimit: limits.driveFiles,
      folderCount: folders?.count ?? 0,
      folderLimit: limits.driveFolders,
      maxFileBytes: this.config.drive.maxFileBytes,
    };
  }

  /** The files in one folder (null: the top level), or every file matching `q`, in a space. */
  async listFiles(
    userId: string,
    query: {
      folderId: string | null;
      q?: string | undefined;
      kind?: DriveFileKind | undefined;
      space?: DriveSpace;
    },
  ): Promise<DriveFile[]> {
    let scope: DriveScope;
    if (query.folderId && !query.q) {
      // A folder that isn't there (or isn't theirs) simply holds nothing, as it always has.
      const found = await this.findFolder(userId, query.folderId).catch(() => null);
      if (!found) return [];
      scope = found.scope;
    } else {
      const team = query.space === "team" && (await this.teams.membership(userId)) !== null;
      scope = await this.scopeFor(userId, team ? "team" : "personal");
    }
    const where = query.kind
      ? and(
          filesIn(scope),
          notTrashed,
          eq(schema.driveFiles.status, "clean"),
          kindFilter(query.kind),
        )
      : query.q
        ? and(filesIn(scope), notTrashed, ilike(schema.driveFiles.name, `%${escapeLike(query.q)}%`))
        : and(
            filesIn(scope),
            notTrashed,
            query.folderId
              ? eq(schema.driveFiles.folderId, query.folderId)
              : isNull(schema.driveFiles.folderId),
          );
    const rows = await this.database.db
      .select()
      .from(schema.driveFiles)
      .where(where)
      .orderBy(asc(sql`lower(${schema.driveFiles.name})`));
    return rows.map((row) => toFile(row, scope));
  }

  /** A file the person may see: their own, or their team's; in Trash only when asked for. */
  private async findFile(
    userId: string,
    id: string,
    where: "files" | "trash" = "files",
  ): Promise<{ row: DriveFileRow; scope: DriveScope }> {
    const [row] = await this.database.db
      .select()
      .from(schema.driveFiles)
      .where(eq(schema.driveFiles.id, id))
      .limit(1);
    const scope = row ? await this.scopeOfRow(userId, row) : null;
    if (!row || !scope || (row.trashedAt !== null) !== (where === "trash")) throw fileNotFound();
    return { row, scope };
  }

  private async findFolder(
    userId: string,
    id: string,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<{ row: DriveFolderRow; scope: DriveScope }> {
    const [row] = await executor
      .select()
      .from(schema.driveFolders)
      .where(eq(schema.driveFolders.id, id))
      .limit(1);
    const scope = row ? await this.scopeOfRow(userId, row) : null;
    if (!row || !scope) throw folderNotFound();
    return { row, scope };
  }

  /** A folder in the given space, for a move or a new item inside it. */
  private async folderIn(
    scope: DriveScope,
    id: string,
    executor: DatabaseExecutor = this.database.db,
  ): Promise<DriveFolderRow> {
    const { row } = await this.findFolder(scope.userId, id, executor);
    if (!sameSpace(scope, row)) throw folderNotFound();
    return row;
  }

  /** The folder and everything below it (the folder is already the person's to see). */
  private async descendantFolderIds(
    executor: DatabaseExecutor,
    folderId: string,
  ): Promise<string[]> {
    const result = await executor.execute<{ id: string }>(sql`
      with recursive tree as (
        select id from ${schema.driveFolders} where id = ${folderId}
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
    input: { name: string; parentId: string | null; space?: DriveSpace },
  ): Promise<DriveFolder> {
    const userId = auth.user.id;
    const scope = input.parentId
      ? (await this.findFolder(userId, input.parentId)).scope
      : await this.scopeFor(userId, input.space ?? "personal");
    let row: DriveFolderRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
        await this.lockScope(tx, scope);
        if (input.parentId) await this.folderIn(scope, input.parentId, tx);
        const usage = await this.usage(scope, tx);
        if (usage.folderCount >= usage.folderLimit) {
          throw new ApiException(
            "limit_reached",
            409,
            scope.kind === "team"
              ? `The team’s plan allows ${String(usage.folderLimit)} folders in its Drive. Delete one first.`
              : `Your plan allows ${String(usage.folderLimit)} folders. Delete one, or move to a plan with more.`,
          );
        }
        const [inserted] = await tx
          .insert(schema.driveFolders)
          .values({
            userId,
            teamId: scope.kind === "team" ? scope.teamId : null,
            name: input.name,
            parentId: input.parentId,
          })
          .returning();
        if (!inserted) throw new Error("Folder insert returned nothing");
        return inserted;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw folderNameTaken();
      throw error;
    }
    return toFolder(row, scope);
  }

  async updateFolder(
    auth: AuthContext,
    id: string,
    input: { name?: string | undefined; parentId?: string | null | undefined },
  ): Promise<DriveFolder> {
    const userId = auth.user.id;
    const { row: current, scope } = await this.findFolder(userId, id);
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
      await this.folderIn(scope, input.parentId);
      const below = await this.descendantFolderIds(this.database.db, id);
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
        .where(eq(schema.driveFolders.id, current.id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw folderNameTaken();
      throw error;
    }
    if (!row) throw folderNotFound();
    return toFolder(row, scope);
  }

  /** Deletes the folder, its folders and their files; the objects go too. */
  async deleteFolder(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    const objectKeys = await this.database.db.transaction(async (tx) => {
      const { row, scope } = await this.findFolder(userId, id, tx);
      if (!mayDelete(scope, row)) throw cannotDelete();
      const folderIds = await this.descendantFolderIds(tx, id);
      const files = await tx
        .select({ objectKey: schema.driveFiles.objectKey })
        .from(schema.driveFiles)
        .where(and(filesIn(scope), inArray(schema.driveFiles.folderId, folderIds)));
      await tx.delete(schema.driveFolders).where(eq(schema.driveFolders.id, row.id));
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
    scope: DriveScope,
    folderId: string | null,
    wanted: string,
  ): Promise<string> {
    const rows = await tx
      .select({ name: schema.driveFiles.name })
      .from(schema.driveFiles)
      .where(
        and(
          filesIn(scope),
          notTrashed,
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
   * file is kept in quarantine: visible and deletable, never openable. A
   * file goes where its folder is, or to the top of `space`.
   */
  /** The owner hears of a quarantined file, and so does whoever runs Brawzer. */
  private async quarantineNotices(
    userId: string,
    fileId: string,
    name: string,
    threat: string | null,
    source: "upload" | "browser",
  ): Promise<void> {
    try {
      const [owner] = await this.database.db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (owner) this.email.sendFileQuarantined(owner.email, name, threat, source, fileId);
      this.email.notifyAdmins(
        "quarantine",
        [
          ["File", name],
          ["Threat", threat ?? "(unnamed)"],
          ["Source", source === "browser" ? "a cloud browser" : "an upload"],
          ["Account", owner?.email ?? userId],
        ],
        `quarantine:${fileId}`,
      );
    } catch (error) {
      logger.warn(`Quarantine notice failed: ${error instanceof Error ? error.message : ""}`);
    }
  }

  async upload(
    auth: { user: { id: string }; session: { id: string } },
    folderId: string | null,
    input: UploadInput,
    meta: RequestMeta,
    space: DriveSpace = "personal",
  ): Promise<DriveFile> {
    const userId = auth.user.id;
    await this.limiter.enforce(RATE_LIMITS.driveUploadsPerAccount, userId);
    const scope = folderId
      ? (await this.findFolder(userId, folderId)).scope
      : await this.scopeFor(userId, space);
    const name = sanitizeFilename(input.filename);

    // Cheap checks first, so a full Drive doesn't receive a whole file for nothing.
    const before = await this.usage(scope);
    if (before.fileCount >= before.fileLimit) throw this.tooManyFiles(before.fileLimit, scope);
    if (before.usedBytes >= before.limitBytes) throw this.driveFull(before.limitBytes, scope);

    const objectId = randomUUID();
    const objectKey = objectKeyFor(scope, objectId);
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
    const teamId = scope.kind === "team" ? scope.teamId : null;
    const wrappedKey = await this.box.seal(
      key.toString("base64"),
      keyContext({ userId, teamId }, objectId),
    );
    key.fill(0);

    let row: DriveFileRow;
    try {
      row = await this.database.db.transaction(async (tx) => {
        await this.lockScope(tx, scope);
        // The folder may have gone, or the person left the team, while the file arrived.
        if (folderId) await this.folderIn(scope, folderId, tx);
        if (scope.kind === "team" && (await this.teams.membership(userId, tx))?.teamId !== teamId) {
          throw notInTeam();
        }
        const usage = await this.usage(scope, tx);
        if (usage.fileCount >= usage.fileLimit) throw this.tooManyFiles(usage.fileLimit, scope);
        if (usage.usedBytes + stored.size > usage.limitBytes)
          throw this.driveFull(usage.limitBytes, scope);
        const [inserted] = await tx
          .insert(schema.driveFiles)
          .values({
            userId,
            teamId,
            folderId,
            name: await this.freeName(tx, scope, folderId, name),
            size: stored.size,
            contentType: stored.contentType,
            status: stored.verdict.verdict,
            threat: stored.verdict.verdict === "infected" ? stored.verdict.signature : null,
            source: input.source ?? "upload",
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

    const fromBrowser = input.source === "browser";
    if (row.status === "infected") {
      void this.quarantineNotices(
        userId,
        row.id,
        row.name,
        row.threat,
        fromBrowser ? "browser" : "upload",
      );
    }
    await this.events.record({
      type:
        row.status === "infected"
          ? "drive.file_quarantined"
          : fromBrowser
            ? "browser.file_saved"
            : "drive.file_uploaded",
      userId,
      sessionId: auth.session.id,
      meta,
      ...(fromBrowser ? { metadata: { kind: input.kind ?? "download" } } : {}),
    });
    return toFile(row, scope);
  }

  /** The folder with that name at the top of the person's own Drive, created if it's missing. */
  async ensureFolder(userId: string, name: string): Promise<string> {
    const [existing] = await this.database.db
      .select({ id: schema.driveFolders.id })
      .from(schema.driveFolders)
      .where(
        and(
          eq(schema.driveFolders.userId, userId),
          isNull(schema.driveFolders.teamId),
          isNull(schema.driveFolders.parentId),
          sql`lower(${schema.driveFolders.name}) = lower(${name})`,
        ),
      )
      .limit(1);
    if (existing) return existing.id;
    try {
      const [created] = await this.database.db
        .insert(schema.driveFolders)
        .values({ userId, parentId: null, name })
        .returning({ id: schema.driveFolders.id });
      if (!created) throw new Error("Folder insert returned nothing");
      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Made in the meantime by another request.
      return this.ensureFolder(userId, name);
    }
  }

  /**
   * Clean files the person may see (their own, or their team's), by id, for
   * handing to a page in the cloud browser. Unknown, foreign and quarantined
   * ids are left out.
   */
  async openForBrowser(userId: string, ids: readonly string[]): Promise<OpenedFile[]> {
    if (ids.length === 0) return [];
    const membership = await this.teams.membership(userId);
    const personal: DriveScope = { kind: "personal", userId };
    const team: DriveScope | null = membership
      ? { kind: "team", teamId: membership.teamId, userId, role: membership.role }
      : null;
    const rows = await this.database.db
      .select()
      .from(schema.driveFiles)
      .where(
        and(
          team ? or(filesIn(personal), filesIn(team)) : filesIn(personal),
          inArray(schema.driveFiles.id, [...ids]),
          eq(schema.driveFiles.status, "clean"),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const opened: OpenedFile[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row) opened.push(await this.openRow(row, row.teamId && team ? team : personal));
    }
    return opened;
  }

  private tooManyFiles(limit: number, scope: DriveScope) {
    return new ApiException(
      "limit_reached",
      409,
      scope.kind === "team"
        ? `The team’s Drive holds up to ${String(limit)} files. Delete some files to make room.`
        : `Your plan's Drive holds up to ${String(limit)} files. Delete some files to make room, or move to a plan with more.`,
    );
  }

  private driveFull(limitBytes: number, scope: DriveScope) {
    return new ApiException(
      "limit_reached",
      409,
      scope.kind === "team"
        ? `The team’s Drive holds up to ${formatBytes(limitBytes)}. Delete some files to make room.`
        : `Your plan's Drive holds up to ${formatBytes(limitBytes)}. Delete some files to make room, or move to a plan with more.`,
    );
  }

  async updateFile(
    auth: AuthContext,
    id: string,
    input: { name?: string | undefined; folderId?: string | null | undefined },
  ): Promise<DriveFile> {
    const userId = auth.user.id;
    const { row: current, scope } = await this.findFile(userId, id);
    if (input.folderId) await this.folderIn(scope, input.folderId);
    let row: DriveFileRow | undefined;
    try {
      [row] = await this.database.db
        .update(schema.driveFiles)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
          updatedAt: new Date(),
        })
        .where(eq(schema.driveFiles.id, current.id))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) throw fileNameTaken();
      throw error;
    }
    if (!row) throw fileNotFound();
    return toFile(row, scope);
  }

  /**
   * Moves a file to Trash, where it waits DRIVE_TRASH_DAYS (still counting
   * towards storage) before it's removed for good. A quarantined file is
   * removed at once: there's nothing to get back.
   */
  async deleteFile(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const userId = auth.user.id;
    const { row, scope } = await this.findFile(userId, id);
    if (!mayDelete(scope, row)) throw cannotDelete();
    if (row.status === "clean") {
      await this.database.db
        .update(schema.driveFiles)
        .set({ trashedAt: new Date() })
        .where(eq(schema.driveFiles.id, row.id));
      await this.events.record({
        type: "drive.file_deleted",
        userId,
        sessionId: auth.session.id,
        meta,
        metadata: { kind: "trash" },
      });
      return;
    }
    await this.removeFile(auth, row, meta);
  }

  /** What's in Trash in this space, newest first. */
  async listTrash(userId: string, space: DriveSpace = "personal"): Promise<DriveFile[]> {
    const team = space === "team" && (await this.teams.membership(userId)) !== null;
    const scope = await this.scopeFor(userId, team ? "team" : "personal");
    const rows = await this.database.db
      .select()
      .from(schema.driveFiles)
      .where(and(filesIn(scope), isNotNull(schema.driveFiles.trashedAt)))
      .orderBy(desc(schema.driveFiles.trashedAt));
    return rows.map((row) => toFile(row, scope));
  }

  /** Puts a file back in its folder, renamed "name (2)" if the name is taken meanwhile. */
  async restoreFile(auth: AuthContext, id: string): Promise<DriveFile> {
    const userId = auth.user.id;
    const { row, scope } = await this.findFile(userId, id, "trash");
    if (!mayDelete(scope, row)) throw cannotDelete();
    const restored = await this.database.db.transaction(async (tx) => {
      await this.lockScope(tx, scope);
      const name = await this.freeName(tx, scope, row.folderId, row.name);
      const [updated] = await tx
        .update(schema.driveFiles)
        .set({ trashedAt: null, name })
        .where(eq(schema.driveFiles.id, row.id))
        .returning();
      if (!updated) throw fileNotFound();
      return updated;
    });
    return toFile(restored, scope);
  }

  /** Removes a file in Trash for good. */
  async deleteForever(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const { row, scope } = await this.findFile(auth.user.id, id, "trash");
    if (!mayDelete(scope, row)) throw cannotDelete();
    await this.removeFile(auth, row, meta);
  }

  /** Removes everything in Trash this person may delete, in this space. */
  async emptyTrash(auth: AuthContext, space: DriveSpace, meta: RequestMeta): Promise<number> {
    const files = await this.listTrash(auth.user.id, space);
    let removed = 0;
    for (const file of files.filter((entry) => entry.canDelete)) {
      const { row } = await this.findFile(auth.user.id, file.id, "trash");
      await this.removeFile(auth, row, meta);
      removed += 1;
    }
    return removed;
  }

  private async removeFile(
    auth: { user: { id: string }; session: { id: string } },
    row: DriveFileRow,
    meta: RequestMeta,
  ): Promise<void> {
    const userId = auth.user.id;
    const deleted = await this.database.db
      .delete(schema.driveFiles)
      .where(eq(schema.driveFiles.id, row.id))
      .returning({ objectKey: schema.driveFiles.objectKey });
    if (deleted.length === 0) throw fileNotFound();
    await this.removeObjects(deleted.map((entry) => entry.objectKey));
    await this.events.record({
      type: "drive.file_deleted",
      userId,
      sessionId: auth.session.id,
      meta,
    });
  }

  /**
   * Saves a new version of a file, keeping its name, folder and id (the
   * desktop's editors save this way). The content is scanned and encrypted
   * with a new key like any upload; the old object is removed once the new
   * one is recorded. A file only its owner may delete may only be saved by
   * them too.
   */
  async replaceContent(
    auth: { user: { id: string }; session: { id: string } },
    id: string,
    input: UploadInput,
    meta: RequestMeta,
  ): Promise<DriveFile> {
    const userId = auth.user.id;
    await this.limiter.enforce(RATE_LIMITS.driveUploadsPerAccount, userId);
    const { row, scope } = await this.findFile(userId, id);
    if (!mayDelete(scope, row)) throw cannotDelete();

    const objectId = randomUUID();
    const objectKey = objectKeyFor(scope, objectId);
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
        throw new ApiException(
          "service_unavailable",
          503,
          "Brawzer’s malware scanner isn’t available right now, so the file wasn’t saved. Try again in a few minutes.",
          { headers: { "Retry-After": "60" } },
        );
      }
      throw error;
    }
    const wrappedKey = await this.box.seal(key.toString("base64"), keyContext(row, objectId));
    key.fill(0);

    let updated: DriveFileRow;
    try {
      updated = await this.database.db.transaction(async (tx) => {
        await this.lockScope(tx, scope);
        const usage = await this.usage(scope, tx);
        if (usage.usedBytes - row.size + stored.size > usage.limitBytes) {
          throw this.driveFull(usage.limitBytes, scope);
        }
        const [saved] = await tx
          .update(schema.driveFiles)
          .set({
            size: stored.size,
            contentType: stored.contentType,
            status: stored.verdict.verdict,
            threat: stored.verdict.verdict === "infected" ? stored.verdict.signature : null,
            wrappedKey,
            objectKey,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.driveFiles.id, row.id), notTrashed))
          .returning();
        if (!saved) throw fileNotFound();
        return saved;
      });
    } catch (error) {
      await this.removeObjects([objectKey]);
      throw error;
    }
    await this.removeObjects([row.objectKey]);
    if (updated.status === "infected") {
      void this.quarantineNotices(userId, updated.id, updated.name, updated.threat, "upload");
    }
    await this.events.record({
      type: updated.status === "infected" ? "drive.file_quarantined" : "drive.file_uploaded",
      userId,
      sessionId: auth.session.id,
      meta,
    });
    return toFile(updated, scope);
  }

  /** Send to Phone: Drive's page for the file, which needs a sign-in, and its QR code. */
  async phoneLink(userId: string, id: string): Promise<DrivePhoneLink> {
    const { row } = await this.findFile(userId, id);
    const params = new URLSearchParams({ q: row.name });
    const url = `${this.config.webOrigin}/app/drive?${params.toString()}`;
    const qrSvg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
    return { url, qrSvg };
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

  private async openRow(row: DriveFileRow, scope: DriveScope): Promise<OpenedFile> {
    if (row.status !== "clean") throw quarantined();
    const objectId = objectIdOf(row.objectKey);
    const key = Buffer.from(
      await this.box.open(row.wrappedKey, keyContext(row, objectId)),
      "base64",
    );
    const object = await this.store.get(row.objectKey);
    if (!object) {
      logger.error(`Drive file ${row.id} has no object in the store`);
      throw fileNotFound();
    }
    const body = createDecryptStream(key, objectId);
    object.on("error", (error) => body.destroy(error));
    return { file: toFile(row, scope), body: object.pipe(body) };
  }

  /** For showing a clean, previewable file in the browser. */
  async openForPreview(userId: string, id: string): Promise<OpenedFile> {
    const { row, scope } = await this.findFile(userId, id);
    if (row.status === "clean" && !isPreviewable(row.contentType)) {
      throw new ApiException(
        "unsupported_media_type",
        415,
        "This type of file can’t be shown here. Save it to a computer to open it.",
      );
    }
    return this.openRow(row, scope);
  }

  /** A single-use ticket to save the file to a computer. Logged in the security history. */
  async issueDownloadTicket(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
  ): Promise<{ url: string; expiresAt: string }> {
    const userId = auth.user.id;
    await this.limiter.enforce(RATE_LIMITS.driveTicketsPerAccount, userId);
    const { row } = await this.findFile(userId, id);
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

  /** Redeems a ticket and opens the file it was issued for, if the person may still see it. */
  async openWithTicket(id: string, ticket: string): Promise<OpenedFile> {
    const userId = await this.tickets.redeem(ticket, id);
    if (!userId) {
      throw new ApiException(
        "token_invalid",
        400,
        "This download link has expired or was already used. Go back to Drive and save the file again.",
      );
    }
    const { row, scope } = await this.findFile(userId, id);
    return this.openRow(row, scope);
  }

  // ── Account ────────────────────────────────────────────────────────────

  /** For "download your data": where the person's own things are, not what's in them. */
  async forExport(userId: string) {
    const scope: DriveScope = { kind: "personal", userId };
    const [folders, files] = await Promise.all([
      this.listFolders(scope),
      this.database.db
        .select()
        .from(schema.driveFiles)
        .where(filesIn(scope))
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

  /** The object keys of everything the account has in its own Drive in the store. */
  async objectKeysOf(userId: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const key of this.store.listKeys(objectKeyFor({ kind: "personal", userId }, "")))
      keys.push(key);
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
