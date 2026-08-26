#!/usr/bin/env bash
# Per-boot reconciliation for Trademark Terminal Cloud Agents. Starts the
# isolated PostgreSQL cluster, ensures the databases exist, applies the current
# schema migrations, and refills the database with synthetic development data.
# Idempotent, and it returns.
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

# Migrations are not best-effort: the API and the integration lane both expect
# the current schema, so a failure here must stop the boot.
bun run db:migrate

# Synthetic development data, so a cloud session opens search, mark detail, and
# Source Status with a current week of trademark activity instead of empty
# states. Seeded per boot rather than baked into the environment snapshot,
# because the dataset is anchored to the current date and a week-old snapshot
# would show a week-old week. The seed only ever reaches the local cluster: it
# refuses any database host that is not loopback, and it fabricates every row
# rather than calling the USPTO Open Data Portal.
#
# Its receipt is the boot's own receipt — database target, the Merchbase user
# the Access Projection and the seeded account are attached to, row counts, and
# the day the newest applied source file covers — so it is printed rather than
# discarded. It carries no credential. Best-effort: a session must still boot if
# seeding fails.
echo "[start] Seeding synthetic development data."
if ! bun run db:seed:dev; then
  echo "[start] Skipping synthetic dev data (seed failed)." >&2
fi
