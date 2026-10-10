#!/usr/bin/env bash
set -euo pipefail

# Runs the authorization test suite against a DISPOSABLE local PostgreSQL.
#
# It never touches a shared or production database: it starts a throwaway cluster in
# a temporary directory on a free local port, creates the two TES database roles,
# applies the repository's real migrations with scripts/database/migrate.sh (so the
# schema under test is exactly what production runs), runs the tests, and always
# tears the cluster down.
#
# To use your own disposable database instead, export both
#   TES_TEST_ADMIN_DATABASE_URL    migration identity (fixtures only)
#   TES_TEST_RUNTIME_DATABASE_URL  runtime role (the code under test runs as this)
# with migrations already applied; the cluster step is then skipped.
#
# Requires PostgreSQL server binaries (initdb, pg_ctl, psql) on the machine.

cd "$(dirname "$0")/../.."

MIGRATOR_ROLE="tes-database-migrator@tes-production-510007.iam"
RUNTIME_ROLE="tes-backend@tes-production-510007.iam"
DATABASE="tes_prod"

run_tests() {
  TES_REQUIRE_DB_TESTS=1 node --test --test-concurrency=1 "$@" test/lib/auth/*.test.ts test/lib/corporate-identity/*.test.ts test/lib/organization-locations/*.test.ts test/lib/operating-authorities/*.test.ts
}

if [[ -n "${TES_TEST_ADMIN_DATABASE_URL:-}" && -n "${TES_TEST_RUNTIME_DATABASE_URL:-}" ]]; then
  run_tests "$@"
  exit $?
fi

# Locate PostgreSQL server binaries.
PG_BIN=""
if command -v pg_config >/dev/null 2>&1; then
  PG_BIN="$(pg_config --bindir)"
fi
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
fi
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL server binaries (initdb) not found. Install PostgreSQL or set the TES_TEST_* URLs." >&2
  exit 1
fi

DATA_DIR="$(mktemp -d -t tes-auth-test.XXXXXX)"
PORT="${TES_TEST_PG_PORT:-$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"

# PostgreSQL refuses to run as root; use the postgres OS user when we are root.
as_pg() {
  if [[ "$(id -u)" == "0" ]]; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}
if [[ "$(id -u)" == "0" ]]; then
  chown postgres "$DATA_DIR"
  chmod 700 "$DATA_DIR"
fi

cleanup() {
  as_pg "$PG_BIN/pg_ctl" -D "$DATA_DIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

as_pg "$PG_BIN/initdb" -D "$DATA_DIR/data" -A trust -U postgres >/dev/null
{
  echo "port = $PORT"
  echo "listen_addresses = '127.0.0.1'"
  echo "unix_socket_directories = '$DATA_DIR'"
  echo "fsync = off"
} >> "$DATA_DIR/data/postgresql.conf"
as_pg "$PG_BIN/pg_ctl" -D "$DATA_DIR/data" -l "$DATA_DIR/server.log" -w start >/dev/null

psql_admin() {
  PGHOST=127.0.0.1 PGPORT="$PORT" psql --no-psqlrc --no-password -v ON_ERROR_STOP=1 -q "$@"
}

psql_admin -U postgres -d postgres <<SQL
CREATE ROLE "$MIGRATOR_ROLE" LOGIN;
CREATE ROLE "$RUNTIME_ROLE" LOGIN;
CREATE DATABASE $DATABASE OWNER "$MIGRATOR_ROLE";
SQL

# Apply the repository's real migrations with the repository's real runner.
PGHOST=127.0.0.1 PGPORT="$PORT" PGDATABASE="$DATABASE" PGUSER="$MIGRATOR_ROLE" \
  bash scripts/database/migrate.sh >/dev/null

export TES_TEST_ADMIN_DATABASE_URL="postgres://$(printf '%s' "$MIGRATOR_ROLE" | sed 's/@/%40/g')@127.0.0.1:$PORT/$DATABASE"
export TES_TEST_RUNTIME_DATABASE_URL="postgres://$(printf '%s' "$RUNTIME_ROLE" | sed 's/@/%40/g')@127.0.0.1:$PORT/$DATABASE"

set +e
run_tests "$@"
status=$?
set -e
exit "$status"
