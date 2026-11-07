import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof logLevels)[number];
export type EmailTransportName = "mailpit" | "resend" | "log";

/** A required URL with an allowed protocol. Error messages never echo the value. */
function urlWithProtocol(protocol: RegExp, expected: string) {
  return z.url({
    protocol,
    error: (issue) => (issue.input === undefined ? "is required" : `must be a ${expected} URL`),
  });
}

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default("http://localhost:3100"),
  /** Extra browser origins allowed to call the API, comma-separated. */
  ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: urlWithProtocol(/^postgres(ql)?$/, "postgres://"),
  REDIS_URL: urlWithProtocol(/^rediss?$/, "redis:// or rediss://"),
  LOG_LEVEL: z.enum(logLevels).default("info"),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  API_DOCS_ENABLED: z.stringbool().optional(),
  /**
   * Which reverse proxies may set X-Forwarded-For: "false" (none), a
   * comma-separated list of addresses/CIDRs (preferred), or "true" (any; only
   * safe when the API is unreachable except through your proxy).
   */
  TRUST_PROXY: z.string().default("false"),
  /** Multiplies every rate limit. Production is always 1. */
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(1000).optional(),
  EMAIL_TRANSPORT: z.enum(["mailpit", "resend", "log"]).default("mailpit"),
  EMAIL_FROM: z.string().min(3).default("Brawzer <no-reply@brawzer.localhost>"),
  MAILPIT_API_URL: z.url({ protocol: /^https?$/ }).default("http://127.0.0.1:8125"),
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * Refuse new passwords found in known data breaches (Pwned Passwords range
   * API; only a 5-character hash prefix is sent). Default: on in production.
   */
  BREACHED_PASSWORD_CHECK: z.stringbool().optional(),
  /** How long the security history is kept, in days. */
  SECURITY_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  /** Who holds the key-encryption keys: "local" (development only) or "vault" (Vault/OpenBao Transit). */
  KEY_PROVIDER: z.enum(["local", "vault"]).default("local"),
  /** Local provider: comma-separated `id:base64` 256-bit keys; the first one encrypts new secrets. */
  ENCRYPTION_KEYS: z.string().optional(),
  VAULT_ADDR: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
  VAULT_TOKEN: z.string().min(1).optional(),
  VAULT_TRANSIT_MOUNT: z
    .string()
    .regex(/^[a-z0-9_-]+$/, "may only contain lowercase letters, digits, _ and -")
    .default("transit"),
  VAULT_TRANSIT_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, "may only contain letters, digits, _ and -")
    .default("brawzer"),
  BUILD_SHA: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, "must be a git commit SHA")
    .optional(),
});

export interface EmailConfig {
  readonly transport: EmailTransportName;
  readonly from: string;
  readonly mailpitApiUrl: string;
  readonly resendApiKey: string | undefined;
}

export type EncryptionConfig =
  | { readonly provider: "local"; readonly keys: readonly { id: string; key: Buffer }[] }
  | {
      readonly provider: "vault";
      readonly vault: { address: string; token: string; mount: string; keyName: string };
    };

/** Parses ENCRYPTION_KEYS ("id:base64,id:base64"). Problems are reported without the key material. */
function parseLocalKeys(
  value: string | undefined,
  issues: string[],
): { id: string; key: Buffer }[] {
  if (!value) {
    issues.push("ENCRYPTION_KEYS: is required when KEY_PROVIDER is local");
    return [];
  }
  const keys: { id: string; key: Buffer }[] = [];
  for (const entry of value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(":");
    const id = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (separator <= 0 || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || key.length !== 32) {
      issues.push("ENCRYPTION_KEYS: each entry must be id:base64 with a 256-bit key");
      return [];
    }
    keys.push({ id, key });
  }
  if (keys.length === 0) issues.push("ENCRYPTION_KEYS: is required when KEY_PROVIDER is local");
  return keys;
}

export interface AppConfig {
  readonly env: "development" | "test" | "production";
  readonly isProduction: boolean;
  readonly version: string;
  readonly apiHost: string;
  readonly apiPort: number;
  /** Public URL of the web app; used in email links. */
  readonly webOrigin: string;
  /** Browser origins whose state-changing requests are accepted. */
  readonly allowedOrigins: readonly string[];
  /** True when the site is served over HTTPS: Secure, __Host- cookies. */
  readonly secureCookies: boolean;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly logLevel: LogLevel;
  readonly logFormat: "json" | "pretty";
  readonly apiDocsEnabled: boolean;
  readonly trustProxy: boolean | readonly string[];
  readonly rateLimitScale: number;
  readonly email: EmailConfig;
  readonly breachedPasswordCheck: boolean;
  readonly securityHistoryRetentionDays: number;
  readonly encryption: EncryptionConfig;
}

/** Raised at startup when the environment is incomplete or invalid. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid API configuration:\n${issues.map((issue) => `  • ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Reduces a URL to its origin; null when it is not an http(s) URL without a path. */
function toOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || (url.pathname !== "/" && url.pathname !== ""))
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

const PROXY_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

function isProxyAddress(entry: string): boolean {
  if (PROXY_KEYWORDS.has(entry)) return true;
  const [address = "", prefix, ...rest] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return /^\d{1,3}$/.test(prefix) && bits <= (family === 4 ? 32 : 128);
}

