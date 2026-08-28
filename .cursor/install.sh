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
#    VARLOCK_SPEC pins the version so this works before node_modules exists.
# shellcheck source=scripts/install-tokens
VARLOCK_SPEC="varlock@${VARLOCK_VERSION}" . "$root/scripts/install-tokens"
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

# Development is loopback. The password still resolves from the Development
# vault and provisions the local role.
export TMTERMINAL_DATABASE_HOST=127.0.0.1
pg_ensure_databases

# 5. Shared agent skills (fleet dev environment parity). Cursor discovers Agent
#    Skills from .agents/skills in the checkout. Locally the operator's
#    home-directory links already provide the fleet skill library; in the cloud
#    VM it is seeded from the private agents repo, read with the fine-grained
#    PAT that Cursor injects as the account-level Runtime Secret
#    CURSOR_CLOUD_AGENTS_GH_READ_TOKEN. Agent tooling is not part of this
#    repository's environment contract, so the PAT lives in Cursor's own secret
#    store rather than in .env.schema, and nothing here touches varlock. The
#    tarball fetch leaves no credential or git state on disk. Always refetched
#    into $HOME/.agents/upstream so setup/seed-cloud.sh can symlink skills,
#    pstack, and the model rule. Snapshot reuse cannot pin a stale copy.
#    Best-effort: every failure path logs and skips — seeding must never fail
#    the install. CURSOR_CLOUD_AGENTS_REF overrides the git ref (default main).
if [ -n "${CURSOR_CLOUD_AGENTS_GH_READ_TOKEN:-}" ]; then
  agents_upstream="${HOME}/.agents/upstream"
  agents_ref="${CURSOR_CLOUD_AGENTS_REF:-main}"
  rm -rf "$agents_upstream"
  mkdir -p "$agents_upstream"
  if curl -fsSL -H "Authorization: Bearer $CURSOR_CLOUD_AGENTS_GH_READ_TOKEN" \
    "https://api.github.com/repos/zknicker/agents/tarball/${agents_ref}" \
    | tar -xz -C "$agents_upstream" --strip-components=1; then
    if [ -f "$agents_upstream/setup/seed-cloud.sh" ]; then
      if bash "$agents_upstream/setup/seed-cloud.sh" \
        --skills "$root/.agents/skills" \
        --rules "$root/.cursor/rules" \
        --plugin-local "${HOME}/.cursor/plugins/local"; then
        echo "[install] Linked fleet agent skills from ${agents_ref}."
      else
        echo "[install] Skipping fleet agent skills (seed-cloud.sh failed)." >&2
      fi
    else
      echo "[install] Skipping fleet agent skills (seed-cloud.sh unavailable)." >&2
    fi
  else
    echo "[install] Skipping fleet agent skills (tarball fetch failed)." >&2
  fi
else
  echo "[install] Skipping fleet agent skills (no read token)." >&2
fi
