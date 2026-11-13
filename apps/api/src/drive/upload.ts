import { PassThrough, type Readable, Transform, type TransformCallback } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { Scanner, ScanVerdict } from "../scanning/clamd.js";
import { createEncryptStream } from "../storage/encrypted-chunks.js";
import type { ObjectStore } from "../storage/object-store.js";
import { SNIFF_BYTES, sniffContentType } from "./content-type.js";

/** The upload went past the per-file limit; nothing was kept. */
export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super("The file is larger than the limit");
    this.name = "FileTooLargeError";
  }
}

export interface StoredUpload {
  /** Plaintext bytes received. */
  size: number;
  /** Sniffed from the first bytes. */
  contentType: string;
  verdict: ScanVerdict;
}

export interface StoreUploadOptions {
  source: Readable;
  objectKey: string;
  /** Authenticated into every chunk (ADR 0011); the object's own ID. */
  objectId: string;
  key: Buffer;
  maxBytes: number;
  store: ObjectStore;
  scanner: Scanner;
}

/**
 * Streams one upload to the scanner and, encrypted, to the object store at the
 * same time, while counting bytes and sampling the start for type detection.
 * Nothing is buffered beyond the encryption chunk and the store's part size.
 * On any failure (too large, scanner unavailable, store error) every branch is
 * torn down; the caller removes whatever reached the store.
 */
export async function storeUpload(options: StoreUploadOptions): Promise<StoredUpload> {
  const { source, objectKey, objectId, key, maxBytes, store, scanner } = options;
  let size = 0;
  let sampled = 0;
  const sample: Buffer[] = [];

  const inspect = new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new FileTooLargeError(maxBytes));
        return;
      }
      if (sampled < SNIFF_BYTES) {
        const take = chunk.subarray(0, SNIFF_BYTES - sampled);
        sample.push(Buffer.from(take));
        sampled += take.length;
      }
      callback(null, chunk);
    },
  });

  const toScanner = new PassThrough();
  const toStore = new PassThrough();
  const encrypted = new PassThrough();

  const fail = (error: Error) => {
    for (const stream of [inspect, toScanner, toStore, encrypted]) {
      if (!stream.destroyed) stream.destroy(error);
    }
  };

  // pipe() keeps the pace of the slower branch; it doesn't forward errors.
  inspect.on("error", fail);
  // Failures surface through the promises below; the streams' own events are
  // listened to so a torn-down branch never becomes an uncaught exception.
  for (const stream of [toScanner, toStore, encrypted]) stream.on("error", () => undefined);
  inspect.pipe(toScanner);
  inspect.pipe(toStore);

  const inspected = pipeline(source, inspect);
  const encrypting = pipeline(toStore, createEncryptStream(key, objectId), encrypted);
  const scanning = scanner.scan(toScanner);
  const storing = store.put(objectKey, encrypted);

  // The first failure tears everything down; the others then fail quietly.
  const branches = [inspected, encrypting, scanning, storing] as const;
  for (const branch of branches) branch.catch(fail);

  try {
    const [, , verdict] = await Promise.all([inspected, encrypting, scanning, storing]);
    await finished(toScanner).catch(() => undefined);
    return { size, contentType: await sniffContentType(Buffer.concat(sample)), verdict };
  } catch (error) {
    fail(error instanceof Error ? error : new Error("Upload failed"));
    throw error;
  }
}
