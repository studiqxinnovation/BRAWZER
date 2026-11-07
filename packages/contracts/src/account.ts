import { z } from "zod";
import { emailLinkTokenSchema, emailSchema } from "./auth.ts";
import { securityEventSchema } from "./security.ts";

export const changeEmailRequestSchema = z.object({ email: emailSchema });

export const confirmEmailChangeRequestSchema = z.object({ token: emailLinkTokenSchema });

export const confirmEmailChangeResponseSchema = z.object({ email: z.email() });

export const deleteAccountRequestSchema = z.object({
  /** Typed by the person to confirm they mean it. */
  email: z
    .string({ error: "Type your email address to confirm." })
    .trim()
    .min(1, "Type your email address to confirm."),
});

/** Everything Brawzer holds about the account, except secrets. */
export const accountExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  account: z.object({
    id: z.uuid(),
    email: z.email(),
    emailVerified: z.boolean(),
    createdAt: z.iso.datetime(),
  }),
  twoFactor: z.object({ enabled: z.boolean(), recoveryCodesRemaining: z.number().int() }),
  passkeys: z.array(
    z.object({
      name: z.string(),
      synced: z.boolean(),
      createdAt: z.iso.datetime(),
      lastUsedAt: z.iso.datetime().nullable(),
    }),
  ),
  sessions: z.array(
    z.object({
      device: z.string().nullable(),
      ipAddress: z.string().nullable(),
      createdAt: z.iso.datetime(),
      lastActiveAt: z.iso.datetime(),
    }),
  ),
  securityHistory: z.array(securityEventSchema),
  profiles: z.array(z.record(z.string(), z.unknown())),
  proxies: z.array(z.record(z.string(), z.unknown())),
});

export const recommendationSchema = z.object({
  id: z.enum(["add_passkey", "enable_two_factor", "recovery_codes_low", "review_devices"]),
});

export const securityOverviewSchema = z.object({
  passkeys: z.number().int().nonnegative(),
  twoFactorEnabled: z.boolean(),
  recoveryCodesRemaining: z.number().int().nonnegative(),
  signedInDevices: z.number().int().nonnegative(),
  /** Wrong passwords or codes in the last 7 days. */
  recentFailedAttempts: z.number().int().nonnegative(),
  recommendations: z.array(recommendationSchema),
  /** Sign-ins from a new device or network in the last 30 days. */
  newDeviceSignIns: z.array(securityEventSchema),
});

export type AccountExport = z.infer<typeof accountExportSchema>;
export type SecurityOverview = z.infer<typeof securityOverviewSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
