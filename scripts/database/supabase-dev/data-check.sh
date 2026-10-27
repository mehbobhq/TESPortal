#!/usr/bin/env bash
# READ-ONLY: row counts that explain whether a signed-in user can be authorised against the Supabase DEVELOPMENT database.
# Prints counts only (no identifiers, no names, no emails). Runs as the migrator inside a READ ONLY transaction.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=guard-target.sh
. "$here/guard-target.sh"
tes_dev_guard "" || exit 2
unset PGOPTIONS
export PGCONNECT_TIMEOUT=20 PGUSER="${TES_MIGRATOR_USER:?}" PGPASSWORD="${TES_MIGRATOR_PASSWORD:?}"
printf '%s\n' "BEGIN TRANSACTION READ ONLY;" "
SELECT 'actors_total: '||count(*) FROM public.actors;
SELECT 'actors_active_human: '||count(*) FROM public.actors WHERE actor_type='HUMAN' AND status='active';
SELECT 'authentication_identities_clerk: '||count(*) FROM public.authentication_identities WHERE provider='clerk';
SELECT 'authentication_identities_clerk_active: '||count(*) FROM public.authentication_identities WHERE provider='clerk' AND status='active';
SELECT 'master_account_authority_active: '||count(*) FROM public.master_account_authority WHERE status='active';
SELECT 'organizations: '||count(*) FROM public.organizations;
SELECT 'customers: '||count(*) FROM public.customers;
" "ROLLBACK;" | psql -X -At -q --no-password -v ON_ERROR_STOP=1
