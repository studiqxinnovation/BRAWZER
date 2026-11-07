import type { ProxyKind, ProxyProtocol, ProxyRotation } from "@brawzer/contracts";
import type { z } from "zod";

export const protocolLabels: Record<ProxyProtocol, string> = {
  http: "HTTP",
  https: "HTTPS",
  socks4: "SOCKS4",
  socks4a: "SOCKS4a",
  socks5: "SOCKS5",
};

export const kindLabels: Record<ProxyKind, string> = {
  unspecified: "Not specified",
  residential: "Residential",
  datacenter: "Datacenter",
  mobile: "Mobile",
};

export const rotationLabels: Record<ProxyRotation, string> = {
  unknown: "Unknown",
  static: "Static address",
  rotating: "Rotating address",
};

/** host:port, with IPv6 addresses in brackets. */
export function hostAndPort(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${String(port)}`;
}

/**
 * One message per form field. Credentials are nested in the API
 * (`credentials.username`) but are plain `username`/`password` fields here.
 */
export function proxyFieldErrors(
  entries: readonly { field: string; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { field, message } of entries) {
    const key = field.replace(/^credentials\./, "") || "form";
    errors[key] ??= message;
  }
  return errors;
}

export const fromIssues = (issues: readonly z.core.$ZodIssue[]) =>
  issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message }));

export const fromDetails = (details: readonly string[] | undefined) =>
  (details ?? []).flatMap((detail) => {
    const separator = detail.indexOf(": ");
    return separator > 0
      ? [{ field: detail.slice(0, separator), message: detail.slice(separator + 2) }]
      : [];
  });
