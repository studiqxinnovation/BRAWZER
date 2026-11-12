/**
 * Appearance preferences (theme and accent).
 *
 * Choices are kept in sessionStorage: they last while this tab is open and are
 * gone when the browser closes, so a shared computer keeps nothing. Signed-in
 * users will get a server-side preference with their account.
 */

import { imageWallpapers } from "./desktop";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];

export const accentNames = ["cobalt", "copper", "glacier"] as const;
export type AccentName = (typeof accentNames)[number];

export const DEFAULT_ACCENT: AccentName = "cobalt";

const THEME_KEY = "brawzer:theme";
const ACCENT_KEY = "brawzer:accent";
const CHANGE_EVENT = "brawzer:appearance-change";

/**
 * Inlined in <head> so a stored preference applies before first paint and the
 * page never flashes the wrong theme. Plain ES2017 for older browsers.
 */
export const themeBootstrapScript = `(function(){var d=document.documentElement;d.dataset.desktopStyle=/Mac|iPhone|iPad/.test(navigator.platform)?"mac":"windows";try{var s=window.sessionStorage,t=s.getItem("${THEME_KEY}"),a=s.getItem("${ACCENT_KEY}"),o=s.getItem("brawzer:desktop-style"),w=s.getItem("brawzer:wallpaper");if(t==="light"||t==="dark")d.dataset.theme=t;if(${JSON.stringify(accentNames)}.indexOf(a)!==-1)d.dataset.accent=a;if(o==="mac"||o==="windows")d.dataset.desktopStyle=o;if(s.getItem("brawzer:desktop")==="off")d.dataset.desktop="off";if(w&&w!=="brawzer"&&/^[a-z]{1,20}$/.test(w)){d.dataset.wallpaper=w;if(${JSON.stringify(imageWallpapers)}.indexOf(w)!==-1){d.dataset.wallpaperKind="image";d.style.setProperty("--wallpaper-image","url(/wallpapers/"+w+".jpg)")}else if(w==="photo"){var ph=s.getItem("brawzer:wallpaper-photo");if(ph&&/^[0-9a-f-]{36}$/i.test(ph)){d.dataset.wallpaperKind="image";d.style.setProperty("--wallpaper-image","url(/api/v1/drive/files/"+ph+"/preview)")}else delete d.dataset.wallpaper}}var p=location.pathname;if(p==="/app"&&!s.getItem("brawzer:dash")&&d.dataset.desktop!=="off"&&matchMedia("(min-width: 64rem)").matches)d.dataset.desk="1";if(p.indexOf("/app")===0&&p.indexOf("/app/browser/window")!==0&&!s.getItem("brawzer:booted")&&d.dataset.desktop!=="off"&&matchMedia("(min-width: 64rem)").matches&&!matchMedia("(prefers-reduced-motion: reduce)").matches){d.dataset.boot="1";s.setItem("brawzer:booted","1")}}catch(e){}})();`;

export function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.some((preference) => preference === value);
}

export function isAccentName(value: unknown): value is AccentName {
  return accentNames.some((accent) => accent === value);
}

export function readThemePreference(): ThemePreference {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}

export function readAccent(): AccentName {
  const value = document.documentElement.dataset.accent;
  return isAccentName(value) ? value : DEFAULT_ACCENT;
}

/**
 * Switches every colour at once. Without this, elements with colour
 * transitions fade over 150 ms while the rest snap, which looks uneven and
 * briefly shows low-contrast in-between colours.
 */
export function switchAppearanceInstantly(apply: () => void = () => undefined): void {
  const root = document.documentElement;
  root.dataset.appearanceSwitching = "";
  apply();
  // Reading a computed style forces the browser to apply the change while
  // transitions are still off.
  getComputedStyle(root).getPropertyValue("color");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      delete root.dataset.appearanceSwitching;
    });
  });
}

export function setThemePreference(preference: ThemePreference): void {
  switchAppearanceInstantly(() => {
    const root = document.documentElement;
    if (preference === "system") delete root.dataset.theme;
    else root.dataset.theme = preference;
  });
  persist(THEME_KEY, preference === "system" ? null : preference);
  notify();
}

export function setAccent(accent: AccentName): void {
  switchAppearanceInstantly(() => {
    document.documentElement.dataset.accent = accent;
  });
  persist(ACCENT_KEY, accent === DEFAULT_ACCENT ? null : accent);
  notify();
}

/** Applies the same instant switch when the operating system changes light/dark. */
export function watchSystemColorScheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    switchAppearanceInstantly();
  };
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

/** Subscribes to theme, accent and operating-system colour-scheme changes. */
export function subscribeToAppearance(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(CHANGE_EVENT, onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    media.removeEventListener("change", onChange);
  };
}

/** The theme actually on screen, resolving "system" through the OS setting. */
export function resolveTheme(): "light" | "dark" {
  const preference = readThemePreference();
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function persist(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked (private mode, kiosk policies): the choice lasts for this page only.
  }
}

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
