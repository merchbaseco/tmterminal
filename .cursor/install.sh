#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Trademark Terminal. Runs after checkout to
# provision the toolchain, workspace dependencies, and an isolated PostgreSQL
# cluster for development and integration tests.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

# 1. Bun toolchain, pinned to the repository version.
bun_version="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "$bun_version" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${bun_version}"
fi
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun

# 2. System PostgreSQL 16 (matches the Compose and production database major).
#    Pipelining is disabled because some build-network proxies answer pipelined
#    archive.ubuntu.com requests with HTTP 400.
if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  apt_opts=(-o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 -o Acquire::http::No-Cache=true)
  sudo apt-get "${apt_opts[@]}" update
  sudo DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" install -y postgresql postgresql-client
fi

# 3. Workspace dependencies. Both credentials are install-time only.
#    .npmrc reads NODE_AUTH_TOKEN for the @merchbaseco GitHub Packages scope; the
#    token is supplied as the MERCHBASE_GITHUB_NPM_TOKEN secret (falling back to
#    an ambient NODE_AUTH_TOKEN or a local gh credential for other setups).
if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  if [ -n "${MERCHBASE_GITHUB_NPM_TOKEN:-}" ]; then
    NODE_AUTH_TOKEN="$MERCHBASE_GITHUB_NPM_TOKEN"
  elif command -v gh >/dev/null 2>&1; then
    NODE_AUTH_TOKEN="$(gh auth token 2>/dev/null || true)"
  fi
fi
: "${NODE_AUTH_TOKEN:?Set MERCHBASE_GITHUB_NPM_TOKEN (read:packages for the merchbaseco org) to install @merchbaseco/access}"
: "${HUGEICONS_LICENSE_KEY:?HUGEICONS_LICENSE_KEY is required to install the private @hugeicons-pro packages}"
export NODE_AUTH_TOKEN HUGEICONS_LICENSE_KEY
bun install --frozen-lockfile

# 4. Isolated PostgreSQL cluster owned by the agent user. The data directory is
#    captured in the environment snapshot; the daemon itself is started per boot.
# shellcheck source=.cursor/postgres-lib.sh
. "$root/.cursor/postgres-lib.sh"
sudo mkdir -p "$PG_ROOT"
sudo chown -R "$(id -un):$(id -gn)" "$PG_ROOT"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  "$PG_BIN/initdb" --pgdata="$PGDATA" --username=postgres --auth=trust --encoding=UTF8 >/dev/null
fi
pg_start
pg_ensure_databases
