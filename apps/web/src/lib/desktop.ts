/**
 * The desktop's look, per tab like the theme (sessionStorage: a shared
 * computer keeps nothing): Mac or Windows style, the wallpaper, and whether
 * the desktop is used at all. The theme script applies them before first
 * paint (see themeBootstrapScript).
 */

export const desktopStyles = ["mac", "windows"] as const;
export type DesktopStyle = (typeof desktopStyles)[number];

export const wallpapers = {
  brawzer: { name: "Brawzer" },
  aurora: { name: "Aurora" },
  dusk: { name: "Dusk" },
  ocean: { name: "Ocean" },
  forest: { name: "Forest" },
  sunrise: { name: "Sunrise" },
  graphite: { name: "Graphite" },
  sand: { name: "Sand" },
} as const;
export type Wallpaper = keyof typeof wallpapers;

const CHANGE_EVENT = "brawzer:desktop-change";

function remember(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
}

function changed() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readDesktopStyle(): DesktopStyle {
  return document.documentElement.dataset.desktopStyle === "windows" ? "windows" : "mac";
}

export function setDesktopStyle(style: DesktopStyle) {
  document.documentElement.dataset.desktopStyle = style;
  remember("brawzer:desktop-style", style);
  changed();
}

export function readWallpaper(): Wallpaper {
  const value = document.documentElement.dataset.wallpaper;
  return value && value in wallpapers ? (value as Wallpaper) : "brawzer";
}

export function setWallpaper(wallpaper: Wallpaper) {
  if (wallpaper === "brawzer") delete document.documentElement.dataset.wallpaper;
  else document.documentElement.dataset.wallpaper = wallpaper;
  remember("brawzer:wallpaper", wallpaper === "brawzer" ? null : wallpaper);
  changed();
}

/** False when the person chose the plain layout ("Use the classic layout"). */
export function readDesktopOn(): boolean {
  return document.documentElement.dataset.desktop !== "off";
}

export function setDesktopOn(on: boolean) {
  if (on) delete document.documentElement.dataset.desktop;
  else document.documentElement.dataset.desktop = "off";
  remember("brawzer:desktop", on ? null : "off");
  changed();
}

export function subscribeToDesktop(onChange: () => void): () => void {
  const wide = window.matchMedia("(min-width: 64rem)");
  window.addEventListener(CHANGE_EVENT, onChange);
  wide.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    wide.removeEventListener("change", onChange);
  };
}

/** The desktop is in use: a wide enough screen, and not switched off. */
export function desktopActive(): boolean {
  return readDesktopOn() && window.matchMedia("(min-width: 64rem)").matches;
}
