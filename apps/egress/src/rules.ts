import { isObviouslyLocal, isPublicAddress, parseHost } from "@brawzer/net-policy";
import type { Lookup } from "@brawzer/proxy-client";

/**
 * Where a cloud browser's connection may go. With a saved proxy, names are
 * handed to the proxy unresolved (it resolves them on its own network, and
 * nothing about the destination leaves through this container's resolver);
 * without one, the name is resolved here and every answer must be public.
 */
export type EgressDecision =
  | { kind: "direct"; address: string; port: number }
  | { kind: "upstream"; host: string; port: number }
  | { kind: "refused"; reason: "address" | "unresolved" | "port" | "engine" | "policy" };

export interface RuleOptions {
  hasUpstream: boolean;
  allowPrivate: boolean;
  /**
   * The profile asked for private and internal addresses to go to its proxy
   * (which reaches them on its own network; nothing here connects to them).
   * Loopback is refused regardless: that is this container.
   */
  privateViaUpstream?: boolean;
  /** The account's own rules: blocked hosts never open; with any allowed hosts, only those open. */
  siteRules?: { allow: readonly string[]; block: readonly string[] } | null;
  lookup: Lookup;
}

function hostMatchesRule(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}

/** The account's rules, on the host as typed (an IP address counts as a host). */
export function siteRulesRefuse(
  host: string,
  rules: { allow: readonly string[]; block: readonly string[] } | null | undefined,
): boolean {
  if (!rules) return false;
  const lower = host.toLowerCase().replace(/\.$/, "");
  if (rules.block.some((rule) => hostMatchesRule(lower, rule))) return true;
  return rules.allow.length > 0 && !rules.allow.some((rule) => hostMatchesRule(lower, rule));
}

/** Loopback is never anyone's intranet: it is the sidecar and the runtime themselves. */
function isLoopback(address: string): boolean {
  return address.startsWith("127.") || address === "::1" || /^::ffff:127\./i.test(address);
}

/**
 * The engine's own background services: component and variation updates,
 * Safe Browsing lookups, optimisation hints and the like. The managed policy
 * already turns most of them off; this closes what is left. Matched by
 * suffix. Only hosts a web page has no use for belong here: Google's
 * sign-in (`accounts.google.com`), its static files (`www.gstatic.com`),
 * its web apps' APIs (`clients6.google.com`) and its downloads
 * (`dl.google.com`) serve websites, so blocking them broke signing in to
 * Gmail, YouTube or Google's password manager inside Brawzer.
 */
export const ENGINE_HOSTS = [
  "clients1.google.com",
  "clients2.google.com",
  "clients3.google.com",
  "clients4.google.com",
  "clients5.google.com",
  "clientservices.googleapis.com",
  "update.googleapis.com",
  "edgedl.me.gvt1.com",
  "redirector.gvt1.com",
  "optimizationguide-pa.googleapis.com",
  "safebrowsing.googleapis.com",
  "safebrowsingohttpgateway.googleapis.com",
  "content-autofill.googleapis.com",
] as const;

/** Ports a page may connect to: the web's, and the unprivileged range. Mail, shell and the like are not for a browser. */
export function isAllowedPort(port: number): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
  if (port === 80 || port === 443) return true;
  return port >= 1024;
}

export function isEngineHost(host: string): boolean {
  const name = host.toLowerCase();
  return ENGINE_HOSTS.some((blocked) => name === blocked || name.endsWith(`.${blocked}`));
}

export async function decideEgress(
  host: string,
  port: number,
  options: RuleOptions,
): Promise<EgressDecision> {
  if (!isAllowedPort(port)) return { kind: "refused", reason: "port" };
  const parsed = parseHost(host);
  if (!parsed) return { kind: "refused", reason: "address" };
  if (siteRulesRefuse(parsed.kind === "ip" ? parsed.address : parsed.name, options.siteRules)) {
    return { kind: "refused", reason: "policy" };
  }
  if (parsed.kind === "ip") {
    if (!options.allowPrivate && !isPublicAddress(parsed.address)) {
      if (!(options.privateViaUpstream && options.hasUpstream) || isLoopback(parsed.address)) {
        return { kind: "refused", reason: "address" };
      }
    }
    return options.hasUpstream
      ? { kind: "upstream", host: parsed.address, port }
      : { kind: "direct", address: parsed.address, port };
  }
  if (!options.allowPrivate && isObviouslyLocal(parsed)) {
    const intranet = options.privateViaUpstream && options.hasUpstream;
    if (!intranet || parsed.name === "localhost" || parsed.name.endsWith(".localhost")) {
      return { kind: "refused", reason: "address" };
    }
  }
  if (isEngineHost(parsed.name)) return { kind: "refused", reason: "engine" };
  if (options.hasUpstream) return { kind: "upstream", host: parsed.name, port };
  let answers: readonly { address: string }[];
  try {
    answers = await options.lookup(parsed.name);
  } catch {
    return { kind: "refused", reason: "unresolved" };
  }
  const first = answers[0];
  if (!first) return { kind: "refused", reason: "unresolved" };
  // A name that resolves to anything private is treated as hostile as a whole.
  if (!options.allowPrivate && !answers.every((answer) => isPublicAddress(answer.address))) {
    return { kind: "refused", reason: "address" };
  }
  return { kind: "direct", address: first.address, port };
}
