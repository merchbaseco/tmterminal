#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Trademark Terminal. Provisions the toolchain,
# workspace dependencies, and an isolated PostgreSQL cluster for development and
# integration tests.
#
# There is no .env step: the committed .env.schema is the environment contract
# and values resolve from 1Password through the fleet-wide Development identity
# that Cursor injects as an account-scoped Runtime Secret.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

# Pinned so `bunx varlock` behaves identically before node_modules exists.
VARLOCK_VERSION="1.16.1"

# 1. Bun toolchain, pinned to the repository version.
bun_version="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "$bun_version" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${bun_version}"
fi
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! grep -q 'BUN_INSTALL' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport BUN_INSTALL="$HOME/.bun"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n' >> "$HOME/.bashrc"
fi
sudo ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun

# 2. System PostgreSQL 16 (matches the Compose and production database major).
#    Pipelining is disabled because some build-network proxies answer pipelined
#    archive.ubuntu.com requests with HTTP 400.
if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  apt_opts=(-o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 -o Acquire::http::No-Cache=true)
  sudo apt-get "${apt_opts[@]}" update
  sudo DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" install -y postgresql postgresql-client
fi

# 3. Workspace dependencies. Both credentials are @internal schema items, so
#    `varlock run` deliberately does not export them; they are fetched
#    explicitly under the install switch and resolved from the Development
#    vault via the Cursor fleet identity. .npmrc reads
#    MERCHBASE_GITHUB_NPM_TOKEN for the @merchbaseco GitHub Packages scope;
#    bunfig.toml reads MERCHBASE_HUGEICONS_LICENSE_KEY for @hugeicons-pro.
if [ -z "${MERCHBASE_GITHUB_NPM_TOKEN:-}" ]; then
  MERCHBASE_GITHUB_NPM_TOKEN="$(
    TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx "varlock@${VARLOCK_VERSION}" printenv MERCHBASE_GITHUB_NPM_TOKEN
  )"
fi
: "${MERCHBASE_GITHUB_NPM_TOKEN:?MERCHBASE_GITHUB_NPM_TOKEN did not resolve; @merchbaseco/access cannot be installed}"

if [ -z "${MERCHBASE_HUGEICONS_LICENSE_KEY:-}" ]; then
  MERCHBASE_HUGEICONS_LICENSE_KEY="$(
    TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx "varlock@${VARLOCK_VERSION}" printenv MERCHBASE_HUGEICONS_LICENSE_KEY
  )"
fi
: "${MERCHBASE_HUGEICONS_LICENSE_KEY:?MERCHBASE_HUGEICONS_LICENSE_KEY did not resolve; @hugeicons-pro cannot be installed}"

export MERCHBASE_GITHUB_NPM_TOKEN MERCHBASE_HUGEICONS_LICENSE_KEY
bun install --frozen-lockfile

# 4. Isolated PostgreSQL cluster owned by the agent user. The data directory is
#    captured in the environment snapshot; the daemon starts per boot.
# shellcheck source=.cursor/postgres-lib.sh
. "$root/.cursor/postgres-lib.sh"
sudo mkdir -p "$PG_ROOT"
sudo chown -R "$(id -un):$(id -gn)" "$PG_ROOT"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  "$PG_BIN/initdb" --pgdata="$PGDATA" --username=postgres --auth=trust --encoding=UTF8 >/dev/null
fi
pg_start

# The schema's development arm points at the Mac mini over Tailscale, which a
# cloud VM cannot reach. Override that one public value for this session; the
# password still resolves from the Development vault and provisions the role.
export TMTERMINAL_DATABASE_HOST=127.0.0.1
pg_ensure_databases
