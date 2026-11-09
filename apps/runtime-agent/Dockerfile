# Brawzer cloud browser runtime: Debian's Chromium plus the runtime agent.
# Build from the repository root:
#   docker build -f apps/runtime-agent/Dockerfile -t brawzer-runtime:dev .
# The orchestrator starts one container per session with a read-only root
# file system, no capabilities and the seccomp profile in apps/api/src/browser.

ARG NODE_IMAGE=node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

FROM ${NODE_IMAGE} AS build
ENV CI=true
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/runtime-agent/package.json apps/runtime-agent/
COPY packages/contracts/package.json packages/contracts/
COPY packages/net-policy/package.json packages/net-policy/
RUN pnpm install --frozen-lockfile --filter "@brawzer/runtime-agent..."
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/net-policy packages/net-policy
COPY apps/runtime-agent apps/runtime-agent
RUN pnpm --filter "@brawzer/runtime-agent..." run build \
  && pnpm --filter @brawzer/runtime-agent deploy --prod /out
# The extension catalogue (ADR 0018): each build fetched and checked against its pinned hash.
RUN apt-get update -qq && apt-get install -y --no-install-recommends unzip >/dev/null && rm -rf /var/lib/apt/lists/* \
  && cd apps/runtime-agent && node scripts/fetch-extensions.mjs /out-extensions /opt/brawzer/extensions

FROM ${NODE_IMAGE} AS runtime
# Debian's Chromium (the base of Bee, Brawzer's own browser) and Firefox ESR
# (security updates arrive with image rebuilds), fonts for most scripts, and
# tini to reap processes as PID 1.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium firefox-esr fonts-liberation fonts-noto-core fonts-noto-color-emoji tini ca-certificates \
    pulseaudio pulseaudio-utils \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin browser
# Managed policies: enforced by the engine itself, whatever a page does.
COPY apps/runtime-agent/policies.json /etc/chromium/policies/managed/brawzer.json
COPY apps/runtime-agent/policies-firefox.json /usr/lib/firefox-esr/distribution/policies.json
COPY --from=build /out-extensions /opt/brawzer/extensions
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
ENV NODE_ENV=production \
    CHROMIUM_BIN=/usr/bin/chromium \
    FIREFOX_BIN=/usr/bin/firefox-esr \
    BRAWZER_SCRATCH_DIR=/tmp \
    BRAWZER_AGENT_PORT=7000
USER browser
EXPOSE 7000
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
