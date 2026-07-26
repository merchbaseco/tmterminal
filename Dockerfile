FROM oven/bun:1.3.5-alpine AS workspace
WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/http-client/package.json packages/http-client/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN --mount=type=secret,id=hugeicons_license_key,required=true \
  HUGEICONS_LICENSE_KEY="$(cat /run/secrets/hugeicons_license_key)" bun install --frozen-lockfile

COPY . .

FROM workspace AS test

FROM workspace AS runtime
ARG TMTERMINAL_REVISION=development
LABEL org.opencontainers.image.revision=$TMTERMINAL_REVISION
RUN rm -rf fixtures

FROM workspace AS web-build
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN bun run --cwd apps/web build

FROM caddy:2.11.4-alpine AS web
ARG TMTERMINAL_REVISION=development
LABEL org.opencontainers.image.revision=$TMTERMINAL_REVISION
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
