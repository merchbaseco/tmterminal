#!/usr/bin/env bash
# Per-boot reconciliation for Trademark Terminal Cloud Agents. Same local
# development model as `bun run dev`: loopback Postgres, migrate, fabricated seed.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$root"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
export TMTERMINAL_DATABASE_HOST=127.0.0.1

bash "$root/scripts/dev-db"

# Fleet agents. Fetch on every boot so a reused snapshot cannot pin a stale copy.
if [ -n "${CURSOR_CLOUD_AGENTS_GH_READ_TOKEN:-}" ]; then
  agents_tmp="$(mktemp -d)" || agents_tmp=""
  if [ -n "$agents_tmp" ] &&
    curl -fsSL -H "Authorization: Bearer $CURSOR_CLOUD_AGENTS_GH_READ_TOKEN" \
      https://api.github.com/repos/zknicker/agents/tarball/main \
      | tar -xz -C "$agents_tmp"; then
    agents_src=""
    for agents_candidate in "$agents_tmp"/*; do
      if [ -f "$agents_candidate/cursor/seed-cloud.sh" ]; then
        agents_src="$agents_candidate"
        break
      fi
    done
    if [ -n "$agents_src" ]; then
      rm -rf "$HOME/.agents/upstream"
      mkdir -p "$HOME/.agents"
      mv "$agents_src" "$HOME/.agents/upstream"
      if bash "$HOME/.agents/upstream/cursor/seed-cloud.sh" --repo-root "$root"; then
        echo "[start] Seeded fleet agents from zknicker/agents."
      else
        echo "[start] Skipping fleet agents (seed-cloud.sh failed)." >&2
      fi
    else
      echo "[start] Skipping fleet agents (seed-cloud.sh missing)." >&2
    fi
  else
    echo "[start] Skipping fleet agents (tarball fetch failed)." >&2
  fi
  rm -rf "$agents_tmp" || true
else
  echo "[start] Skipping fleet agents (no read token)." >&2
fi
