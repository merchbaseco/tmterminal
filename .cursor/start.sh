#!/usr/bin/env bash
# Per-boot reconciliation for Trademark Terminal Cloud Agents. Starts the
# isolated PostgreSQL cluster, ensures the databases exist, and applies the
# current schema migrations. Idempotent, and it returns.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# A cloud VM has no Tailscale, so the schema's development database host is
# replaced with the local cluster for this session. Nothing sensitive is
# overridden — the password still resolves from the Development vault.
export TMTERMINAL_DATABASE_HOST=127.0.0.1

# shellcheck source=.cursor/postgres-lib.sh
. "$root/.cursor/postgres-lib.sh"

pg_start
pg_ensure_databases

bun run db:migrate
