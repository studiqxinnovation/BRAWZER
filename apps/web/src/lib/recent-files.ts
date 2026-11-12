/**
 * The files opened in this tab, for the desktop's "Recent files": kept in
 * sessionStorage, so a shared computer forgets them when the tab closes.
 */
import type { DriveFile } from "@brawzer/contracts";

const KEY = "brawzer:recent-files";
const LIMIT = 12;

export interface RecentFile {
  id: string;
  name: string;
  contentType: string;
  status: DriveFile["status"];
}

export function readRecentFiles(): RecentFile[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is RecentFile =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as RecentFile).id === "string" &&
            typeof (entry as RecentFile).name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentFile(file: RecentFile) {
  try {
    const rest = readRecentFiles().filter((entry) => entry.id !== file.id);
    window.sessionStorage.setItem(KEY, JSON.stringify([file, ...rest].slice(0, LIMIT)));
  } catch {
    // Storage blocked: nothing to remember.
  }
}

export function clearRecentFiles() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
