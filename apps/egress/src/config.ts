import type { ProxyTarget } from "@brawzer/proxy-client";
import { z } from "zod";

const siteRulesSchema = z.object({
  allow: z.array(z.string().min(1).max(253)).max(1000),
  block: z.array(z.string().min(1).max(253)).max(1000),
});

const upstreamSchema = z.object({
  protocol: z.enum(["http", "https", "socks4", "socks4a", "socks5"]),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  credentials: z
    .object({ username: z.string().max(255), password: z.string().max(255) })
    .nullable(),
});

export interface EgressConfig {
  /** `session`: the egress of one cloud browser session. `tester`: runs proxy tests for the API. */
  mode: "session" | "tester";
  /** Presented by the API on the tester's routes (and, in session mode, on the health route's twin). */
  secret: string;
  /** The HTTP port for /healthz (session) or the test API (tester), on all interfaces of the container. */
  port: number;
  /** Session mode: the loopback port the runtime's proxy forwards to. */
  proxyPort: number;
  /** Session mode: the profile's saved proxy, or null for direct connections. */
  upstream: ProxyTarget | null;
  /** Development and tests only: private and local addresses are allowed. */
  allowPrivate: boolean;
  /** The profile's choice: private addresses go to its proxy rather than being refused. */
  privateViaUpstream: boolean;
  /** The account's own site rules (Phase 8, idea 8), or none. */
  siteRules: { allow: string[]; block: string[] } | null;
  /**
   * Development only: proxies and echo servers that the tests run on this
   * machine's loopback are reached under this name from inside the container.
   */
  loopbackHost: string | null;
  /** Session mode: apply the firewall that makes this process the only way out. */
  firewall: boolean;
  /** The unprivileged user the service runs as once the firewall is in place. */
  runAs: { uid: number; gid: number };
}

export function readConfig(env: NodeJS.ProcessEnv): EgressConfig {
  const mode = env.EGRESS_MODE === "tester" ? "tester" : "session";
  const secret = env.EGRESS_SECRET ?? "";
  if (secret.length < 32) throw new Error("EGRESS_SECRET must be set (32+ characters)");
  const port = Number(env.EGRESS_PORT ?? (mode === "tester" ? "7001" : "7002"));
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("EGRESS_PORT must be a port number above 1023");
  }
  let upstream: ProxyTarget | null = null;
  if (env.EGRESS_UPSTREAM) {
    const parsed = upstreamSchema.safeParse(JSON.parse(env.EGRESS_UPSTREAM));
    if (!parsed.success) throw new Error("EGRESS_UPSTREAM is not a proxy description");
    upstream = parsed.data;
  }
  let siteRules: { allow: string[]; block: string[] } | null = null;
  if (env.EGRESS_SITE_RULES) {
    const parsed = siteRulesSchema.safeParse(JSON.parse(env.EGRESS_SITE_RULES));
    if (!parsed.success) throw new Error("EGRESS_SITE_RULES is not a rule set");
    siteRules = parsed.data;
  }
  const loopback = env.EGRESS_LOOPBACK_HOST?.trim();
  const uid = Number(env.EGRESS_UID ?? "10002");
  const gid = Number(env.EGRESS_GID ?? String(uid));
  return {
    mode,
    secret,
    port,
    proxyPort: 3129,
    upstream,
    allowPrivate: env.EGRESS_ALLOW_PRIVATE === "true",
    privateViaUpstream: upstream !== null && env.EGRESS_PRIVATE_VIA_UPSTREAM === "true",
    siteRules,
    loopbackHost: loopback === undefined || loopback === "" ? null : loopback,
    firewall: mode === "session" && env.EGRESS_FIREWALL !== "false",
    runAs: { uid, gid },
  };
}
