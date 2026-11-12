# Brawzer web image. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t brawzer-web \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://brawzer.example \
#     --build-arg API_INTERNAL_URL=http://api:4100 .
# Both values are part of the build: the site URL appears in metadata and
# enables HTTPS-only headers, and /api/v1 forwarding is fixed at build time.

ARG NODE_IMAGE=node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

FROM ${NODE_IMAGE} AS build
ARG NEXT_PUBLIC_SITE_URL
ARG API_INTERNAL_URL=http://api:4100
ENV CI=true \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    API_INTERNAL_URL=${API_INTERNAL_URL}
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter "@brawzer/web..."
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter "@brawzer/web..." run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3100
WORKDIR /app
# Next.js standalone output: the server and only the files it needs.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Static files (the wallpapers): standalone output doesn't carry them itself.
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
