# Shared PostgreSQL locations for the Trademark Terminal Cloud Agent
# environment. Source this file; do not execute it directly.
#
# The cluster listens on the schema's development database port so a cloud
# session overrides exactly ONE public value — TMTERMINAL_DATABASE_HOST — and
# nothing else. Credentials are never hard-coded here: the role is provisioned
# with the same password the server will resolve from the Development vault.

PG_BIN=/usr/lib/postgresql/16/bin
PG_ROOT=/var/lib/tmterminal
PGDATA="$PG_ROOT/pgdata"
PG_SOCKET_DIR="$PG_ROOT/sockets"
PG_LOG="$PG_ROOT/postgres.log"
PG_PORT=5437

export PATH="$PG_BIN:$PATH"

pg_is_running() {
  "$PG_BIN/pg_ctl" --pgdata="$PGDATA" status >/dev/null 2>&1
}

pg_start() {
  mkdir -p "$PG_SOCKET_DIR"
  if pg_is_running; then
    return 0
  fi
  "$PG_BIN/pg_ctl" --pgdata="$PGDATA" --log="$PG_LOG" --wait \
    --options="-c listen_addresses=127.0.0.1 -c port=$PG_PORT -c unix_socket_directories=$PG_SOCKET_DIR" \
    start
}

pg_psql() {
  "$PG_BIN/psql" --host=127.0.0.1 --port="$PG_PORT" --username=postgres --dbname=postgres \
    --no-align --tuples-only "$@"
}

# Creates the development role and both databases using the credential the
# schema resolves. Values move through psql variables and are never printed.
pg_ensure_databases() {
  db_user="$(bunx varlock printenv TMTERMINAL_DATABASE_USER)"
  db_name="$(bunx varlock printenv TMTERMINAL_DATABASE_NAME)"
  db_password="$(bunx varlock printenv TMTERMINAL_DATABASE_PASSWORD)"
  test_db_name="tmterminal_test"

  pg_psql -v ON_ERROR_STOP=1 \
    -v db_user="$db_user" -v db_name="$db_name" -v test_db_name="$test_db_name" \
    -v db_password="$db_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN SUPERUSER PASSWORD %L', :'db_user', :'db_password')
    WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'db_user')\gexec
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'db_user', :'db_password')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name')\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'test_db_name', :'db_user')
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'test_db_name')\gexec
SQL
}
