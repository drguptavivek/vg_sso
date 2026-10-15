FROM node:22-alpine AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm version comes from package.json "packageManager".
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile

FROM deps AS migration
COPY . .
ENV NODE_ENV=production
CMD ["pnpm", "run", "db:migrate"]

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Build-time env is not required: this app reads Keycloak/NextAuth config at
# request time (server components / route handlers), not at build time.
RUN pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/.next/standalone ./
COPY --chown=node:node --from=build /app/.next/static ./.next/static

EXPOSE 3100
ENV PORT=3100
USER node
CMD ["node", "server.js"]
