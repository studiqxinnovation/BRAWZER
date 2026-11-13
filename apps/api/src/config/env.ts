import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { DRIVE_LIMITS } from "@brawzer/contracts";
import { homedir } from "node:os";
import { z } from "zod";
import { parsePlanDefinitions, type PlanDefinition } from "../billing/plans.js";

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
  /** Passkey domain (WebAuthn RP ID). Defaults to WEB_ORIGIN's hostname; passkeys only work on it. */
  WEBAUTHN_RP_ID: z
    .string()
    .regex(/^[a-z0-9.-]+$/, "must be a lowercase host name")
    .optional(),
  WEBAUTHN_RP_NAME: z.string().min(1).max(64).default("Brawzer"),
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
  /**
   * Proxy tests fetch this URL through the proxy; it must answer with the
   * caller's IP address as plain text. Defaults to this API's own
   * /api/v1/network/echo. Must be https in production.
   */
  PROXY_TEST_URL: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
  /** Lets proxy tests reach private and local addresses. Development and tests only. */
  PROXY_TEST_ALLOW_PRIVATE: z.stringbool().default(false),
  /**
   * Drive's object store. No endpoint means AWS S3 itself; a custom endpoint
   * must be https in production. Keys are optional where the host provides
   * credentials (such as an IAM role).
   */
  STORAGE_ENDPOINT: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
  STORAGE_REGION: z.string().min(1).default("us-east-1"),
  STORAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "must be a valid bucket name")
    .default("brawzer-drive"),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Bucket in the path rather than the host name; most self-hosted stores need it. */
  STORAGE_FORCE_PATH_STYLE: z.stringbool().optional(),
  /** ClamAV's clamd, which scans every Drive upload. */
  CLAMAV_HOST: z.string().min(1).default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  /** Lowers Drive's per-file limit so tests can hit it quickly. Development and tests only. */
  DRIVE_MAX_FILE_BYTES: z.coerce.number().int().min(1).max(DRIVE_LIMITS.maxFileBytes).optional(),
  /**
   * The Docker engine that runs cloud browser containers: a socket path or
   * unix:// URL. Defaults to the usual socket locations.
   */
  DOCKER_HOST: z.string().min(1).optional(),
  /** The runtime image (apps/runtime-agent/Dockerfile). */
  BROWSER_RUNTIME_IMAGE: z.string().min(1).default("brawzer-runtime:dev"),
  /** The Docker network runtime containers join; created if missing. */
  BROWSER_RUNTIME_NETWORK: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/, "must be a Docker network name")
    .default("brawzer-runtime"),
  /**
   * Public base URL of this API for the browser stream (ws:// or wss://).
   * Defaults to this API's own address; production must set wss://.
   */
  BROWSER_STREAM_URL: z
    .url({ protocol: /^wss?$/, error: "must be a ws:// or wss:// URL" })
    .optional(),
  /** Serves testsite.invalid (HTTP and HTTPS) inside each runtime for the browser tests. Development and tests only. */
  BROWSER_TEST_SITE: z.stringbool().default(false),
  /** The egress image (apps/egress/Dockerfile, ADR 0014): one container per session, plus the proxy tester. */
  EGRESS_IMAGE: z.string().min(1).default("brawzer-egress:dev"),
  /**
   * Where proxy tests run: in the egress tester container (the default and
   * the only option in production), or inside the API (`inline`, development
   * without a container engine).
   */
  PROXY_TEST_RUNNER: z.enum(["egress", "inline"]).default("egress"),
  /**
   * Development only: proxies and echo servers on this machine's loopback
   * are reached from egress containers under this name (Docker Desktop:
   * host.docker.internal). Refused in production.
   */
  EGRESS_LOOPBACK_HOST: z
    .string()
    .regex(/^[a-z0-9.-]{1,253}$/i, "must be a host name")
    .optional(),
  /** Stripe (Phase 6, ADR 0015). Without a key, paid plans are unavailable and only the free plan exists. */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Tests only: a fake Stripe API. Refused in production. */
  STRIPE_API_BASE: z.url({ protocol: /^https?$/ }).optional(),
  /** The paid plans this installation offers, as JSON (see apps/api/src/billing/plans.ts). */
  BILLING_PLANS: z.string().optional(),
  /** Comma-separated addresses that are administrators when their accounts exist. */
  ADMIN_EMAILS: z.string().optional(),
  BUILD_SHA: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/, "must be a git commit SHA")
    .optional(),
});

