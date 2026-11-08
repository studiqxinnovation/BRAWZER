# Brawzer egress service (ADR 0014): the only way out of a cloud browser
# session's network, and the runner of proxy tests. Build from the root:
#   docker build -f apps/egress/Dockerfile -t brawzer-egress:dev .
# The container starts as root to install the firewall (CAP_NET_ADMIN) and
# the process drops to the `egress` user before it listens; the orchestrator
# grants NET_ADMIN, SETUID and SETGID and nothing else.

ARG NODE_IMAGE=node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

FROM ${NODE_IMAGE} AS build
ENV CI=true
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/egress/package.json apps/egress/
COPY packages/contracts/package.json packages/contracts/
COPY packages/net-policy/package.json packages/net-policy/
COPY packages/proxy-client/package.json packages/proxy-client/
RUN pnpm install --frozen-lockfile --filter "@brawzer/egress..."
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/net-policy packages/net-policy
COPY packages/proxy-client packages/proxy-client
COPY apps/egress apps/egress
RUN pnpm --filter "@brawzer/egress..." run build \
  && pnpm --filter @brawzer/egress deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends nftables tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10002 --user-group --no-create-home --shell /usr/sbin/nologin egress
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 7001 7002
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
