FROM oven/bun:1.3.5-alpine AS workspace
WORKDIR /app

COPY package.json bun.lock bunfig.toml .npmrc tsconfig.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY packages/http-client/package.json packages/http-client/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN --mount=type=secret,id=merchbase_hugeicons_license_key,required=true \
  --mount=type=secret,id=merchbase_github_npm_token,required=true \
  MERCHBASE_HUGEICONS_LICENSE_KEY="$(cat /run/secrets/merchbase_hugeicons_license_key)" \
  MERCHBASE_GITHUB_NPM_TOKEN="$(cat /run/secrets/merchbase_github_npm_token)" \
  bun install --frozen-lockfile

COPY . .

FROM workspace AS test

FROM workspace AS runtime
ARG TMTERMINAL_REVISION=development
LABEL org.opencontainers.image.revision=$TMTERMINAL_REVISION
RUN rm -rf fixtures

FROM workspace AS web-build
ARG VITE_MERCHBASE_CLERK_PUBLISHABLE_KEY
ENV VITE_MERCHBASE_CLERK_PUBLISHABLE_KEY=$VITE_MERCHBASE_CLERK_PUBLISHABLE_KEY
RUN bun run --cwd apps/web build

FROM workspace AS docs-build
RUN bun run --cwd apps/docs build

FROM caddy:2.11.4-alpine AS web
ARG TMTERMINAL_REVISION=development
LABEL org.opencontainers.image.revision=$TMTERMINAL_REVISION
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
COPY --from=docs-build /app/apps/docs/.vitepress/dist /srv/docs
