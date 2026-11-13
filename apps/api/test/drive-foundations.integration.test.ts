import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { healthResponseSchema } from "@brawzer/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Scanner } from "../src/scanning/clamd.js";
import { SCANNER } from "../src/scanning/scanning.module.js";
import {
  CHUNK_SIZE,
  createDecryptStream,
  createEncryptStream,
  generateFileKey,
} from "../src/storage/encrypted-chunks.js";
import type { ObjectStore } from "../src/storage/object-store.js";
import { OBJECT_STORE } from "../src/storage/storage.module.js";
import { createHarness, type Harness } from "./support/harness.js";

// Requires the local services (`pnpm infra:up`): RustFS stands in for the
// object store and ClamAV scans with its bundled signatures.
let h: Harness;
let store: ObjectStore;
let scanner: Scanner;
const prefix = `test/${randomUUID()}/`;

// The standard antivirus test file, assembled so this source file isn't flagged.
const EICAR = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$",
  "EICAR-STANDARD-",
  "ANTIVIRUS-TEST-FILE!$H+H*",
].join("");

beforeAll(async () => {
  h = await createHarness({ ipPrefix: "100.67.0" });
  store = h.app.get<ObjectStore>(OBJECT_STORE);
  scanner = h.app.get<Scanner>(SCANNER);
});

afterAll(async () => {
  const keys: string[] = [];
  for await (const key of store.listKeys(prefix)) keys.push(key);
  if (keys.length > 0) await store.deleteMany(keys);
  await h.close();
});

describe("the object store", () => {
  it("is reported healthy together with the scanner", async () => {
    const response = await h.browser().get("/health");
    const report = healthResponseSchema.parse(response.json());
    expect(report.status).toBe("ok");
    expect(report.checks?.storage.status).toBe("up");
    expect(report.checks?.scanner.status).toBe("up");
  });

  it("stores and returns an encrypted stream larger than one chunk, byte for byte", async () => {
    const fileId = randomUUID();
    const key = generateFileKey();
    const plain = randomBytes(2 * CHUNK_SIZE + 777);
    const objectKey = `${prefix}${fileId}`;

    await store.put(objectKey, Readable.from([plain]).pipe(createEncryptStream(key, fileId)));

    const stored = await store.get(objectKey);
    if (!stored) throw new Error("The object wasn't stored");
    const sealed = await buffer(stored);
    expect(sealed.length).toBe(9 + plain.length + 3 * 16);
    expect(sealed.includes(plain.subarray(0, 64))).toBe(false);

    const again = await store.get(objectKey);
    if (!again) throw new Error("The object vanished");
    const opened: Buffer[] = [];
    await pipeline(again, createDecryptStream(key, fileId), async (source) => {
      for await (const piece of source) opened.push(piece as Buffer);
    });
    expect(Buffer.concat(opened).equals(plain)).toBe(true);
  });

  it("lists by prefix, deletes in bulk and answers null for a missing object", async () => {
    const keys = [`${prefix}a`, `${prefix}b`, `${prefix}c`];
    for (const key of keys) await store.put(key, Readable.from([Buffer.from(key)]));
    const listed: string[] = [];
    for await (const key of store.listKeys(prefix)) listed.push(key);
    expect(listed).toEqual(expect.arrayContaining(keys));

    await store.deleteMany(keys);
    for (const key of keys) expect(await store.get(key)).toBeNull();
    expect(await store.get(`${prefix}never-existed`)).toBeNull();
    await store.delete(`${prefix}never-existed`); // deleting nothing is fine
  });
});

describe("the scanner", () => {
  it("passes ordinary content and catches the EICAR test file", async () => {
    const clean = await scanner.scan(
      Readable.from([randomBytes(50_000), Buffer.from("plain text")]),
    );
    expect(clean).toEqual({ verdict: "clean" });

    const infected = await scanner.scan(Readable.from([Buffer.from(EICAR)]));
    expect(infected.verdict).toBe("infected");
    if (infected.verdict === "infected") expect(infected.signature).toMatch(/eicar/i);

    // The EICAR signature only matches at the start of a file, so a buried copy
    // isn't expected to be found; what matters is that streaming in many small
    // pieces still delivers the whole file.
    const pieces = [...Buffer.from(EICAR)].map((byte) => Buffer.from([byte]));
    expect((await scanner.scan(Readable.from(pieces))).verdict).toBe("infected");
    const large = await scanner.scan(Readable.from([randomBytes(3 * 1024 * 1024)]));
    expect(large).toEqual({ verdict: "clean" });
  });
});
