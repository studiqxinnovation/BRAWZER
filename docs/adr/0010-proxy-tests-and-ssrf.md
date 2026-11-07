# ADR 0010: Proxy tests and server-side request forgery

- **Status:** Accepted (milestone 2.6)
- **Date:** 2026-11-07

## Context

People save proxies (host, port, protocol, optional username and password)
and Brawzer tests them. Testing means Brawzer's servers open a connection to
an address someone typed. Without care, that is server-side request forgery:
an attacker could aim the "proxy" at Brawzer's own network (databases,
Redis, the key service), at a cloud metadata service such as
`169.254.169.254`, or use the tester to scan ports.

Proxy credentials must also never reach the public computer, and must not be
readable from a database dump.

## Decision

### What may be connected to

`apps/api/src/proxies/address-policy.ts` decides.

- **Host syntax is strict.** A host is a canonical IPv4 address, an IPv6
  address (brackets optional), or a DNS name (international names converted
  to ASCII). Anything a resolver could read in a surprising way is refused
  before any lookup: decimal, octal, hex and shortened IPv4 (`2130706433`,
  `0177.0.0.1`, `0x7f.1`, `127.1`), names whose last label doesn't start with
  a letter, and IPv6 zone IDs.
- **Only public addresses.** Every IPv4 and IPv6 special-purpose range is
  refused: this-network, private, carrier-grade NAT, loopback, link-local
  (including metadata), documentation, benchmarking, multicast, reserved,
  unique-local and site-local. Ranges that embed an IPv4 address (mapped
  `::ffff:0:0/96`, compatible, NAT64, 6to4, Teredo) are refused outright
  rather than unpacked. IPv4 and IPv6 rules live in separate `BlockList`s,
  because a single list also matches IPv4 addresses against IPv6 rules in
  their mapped form.
- **Checked twice.** When a proxy is saved, IP literals and obviously local
  names (`localhost`, `.local`, `.internal`, `.home.arpa`, `.lan`) get a
  clear error. The real protection is at test time, on the resolved address.

### How a test runs

`apps/api/src/proxies/proxy-tester.ts`:

1. **Resolve once.** The name is looked up once. If any answer is not
   public, the test stops (`blocked_address`). The first answer is the
   address used; there is no second lookup an attacker's DNS could change
   (DNS rebinding). Sockets are opened by IP address with a lookup function
   that refuses to resolve anything.
2. **Connect to that exact address**, then speak the proxy's protocol:
   SOCKS4, SOCKS4a and SOCKS5 through the `socks` library on the
   already-open socket; HTTP proxies with `CONNECT`; HTTPS proxies with TLS
   first, verifying the proxy's certificate.
3. **Fixed destination.** Every test fetches one configured URL through the
   proxy (`PROXY_TEST_URL`, by default the API's own
   `GET /api/v1/network/echo`), which answers with the caller's address. The
   person can't choose where the proxy connects. In production the URL must
   be `https`, so a proxy can't fake the answer.
4. **Bounded.** 10 seconds for the whole test, 8 KB for proxy response
   headers, 4 KB for the echo response; at most 2 tests at once per account
   and 16 per API instance; 30 tests per account per 15 minutes.
5. **Plain-language results.** Reachable, authenticated, latency, exit
   address, and on failure one of a fixed set of reasons with a message
   (refused, timed out, wrong password, blocked address and so on). Raw
   errors and internal details never reach the person.

### Credentials

The username and password are one envelope-encrypted value (ADR 0008),
bound to the account and the proxy's row, so a ciphertext can't be moved to
another row. The API never returns them, only `hasCredentials`; editing keeps
them unless they are replaced or removed. They are decrypted only for the
moment a test needs them, and never logged. Protocol rules are enforced:
SOCKS4 takes a user ID without a password, HTTP usernames can't contain a
colon, SOCKS5 fields are limited to 255 bytes.

### Development and tests

`PROXY_TEST_ALLOW_PRIVATE=true` lets tests and local development use
proxies on this machine. Configuration refuses it in production, along with
a non-`https` `PROXY_TEST_URL`.

## Consequences

- Proxies on private networks can't be used, even when someone has a
  legitimate one. Brawzer is a cloud service; its proxies must be reachable
  from the internet.
- Tests run inside the API process. The address rules are the only barrier
  between a test and Brawzer's own network until Phase 5 moves tests (and
  browser traffic) into an isolated egress service that can't reach internal
  services at all. That isolation is required before launch.
- Concurrency limits are per API instance; with several instances the total
  grows with them, while the per-account rate limit (Redis) stays shared.
- Saving or assigning a proxy doesn't ask "confirm it's you" today, because
  no traffic flows through proxies yet. Once browsing uses them (Phase 5),
  changing a profile's proxy should require a recent sign-in.
