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
export TMTERMINAL_HOST=127.0.0.1
export TMTERMINAL_PORT=3000
export NODE_ENV=development

exec bunx varlock run -- bun run apps/server/src/server.ts
