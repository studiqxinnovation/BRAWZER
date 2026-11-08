import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChunkWriter } from "./transfers.ts";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("ChunkWriter", () => {
  it("writes chunks that arrive together in order, with one file handle", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "brawzer-chunks-"));
    const writer = new ChunkWriter(path.join(dir, "notes.txt"), 1024);
    // Not awaited one by one: the socket delivers them back to back.
    const writes = [
      writer.write(0, new TextEncoder().encode("hello "), false),
      writer.write(1, new TextEncoder().encode("drive"), false),
      writer.write(2, new Uint8Array(0), true),
    ];
    await Promise.all(writes);
    expect(await writer.done).toBe(11);
    expect(await readFile(path.join(dir, "notes.txt"), "utf8")).toBe("hello drive");
  });

  it("refuses chunks out of order and removes the file", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "brawzer-chunks-"));
    const file = path.join(dir, "bad.bin");
    const writer = new ChunkWriter(file, 1024);
    await writer.write(1, new Uint8Array([1]), true);
    await expect(writer.done).rejects.toThrow("chunk out of order");
    await expect(readFile(file)).rejects.toThrow();
  });

  it("stops at the size limit", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "brawzer-chunks-"));
    const writer = new ChunkWriter(path.join(dir, "big.bin"), 4);
    await writer.write(0, new Uint8Array(3), false);
    await writer.write(1, new Uint8Array(3), true);
    await expect(writer.done).rejects.toThrow("file too large");
  });
});
