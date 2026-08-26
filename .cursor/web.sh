#!/usr/bin/env bash
# Trademark Terminal website dev server. Vite proxies /api to the local API.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

export TMTERMINAL_API_PORT=3000

# Cursor forwards a session's ports by watching the VM for listening sockets,
# and the repository's default loopback bind is invisible to that watcher, so
# the agent's browser could never reach the website. Widening the socket is all
# this does: the website still serves the loopback origin Clerk authorizes.
export TMTERMINAL_DEV_HOST=0.0.0.0

# The website signs in automatically as the shared Merchbase Dev Sign-In user,
# through the development endpoint the API exposes on this machine, so a cloud
# session opens on data views instead of a sign-in wall. Dev builds only.
export VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN=true

exec bunx varlock run -- apps/web/node_modules/.bin/vite apps/web --port 5173
