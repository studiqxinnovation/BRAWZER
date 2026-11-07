import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function sourceFiles(): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx") && !file.includes("node_modules"))
    .map((file) => path.join(root, file));
}

describe("forms", () => {
  // A form submitted before the page is interactive is sent by the browser
  // itself. With the default GET, its fields (passwords included) would land
  // in the address bar, the history of a shared computer and server logs.
  it("all use POST, so nothing typed can end up in a URL", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      for (const tag of readFileSync(file, "utf8").match(/<form\b[^>]*>/g) ?? []) {
        if (!/\bmethod="post"/.test(tag)) offenders.push(`${path.relative(root, file)}: ${tag}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
