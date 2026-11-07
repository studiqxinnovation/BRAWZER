import { z } from "zod";

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
 * Browser engines. Must match the database enum `browser_engine`. Only
 * Chromium runs today; Firefox arrives with WebRTC streaming in Phase 3b.
 */
export const browserEngines = ["chromium", "firefox"] as const;
export const browserEngineSchema = z.enum(browserEngines);

/** What can be chosen now. */
const availableEngineSchema = z.literal("chromium", {
  error: "Chromium is the only engine available today.",
});

/** Temporary limit until plans exist (Phase 6). */
export const MAX_PROFILES = 10;

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
  engine: availableEngineSchema.default("chromium"),
});

export const updateProfileRequestSchema = z
  .object({
    name: profileNameSchema.optional(),
    color: profileColorSchema.optional(),
    proxyId: z.uuid({ error: "Choose one of your proxies." }).nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.color !== undefined || value.proxyId !== undefined,
    { error: "Change the name, colour or proxy." },
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
