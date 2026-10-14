#!/usr/bin/env bash
# Trademark Terminal cloud agent install, the repo-owned part of the fleet
# cloud agent contract (zknicker/agents cloud-agent-setup skill). Cursor runs it
# as its snapshot install; Claude runs it from the fleet start each session.
# Idempotent: provisions the toolchain, workspace dependencies, and an isolated
# PostgreSQL cluster for development and integration tests.
#
# There is no .env step: the committed .env.schema is the environment contract
# and values resolve from 1Password through the fleet-wide Development identity
# each platform provides as CLOUD_AGENTS_DEVELOPMENT_OP_TOKEN.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# Claude cloud runs as root without sudo; Cursor runs as a sudo-capable user.
if [ "$(id -u)" -eq 0 ]; then
  as_root=()
else
  as_root=(sudo)
fi

# Pinned so `bunx varlock` behaves identically before node_modules exists.
VARLOCK_VERSION="1.16.1"

# 1. Bun toolchain, pinned to the repository version. A cloud image can already
#    carry another repo's Bun, so any version mismatch reinstalls.
bun_version="$(sed -n 's/.*"packageManager": "bun@\([^"]*\)".*/\1/p' package.json)"
if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version 2>/dev/null || true)" != "$bun_version" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v${bun_version}"
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! grep -q 'BUN_INSTALL' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport BUN_INSTALL="$HOME/.bun"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n' >> "$HOME/.bashrc"
fi
"${as_root[@]}" ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun
"${as_root[@]}" ln -sf "$BUN_INSTALL/bin/bunx" /usr/local/bin/bunx

# 2. System PostgreSQL 16 (matches the Compose and production database major).
#    Pipelining is disabled because some build-network proxies answer pipelined
#    archive.ubuntu.com requests with HTTP 400.
if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  apt_opts=(-o Acquire::Retries=5 -o Acquire::http::Pipeline-Depth=0 -o Acquire::http::No-Cache=true)
  "${as_root[@]}" apt-get "${apt_opts[@]}" update
  "${as_root[@]}" env DEBIAN_FRONTEND=noninteractive apt-get "${apt_opts[@]}" install -y postgresql postgresql-client
fi

# 3. Workspace dependencies. Both credentials are @internal schema items, so
#    `varlock run` deliberately does not export them; they are fetched
#    explicitly under the install switch and resolved from the Development
#    vault via the fleet identity. .npmrc reads MERCHBASE_GITHUB_NPM_TOKEN for
#    the @merchbaseco GitHub Packages scope; bunfig.toml reads
#    MERCHBASE_HUGEICONS_LICENSE_KEY for @hugeicons-pro. VARLOCK_SPEC pins the
#    version so this works before node_modules exists.
# shellcheck source=scripts/install-tokens
VARLOCK_SPEC="varlock@${VARLOCK_VERSION}" . "$root/scripts/install-tokens"
timeout 900 bun install --frozen-lockfile || { echo "[install] ERROR: bun install failed or timed out" >&2; exit 1; }

# 4. Isolated PostgreSQL cluster. PostgreSQL refuses to run as root, so on a
#    root host the cluster belongs to the postgres account (postgres-lib.sh).
#    The data directory survives in the environment snapshot; the daemon
#    starts per session.
# shellcheck source=.agents/cloud/postgres-lib.sh
. "$root/.agents/cloud/postgres-lib.sh"
"${as_root[@]}" mkdir -p "$PG_ROOT"
"${as_root[@]}" chown -R "$PG_OWNER:$(id -gn "$PG_OWNER")" "$PG_ROOT"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  pg_as_owner "$PG_BIN/initdb" --pgdata="$PGDATA" --username=postgres --auth=trust --encoding=UTF8 >/dev/null
fi
pg_start

# Development is loopback. The password still resolves from the Development
# vault and provisions the local role.
export TMTERMINAL_DATABASE_HOST=127.0.0.1
pg_ensure_databases
