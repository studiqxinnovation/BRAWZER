import type { DriveFolder } from "@brawzer/contracts";
import { describe, expect, it } from "vitest";
import {
  childFolders,
  describePath,
  describeType,
  folderPath,
  folderSubtree,
  formatBytes,
  previewKind,
  shortName,
} from "./drive";

const folder = (id: string, name: string, parentId: string | null): DriveFolder => ({
  id,
  name,
  parentId,
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
});
const folders = [
  folder("a", "Work", null),
  folder("b", "Reports", "a"),
  folder("c", "2026", "b"),
  folder("d", "Personal", null),
];

describe("formatBytes", () => {
  it("rounds to a sensible precision", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(999)).toBe("999 bytes");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(104_857_600)).toBe("100 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
    expect(formatBytes(1.25 * 1024 ** 2)).toBe("1.3 MB");
  });
});

describe("folder paths", () => {
  it("walks up to the top level", () => {
    expect(folderPath(folders, "c").map((f) => f.name)).toEqual(["Work", "Reports", "2026"]);
    expect(folderPath(folders, null)).toEqual([]);
    expect(folderPath(folders, "missing")).toEqual([]);
    expect(describePath(folders, "b")).toBe("Drive / Work / Reports");
    expect(describePath(folders, null)).toBe("Drive");
  });

  it("survives a cycle in bad data", () => {
    const cyclic = [folder("x", "X", "y"), folder("y", "Y", "x")];
    expect(folderPath(cyclic, "x").length).toBeLessThanOrEqual(2);
  });

  it("lists children and subtrees", () => {
    expect(childFolders(folders, null).map((f) => f.name)).toEqual(["Work", "Personal"]);
    expect([...folderSubtree(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...folderSubtree(folders, "d")]).toEqual(["d"]);
  });
});

describe("previewKind", () => {
  it("picks the viewer for clean, previewable files only", () => {
    expect(previewKind({ contentType: "image/png", previewable: true })).toBe("image");
    expect(previewKind({ contentType: "application/pdf", previewable: true })).toBe("pdf");
    expect(previewKind({ contentType: "text/plain", previewable: true })).toBe("text");
    expect(previewKind({ contentType: "image/png", previewable: false })).toBeNull();
    expect(previewKind({ contentType: "application/zip", previewable: true })).toBeNull();
  });
});

describe("describeType", () => {
  it("names common types plainly", () => {
    expect(describeType("application/octet-stream")).toBe("File");
    expect(describeType("image/jpeg")).toBe("JPEG image");
    expect(describeType("application/pdf")).toBe("PDF");
    expect(describeType("application/x-msdownload")).toBe("Program");
    expect(describeType("application/vnd.oasis.opendocument.text")).toBe(
      "application/vnd.oasis.opendocument.text",
    );
  });
});

describe("shortName", () => {
  it("keeps the extension when shortening", () => {
    expect(shortName("short.pdf")).toBe("short.pdf");
    const long = shortName(`${"a".repeat(60)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(41);
    expect(long.endsWith("….pdf")).toBe(true);
  });
});
