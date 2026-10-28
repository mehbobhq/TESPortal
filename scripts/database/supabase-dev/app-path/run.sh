#!/usr/bin/env bash
# Runs check.mjs against the Supabase DEVELOPMENT database through the REAL application adapter, as the backend role, on the
# port given by TES_BACKEND_PORT (6543 = transaction pooler, as the Vercel Preview uses). Passes the same secrets as the other actions
# through the adapter's separate-variable form; nothing is printed.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../guard-target.sh
. "$here/../guard-target.sh"
tes_dev_guard "" || exit 2
: "${TES_BACKEND_USER:?}" "${TES_BACKEND_PASSWORD:?}" "${TES_APP_PATH_CLERK_USER_ID:?}" "${TES_SUPABASE_DEV_CA_PEM:?}"
port="${TES_BACKEND_PORT:-6543}"
# The same separate-variable form the Vercel Preview uses (no connection string to build or encode).
export TES_SUPABASE_DEV_DB_HOST="$PGHOST" TES_SUPABASE_DEV_DB_USER="$TES_BACKEND_USER" TES_SUPABASE_DEV_DB_PASSWORD="$TES_BACKEND_PASSWORD" TES_SUPABASE_DEV_DB_PORT="$port" TES_SUPABASE_DEV_DB_NAME="$PGDATABASE"
export TES_DATABASE_PROVIDER=supabase-dev
unset TES_SUPABASE_DEV_DATABASE_URL
unset TES_CLOUD_SQL_INSTANCE TES_POSTGRES_IAM_USER VERCEL_ENV TES_ENVIRONMENT
cd "$here/../../../.." || exit 1
node --experimental-strip-types --no-warnings --import ./scripts/database/supabase-dev/app-path/register.mjs scripts/database/supabase-dev/app-path/check.mjs 2>&1 | grep -E '^app_path:'
exit "${PIPESTATUS[0]}"
