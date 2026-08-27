#!/usr/bin/env bash
# VitePress product docs. The website proxies /docs here in development.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# Same bind reason as the website: Cursor finds ports by watching sockets.
host="${TMTERMINAL_DEV_HOST:-0.0.0.0}"

exec bunx varlock run -- apps/docs/node_modules/.bin/vitepress dev apps/docs --port 5174 --host "$host"
