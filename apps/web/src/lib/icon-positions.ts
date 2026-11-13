/**
 * Where the desktop's icons were dragged to, for this tab: a shared computer
 * forgets them with the tab. "Clean up icons" puts every icon back in its column.
 */
const KEY = "brawzer:icon-positions";
const listeners = new Set<() => void>();

export type IconPositions = Readonly<Record<string, { x: number; y: number }>>;

let current: IconPositions | undefined;
const EMPTY: IconPositions = {};

function load(): IconPositions {
  if (current) return current;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    current = typeof parsed === "object" && parsed !== null ? (parsed as IconPositions) : EMPTY;
  } catch {
    current = EMPTY;
  }
  return current;
}

function save(next: IconPositions) {
  current = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: kept in memory for this page.
  }
  for (const listener of listeners) listener();
}

export const readIconPositions = (): IconPositions =>
  typeof window === "undefined" ? EMPTY : load();
export const noIconPositions = (): IconPositions => EMPTY;

export function setIconPosition(key: string, position: { x: number; y: number }) {
  save({ ...load(), [key]: position });
}

export function clearIconPositions() {
  save(EMPTY);
}

export function subscribeToIconPositions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
