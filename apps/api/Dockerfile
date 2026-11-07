# Brawzer API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t brawzer-api .
# Run migrations once per release with the same image:
#   docker run --rm -e DATABASE_URL=... brawzer-api node dist/migrate.js

# Node 26.12 on Debian bookworm, pinned by digest so every build uses the same base.
ARG NODE_IMAGE=node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

FROM ${NODE_IMAGE} AS build
ENV CI=true
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
WORKDIR /repo
# Manifests first, so dependencies are only reinstalled when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/net-policy/package.json packages/net-policy/
RUN pnpm install --frozen-lockfile --filter "@brawzer/api..."
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/net-policy packages/net-policy
COPY apps/api apps/api
RUN pnpm --filter "@brawzer/api..." run build \
  && pnpm --filter @brawzer/api deploy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4100
WORKDIR /app
# Files belong to root; the API runs as the unprivileged `node` user and can't change them.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
