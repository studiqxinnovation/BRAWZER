import { currentExam } from "./exam";

/**
 * The desktop's look, per tab like the theme (sessionStorage: a shared
 * computer keeps nothing): Mac or Windows style, the wallpaper, and whether
 * the desktop is used at all. The theme script applies them before first
 * paint (see themeBootstrapScript).
 */

export const desktopStyles = ["mac", "windows"] as const;
export type DesktopStyle = (typeof desktopStyles)[number];

/** Who took a wallpaper's photo, under which licence, and where it came from. */
export interface WallpaperCredit {
  by: string;
  licence: string;
  source: string;
}
interface WallpaperEntry {
  name: string;
  kind: "gradient" | "image";
  group: string;
  credit?: WallpaperCredit;
}

/**
 * The wallpapers: real photographs (public domain, CC0 or CC BY, credited in
 * the picker; JPEG files under /wallpapers, each signed with the mark) and
 * the plain colour washes. A photo of the person's own, kept in Drive, is
 * the one more choice ("photo").
 */
export const wallpapers = {
  brawzer: { name: "Brawzer", kind: "gradient", group: "Colours" },
  bees: {
    name: "Honeycomb",
    kind: "image",
    group: "Brawzer",
    credit: {
      by: "Thomas Bresson",
      licence: "CC BY 2.0",
      source:
        "https://commons.wikimedia.org/wiki/File:ComputerHotline_-_Apis_mellifera_(by)_(1).jpg",
    },
  },
  nebula: {
    name: "Carina Nebula",
    kind: "image",
    group: "Space",
    credit: {
      by: "ESO, R. Gendler and others",
      licence: "CC BY 4.0",
      source: "https://commons.wikimedia.org/wiki/File:ESO_-_The_Carina_Nebula_(by).jpg",
    },
  },
  galaxy: {
    name: "Spiral galaxy",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA, ESA and the Hubble Heritage Team",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:Hubble2005-01-barred-spiral-galaxy-NGC1300.jpg",
    },
  },
  saturn: {
    name: "Saturn",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA/JPL/Space Science Institute",
      licence: "Public domain",
      source: "https://images.nasa.gov/details/PIA06193",
    },
  },
  earth: {
    name: "Earth from orbit",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA Expedition 20 crew",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:ISS-20_Thunderstorms_on_the_Brazilian_Horizon.jpg",
    },
  },
  nightlights: {
    name: "Earth at night",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA",
      licence: "Public domain",
      source: "https://images.nasa.gov/details/iss035e017673",
    },
  },
  startrails: {
    name: "Star trails",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA/Don Pettit",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:International_Space_Station_star_trails_-_JSC2012E039800.jpg",
    },
  },
  orion: {
    name: "Orion and the Moon",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA",
      licence: "Public domain",
      source: "https://images.nasa.gov/details/art001e000669",
    },
  },
  eclipse: {
    name: "Eclipse",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:Solar_eclipse_taken_from_Artemis_II_-_April_2026.jpg",
    },
  },
  northern: {
    name: "Northern lights",
    kind: "image",
    group: "Nature",
    credit: {
      by: "Johannes Groll",
      licence: "CC0",
      source: "https://commons.wikimedia.org/wiki/File:Lofoten,_Norway_(Unsplash).jpg",
    },
  },
  summit: {
    name: "Himalayas",
    kind: "image",
    group: "Nature",
    credit: {
      by: "Vyacheslav Argenberg",
      licence: "CC BY 4.0",
      source:
        "https://commons.wikimedia.org/wiki/File:Mountains_in_snow,_Mountain_lake,_Chola_Valley,_Nepal,_Himalayas.jpg",
    },
  },
  kirkjufell: {
    name: "Kirkjufell",
    kind: "image",
    group: "Nature",
    credit: {
      by: "Jakub Ha\u0142un",
      licence: "CC BY 4.0",
      source: "https://commons.wikimedia.org/wiki/File:Kirkjufell,_Iceland,_20240714_1631_0713.jpg",
    },
  },
  gullfoss: {
    name: "Gullfoss",
    kind: "image",
    group: "Nature",
    credit: {
      by: "Pierre-Selim Huard",
      licence: "CC BY 4.0",
      source: "https://commons.wikimedia.org/wiki/File:Iceland_-_2017-02-22_-_Gullfoss_-_3684.jpg",
    },
  },
  lightning: {
    name: "Lightning",
    kind: "image",
    group: "Nature",
    credit: {
      by: "NOAA Photo Library",
      licence: "Public domain",
      source: "https://commons.wikimedia.org/wiki/File:Lightning_in_Dallas_2015.jpg",
    },
  },
  storm: {
    name: "Storm",
    kind: "image",
    group: "Nature",
    credit: {
      by: "Maxime Raynal",
      licence: "CC BY 2.0",
      source:
        "https://commons.wikimedia.org/wiki/File:Port_and_lighthouse_overnight_storm_with_lightning_in_Port-la-Nouvelle.jpg",
    },
  },
  eagle: {
    name: "Bald eagle",
    kind: "image",
    group: "Wildlife",
    credit: {
      by: "Andy Morffew",
      licence: "CC BY 2.0",
      source: "https://commons.wikimedia.org/wiki/File:Bald_eagle_in_Alaska_2016-3.jpg",
    },
  },
  tiger: {
    name: "Tigers",
    kind: "image",
    group: "Wildlife",
    credit: {
      by: "Dave Pape",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:Panthera_tigris_altaica_13_-_Buffalo_Zoo.jpg",
    },
  },
  wolf: {
    name: "Wolf",
    kind: "image",
    group: "Wildlife",
    credit: {
      by: "Jim Clark, U.S. Fish and Wildlife Service",
      licence: "Public domain",
      source: "https://commons.wikimedia.org/wiki/File:Mexican_Wolf_2_yfb-edit_1.jpg",
    },
  },
  elephant: {
    name: "Elephants",
    kind: "image",
    group: "Wildlife",
    credit: {
      by: "Geoff Gallice",
      licence: "CC BY 2.0",
      source:
        "https://commons.wikimedia.org/wiki/File:Loxodonta_africana_South_Luangwa_National_Park_(1).jpg",
    },
  },
  tokyo: {
    name: "Tokyo",
    kind: "image",
    group: "City",
    credit: {
      by: "David Kernan",
      licence: "CC BY 4.0",
      source: "https://commons.wikimedia.org/wiki/File:Tokyo_Tower,_Minato_City.jpg",
    },
  },
  jet: {
    name: "F-22 Raptor",
    kind: "image",
    group: "Military",
    credit: {
      by: "U.S. Air Force, Andy Dunaway",
      licence: "Public domain",
      source: "https://commons.wikimedia.org/wiki/File:F-22_Raptor_edit1.jpg",
    },
  },
  carrier: {
    name: "Carrier deck",
    kind: "image",
    group: "Military",
    credit: {
      by: "U.S. Navy, August Clawson",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:FA-18F_Super_Hornet_of_VFA-103_makes_a_touch_and_go_landing_aboard_USS_George_Washington_(CVN-73)_in_the_Atlantic_Ocean,_6_December_2023_(231206-N-VX022-1050).JPG",
    },
  },
  thunderbirds: {
    name: "Thunderbirds",
    kind: "image",
    group: "Military",
    credit: {
      by: "David Armer",
      licence: "Public domain",
      source: "https://commons.wikimedia.org/wiki/File:U_S_Air_Force_Thunderbirds.jpg",
    },
  },
  olympiastadion: {
    name: "Olympiastadion",
    kind: "image",
    group: "Sport",
    credit: {
      by: "Tobi 87",
      licence: "CC BY 3.0",
      source: "https://commons.wikimedia.org/wiki/File:Berliner_Olympiastadion_night.jpg",
    },
  },
  everest: {
    name: "Everest",
    kind: "image",
    group: "Nature",
    credit: {
      by: "Vyacheslav Argenberg",
      licence: "CC BY 4.0",
      source:
        "https://commons.wikimedia.org/wiki/File:Everest,_Nuptse,_Khumbu_Glacier,_Nepal,_Himalayas.jpg",
    },
  },
  spruce: {
    name: "Spruce forest",
    kind: "image",
    group: "Nature",
    credit: {
      by: "W.carter",
      licence: "CC0",
      source: "https://commons.wikimedia.org/wiki/File:Spruce_forest_at_Holma.jpg",
    },
  },
  worldcup: {
    name: "Maracanã",
    kind: "image",
    group: "Sport",
    credit: {
      by: "Danilo Borges/copa2014.gov.br Licen\u00e7a Creative Commons Atribui\u00e7\u00e3o 3.0 Brasil",
      licence: "CC BY 3.0",
      source:
        "https://commons.wikimedia.org/wiki/File:Germany_and_Argentina_face_off_in_the_final_of_the_World_Cup_2014_-2014-07-13_(5).jpg",
    },
  },
  triplejump: {
    name: "Triple jump",
    kind: "image",
    group: "Sport",
    credit: {
      by: "Marie-Lan Nguyen",
      licence: "CC BY 3.0",
      source:
        "https://commons.wikimedia.org/wiki/File:Men_triple_jump_French_Athletics_Championships_2013_t154029.jpg",
    },
  },
  b2: {
    name: "B-2 Spirit",
    kind: "image",
    group: "Military",
    credit: {
      by: "U.S. Air Force, Keith James",
      licence: "Public domain",
      source:
        "https://commons.wikimedia.org/wiki/File:2nd_Air_Refueling_Squadron_refuels_B-2%27s_161110-F-GV347-141.jpg",
    },
  },
  launchpad: {
    name: "Launch pad",
    kind: "image",
    group: "Space",
    credit: {
      by: "NASA, Bill Ingalls",
      licence: "Public domain",
      source: "https://commons.wikimedia.org/wiki/File:Brightly_lit_STS-135_on_launch_pad_39a.jpg",
    },
  },

  aurora: { name: "Aurora", kind: "gradient", group: "Colours" },
  dusk: { name: "Dusk", kind: "gradient", group: "Colours" },
  ocean: { name: "Ocean", kind: "gradient", group: "Colours" },
  forest: { name: "Forest", kind: "gradient", group: "Colours" },
  sunrise: { name: "Sunrise", kind: "gradient", group: "Colours" },
  graphite: { name: "Graphite", kind: "gradient", group: "Colours" },
  sand: { name: "Sand", kind: "gradient", group: "Colours" },
} as const satisfies Record<string, WallpaperEntry>;
export type Wallpaper = keyof typeof wallpapers;
/** A wallpaper's entry, with its credit where the photo has one. */
export const wallpaperEntry = (key: Wallpaper): WallpaperEntry => wallpapers[key];
/** The drawn scenes' keys, for the theme script that sets one before first paint. */
export const imageWallpapers = (Object.keys(wallpapers) as Wallpaper[]).filter(
  (key) => wallpapers[key].kind === "image",
);
export const wallpaperUrl = (key: Wallpaper) => `/wallpapers/${key}.jpg`;
export const photoWallpaperUrl = (fileId: string) =>
  `/api/v1/drive/files/${encodeURIComponent(fileId)}/preview`;

