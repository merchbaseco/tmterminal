FROM oven/bun:1.3.5-alpine AS workspace
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/http-client/package.json packages/http-client/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN bun install --frozen-lockfile

COPY . .

FROM workspace AS test

FROM workspace AS runtime
ARG TMTURTLE_REVISION=development
LABEL org.opencontainers.image.revision=$TMTURTLE_REVISION
RUN rm -rf fixtures

FROM workspace AS web-build
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN bun run --cwd apps/web build

FROM caddy:2.11.4-alpine AS web
ARG TMTURTLE_REVISION=development
LABEL org.opencontainers.image.revision=$TMTURTLE_REVISION
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
