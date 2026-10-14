# Trademark Terminal cloud agent session exports, sourced by the fleet start and
# every session shell. The pinned Bun lives in ~/.bun, and the database is the
# loopback cluster .agents/cloud/start.sh starts.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
export TMTERMINAL_DATABASE_HOST=127.0.0.1
