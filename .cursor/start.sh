#!/usr/bin/env bash
# Per-boot reconciliation for Trademark Terminal. Starts the isolated PostgreSQL
# cluster, ensures the development and test databases exist, and applies the
# current schema migrations. It must be idempotent and return.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# shellcheck source=.cursor/postgres-lib.sh
. "$root/.cursor/postgres-lib.sh"

pg_start
pg_ensure_databases

DATABASE_URL="postgres://${TMTERMINAL_DB_USER}:${TMTERMINAL_DB_PASSWORD}@127.0.0.1:5432/${TMTERMINAL_DB_NAME}"
export DATABASE_URL
bun run db:migrate
