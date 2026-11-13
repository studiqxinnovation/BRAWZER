import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * The encrypted object format for Drive files (ADR 0011).
 *
 * header: version (1 byte) | nonce prefix (8 bytes)
 * chunk:  ciphertext (1 MiB, or less for the last chunk) | GCM tag (16 bytes)
 *
 * Each chunk is AES-256-GCM with nonce = prefix | chunk index, and
 * authenticated data naming the file, the index and whether the chunk is the
 * last. Every chunk but the last is exactly CHUNK_SIZE bytes of ciphertext, so
 * no lengths are stored: a reader knows a full chunk isn't the last one
 * because more bytes follow it.
 */
export const FORMAT_VERSION = 1;
export const CHUNK_SIZE = 1024 * 1024;
export const KEY_BYTES = 32;
const HEADER_BYTES = 9;
const TAG_BYTES = 16;
const NONCE_PREFIX_BYTES = 8;

export class EncryptedObjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptedObjectError";
  }
}

export function generateFileKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** The stored size of a file of `plainLength` bytes. */
export function encryptedSize(plainLength: number): number {
  const chunks = Math.max(1, Math.ceil(plainLength / CHUNK_SIZE));
  return HEADER_BYTES + plainLength + chunks * TAG_BYTES;
}

function nonceFor(prefix: Buffer, index: number): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0, 0, NONCE_PREFIX_BYTES);
  nonce.writeUInt32BE(index, NONCE_PREFIX_BYTES);
  return nonce;
}

function aadFor(fileId: string, index: number, last: boolean): Buffer {
  return Buffer.from(
    `brawzer-drive|${String(FORMAT_VERSION)}|${fileId}|${String(index)}|${last ? "last" : "more"}`,
    "utf8",
  );
}

function checkKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new EncryptedObjectError("The file key must be 32 bytes");
}

/** Plaintext in, encrypted object (header and chunks) out. */
export function createEncryptStream(key: Buffer, fileId: string): Transform {
  checkKey(key);
  const prefix = randomBytes(NONCE_PREFIX_BYTES);
  let buffered = Buffer.alloc(0);
  let index = 0;
  let headerSent = false;

  const seal = (plain: Buffer, last: boolean): Buffer => {
    const cipher = createCipheriv("aes-256-gcm", key, nonceFor(prefix, index));
    cipher.setAAD(aadFor(fileId, index, last));
    const out = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    index += 1;
    return out;
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      if (!headerSent) {
        this.push(Buffer.concat([Buffer.from([FORMAT_VERSION]), prefix]));
        headerSent = true;
      }
      buffered = Buffer.concat([buffered, chunk]);
      // Strictly more than a chunk: the last byte always belongs to the final chunk.
      while (buffered.length > CHUNK_SIZE) {
        this.push(seal(buffered.subarray(0, CHUNK_SIZE), false));
        buffered = buffered.subarray(CHUNK_SIZE);
      }
      callback();
    },
    flush(callback: TransformCallback) {
      if (!headerSent) this.push(Buffer.concat([Buffer.from([FORMAT_VERSION]), prefix]));
      this.push(seal(buffered, true));
      callback();
    },
  });
}

/**
 * Encrypted object in, plaintext out. Every chunk is verified before any of
 * it is passed on; tampering, truncation, reordering or a key or file-ID
 * mismatch destroys the stream with an EncryptedObjectError.
 */
export function createDecryptStream(key: Buffer, fileId: string): Transform {
  checkKey(key);
  let buffered = Buffer.alloc(0);
  let prefix: Buffer | null = null;
  let index = 0;

  const open = (sealed: Buffer, last: boolean): Buffer => {
    if (!prefix) throw new EncryptedObjectError("Missing header");
    if (sealed.length < TAG_BYTES) throw new EncryptedObjectError("Truncated chunk");
    const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(prefix, index));
    decipher.setAAD(aadFor(fileId, index, last));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    let plain: Buffer;
    try {
      plain = Buffer.concat([
        decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new EncryptedObjectError(`Chunk ${String(index)} failed verification`);
    }
    index += 1;
    return plain;
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        if (!prefix) {
          if (buffered.length < HEADER_BYTES) {
            callback();
            return;
          }
          if (buffered[0] !== FORMAT_VERSION) {
            throw new EncryptedObjectError(`Unknown format version ${String(buffered[0])}`);
          }
          prefix = Buffer.from(buffered.subarray(1, HEADER_BYTES));
          buffered = buffered.subarray(HEADER_BYTES);
        }
        while (buffered.length > CHUNK_SIZE + TAG_BYTES) {
          this.push(open(buffered.subarray(0, CHUNK_SIZE + TAG_BYTES), false));
          buffered = buffered.subarray(CHUNK_SIZE + TAG_BYTES);
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new EncryptedObjectError("Decryption failed"));
      }
    },
    flush(callback: TransformCallback) {
      try {
        if (!prefix) throw new EncryptedObjectError("Missing header");
        this.push(open(buffered, true));
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new EncryptedObjectError("Decryption failed"));
      }
    },
  });
}
