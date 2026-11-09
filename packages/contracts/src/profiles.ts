import { z } from "zod";
import { extensionListSchema } from "./extensions.ts";

/**
 * The colours a profile can have. The web app gives each a shade that keeps
 * a white initial at 4.5:1 contrast or better (a test checks this).
 * Must match the database enum `profile_color`.
 */
export const profileColors = [
  "indigo",
  "teal",
  "copper",
  "violet",
  "navy",
  "rose",
  "green",
  "slate",
] as const;

export const profileColorSchema = z.enum(profileColors, { error: "Choose a colour." });

/**
 * Browser engines. Must match the database enum `browser_engine`. Bee is
 * Brawzer's own browser, built on Chromium; Firefox is the second engine.
 */
export const browserEngines = ["bee", "firefox"] as const;
export const browserEngineSchema = z.enum(browserEngines, { error: "Choose Bee or Firefox." });

/** What each engine is, in the words the pages use. */
export const engineDetails = {
  bee: {
    name: "Bee Browser",
    basis: "Brawzer’s own browser, built on Chromium",
  },
  firefox: {
    name: "Firefox",
    basis: "Mozilla’s engine, for sites and extensions that need it",
  },
} as const satisfies Record<(typeof browserEngines)[number], { name: string; basis: string }>;

/** Temporary limit until plans exist (Phase 6). */
export const MAX_PROFILES = 10;

/** The most a profile's saved browsing data may take (compressed). */
export const MAX_PROFILE_DATA_BYTES = 256 * 1024 * 1024;

/** Control characters and bidirectional overrides could disguise a name. */
const DISGUISING_CHARACTERS = /[\p{Cc}‪-‮⁦-⁩]/u;

export const profileNameSchema = z
  .string({ error: "Give the profile a name." })
  .trim()
  .min(1, "Give the profile a name.")
  .max(40, "Use at most 40 characters.")
  .refine((value) => !DISGUISING_CHARACTERS.test(value), {
    error: "Use letters, numbers, spaces and punctuation.",
  });

export const profileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: profileColorSchema,
  engine: browserEngineSchema,
  position: z.number().int().nonnegative(),
  /** The proxy this profile will browse through (Phase 5), or null. */
  proxyId: z.uuid().nullable(),
  /** Whether cookies, history and site data are kept between sessions. */
  keepData: z.boolean(),
  /**
   * With a proxy: private and internal addresses go to the proxy instead of
   * being refused, so an intranet behind one's own proxy is reachable.
   * Off by default. Without a proxy it has no effect.
   */
  privateThroughProxy: z.boolean(),
  /** Catalogue extensions installed into this profile's sessions (slugs). */
  extensions: z.array(z.string()),
  /** The saved browsing data, if any: how much (compressed) and when it was last saved. */
  data: z
    .object({
      bytes: z.number().int().nonnegative(),
      savedAt: z.iso.datetime(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const profileListSchema = z.object({
  profiles: z.array(profileSchema),
  /** How many profiles the account may have. */
  limit: z.number().int().positive(),
});

export const createProfileRequestSchema = z.object({
  name: profileNameSchema,
  color: profileColorSchema,
  engine: browserEngineSchema.default("bee"),
});

export const updateProfileRequestSchema = z
  .object({
    name: profileNameSchema.optional(),
    color: profileColorSchema.optional(),
    proxyId: z.uuid({ error: "Choose one of your proxies." }).nullable().optional(),
    keepData: z.boolean().optional(),
    privateThroughProxy: z.boolean().optional(),
    extensions: extensionListSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.color !== undefined ||
      value.proxyId !== undefined ||
      value.keepData !== undefined ||
      value.privateThroughProxy !== undefined ||
      value.extensions !== undefined,
    { error: "Change the name, colour, proxy or what is kept." },
  );

export const reorderProfilesRequestSchema = z.object({
  /** Every profile of the account, in the new order. */
  ids: z
    .array(z.uuid({ error: "That isn’t a profile ID." }))
    .min(1, "List the profiles in their new order.")
    .max(MAX_PROFILES, `An account has at most ${String(MAX_PROFILES)} profiles.`)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: "Each profile can appear only once.",
    }),
});

export type ProfileColor = z.infer<typeof profileColorSchema>;
export type BrowserEngine = z.infer<typeof browserEngineSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type ProfileList = z.infer<typeof profileListSchema>;
export type CreateProfileRequest = z.input<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;