export interface BillingConfig {
  readonly stripeSecretKey: string | null;
  readonly webhookSecret: string | null;
  readonly stripeApiBase: string | null;
  readonly plans: readonly PlanDefinition[];
}

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

export interface StorageConfig {
  /** Undefined means AWS S3's own endpoints. */
  readonly endpoint: string | undefined;
  readonly region: string;
  readonly bucket: string;
  readonly credentials:
    { readonly accessKeyId: string; readonly secretAccessKey: string } | undefined;
  readonly forcePathStyle: boolean;
  /** Development and tests create the bucket if it's missing; production expects it. */
  readonly createBucket: boolean;
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
  readonly storage: StorageConfig;
  readonly scanner: { readonly host: string; readonly port: number };
  readonly drive: {
    /** Per-file limit in bytes; the contract's value unless lowered for tests. */
    readonly maxFileBytes: number;
  };
  readonly browser: {
    /** Path of the Docker engine's Unix socket. */
    readonly dockerSocket: string;
    readonly image: string;
    readonly network: string;
    /** Base URL (ws:// or wss://) the Browser page opens the stream on. */
    readonly streamUrl: string;
    /** Never true in production. */
    readonly testSite: boolean;
  };
  readonly egress: {
    readonly image: string;
    readonly loopbackHost: string | null;
  };
  readonly billing: BillingConfig;
  /** Lower-cased addresses of administrators. */
  readonly adminEmails: readonly string[];
  readonly proxyTests: {
    readonly runner: "egress" | "inline";
    /** The fixed destination of every proxy test. */
    readonly url: string;
    /** Never true in production. */
    readonly allowPrivate: boolean;
  };
  /** Passkeys are bound to `rpId`; `origins` are the pages allowed to use them. */
  readonly webauthn: {
    readonly rpId: string;
    readonly rpName: string;
    readonly origins: readonly string[];
  };
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
  const webOriginHost = new URL(webOrigin).hostname;
  const rpId = values.WEBAUTHN_RP_ID ?? webOriginHost;
  if (webOriginHost !== rpId && !webOriginHost.endsWith(`.${rpId}`)) {
    issues.push("WEBAUTHN_RP_ID: must be WEB_ORIGIN's host name or a parent domain of it");
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
  const echoHost =
    values.API_HOST === "0.0.0.0" || values.API_HOST === "::" ? "127.0.0.1" : values.API_HOST;
  const proxyTestUrl =
    values.PROXY_TEST_URL ?? `http://${echoHost}:${String(values.API_PORT)}/api/v1/network/echo`;
  if (isProduction && !proxyTestUrl.startsWith("https://")) {
    issues.push("PROXY_TEST_URL: must be set to an https URL in production");
  }
  if (isProduction && values.PROXY_TEST_ALLOW_PRIVATE) {
    issues.push("PROXY_TEST_ALLOW_PRIVATE: must not be enabled in production");
  }
  if (isProduction && values.PROXY_TEST_RUNNER !== "egress") {
    issues.push("PROXY_TEST_RUNNER: must be egress in production");
  }
  if (isProduction && values.EGRESS_LOOPBACK_HOST) {
    issues.push("EGRESS_LOOPBACK_HOST: must not be set in production");
  }
  if (values.STRIPE_SECRET_KEY && !values.STRIPE_WEBHOOK_SECRET) {
    issues.push("STRIPE_WEBHOOK_SECRET: is required when STRIPE_SECRET_KEY is set");
  }
  if (isProduction && values.STRIPE_API_BASE) {
    issues.push("STRIPE_API_BASE: must not be set in production");
  }
  if (
    isProduction &&
    values.STRIPE_SECRET_KEY &&
    !values.STRIPE_SECRET_KEY.startsWith("sk_live_")
  ) {
    issues.push("STRIPE_SECRET_KEY: must be a live key in production");
  }
  let plans: PlanDefinition[] = [];
  try {
    plans = parsePlanDefinitions(values.BILLING_PLANS);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "BILLING_PLANS: invalid");
  }
  const adminEmails = (values.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
  if (isProduction && values.STORAGE_ENDPOINT && !values.STORAGE_ENDPOINT.startsWith("https://")) {
    issues.push("STORAGE_ENDPOINT: must use https in production");
  }
  if (
    (values.STORAGE_ACCESS_KEY_ID === undefined) !==
    (values.STORAGE_SECRET_ACCESS_KEY === undefined)
  ) {
    issues.push("STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY: set both or neither");
  }
  if (isProduction && values.DRIVE_MAX_FILE_BYTES !== undefined) {
    issues.push("DRIVE_MAX_FILE_BYTES: must not be set in production");
  }
  const streamUrl = values.BROWSER_STREAM_URL ?? `ws://${echoHost}:${String(values.API_PORT)}`;
  if (isProduction && !streamUrl.startsWith("wss://")) {
    issues.push("BROWSER_STREAM_URL: must be set to a wss:// URL in production");
  }
  if (isProduction && values.BROWSER_TEST_SITE) {
    issues.push("BROWSER_TEST_SITE: must not be enabled in production");
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
    proxyTests: Object.freeze({
      url: proxyTestUrl,
      allowPrivate: values.PROXY_TEST_ALLOW_PRIVATE,
      runner: values.PROXY_TEST_RUNNER,
    }),
    egress: Object.freeze({
      image: values.EGRESS_IMAGE,
      loopbackHost: values.EGRESS_LOOPBACK_HOST ?? null,
    }),
    billing: Object.freeze({
      stripeSecretKey: values.STRIPE_SECRET_KEY ?? null,
      webhookSecret: values.STRIPE_WEBHOOK_SECRET ?? null,
      stripeApiBase: values.STRIPE_API_BASE ?? null,
      plans,
    }),
    adminEmails,
    storage: Object.freeze({
      endpoint: values.STORAGE_ENDPOINT,
      region: values.STORAGE_REGION,
      bucket: values.STORAGE_BUCKET,
      credentials:
        values.STORAGE_ACCESS_KEY_ID && values.STORAGE_SECRET_ACCESS_KEY
          ? Object.freeze({
              accessKeyId: values.STORAGE_ACCESS_KEY_ID,
              secretAccessKey: values.STORAGE_SECRET_ACCESS_KEY,
            })
          : undefined,
      // Custom endpoints are self-hosted stores, which usually need path style.
      forcePathStyle: values.STORAGE_FORCE_PATH_STYLE ?? values.STORAGE_ENDPOINT !== undefined,
      createBucket: !isProduction,
    }),
    scanner: Object.freeze({ host: values.CLAMAV_HOST, port: values.CLAMAV_PORT }),
    drive: Object.freeze({
      maxFileBytes: values.DRIVE_MAX_FILE_BYTES ?? DRIVE_LIMITS.maxFileBytes,
    }),
    browser: Object.freeze({
      dockerSocket: dockerSocketPath(values.DOCKER_HOST),
      image: values.BROWSER_RUNTIME_IMAGE,
      network: values.BROWSER_RUNTIME_NETWORK,
      streamUrl: streamUrl.replace(/\/$/, ""),
      testSite: values.BROWSER_TEST_SITE,
    }),
    webauthn: Object.freeze({
      rpId,
      rpName: values.WEBAUTHN_RP_NAME,
      // Passkeys work only on pages under the RP ID (IP-address origins never qualify).
      origins: Object.freeze(
        [webOrigin, ...extraOrigins].filter((origin) => {
          const host = new URL(origin).hostname;
          return host === rpId || host.endsWith(`.${rpId}`);
        }),
      ),
    }),
    email: Object.freeze({
      transport: values.EMAIL_TRANSPORT,
      from: values.EMAIL_FROM,
      mailpitApiUrl: values.MAILPIT_API_URL,
      resendApiKey: values.RESEND_API_KEY,
    }),
  });
}

/** DOCKER_HOST as a socket path; without it, the first usual location that exists. */
export function dockerSocketPath(value: string | undefined): string {
  if (value) return value.startsWith("unix://") ? value.slice("unix://".length) : value;
  const candidates = [
    "/var/run/docker.sock",
    path.join(homedir(), ".docker", "run", "docker.sock"),
    path.join(homedir(), ".colima", "default", "docker.sock"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? "";
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
