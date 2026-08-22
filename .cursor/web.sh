#!/usr/bin/env bash
# Trademark Terminal website dev server. Vite proxies /api to the local API.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

export TMTERMINAL_API_PORT=3000

exec bunx varlock run -- apps/web/node_modules/.bin/vite apps/web --host 127.0.0.1 --port 5173
