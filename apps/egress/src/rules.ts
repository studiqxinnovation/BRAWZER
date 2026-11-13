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
  | { kind: "refused"; reason: "address" | "unresolved" | "port" | "engine" };

export interface RuleOptions {
  hasUpstream: boolean;
  allowPrivate: boolean;
  lookup: Lookup;
}

/**
 * The engine's own background services: component and variation updates,
 * account services and the like. The managed policy already turns most of
 * them off; this closes what is left. Matched by suffix.
 */
export const ENGINE_HOSTS = [
  "clients1.google.com",
  "clients2.google.com",
  "clients3.google.com",
  "clients4.google.com",
  "clients5.google.com",
  "clients6.google.com",
  "clientservices.googleapis.com",
  "update.googleapis.com",
  "edgedl.me.gvt1.com",
  "redirector.gvt1.com",
  "dl.google.com",
  "optimizationguide-pa.googleapis.com",
  "safebrowsing.googleapis.com",
  "safebrowsingohttpgateway.googleapis.com",
  "content-autofill.googleapis.com",
  "accounts.google.com",
  "www.gstatic.com/chrome",
] as const;

/** Ports a page may connect to: the web's, and the unprivileged range. Mail, shell and the like are not for a browser. */
export function isAllowedPort(port: number): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
  if (port === 80 || port === 443) return true;
  return port >= 1024;
}

export function isEngineHost(host: string): boolean {
  const name = host.toLowerCase();
  return ENGINE_HOSTS.some((blocked) => {
    const [blockedHost] = blocked.split("/");
    return name === blockedHost || name.endsWith(`.${blockedHost ?? ""}`);
  });
}

export async function decideEgress(
  host: string,
  port: number,
  options: RuleOptions,
): Promise<EgressDecision> {
  if (!isAllowedPort(port)) return { kind: "refused", reason: "port" };
  const parsed = parseHost(host);
  if (!parsed) return { kind: "refused", reason: "address" };
  if (parsed.kind === "ip") {
    if (!options.allowPrivate && !isPublicAddress(parsed.address)) {
      return { kind: "refused", reason: "address" };
    }
    return options.hasUpstream
      ? { kind: "upstream", host: parsed.address, port }
      : { kind: "direct", address: parsed.address, port };
  }
  if (!options.allowPrivate && isObviouslyLocal(parsed)) {
    return { kind: "refused", reason: "address" };
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
