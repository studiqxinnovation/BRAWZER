import { type DriveFile, OFFICE_TYPES } from "@brawzer/contracts";
import type { AppId } from "./registry";

const CODE = /\.(js|mjs|ts|tsx|jsx|py|java|c|h|cpp|cs|go|rs|rb|php|css|json|sql|sh|ya?ml)$/i;

/** Which app opens a Drive file, if any does. */
export function appFor(file: Pick<DriveFile, "name" | "contentType" | "status">): AppId | null {
  if (file.status !== "clean") return null;
  if (file.contentType.startsWith("image/")) return "photos";
  if (file.contentType === "application/pdf") return "pdf-viewer";
  if (file.contentType.startsWith("audio/")) return "music";
  if (file.contentType === OFFICE_TYPES.word) return "writer";
  if (file.contentType === OFFICE_TYPES.excel) return "calc";
  if (file.contentType === OFFICE_TYPES.powerpoint) return "slides";
  if (file.contentType !== "text/plain") return null;
  if (/\.csv$/i.test(file.name)) return "calc";
  if (/\.slides$/i.test(file.name)) return "slides";
  if (/\.html?$/i.test(file.name)) return "writer";
  if (CODE.test(file.name)) return "code";
  return "notepad";
}