/** Parses TRUST_PROXY; null when the value is invalid. */
function parseTrustProxy(value: string): boolean | readonly string[] | null {
  const flag = z.stringbool().safeParse(value.trim());
  if (flag.success) return flag.data;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 && entries.every(isProxyAddress) ? Object.freeze(entries) : null;
}

/** Validates environment variables into a typed, immutable configuration. */
export function parseConfig(env: NodeJS.ProcessEnv, version = readPackageVersion()): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const values = result.data;
  const isProduction = values.NODE_ENV === "production";
  const issues: string[] = [];

  const webOrigin = toOrigin(values.WEB_ORIGIN) ?? values.WEB_ORIGIN;
  const extraOrigins = (values.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const origin = toOrigin(entry);
      if (!origin) issues.push("ALLOWED_ORIGINS: each entry must be an http(s) origin");
      return origin;
    })
    .filter((origin): origin is string => origin !== null);

  const trustProxy = parseTrustProxy(values.TRUST_PROXY);
  if (trustProxy === null) {
    issues.push("TRUST_PROXY: must be true, false, or a comma-separated list of proxy addresses");
  }
  if (isProduction && !webOrigin.startsWith("https://")) {
    issues.push("WEB_ORIGIN: must use https in production");
  }
  if (isProduction && values.EMAIL_TRANSPORT !== "resend") {
    issues.push("EMAIL_TRANSPORT: must be resend in production");
  }
  if (values.EMAIL_TRANSPORT === "resend" && !values.RESEND_API_KEY) {
    issues.push("RESEND_API_KEY: is required when EMAIL_TRANSPORT is resend");
  }
  let encryption: EncryptionConfig | undefined;
  if (values.KEY_PROVIDER === "local") {
    if (isProduction) {
      issues.push("KEY_PROVIDER: must be a key management service (vault) in production");
    }
    encryption = { provider: "local", keys: parseLocalKeys(values.ENCRYPTION_KEYS, issues) };
  } else {
    if (!values.VAULT_ADDR) issues.push("VAULT_ADDR: is required when KEY_PROVIDER is vault");
    if (!values.VAULT_TOKEN) issues.push("VAULT_TOKEN: is required when KEY_PROVIDER is vault");
    encryption = {
      provider: "vault",
      vault: {
        address: values.VAULT_ADDR ?? "",
        token: values.VAULT_TOKEN ?? "",
        mount: values.VAULT_TRANSIT_MOUNT,
        keyName: values.VAULT_TRANSIT_KEY,
      },
    };
  }
  if (issues.length > 0) throw new ConfigError(issues);

  return Object.freeze({
    env: values.NODE_ENV,
    isProduction,
    version: values.BUILD_SHA ? `${version}+${values.BUILD_SHA.slice(0, 12)}` : version,
    apiHost: values.API_HOST,
    apiPort: values.API_PORT,
    webOrigin,
    allowedOrigins: Object.freeze([...new Set([webOrigin, ...extraOrigins])]),
    secureCookies: webOrigin.startsWith("https://"),
    databaseUrl: values.DATABASE_URL,
    redisUrl: values.REDIS_URL,
    logLevel: values.LOG_LEVEL,
    logFormat: values.LOG_FORMAT,
    // Interactive docs describe the whole API surface, so they are off in
    // production unless an operator explicitly turns them on.
    apiDocsEnabled: values.API_DOCS_ENABLED ?? !isProduction,
    trustProxy: trustProxy ?? false,
    // Development and tests run many sign-ups from one address; production never relaxes.
    rateLimitScale: isProduction ? 1 : (values.RATE_LIMIT_SCALE ?? 20),
    // Off by default locally, so development and tests never depend on the internet.
    breachedPasswordCheck: values.BREACHED_PASSWORD_CHECK ?? isProduction,
    securityHistoryRetentionDays: values.SECURITY_HISTORY_RETENTION_DAYS,
    encryption: Object.freeze(encryption),
    email: Object.freeze({
      transport: values.EMAIL_TRANSPORT,
      from: values.EMAIL_FROM,
      mailpitApiUrl: values.MAILPIT_API_URL,
      resendApiKey: values.RESEND_API_KEY,
    }),
  });
}

/** Loads the local .env file (development only), then validates the environment. */
export function loadConfig(): AppConfig {
  loadLocalEnvFile();
  return parseConfig(process.env);
}

/**
 * In development, loads the workspace-root .env so `pnpm dev` works without
 * exporting variables. Existing environment variables always win. Production
 * never reads files: values come from the platform's secret manager.
 */
export function loadLocalEnvFile(startDir = process.cwd()): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const file = findInWorkspace(startDir, ".env");
  if (file) process.loadEnvFile(file);
  return file;
}

/** Looks for `name` from `startDir` upwards, stopping at the workspace root. */
export function findInWorkspace(startDir: string, name: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (existsSync(path.join(dir, "pnpm-workspace.yaml")) || parent === dir) return undefined;
    dir = parent;
  }
}

function readPackageVersion(): string {
  // Same relative location from src/config and dist/config.
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  return z.object({ version: z.string() }).safeParse(manifest).data?.version ?? "0.0.0";
}
