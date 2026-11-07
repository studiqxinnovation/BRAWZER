import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import {
  CHUNK_SIZE,
  createDecryptStream,
  createEncryptStream,
  encryptedSize,
  EncryptedObjectError,
  generateFileKey,
} from "./encrypted-chunks.js";

const FILE = "0193a0d2-2f1e-7a3b-8c4d-5e6f7a8b9c0d";

/** Flips one bit at `index`. */
function flip(data: Buffer, index: number): void {
  data.writeUInt8(data.readUInt8(index) ^ 0x01, index);
}

/** Feeds `data` through the stream in odd-sized pieces, like a network would. */
async function run(data: Buffer, transform: NodeJS.ReadWriteStream, pieces = [7, 1000, 65_536]) {
  let offset = 0;
  let i = 0;
  const chunks: Buffer[] = [];
  while (offset < data.length) {
    const size = pieces[i % pieces.length] ?? 1;
    chunks.push(data.subarray(offset, offset + size));
    offset += size;
    i += 1;
  }
  const out: Buffer[] = [];
  await pipeline(Readable.from(chunks), transform, async (source) => {
    for await (const piece of source) out.push(piece as Buffer);
  });
  return Buffer.concat(out);
}

async function roundTrip(plain: Buffer, key = generateFileKey()) {
  const sealed = await run(plain, createEncryptStream(key, FILE));
  expect(sealed.length).toBe(encryptedSize(plain.length));
  const opened = await run(sealed, createDecryptStream(key, FILE));
  expect(opened.equals(plain)).toBe(true);
  return sealed;
}

describe("encrypted chunks", () => {
  it("round-trips files of every awkward size", async () => {
    for (const size of [
      0,
      1,
      17,
      CHUNK_SIZE - 1,
      CHUNK_SIZE,
      CHUNK_SIZE + 1,
      2 * CHUNK_SIZE,
      3 * CHUNK_SIZE + 12_345,
    ]) {
      await roundTrip(randomBytes(size));
    }
  });

  it("produces different ciphertext for the same content and reveals nothing but size", async () => {
    const plain = Buffer.alloc(5000, 7);
    const key = generateFileKey();
    const first = await run(plain, createEncryptStream(key, FILE));
    const second = await run(plain, createEncryptStream(key, FILE));
    expect(first.equals(second)).toBe(false);
    expect(first.includes(Buffer.alloc(64, 7))).toBe(false);
  });

  it("refuses the wrong key or another file's ID", async () => {
    const key = generateFileKey();
    const sealed = await roundTrip(randomBytes(3000), key);
    await expect(run(sealed, createDecryptStream(generateFileKey(), FILE))).rejects.toBeInstanceOf(
      EncryptedObjectError,
    );
    await expect(
      run(sealed, createDecryptStream(key, "0193a0d2-2f1e-7a3b-8c4d-000000000000")),
    ).rejects.toBeInstanceOf(EncryptedObjectError);
  });

  it("detects a flipped byte, a truncated file and reordered chunks", async () => {
    const key = generateFileKey();
    const sealed = await roundTrip(randomBytes(2 * CHUNK_SIZE + 500), key);
    const open = (data: Buffer) => run(data, createDecryptStream(key, FILE));

    const flipped = Buffer.from(sealed);
    flip(flipped, 9 + 100);
    await expect(open(flipped)).rejects.toThrow(/Chunk 0 failed/);
    const tailFlipped = Buffer.from(sealed);
    flip(tailFlipped, sealed.length - 1);
    await expect(open(tailFlipped)).rejects.toThrow(/Chunk 2 failed/);

    // Cut after the first full chunk: that chunk was sealed as "more", not "last".
    const truncated = sealed.subarray(0, 9 + CHUNK_SIZE + 16);
    await expect(open(truncated)).rejects.toThrow(/Chunk 0 failed/);
    // Cut inside a tag.
    await expect(open(sealed.subarray(0, sealed.length - 5))).rejects.toBeInstanceOf(
      EncryptedObjectError,
    );

    const header = sealed.subarray(0, 9);
    const chunk0 = sealed.subarray(9, 9 + CHUNK_SIZE + 16);
    const chunk1 = sealed.subarray(9 + CHUNK_SIZE + 16, 9 + 2 * (CHUNK_SIZE + 16));
    const rest = sealed.subarray(9 + 2 * (CHUNK_SIZE + 16));
    await expect(open(Buffer.concat([header, chunk1, chunk0, rest]))).rejects.toThrow(
      /Chunk 0 failed/,
    );
  });

  it("rejects an unknown format version and a missing header", async () => {
    const key = generateFileKey();
    const sealed = await roundTrip(randomBytes(10), key);
    const future = Buffer.from(sealed);
    future[0] = 2;
    await expect(run(future, createDecryptStream(key, FILE))).rejects.toThrow(/format version 2/);
    await expect(run(Buffer.alloc(3), createDecryptStream(key, FILE))).rejects.toThrow(
      /Missing header/,
    );
  });

  it("never hands out plaintext from a chunk that fails", async () => {
    const key = generateFileKey();
    const plain = randomBytes(CHUNK_SIZE + 10);
    const sealed = await run(plain, createEncryptStream(key, FILE));
    const damaged = Buffer.from(sealed);
    flip(damaged, 9 + CHUNK_SIZE + 16 + 3); // inside the last chunk
    const received: Buffer[] = [];
    await expect(
      pipeline(Readable.from([damaged]), createDecryptStream(key, FILE), async (source) => {
        for await (const piece of source) received.push(piece as Buffer);
      }),
    ).rejects.toBeInstanceOf(EncryptedObjectError);
    // Only the intact first chunk came through, nothing of the damaged one.
    expect(Buffer.concat(received).equals(plain.subarray(0, CHUNK_SIZE))).toBe(true);
  });

  it("rejects keys of the wrong length", () => {
    expect(() => createEncryptStream(Buffer.alloc(16), FILE)).toThrow(EncryptedObjectError);
    expect(() => createDecryptStream(Buffer.alloc(31), FILE)).toThrow(EncryptedObjectError);
  });

  it("agrees with encryptedSize", async () => {
    const data = await buffer(
      Readable.from([randomBytes(1234)]).pipe(createEncryptStream(generateFileKey(), FILE)),
    );
    expect(data.length).toBe(encryptedSize(1234));
    expect(encryptedSize(0)).toBe(9 + 16);
    expect(encryptedSize(CHUNK_SIZE)).toBe(9 + CHUNK_SIZE + 16);
    expect(encryptedSize(CHUNK_SIZE + 1)).toBe(9 + CHUNK_SIZE + 1 + 32);
  });
});
