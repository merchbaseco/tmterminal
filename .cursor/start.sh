#!/usr/bin/env bash
# Per-boot reconciliation for Trademark Terminal Cloud Agents. Same local
# development model as `bun run dev`: loopback Postgres, migrate, fabricated seed.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
export TMTERMINAL_DATABASE_HOST=127.0.0.1

bash "$root/scripts/dev-db"
