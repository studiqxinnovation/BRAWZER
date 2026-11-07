# 0003 Supply-chain policy

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Compromised npm releases are usually detected and removed within days. A
security product that installs a package on the day it is published carries
that risk for nothing.

## Decision

- **`minimumReleaseAge: 10080` (7 days)** in `pnpm-workspace.yaml`. This applies to direct and transitive dependencies.
- **No exemptions** without a recorded security reason. pnpm can add exemptions automatically when a pinned version is too new; remove them and pin an older version instead.
- **Exact versions in one `catalog`**, referenced as `catalog:` by every package.
- **Install scripts blocked by default.** Allowed: `esbuild` (binary check). Denied explicitly: `@scarf/scarf` (telemetry).

## Consequences

- Security patches arrive up to 7 days later. For an actively exploited vulnerability, a time-limited exemption may be added with a comment naming the advisory.
- Upgrades need a quick check that the chosen version is at least 7 days old.
