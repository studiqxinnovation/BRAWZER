import { z } from "zod";

/** Must match the database enums of the same names (a test in the API enforces this). */
export const proxyProtocols = ["http", "https", "socks4", "socks4a", "socks5"] as const;
export const proxyKinds = ["unspecified", "residential", "datacenter", "mobile"] as const;
export const proxyRotations = ["unknown", "static", "rotating"] as const;

/** Why a proxy test failed. Each comes with a plain-language message. */
export const proxyTestReasons = [
  "invalid_host",
  "dns_failed",
  "blocked_address",
  "timeout",
  "connection_refused",
  "connection_failed",
  "tls_failed",
  "auth_failed",
  "proxy_error",
  "destination_failed",
  "invalid_response",
] as const;

export const proxyProtocolSchema = z.enum(proxyProtocols, { error: "Choose a protocol." });
export const proxyKindSchema = z.enum(proxyKinds, { error: "Choose a type." });
export const proxyRotationSchema = z.enum(proxyRotations, { error: "Choose a rotation." });
export const proxyTestReasonSchema = z.enum(proxyTestReasons);

/** Temporary limit until plans exist (Phase 6). */
export const MAX_PROXIES = 20;

const CONTROL_CHARACTERS = /\p{Cc}/u;

export const proxyNameSchema = z
  .string({ error: "Give the proxy a name." })
  .trim()
  .min(1, "Give the proxy a name.")
  .max(40, "Use at most 40 characters.")
  .refine((value) => !/[\p{Cc}‪-‮⁦-⁩]/u.test(value), {
    error: "Use letters, numbers, spaces and punctuation.",
  });

/** Checked in full by the API (address rules need the server); this catches typing mistakes. */
export const proxyHostSchema = z
  .string({ error: "Enter the proxy’s host name or IP address." })
  .trim()
  .min(1, "Enter the proxy’s host name or IP address.")
  .max(255, "That host name is too long.")
  .refine((value) => !/[\s/@?#]/.test(value), {
    error: "Enter only the host name or IP address, without a scheme, path or password.",
  });

export const proxyPortSchema = z.coerce
  .number({ error: "Enter a port number." })
  .int("Enter a whole number.")
  .min(1, "Use a port from 1 to 65535.")
  .max(65_535, "Use a port from 1 to 65535.");

/** Write-only: sent when saving, never returned. */
export const proxyCredentialsSchema = z.object({
  username: z
    .string({ error: "Enter the username." })
    .min(1, "Enter the username.")
    .max(255, "Use at most 255 characters.")
    .refine((value) => !CONTROL_CHARACTERS.test(value), { error: "Remove line breaks and tabs." }),
  password: z
    .string()
    .max(255, "Use at most 255 characters.")
    .refine((value) => !CONTROL_CHARACTERS.test(value), { error: "Remove line breaks and tabs." })
    .default(""),
});

export const createProxyRequestSchema = z.object({
  name: proxyNameSchema,
  protocol: proxyProtocolSchema,
  host: proxyHostSchema,
  port: proxyPortSchema,
  kind: proxyKindSchema.default("unspecified"),
  rotation: proxyRotationSchema.default("unknown"),
  credentials: proxyCredentialsSchema.optional(),
});

export const updateProxyRequestSchema = z
  .object({
    name: proxyNameSchema.optional(),
    protocol: proxyProtocolSchema.optional(),
    host: proxyHostSchema.optional(),
    port: proxyPortSchema.optional(),
    kind: proxyKindSchema.optional(),
    rotation: proxyRotationSchema.optional(),
    /** Omitted: keep the saved credentials. null: remove them. An object: replace them. */
    credentials: proxyCredentialsSchema.nullable().optional(),
  })
  // Omitted fields are absent from the parsed value, so any key means a change.
  .refine((value) => Object.keys(value).length > 0, {
    error: "Change at least one setting.",
  });

export const proxyTestResultSchema = z.object({
  ok: z.boolean(),
  /** A connection to the proxy was made. */
  reachable: z.boolean(),
  /** The proxy accepted the credentials (or needed none); null if it wasn't reached. */
  authenticated: z.boolean().nullable(),
  /** Round trip of the test request through the proxy. */
  latencyMs: z.number().int().nonnegative().nullable(),
  /** The address websites would see. */
  exitAddress: z.string().nullable(),
  reason: proxyTestReasonSchema.nullable(),
  message: z.string(),
  testedAt: z.iso.datetime(),
});

export const proxySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  protocol: proxyProtocolSchema,
  host: z.string(),
  port: z.number().int(),
  kind: proxyKindSchema,
  rotation: proxyRotationSchema,
  /** Whether a username and password are saved. They are never returned. */
  hasCredentials: z.boolean(),
  lastTest: proxyTestResultSchema.nullable(),
  /** Profiles that use this proxy. */
  usedBy: z.array(z.object({ id: z.uuid(), name: z.string() })),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const proxyListSchema = z.object({
  proxies: z.array(proxySchema),
  limit: z.number().int().positive(),
});

export type ProxyProtocol = z.infer<typeof proxyProtocolSchema>;
export type ProxyKind = z.infer<typeof proxyKindSchema>;
export type ProxyRotation = z.infer<typeof proxyRotationSchema>;
export type ProxyTestReason = z.infer<typeof proxyTestReasonSchema>;
export type ProxyTestResult = z.infer<typeof proxyTestResultSchema>;
export type SavedProxy = z.infer<typeof proxySchema>;
export type ProxyList = z.infer<typeof proxyListSchema>;
export type CreateProxyRequest = z.input<typeof createProxyRequestSchema>;
export type UpdateProxyRequest = z.input<typeof updateProxyRequestSchema>;
