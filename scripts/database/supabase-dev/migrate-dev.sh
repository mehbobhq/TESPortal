#!/usr/bin/env bash
# Applies database/migrations to the Supabase DEVELOPMENT database as the migrator role, through the existing
# runner (scripts/database/migrate.sh: ledger, checksums, advisory lock, one transaction per migration).
# Inputs (environment; PGPASSWORD comes from a GitHub secret and is never printed):
#   TES_DATABASE_TARGET=supabase-dev, PGHOST, PGPORT=5432 (session mode), PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE=verify-full, PGSSLROOTCERT
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=guard-target.sh
. "$here/guard-target.sh"
tes_dev_guard "${TES_DEV_SESSION_PORT:-5432}" needs-user
case "$PGUSER" in
  "tes-database-migrator@tes-production-510007.iam"|"tes-database-migrator@tes-production-510007.iam".*) ;;
  *) echo "REFUSED: migrations must run as the tes-database-migrator role." >&2; exit 1;;
esac
[ -z "${PGOPTIONS:-}" ] || { echo "REFUSED: PGOPTIONS must not be set." >&2; exit 1; }
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"
bash "$here/../migrate.sh"
# Narrow, idempotent hardening of function privileges (does not touch any migration).
psql -X -q --no-password -v ON_ERROR_STOP=1 -f "$here/harden.sql"
