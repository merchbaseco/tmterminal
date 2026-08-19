# Shared PostgreSQL locations and helpers for the Trademark Terminal Cloud Agent
# environment. Source this file; do not execute it directly.

PG_BIN=/usr/lib/postgresql/16/bin
PG_ROOT=/var/lib/tmterminal
PGDATA="$PG_ROOT/pgdata"
PG_SOCKET_DIR="$PG_ROOT/sockets"
PG_LOG="$PG_ROOT/postgres.log"

export PATH="$PG_BIN:$PATH"

TMTERMINAL_DB_USER=tmterminal
TMTERMINAL_DB_PASSWORD=change-me
TMTERMINAL_DB_NAME=tmterminal
TMTERMINAL_TEST_DB_NAME=tmterminal_test

pg_is_running() {
  "$PG_BIN/pg_ctl" --pgdata="$PGDATA" status >/dev/null 2>&1
}

pg_start() {
  mkdir -p "$PG_SOCKET_DIR"
  if pg_is_running; then
    return 0
  fi
  "$PG_BIN/pg_ctl" --pgdata="$PGDATA" --log="$PG_LOG" --wait \
    --options="-c listen_addresses=127.0.0.1 -c port=5432 -c unix_socket_directories=$PG_SOCKET_DIR" \
    start
}

pg_psql() {
  "$PG_BIN/psql" --host=127.0.0.1 --port=5432 --username=postgres --dbname=postgres \
    --no-align --tuples-only "$@"
}

pg_ensure_databases() {
  pg_psql --command="SELECT 1 FROM pg_roles WHERE rolname='$TMTERMINAL_DB_USER'" | grep -q 1 ||
    pg_psql --command="CREATE ROLE $TMTERMINAL_DB_USER LOGIN PASSWORD '$TMTERMINAL_DB_PASSWORD' SUPERUSER"
  pg_psql --command="SELECT 1 FROM pg_database WHERE datname='$TMTERMINAL_DB_NAME'" | grep -q 1 ||
    pg_psql --command="CREATE DATABASE $TMTERMINAL_DB_NAME OWNER $TMTERMINAL_DB_USER"
  pg_psql --command="SELECT 1 FROM pg_database WHERE datname='$TMTERMINAL_TEST_DB_NAME'" | grep -q 1 ||
    pg_psql --command="CREATE DATABASE $TMTERMINAL_TEST_DB_NAME OWNER $TMTERMINAL_DB_USER"
}
