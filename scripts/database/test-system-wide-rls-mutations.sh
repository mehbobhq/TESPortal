#!/usr/bin/env bash
set -euo pipefail
base_db="${PGDATABASE:?PGDATABASE required}"
run_mutation() {
  local db="$1" sql="$2" label="$3"
  dropdb --if-exists "$db" >/dev/null 2>&1 || true
  createdb "$db"
  PGDATABASE="$db" bash scripts/database/migrate.sh >/dev/null
  PGDATABASE="$db" psql -v ON_ERROR_STOP=1 -c "$sql" >/dev/null
  set +e
  PGDATABASE="$db" psql -v ON_ERROR_STOP=1 -f test/database/system-wide-authorization-rls.sql >/tmp/tes-rls-mutation.log 2>&1
  status=$?
  set -e
  if [[ $status -eq 0 ]]; then
    cat /tmp/tes-rls-mutation.log
    echo "Mutation survived adversarial matrix: $label" >&2
    exit 1
  fi
  echo "Mutation caught: $label"
  dropdb "$db"
}
run_mutation tes_mutation_registration "ALTER POLICY registrations_customer ON public.registrations USING (true)" "cross-tenant registration leak"
run_mutation tes_mutation_credentials "CREATE POLICY credential_customer_leak ON public.credential_systems FOR SELECT USING (true)" "customer credential leak"
run_mutation tes_mutation_system "ALTER POLICY vehicles_system ON public.vehicles USING (true)" "unconditional SYSTEM vehicle bypass"
PGDATABASE="$base_db" true
echo "RLS mutation suite passed."
