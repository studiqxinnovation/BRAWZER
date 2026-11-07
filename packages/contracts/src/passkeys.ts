import { z } from "zod";

/**
 * WebAuthn options and responses are standard JSON shapes, checked in full
 * by SimpleWebAuthn on the server; here they only pass through.
 */
const webauthnJson = z.record(z.string(), z.unknown());

export const passkeyOptionsResponseSchema = z.object({
  /** Send back with the browser's response; single use, valid for 5 minutes. */
  challengeId: z.uuid(),
  options: webauthnJson,
});

export const passkeyNameSchema = z
  .string({ error: "Give the passkey a name." })
  .trim()
  .min(1, "Give the passkey a name.")
  .max(60, "Use at most 60 characters.");

export const passkeyRegistrationRequestSchema = z.object({
  challengeId: z.uuid({ error: "Start again." }),
  name: passkeyNameSchema.optional(),
  response: webauthnJson,
});

export const passkeySignInRequestSchema = z.object({
  challengeId: z.uuid({ error: "Start again." }),
  keepSignedIn: z.boolean().default(false),
  response: webauthnJson,
});

export const passkeyConfirmationRequestSchema = z.object({
  challengeId: z.uuid({ error: "Start again." }),
  response: webauthnJson,
});

export const passkeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Synced across the owner's devices (for example by iCloud Keychain or Google Password Manager). */
  synced: z.boolean(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});

export const passkeyListSchema = z.object({ passkeys: z.array(passkeySchema) });

export const renamePasskeyRequestSchema = z.object({ name: passkeyNameSchema });

export type PasskeyOptionsResponse = z.infer<typeof passkeyOptionsResponseSchema>;
export type PasskeySignInRequest = z.input<typeof passkeySignInRequestSchema>;
export type Passkey = z.infer<typeof passkeySchema>;
export type PasskeyList = z.infer<typeof passkeyListSchema>;
