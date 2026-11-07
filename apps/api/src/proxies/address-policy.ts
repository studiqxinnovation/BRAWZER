import { BlockList, isIPv6 } from "node:net";
import { domainToASCII } from "node:url";

/**
 * Which network addresses Brawzer's servers may connect to when someone asks
 * them to (ADR 0010). Anything private, local, reserved or special-purpose is
 * refused, for IPv4 and IPv6 alike, so a proxy test can't be aimed at
 * Brawzer's own network or a cloud metadata service.
 */
// Two lists, because a BlockList also checks IPv4 addresses against IPv6
// rules in their mapped form, and the IPv6 list refuses every mapped address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();

// IPv4 special-purpose ranges (RFC 6890 and successors).
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network", including 0.0.0.0
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (and some cloud metadata services)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including 169.254.169.254 metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including 255.255.255.255
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

// IPv6 special-purpose ranges. Ranges that embed an IPv4 address (mapped,
// compatible, NAT64, 6to4, Teredo) are refused outright rather than unpacked.
for (const [network, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible
  ["::ffff:0:0", 96], // IPv4-mapped, such as ::ffff:127.0.0.1
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 23], // IETF protocol assignments, including Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation
  ["5f00::", 16], // segment routing
  ["fc00::", 7], // unique local, including AWS's fd00:ec2::254 metadata
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

const CANONICAL_IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type ParsedHost =
  { kind: "ip"; address: string; family: 4 | 6 } | { kind: "name"; name: string };

/**
 * Reads what someone typed as a proxy host: a canonical IPv4 address, an IPv6
 * address (brackets optional), or a DNS host name (international names are
 * converted to ASCII). Anything a resolver might read in a surprising way is
 * refused: decimal, octal, hex or shortened IPv4 (`2130706433`, `0177.0.0.1`,
 * `0x7f.1`, `127.1`), all-numeric top-level labels, and IPv6 zone IDs.
 */
export function parseHost(input: string): ParsedHost | null {
  let host = input.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.length === 0 || host.length > 253 || host.includes("%")) return null;

  if (CANONICAL_IPV4.test(host)) return { kind: "ip", address: host, family: 4 };
  if (host.includes(":")) return isIPv6(host) ? { kind: "ip", address: host, family: 6 } : null;

  if (host.endsWith(".")) host = host.slice(0, -1);
  const ascii = domainToASCII(host);
  if (ascii === "" || ascii.length > 253) return null;
  const labels = ascii.split(".");
  if (!labels.every((label) => LABEL.test(label))) return null;
  // Real top-level domains start with a letter, which also rules out every
  // numeric shorthand for an IPv4 address.
  if (!/^[a-z]/.test(labels.at(-1) ?? "")) return null;
  return { kind: "name", name: ascii };
}

/** True only for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  if (CANONICAL_IPV4.test(address)) return !blockedV4.check(address, "ipv4");
  if (!address.includes("%") && isIPv6(address)) return !blockedV6.check(address, "ipv6");
  return false;
}

/** Names that only ever mean this machine or a local network. */
const LOCAL_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "lan", "intranet"];

/**
 * Checked when a proxy is saved, for an early, clear message. The real
 * protection is at test time, on the resolved address.
 */
export function isObviouslyLocal(host: ParsedHost): boolean {
  if (host.kind === "ip") return !isPublicAddress(host.address);
  return LOCAL_SUFFIXES.some((suffix) => host.name === suffix || host.name.endsWith(`.${suffix}`));
}
