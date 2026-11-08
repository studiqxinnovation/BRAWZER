import { randomUUID } from "node:crypto";
import { PassThrough, type Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MAX_PROFILE_DATA_BYTES } from "@brawzer/contracts";
import { type DatabaseHandle, eq, type ProfileRow, schema } from "@brawzer/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { SECRET_BOX } from "../crypto/crypto.module.js";
import type { SecretBox } from "../crypto/secret-box.js";
import { DATABASE } from "../database/database.module.js";
import {
  createDecryptStream,
  createEncryptStream,
  generateFileKey,
} from "../storage/encrypted-chunks.js";
import type { ObjectStore } from "../storage/object-store.js";
import { OBJECT_STORE } from "../storage/storage.module.js";

const logger = new Logger("ProfileData");

/** A profile's data key is sealed for one account and one object (ADR 0011). */
const keyContext = (userId: string, objectId: string) => `profile-data:${userId}:${objectId}`;
const objectKeyFor = (userId: string, objectId: string) => `profiles/${userId}/${objectId}`;
const objectIdOf = (objectKey: string) => objectKey.slice(objectKey.lastIndexOf("/") + 1);

export class ProfileDataTooLargeError extends Error {
  constructor() {
    super("The profile data is larger than the limit");
    this.name = "ProfileDataTooLargeError";
  }
}

/**
 * A profile's browsing data between sessions: one object per profile in the
 * object store, encrypted like a Drive file (its own key, wrapped by the key
 * service, ADR 0011's chunk format with the object id authenticated). The
 * runtime packs and unpacks it; the API only ever sees ciphertext go by.
 */
@Injectable()
export class ProfileDataService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  /** The decrypted archive, or null when the profile has no saved data. */
  async open(profile: ProfileRow): Promise<Readable | null> {
    if (!profile.dataObjectKey || !profile.dataWrappedKey) return null;
    const objectId = objectIdOf(profile.dataObjectKey);
    const key = Buffer.from(
      await this.box.open(profile.dataWrappedKey, keyContext(profile.userId, objectId)),
      "base64",
    );
    const object = await this.store.get(profile.dataObjectKey);
    if (!object) {
      logger.error(`Profile ${profile.id} has no data object in the store`);
      return null;
    }
    const body = createDecryptStream(key, objectId);
    object.on("error", (error) => body.destroy(error));
    return object.pipe(body);
  }

  /**
   * Stores a fresh archive for the profile and forgets the previous one.
   * Nothing is kept when the archive is over the limit or the store fails.
   */
  async save(profile: ProfileRow, archive: Readable): Promise<{ bytes: number }> {
    const objectId = randomUUID();
    const objectKey = objectKeyFor(profile.userId, objectId);
    const key = generateFileKey();
    let bytes = 0;
    const count = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        bytes += chunk.length;
        if (bytes > MAX_PROFILE_DATA_BYTES) {
          callback(new ProfileDataTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });
    const encrypted = new PassThrough();
    encrypted.on("error", () => undefined);
    const storing = this.store.put(objectKey, encrypted);
    storing.catch(() => undefined);
    try {
      await Promise.all([
        pipeline(archive, count, createEncryptStream(key, objectId), encrypted),
        storing,
      ]);
    } catch (error) {
      encrypted.destroy();
      key.fill(0);
      await this.store.delete(objectKey).catch(() => undefined);
      throw error;
    }
    const wrappedKey = await this.box.seal(
      key.toString("base64"),
      keyContext(profile.userId, objectId),
    );
    key.fill(0);
    const [updated] = await this.database.db
      .update(schema.profiles)
      .set({
        dataObjectKey: objectKey,
        dataWrappedKey: wrappedKey,
        dataBytes: bytes,
        dataSavedAt: new Date(),
      })
      .where(eq(schema.profiles.id, profile.id))
      .returning({ id: schema.profiles.id });
    if (!updated) {
      // The profile went away while its session ran: nothing to attach the data to.
      await this.store.delete(objectKey).catch(() => undefined);
      return { bytes };
    }
    if (profile.dataObjectKey)
      await this.store.delete(profile.dataObjectKey).catch(() => undefined);
    return { bytes };
  }

  /** Forgets a profile's saved data; the record and the object both go. */
  async clear(profile: ProfileRow): Promise<void> {
    await this.database.db
      .update(schema.profiles)
      .set({ dataObjectKey: null, dataWrappedKey: null, dataBytes: null, dataSavedAt: null })
      .where(eq(schema.profiles.id, profile.id));
    if (profile.dataObjectKey) await this.removeObjects([profile.dataObjectKey]);
  }

  /** Every profile data object of the account, for deletion after its rows are gone. */
  async objectKeysOf(userId: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const key of this.store.listKeys(objectKeyFor(userId, ""))) keys.push(key);
    return keys;
  }

  async removeObjects(objectKeys: readonly string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    try {
      await this.store.deleteMany(objectKeys);
    } catch (error) {
      logger.error(
        `Could not remove ${String(objectKeys.length)} profile data object(s): ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
}
