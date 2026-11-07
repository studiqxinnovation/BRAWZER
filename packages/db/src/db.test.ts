import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, hasMigrations } from "./index.ts";

describe("hasMigrations", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function tempFolder(): string {
    const folder = mkdtempSync(path.join(tmpdir(), "brawzer-migrations-"));
    folders.push(folder);
    return folder;
  }

  it("is false before any migration has been generated", () => {
    expect(hasMigrations(tempFolder())).toBe(false);
  });

  it("is true once drizzle-kit has written a journal", () => {
    const folder = tempFolder();
    mkdirSync(path.join(folder, "meta"));
    writeFileSync(path.join(folder, "meta", "_journal.json"), "{}");
    expect(hasMigrations(folder)).toBe(true);
  });
});

describe("createDatabase", () => {
  it("creates a pool without connecting until it is used", async () => {
    const database = createDatabase({ url: "postgres://user:pass@127.0.0.1:1/none" });
    expect(database.pool.totalCount).toBe(0);
    await database.close();
  });

  it("reports an unreachable database through ping()", async () => {
    // Port 1 is reserved and nothing listens on it, so the connection is refused quickly.
    const database = createDatabase({ url: "postgres://user:pass@127.0.0.1:1/none" });
    await expect(database.ping()).rejects.toThrow();
    await database.close();
  });
});
