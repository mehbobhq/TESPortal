#!/usr/bin/env bash
# Runs check.mjs against the Supabase DEVELOPMENT database through the REAL application adapter, as the backend role, on the
# port given by TES_BACKEND_PORT (6543 = transaction pooler, as the Vercel Preview uses). Builds the adapter's connection string
# in memory from the same secrets as the other actions; nothing is printed.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../guard-target.sh
. "$here/../guard-target.sh"
tes_dev_guard "" || exit 2
: "${TES_BACKEND_USER:?}" "${TES_BACKEND_PASSWORD:?}" "${TES_APP_PATH_CLERK_USER_ID:?}" "${TES_SUPABASE_DEV_CA_PEM:?}"
port="${TES_BACKEND_PORT:-6543}"
TES_SUPABASE_DEV_DATABASE_URL="$(B_HOST="$PGHOST" B_DB="$PGDATABASE" B_USER="$TES_BACKEND_USER" B_PASS="$TES_BACKEND_PASSWORD" B_PORT="$port" node -e 'const e=process.env;process.stdout.write("postgresql://"+encodeURIComponent(e.B_USER)+":"+encodeURIComponent(e.B_PASS)+"@"+e.B_HOST+":"+e.B_PORT+"/"+encodeURIComponent(e.B_DB))')"
export TES_SUPABASE_DEV_DATABASE_URL TES_DATABASE_PROVIDER=supabase-dev
unset TES_CLOUD_SQL_INSTANCE TES_POSTGRES_IAM_USER VERCEL_ENV TES_ENVIRONMENT
cd "$here/../../../.." || exit 1
node --experimental-strip-types --no-warnings --import ./scripts/database/supabase-dev/app-path/register.mjs scripts/database/supabase-dev/app-path/check.mjs 2>&1 | grep -E '^app_path:'
exit "${PIPESTATUS[0]}"
