import type { DriveFile } from "@brawzer/contracts";
import type { AppId } from "./registry";

const CODE = /\.(js|mjs|ts|tsx|jsx|py|java|c|h|cpp|cs|go|rs|rb|php|css|json|sql|sh|ya?ml)$/i;

/** Which app opens a Drive file, if any does. */
export function appFor(file: Pick<DriveFile, "name" | "contentType" | "status">): AppId | null {
  if (file.status !== "clean") return null;
  if (file.contentType.startsWith("image/")) return "photos";
  if (file.contentType === "application/pdf") return "pdf-viewer";
  if (file.contentType.startsWith("audio/")) return "music";
  if (file.contentType !== "text/plain") return null;
  if (/\.csv$/i.test(file.name)) return "calc";
  if (/\.html?$/i.test(file.name)) return "writer";
  if (CODE.test(file.name)) return "code";
  return "notepad";
}
