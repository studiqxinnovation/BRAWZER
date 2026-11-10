# Brawzer cloud browser runtime: Debian's Chromium (Bee, and Chromium as it
# is), Firefox ESR, Google Chrome and, on x86-64, Microsoft Edge, plus the
# runtime agent.
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

# Google's and Microsoft's package signing keys, each checked against its
# pinned fingerprint before apt may trust it. gnupg and curl stay in this
# stage, out of the runtime image.
FROM ${NODE_IMAGE} AS vendor-keys
ARG GOOGLE_SIGNING_FINGERPRINT=EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796
ARG MICROSOFT_SIGNING_FINGERPRINT=BC528686B50D79E339D3721CEB3E94ADBE1229CF
RUN apt-get update -qq && apt-get install -y --no-install-recommends gnupg curl ca-certificates >/dev/null \
  && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub -o /tmp/google.pub \
  && gpg --show-keys --with-colons /tmp/google.pub | awk -F: '$1 == "fpr" { print $10; exit }' > /tmp/google.fpr \
  && test "$(cat /tmp/google.fpr)" = "${GOOGLE_SIGNING_FINGERPRINT}" \
  && gpg --dearmor -o /google-chrome.gpg /tmp/google.pub \
  && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc -o /tmp/microsoft.asc \
  && gpg --show-keys --with-colons /tmp/microsoft.asc | awk -F: '$1 == "fpr" { print $10; exit }' > /tmp/microsoft.fpr \
  && test "$(cat /tmp/microsoft.fpr)" = "${MICROSOFT_SIGNING_FINGERPRINT}" \
  && gpg --dearmor -o /microsoft.gpg /tmp/microsoft.asc

FROM ${NODE_IMAGE} AS runtime
# Debian's Chromium (the base of Bee, Brawzer's own browser), Firefox ESR,
# Google Chrome from Google's own signed repository and, where Microsoft
# ships it (x86-64 only), Microsoft Edge from Microsoft's (security updates
# arrive with image rebuilds; the engine watch starts one when any of them
# moves), fonts for most scripts, and tini to reap processes as PID 1.
COPY --from=vendor-keys /google-chrome.gpg /usr/share/keyrings/google-chrome.gpg
COPY --from=vendor-keys /microsoft.gpg /usr/share/keyrings/microsoft.gpg
# Certificates first: the vendors' repositories are HTTPS.
RUN apt-get update -qq && apt-get install -y --no-install-recommends ca-certificates >/dev/null \
  && arch="$(dpkg --print-architecture)" \
  && echo "deb [arch=${arch} signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list \
  && edge="" \
  && if [ "${arch}" = "amd64" ]; then \
       echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/edge stable main" \
         > /etc/apt/sources.list.d/microsoft-edge.list; \
       edge="microsoft-edge-stable"; \
     fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium firefox-esr google-chrome-stable ${edge} fonts-liberation fonts-noto-core fonts-noto-color-emoji tini ca-certificates \
    pulseaudio pulseaudio-utils \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin browser
# Managed policies: enforced by the engine itself, whatever a page does. The
# locked ones live here; each engine's policy path points at the session's
# scratch space, where the agent writes them (locked, or with the profile's
# browser account on: ADR 0021) before any engine starts, and starts none if
# it can't.
COPY apps/runtime-agent/policies.json /opt/brawzer/policies/chromium.json
COPY apps/runtime-agent/policies-firefox.json /opt/brawzer/policies/firefox.json
RUN mkdir -p /etc/chromium/policies/managed /etc/opt/chrome/policies/managed /etc/opt/edge/policies/managed \
    /usr/lib/firefox-esr/distribution \
  && ln -sf /tmp/brawzer-policy/chromium.json /etc/chromium/policies/managed/brawzer.json \
  && ln -sf /tmp/brawzer-policy/chromium.json /etc/opt/chrome/policies/managed/brawzer.json \
  && ln -sf /tmp/brawzer-policy/edge.json /etc/opt/edge/policies/managed/brawzer.json \
  && ln -sf /tmp/brawzer-policy/firefox.json /usr/lib/firefox-esr/distribution/policies.json
COPY --from=build /out-extensions /opt/brawzer/extensions
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
ENV NODE_ENV=production \
    CHROMIUM_BIN=/usr/bin/chromium \
    FIREFOX_BIN=/usr/bin/firefox-esr \
    CHROME_BIN=/usr/bin/google-chrome-stable \
    EDGE_BIN=/usr/bin/microsoft-edge-stable \
    BRAWZER_SCRATCH_DIR=/tmp \
    BRAWZER_AGENT_PORT=7000
USER browser
EXPOSE 7000
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
