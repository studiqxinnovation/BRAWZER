/**
 * A file "cut" from the desktop or Files, waiting to be pasted into another
 * folder: a move, done when it's pasted. Kept for this tab only.
 */
const KEY = "brawzer:cut-file";
const listeners = new Set<() => void>();

export interface CutFile {
  id: string;
  name: string;
  folderId: string | null;
}

let current: CutFile | null | undefined;

function read(): CutFile | null {
  if (current !== undefined) return current;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    current =
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as CutFile).id === "string" &&
      typeof (parsed as CutFile).name === "string"
        ? (parsed as CutFile)
        : null;
  } catch {
    current = null;
  }
  return current;
}

export const readCutFile = (): CutFile | null => (typeof window === "undefined" ? null : read());

export function cutFile(file: CutFile) {
  current = file;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    // Storage blocked: kept in memory for this page.
  }
  for (const listener of listeners) listener();
}

export function clearCutFile() {
  current = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
  for (const listener of listeners) listener();
}

export function subscribeToCutFile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
