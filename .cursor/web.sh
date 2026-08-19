#!/usr/bin/env bash
# Trademark Terminal website dev server. Vite proxies /api to the local API.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

export TMTERMINAL_API_PORT="${TMTERMINAL_API_PORT:-3000}"
export VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY:-pk_test_unused}"

exec apps/web/node_modules/.bin/vite apps/web --host 127.0.0.1 --port 5173
