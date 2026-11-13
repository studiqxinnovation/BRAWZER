import type { DriveFile, DriveFolder } from "@brawzer/contracts";

/** "1.2 MB", "340 KB", "2 GB": binary units named the way people say them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${String(bytes)} bytes`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1);
  return `${String(rounded).replace(/\.0$/, "")} ${units[unit] ?? "TB"}`;
}

/** The folder and its ancestors, top level first. Unknown IDs give an empty path. */
export function folderPath(
  folders: readonly DriveFolder[],
  folderId: string | null,
): DriveFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: DriveFolder[] = [];
  const seen = new Set<string>();
  for (let current = folderId; current && !seen.has(current);) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) return [];
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

/** "Drive / Work / Reports" for showing where something lives. */
export function describePath(folders: readonly DriveFolder[], folderId: string | null): string {
  return ["Drive", ...folderPath(folders, folderId).map((folder) => folder.name)].join(" / ");
}

export function childFolders(
  folders: readonly DriveFolder[],
  parentId: string | null,
): DriveFolder[] {
  return folders.filter((folder) => folder.parentId === parentId);
}

/** The folder and every folder below it: where it can't be moved to. */
export function folderSubtree(folders: readonly DriveFolder[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

export type PreviewKind = "image" | "pdf" | "text";

/** How to show a previewable file. Null for everything else. */
export function previewKind(
  file: Pick<DriveFile, "contentType" | "previewable">,
): PreviewKind | null {
  if (!file.previewable) return null;
  if (file.contentType.startsWith("image/")) return "image";
  if (file.contentType === "application/pdf") return "pdf";
  if (file.contentType === "text/plain") return "text";
  return null;
}

/** A short, honest description of a file's type from its sniffed content type. */
export function describeType(contentType: string): string {
  if (contentType === "application/octet-stream") return "File";
  if (contentType === "text/plain") return "Text";
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "application/zip") return "ZIP archive";
  if (contentType === "application/gzip") return "Gzip archive";
  if (contentType.startsWith("image/")) return `${contentType.slice(6).toUpperCase()} image`;
  if (contentType.startsWith("audio/")) return "Audio";
  if (contentType.startsWith("video/")) return "Video";
  if (contentType.includes("wordprocessingml")) return "Word document";
  if (contentType.includes("spreadsheetml")) return "Spreadsheet";
  if (contentType.includes("presentationml")) return "Presentation";
  if (contentType.startsWith("application/x-") || contentType.includes("executable")) {
    return "Program";
  }
  return contentType;
}

/** Puts a file's name into a sentence without it running on forever. */
export function shortName(name: string, max = 40): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  return `${name.slice(0, max - extension.length - 1).trimEnd()}…${extension}`;
}
