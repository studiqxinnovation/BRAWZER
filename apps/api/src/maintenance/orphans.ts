import { type DatabaseHandle, isNotNull, schema } from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DATABASE } from "../database/database.module.js";
import type { ObjectStore } from "../storage/object-store.js";
import { OBJECT_STORE } from "../storage/storage.module.js";

const logger = new Logger("Orphans");

/** Objects younger than this may belong to an upload still in flight. */
export const ORPHAN_MIN_AGE_MS = 60 * 60_000;

export interface OrphanResult {
  checked: number;
  removed: number;
}

/**
 * Removes objects nothing refers to: a Drive file or profile archive whose
 * record was deleted while the store was unreachable (ADR 0011 deletes the
 * row first, then the object). Only objects older than an hour are
 * considered, so an upload between its store write and its row is safe.
 */
@Injectable()
export class OrphanService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  async run(now = new Date()): Promise<OrphanResult> {
    const [files, profiles] = await Promise.all([
      this.database.db.select({ key: schema.driveFiles.objectKey }).from(schema.driveFiles),
      this.database.db
        .select({ key: schema.profiles.dataObjectKey })
        .from(schema.profiles)
        .where(isNotNull(schema.profiles.dataObjectKey)),
    ]);
    const referenced = new Set<string>();
    for (const row of files) referenced.add(row.key);
    for (const row of profiles) if (row.key) referenced.add(row.key);

    const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS;
    let checked = 0;
    const orphans: string[] = [];
    for (const prefix of ["drive/", "profiles/"]) {
      for await (const object of this.store.listObjects(prefix)) {
        checked += 1;
        if (referenced.has(object.key)) continue;
        if (object.lastModified && object.lastModified.getTime() > cutoff) continue;
        orphans.push(object.key);
      }
    }
    if (orphans.length > 0) {
      await this.store.deleteMany(orphans);
      logger.log(`Removed ${String(orphans.length)} orphaned object(s)`);
    }
    return { checked, removed: orphans.length };
  }
}
