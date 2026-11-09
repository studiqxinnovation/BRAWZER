import { z } from "zod";

/**
 * Brawzer's extension catalogue: open-source extensions reviewed by the
 * project, pinned to a release at least seven days old (ADR 0003) and to its
 * SHA-256, fetched into the runtime image at build time and installed into a
 * profile's session by the agent. Nothing installs from a store. Adding an
 * entry is a code change with a review.
 */
export interface CatalogueBuild {
  /** The release asset, as the project publishes it. */
  url: string;
  sha256: string;
  version: string;
  /** Chromium takes an unpacked zip; Firefox a signed xpi. */
  kind: "zip" | "xpi";
  /** Firefox's add-on id from the manifest; Chromium's id is derived from the install path. */
  id?: string;
}

export interface CatalogueEntry {
  slug: string;
  name: string;
  summary: string;
  licence: string;
  homepage: string;
  bee: CatalogueBuild | null;
  firefox: CatalogueBuild | null;
}

export const EXTENSION_CATALOGUE: readonly CatalogueEntry[] = [
  {
    slug: "ubo-lite",
    name: "uBlock Origin Lite",
    summary:
      "Blocks ads and trackers with the filter lists you choose, within what Chromium’s newer extension model allows.",
    licence: "GPL-3.0",
    homepage: "https://github.com/uBlockOrigin/uBOL-home",
    bee: {
      url: "https://github.com/uBlockOrigin/uBOL-home/releases/download/2026.1026.1812/uBOLite_2026.1026.1812.chromium.zip",
      sha256: "d3788eac9f0a44c67f3745a43c3fd446ef33d56b1121f469b19e0fa0a836c2b5",
      version: "2026.1026.1812",
      kind: "zip",
    },
    firefox: {
      url: "https://github.com/uBlockOrigin/uBOL-home/releases/download/2026.1026.1812/uBOLite_2026.1026.1812.firefox.signed.xpi",
      sha256: "b146e91f7221e25993388ddb0ed53772c24d5d2aa1c85215bdc1ca11c493d306",
      version: "2026.1026.1812",
      kind: "xpi",
      id: "uBOLiteRedux@raymondhill.net",
    },
  },
  {
    slug: "ublock-origin",
    name: "uBlock Origin",
    summary:
      "The full ad and tracker blocker, with cosmetic filtering. Firefox only: Chromium no longer runs its extension model.",
    licence: "GPL-3.0",
    homepage: "https://github.com/gorhill/uBlock",
    bee: null,
    firefox: {
      url: "https://github.com/gorhill/uBlock/releases/download/1.75.0/uBlock0_1.75.0.firefox.signed.xpi",
      sha256: "5b74415860456370644bd80f16125e865b0e6c356bb5dfcfb84069967eaa5287",
      version: "1.75.0",
      kind: "xpi",
      id: "uBlock0@raymondhill.net",
    },
  },
  {
    slug: "dark-reader",
    name: "Dark Reader",
    summary: "Dark mode for every website, with brightness and contrast you set.",
    licence: "MIT",
    homepage: "https://github.com/darkreader/darkreader",
    bee: {
      url: "https://github.com/darkreader/darkreader/releases/download/v4.9.134/darkreader-chrome-mv3.zip",
      sha256: "40402188ad23154a1b8fa094171f2b6908209ed6673ccf58276b75ce661acfaf",
      version: "4.9.134",
      kind: "zip",
    },
    firefox: {
      url: "https://github.com/darkreader/darkreader/releases/download/v4.9.134/darkreader-firefox.xpi",
      sha256: "911246673307a2de002b6d846bf4f8f245b7f5948491d3878283250b9b70ba26",
      version: "4.9.134",
      kind: "xpi",
      id: "addon@darkreader.org",
    },
  },
];

export const extensionSlugs = EXTENSION_CATALOGUE.map((entry) => entry.slug);

export const extensionSlugSchema = z.string().refine((slug) => extensionSlugs.includes(slug), {
  error: "That extension isn’t in the catalogue.",
});

/** Up to the whole catalogue, each once. */
export const extensionListSchema = z
  .array(extensionSlugSchema)
  .max(EXTENSION_CATALOGUE.length)
  .refine((slugs) => new Set(slugs).size === slugs.length, { error: "Each extension once." });

/** The catalogue entries an engine can run. */
// The engine is named, not imported from profiles.ts, which imports this module.
export function extensionsFor(engine: "bee" | "firefox"): CatalogueEntry[] {
  return EXTENSION_CATALOGUE.filter((entry) => entry[engine] !== null);
}

export function catalogueEntry(slug: string): CatalogueEntry | undefined {
  return EXTENSION_CATALOGUE.find((entry) => entry.slug === slug);
}
