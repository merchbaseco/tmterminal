#!/usr/bin/env bash
# Trademark Terminal API against the isolated local database. Placeholder Clerk
# values let the server boot and serve the anonymous health and status routes;
# authenticated data procedures require real Clerk credentials, which override
# the placeholders when present in the environment.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# shellcheck source=.cursor/postgres-lib.sh
. "$root/.cursor/postgres-lib.sh"

export DATABASE_URL="postgres://${TMTERMINAL_DB_USER}:${TMTERMINAL_DB_PASSWORD}@127.0.0.1:5432/${TMTERMINAL_DB_NAME}"
export HOST=127.0.0.1
export PORT=3000
export NODE_ENV=development
export CLERK_ISSUER="${CLERK_ISSUER:-https://clerk.test}"
export CLERK_AUTHORIZED_PARTIES="${CLERK_AUTHORIZED_PARTIES:-http://127.0.0.1:5173}"
export CLERK_JWT_KEY="${CLERK_JWT_KEY:-unused-dev-key}"
export CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-pk_test_unused}"
export CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-sk_test_unused}"
export CLERK_WEBHOOK_SIGNING_SECRET="${CLERK_WEBHOOK_SIGNING_SECRET:-whsec_unused}"

exec bun run apps/server/src/server.ts
