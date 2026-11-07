# 0001 Monorepo and toolchain

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Brawzer has several deployable parts: web app, API, and later the gateway,
orchestrator and runtime agent. These share types, schemas and a design system.
They must stay consistent without a release process between them.

## Decision

- **One repository** with pnpm 12 workspaces and Turborepo for task ordering and caching.
- **TypeScript 6.0** everywhere, strict, with `noUncheckedIndexedAccess`. TypeScript 7 (the native compiler) is current, but `typescript-eslint` supports only versions below 6.1. Move to 7 when the lint tooling supports it.
- **ESLint 9** with type-aware `typescript-eslint` rules and strict `jsx-a11y` accessibility rules. ESLint 10 is current, but the accessibility and React plugins don't support it yet.
- **Prettier** for formatting. **Vitest** for unit and integration tests. **Playwright** for browser tests.
- **Package boundaries:**
  - Shared Node packages (`contracts`, `db`) build to `dist/` with `tsc`.
  - The design system (`ui`) is consumed as source by Next.js.
- **Node.js 26.** Node 25+ no longer ships Corepack, so pnpm is installed with `npm install -g pnpm@12`.

## Consequences

- One `pnpm install` and one lint and test run cover everything.
- `dev`, `typecheck` and `test` build the shared packages first (`dependsOn: ["^build"]`).
- Upgrading TypeScript or ESLint majors is blocked on plugin support; revisit each quarter.
