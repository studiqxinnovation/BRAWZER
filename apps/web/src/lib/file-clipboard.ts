/**
 * A file "cut" or "copied" from the desktop or Files, waiting to be pasted
 * into another folder: a move when it was cut, a copy when it was copied.
 * Kept for this tab only.
 */
const KEY = "brawzer:file-clipboard";
const listeners = new Set<() => void>();

export interface ClipboardFile {
  id: string;
  name: string;
  folderId: string | null;
  mode: "cut" | "copy";
}

let current: ClipboardFile | null | undefined;

function read(): ClipboardFile | null {
  if (current !== undefined) return current;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const candidate = parsed as Partial<ClipboardFile> | null;
    current =
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      (candidate.mode === "cut" || candidate.mode === "copy")
        ? {
            id: candidate.id,
            name: candidate.name,
            folderId: typeof candidate.folderId === "string" ? candidate.folderId : null,
            mode: candidate.mode,
          }
        : null;
  } catch {
    current = null;
  }
  return current;
}

export const readClipboardFile = (): ClipboardFile | null =>
  typeof window === "undefined" ? null : read();

export function subscribeToClipboardFile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function holdFile(file: ClipboardFile) {
  current = file;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    // Storage blocked: kept in memory for this page.
  }
  for (const listener of listeners) listener();
}

export function clearClipboardFile() {
  current = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
  for (const listener of listeners) listener();
}
