#!/usr/bin/env bash
# Trademark Terminal API against the isolated local database. Every value comes
# from the committed .env.schema, resolved through the Cursor fleet Development
# identity; only the database host is overridden for the local cluster.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

export TMTERMINAL_DATABASE_HOST=127.0.0.1
# Same reason as the website's TMTERMINAL_DEV_HOST: Cursor detects a session's
# ports by watching for listening sockets, so a loopback-only API is never
# forwarded. The development sign-in endpoint stays closed to anything but a
# caller on this machine regardless of the bind address.
export TMTERMINAL_HOST=0.0.0.0
export TMTERMINAL_PORT=3000
export NODE_ENV=development

exec bunx varlock run -- bun run apps/server/src/server.ts
