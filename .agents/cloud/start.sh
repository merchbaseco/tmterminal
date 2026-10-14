#!/usr/bin/env bash
# Trademark Terminal per-session services, the repo-owned part of the fleet
# cloud agent contract. Same local development model as `bun run dev`: loopback
# Postgres, migrate, fabricated seed. It returns; the API and website run in
# Cursor terminals or, on Claude, from .agents/cloud/api.sh and web.sh.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
export TMTERMINAL_DATABASE_HOST=127.0.0.1

bash "$root/scripts/dev-db"
