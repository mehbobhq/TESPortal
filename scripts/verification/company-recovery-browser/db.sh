#!/usr/bin/env bash
set -euo pipefail
cd /home/user/TESPortal
MIGRATOR_ROLE="tes-database-migrator@tes-production-510007.iam"
RUNTIME_ROLE="tes-backend@tes-production-510007.iam"
DATABASE="tes_prod"
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -n 1)"
D=/tmp/e2e-pgdata
PORT=55432
rm -rf "$D"; mkdir -p "$D"; chown postgres "$D"; chmod 700 "$D"
runuser -u postgres -- "$PG_BIN/initdb" -D "$D/data" -A trust -U postgres >/dev/null
{ echo "port = $PORT"; echo "listen_addresses = '127.0.0.1'"; echo "unix_socket_directories = '$D'"; echo "fsync = off"; } >> "$D/data/postgresql.conf"
runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$D/data" -l "$D/server.log" -w start >/dev/null
P="env PGHOST=127.0.0.1 PGPORT=$PORT psql --no-psqlrc --no-password -v ON_ERROR_STOP=1 -q"
$P -U postgres -d postgres <<SQL
CREATE ROLE "$MIGRATOR_ROLE" LOGIN;
CREATE ROLE "$RUNTIME_ROLE" LOGIN;
CREATE DATABASE $DATABASE OWNER "$MIGRATOR_ROLE";
SQL
PGHOST=127.0.0.1 PGPORT=$PORT PGDATABASE="$DATABASE" PGUSER="$MIGRATOR_ROLE" bash scripts/database/migrate.sh >/dev/null
echo "READY $PORT"
