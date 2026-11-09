import { z } from "zod";
import { emailLinkTokenSchema, emailSchema, newPasswordSchema } from "./auth.ts";
import { driveFileStatusSchema } from "./drive.ts";
import { browserEngineSchema, profileColorSchema } from "./profiles.ts";
import { proxyKindSchema, proxyProtocolSchema, proxyRotationSchema } from "./proxies.ts";
import { securityEventSchema } from "./security.ts";

export const changeEmailRequestSchema = z.object({ email: emailSchema });

export const confirmEmailChangeRequestSchema = z.object({ token: emailLinkTokenSchema });

export const confirmEmailChangeResponseSchema = z.object({ email: z.email() });

/** From the link sent to the old address: restores it and sets a new password. */
export const undoEmailChangeRequestSchema = z.object({
  token: emailLinkTokenSchema,
  password: newPasswordSchema,
});

export const undoEmailChangeResponseSchema = z.object({ email: z.email() });

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
  profiles: z.array(
    z.object({
      name: z.string(),
      color: profileColorSchema,
      engine: browserEngineSchema,
      extensions: z.array(z.string()),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  /** Never credentials: only whether some are saved. */
  proxies: z.array(
    z.object({
      name: z.string(),
      protocol: proxyProtocolSchema,
      host: z.string(),
      port: z.number().int(),
      kind: proxyKindSchema,
      rotation: proxyRotationSchema,
      hasCredentials: z.boolean(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  /** The account's site rules: blocked hosts, and the allowed hosts that restrict browsing when any exist. */
  siteRules: z.array(
    z.object({ kind: z.enum(["allow", "block"]), host: z.string(), createdAt: z.iso.datetime() }),
  ),
  /** Pages reported to Brawzer's team; a picture is listed, not repeated here. */
  pageReports: z.array(
    z.object({
      kind: z.enum(["broken", "blocked", "other"]),
      message: z.string(),
      url: z.string().nullable(),
      createdAt: z.iso.datetime(),
      closedAt: z.iso.datetime().nullable(),
      hasPicture: z.boolean(),
    }),
  ),
  /** Drive's records only; the files themselves are saved from Drive. */
  drive: z.object({
    folders: z.array(z.object({ path: z.string(), createdAt: z.iso.datetime() })),
    files: z.array(
      z.object({
        path: z.string(),
        size: z.number().int().nonnegative(),
        contentType: z.string(),
        status: driveFileStatusSchema,
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
  /** Cloud browser sessions: when they ran and why they ended. Never what was browsed. */
  browserSessions: z.array(
    z.object({
      engine: z.string(),
      startedAt: z.iso.datetime(),
      endedAt: z.iso.datetime().nullable(),
      endReason: z.string().nullable(),
    }),
  ),
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
