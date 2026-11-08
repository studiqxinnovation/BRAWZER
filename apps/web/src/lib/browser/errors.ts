import { hostOf } from "./input";

export type NavigationErrorKind =
  | "unresolved"
  | "blocked"
  | "policy"
  | "unreachable"
  | "timeout"
  | "certificate"
  | "redirect"
  | "address"
  | "other";

export interface NavigationErrorText {
  kind: NavigationErrorKind;
  title: string;
  detail: string;
}

/**
 * Chromium's `ERR_…` codes, Firefox's `about:neterror` codes and Brawzer's
 * own (`BRAWZER_REFUSED_<reason>`, when the proxy refused the connection and
 * the agent knows why), by what they mean to a person.
 */
const KINDS: readonly [NavigationErrorKind, RegExp][] = [
  ["policy", /^BRAWZER_REFUSED_POLICY$/],
  [
    "unresolved",
    /^(BRAWZER_REFUSED_UNRESOLVED|ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_DNS_|dnsNotFound|unknownSocketType)/,
  ],
  [
    "blocked",
    /^(BRAWZER_REFUSED_|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_|ERR_BLOCKED_BY|ERR_UNSAFE_PORT|proxyConnectFailure|proxyResolveFailure|blockedByPolicy|deniedPortAccess|cspBlocked)/,
  ],
  ["timeout", /^(ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|netTimeout)/],
  [
    "unreachable",
    /^(ERR_CONNECTION_|ERR_EMPTY_RESPONSE|ERR_ADDRESS_UNREACHABLE|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_|ERR_HTTP2_|ERR_QUIC_|connectionFailure|netReset|netInterrupt|netOffline|serverError)/,
  ],
  [
    "certificate",
    /^(ERR_CERT_|ERR_SSL_|ERR_BAD_SSL|nssFailure2|nssBadCert|sslv3Used|certerror|SEC_ERROR|SSL_ERROR|MOZILLA_PKIX)/,
  ],
  ["redirect", /^(ERR_TOO_MANY_REDIRECTS|redirectLoop)/],
  [
    "address",
    /^(ERR_INVALID_URL|ERR_UNKNOWN_URL_SCHEME|ERR_INVALID_REDIRECT|malformedURI|unknownProtocolFound|fileNotFound|fileAccessDenied)/,
  ],
];

export function navigationErrorKind(code: string): NavigationErrorKind {
  for (const [kind, pattern] of KINDS) if (pattern.test(code)) return kind;
  return "other";
}

/** What Brawzer says in place of the engine's error page. Honest about what it knows. */
export function describeNavigationError(code: string, url: string): NavigationErrorText {
  const kind = navigationErrorKind(code);
  const host = hostOf(url) || url;
  const site = `“${host}”`;
  switch (kind) {
    case "unresolved":
      return {
        kind,
        title: "There’s no website at this address",
        detail: `Nothing answers to ${site}. Check the spelling, or search for it instead.`,
      };
    case "blocked":
      return {
        kind,
        title: "Brawzer didn’t allow this connection",
        detail:
          code === "BRAWZER_REFUSED_ADDRESS"
            ? `${site} is a private or internal address. Brawzer only connects to public websites.`
            : code === "BRAWZER_REFUSED_PORT"
              ? `${site} uses a port Brawzer doesn’t carry. Websites are reached on 80, 443 and ports above 1023.`
              : code === "BRAWZER_REFUSED_ENGINE"
                ? `${site} is one of the engine’s own services, which Brawzer keeps switched off.`
                : `${site} is a private or internal address, a port Brawzer doesn’t carry, or one of the engine’s own services. Brawzer only connects to public websites.`,
      };
    case "policy":
      return {
        kind,
        title: "Your site rules stopped this",
        detail: `${site} is on your list of blocked sites, or isn’t on your list of allowed sites. Change that on the Site rules page.`,
      };
    case "timeout":
      return {
        kind,
        title: "The website took too long",
        detail: `${site} didn’t answer in time. It may be busy or down; try again in a moment.`,
      };
    case "unreachable":
      return {
        kind,
        title: "The website isn’t answering",
        detail: `${site} refused the connection or closed it before replying. It may be down, or not serving this address.`,
      };
    case "certificate":
      return {
        kind,
        title: "This website’s certificate can’t be trusted",
        detail: `${site} presented a certificate Brawzer couldn’t verify, so nothing was sent to it. If this is a site you know, its certificate may have expired.`,
      };
    case "redirect":
      return {
        kind,
        title: "This page redirects in a loop",
        detail: `${site} keeps sending the browser to another address without ever showing a page.`,
      };
    case "address":
      return {
        kind,
        title: "That isn’t an address Brawzer can open",
        detail:
          "Check the address, or search for it instead. Brawzer opens http and https pages only.",
      };
    default:
      return {
        kind,
        title: "This page couldn’t be opened",
        detail: `Something went wrong between Brawzer and ${site}.`,
      };
  }
}