/** What is on the desktop: a named wallpaper, or the person's photo (a Drive file). */
export type WallpaperChoice = { kind: "named"; key: Wallpaper } | { kind: "photo"; fileId: string };

const PHOTO_KEY = "brawzer:wallpaper-photo";
const UUID = /^[0-9a-f-]{36}$/i;

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

/** The style this tab was set to, if one was chosen here (not just guessed from the computer). */
export function chosenDesktopStyle(): DesktopStyle | null {
  try {
    const value = sessionStorage.getItem("brawzer:desktop-style");
    return value === "mac" || value === "windows" ? value : null;
  } catch {
    return null;
  }
}

export function setDesktopStyle(style: DesktopStyle) {
  document.documentElement.dataset.desktopStyle = style;
  remember("brawzer:desktop-style", style);
  changed();
}

export function readWallpaper(): Wallpaper | "photo" {
  const value = document.documentElement.dataset.wallpaper;
  if (value === "photo") return "photo";
  return value && value in wallpapers ? (value as Wallpaper) : "brawzer";
}

/** The Drive file behind "photo", when that is the wallpaper. */
export function readWallpaperPhoto(): string | null {
  try {
    const id = sessionStorage.getItem(PHOTO_KEY);
    return id && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

let lastChoice: WallpaperChoice | null = null;
/** The same object until the choice changes, so a store snapshot stays stable. */
export function readWallpaperChoice(): WallpaperChoice {
  const current = readWallpaper();
  const photo = readWallpaperPhoto();
  const next: WallpaperChoice =
    current === "photo" && photo
      ? { kind: "photo", fileId: photo }
      : { kind: "named", key: current === "photo" ? "brawzer" : current };
  const same =
    lastChoice?.kind === "photo"
      ? next.kind === "photo" && next.fileId === lastChoice.fileId
      : lastChoice?.kind === "named" && next.kind === "named" && next.key === lastChoice.key;
  if (same && lastChoice) return lastChoice;
  lastChoice = next;
  return next;
}

/** Sets the picture itself on the document, as the theme script does before first paint. */
function applyImage(url: string | null) {
  const root = document.documentElement;
  if (url) {
    root.dataset.wallpaperKind = "image";
    root.style.setProperty("--wallpaper-image", `url("${url}")`);
  } else {
    delete root.dataset.wallpaperKind;
    root.style.removeProperty("--wallpaper-image");
  }
}

export function setWallpaper(wallpaper: Wallpaper) {
  if (wallpaper === "brawzer") delete document.documentElement.dataset.wallpaper;
  else document.documentElement.dataset.wallpaper = wallpaper;
  applyImage(wallpapers[wallpaper].kind === "image" ? wallpaperUrl(wallpaper) : null);
  remember("brawzer:wallpaper", wallpaper);
  remember(PHOTO_KEY, null);
  changed();
}

/** A photo from Drive as the wallpaper: its id is remembered, the picture served from Drive. */
export function setWallpaperPhoto(fileId: string) {
  if (!UUID.test(fileId)) return;
  document.documentElement.dataset.wallpaper = "photo";
  applyImage(photoWallpaperUrl(fileId));
  remember("brawzer:wallpaper", "photo");
  remember(PHOTO_KEY, fileId);
  changed();
}

/** Whether this tab picked a wallpaper itself (then the account's doesn't override it). */
export function tabChoseWallpaper(): boolean {
  try {
    return sessionStorage.getItem("brawzer:wallpaper") !== null;
  } catch {
    return false;
  }
}

export function applyWallpaperChoice(choice: WallpaperChoice) {
  if (choice.kind === "photo") setWallpaperPhoto(choice.fileId);
  else setWallpaper(choice.key);
}

/** False when the person chose the plain layout ("Use the classic layout"). */
export function readDesktopOn(): boolean {
  return document.documentElement.dataset.desktop !== "off";
}

export function setDesktopOn(on: boolean) {
  // Exam Mode keeps to the desktop until its time is up.
  if (!on && currentExam()) return;
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
