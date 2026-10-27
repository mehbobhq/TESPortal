#!/usr/bin/env bash
# LOCAL end-to-end test of the Supabase development tooling on a DISPOSABLE PostgreSQL cluster whose bootstrap
# superuser is `supabase_admin` (see emulate-supabase.sql). It never contacts Supabase. Refuses non-loopback hosts.
#   PGHOST=127.0.0.1 PGPORT=<port> bash scripts/database/supabase-dev/test/run-local.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." || exit 1
D=scripts/database/supabase-dev
: "${PGHOST:?}"; : "${PGPORT:?}"
case "$PGHOST" in 127.0.0.1|localhost|::1) ;; *) echo "REFUSED: loopback only" >&2; exit 2;; esac
M='tes-database-migrator@tes-production-510007.iam'; B='tes-backend@tes-production-510007.iam'
fail=0; n=0
ok()  { n=$((n+1)); echo "ok   $*"; }
bad() { n=$((n+1)); fail=$((fail+1)); echo "FAIL $*"; }
expect() { local label="$1" want="$2"; shift 2; "$@" >/tmp/sbt.$$ 2>&1; local rc=$?; if { [ "$want" = 0 ] && [ $rc = 0 ]; } || { [ "$want" = nz ] && [ $rc != 0 ]; }; then ok "$label"; else bad "$label (rc=$rc)"; tail -3 /tmp/sbt.$$; fi; }
admin() { PGUSER=supabase_admin psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
reset() {  # reset <db_owner>
  admin -d postgres -c "DROP DATABASE IF EXISTS tes_dev WITH (FORCE)" >/dev/null
  for r in "$M" "$B" anon authenticated service_role authenticator postgres; do admin -d postgres -c "DROP ROLE IF EXISTS \"$r\"" >/dev/null 2>&1; done
  admin -d postgres -v db_owner="$1" -f $D/test/emulate-supabase.sql >/dev/null
}
bootstrap() { TES_DEV_BOOTSTRAP_CONFIRM="${CONF-supabase-dev}" TES_DEV_BACKEND_PASSWORD="${BP-aaaaaaaaaaaaaaaaaaaaaaaa1}" TES_DEV_MIGRATOR_PASSWORD="${MP-bbbbbbbbbbbbbbbbbbbbbbbb2}" PGUSER="${BUSER-postgres}" PGDATABASE=tes_dev psql -X -q -v ON_ERROR_STOP=1 -f $D/bootstrap.sql; }
env_dev() { export TES_DATABASE_TARGET=supabase-dev TES_DEV_LOCAL_TEST=1 PGDATABASE=tes_dev; }

echo "== bootstrap: fail-closed cases"
reset postgres
CONF=nope expect "wrong confirmation refused" nz bootstrap
BP=short expect "short password refused" nz bootstrap
MP=aaaaaaaaaaaaaaaaaaaaaaaa1 expect "identical passwords refused" nz bootstrap
BUSER=supabase_admin expect "superuser refused" nz bootstrap
env -u TES_DEV_BOOTSTRAP_CONFIRM bash -c "PGUSER=postgres PGDATABASE=tes_dev TES_DEV_BACKEND_PASSWORD=x psql -X -q -f $D/bootstrap.sql" >/dev/null 2>&1; [ $? != 0 ] && ok "missing confirmation refused" || bad "missing confirmation refused"
[ "$(admin -d tes_dev -c "select count(*) from pg_roles where rolname in ('$M','$B')")" = 0 ] && ok "refused runs created no role" || bad "refused runs created roles"
reset supabase_admin
expect "admin that is not the database owner fails closed" nz bootstrap
[ "$(admin -d tes_dev -c "select has_database_privilege('$M','tes_dev','CREATE')")" = f ] && ok "no CREATE granted on failure" || bad "CREATE granted on failure"

echo "== bootstrap + migrations"
reset postgres
expect "bootstrap succeeds" 0 bootstrap
expect "bootstrap is idempotent (second run)" 0 bootstrap
admin -d tes_dev -c "ALTER ROLE \"$M\" CREATEDB" ; expect "bootstrap repairs a drifted attribute (CREATEDB)" 0 bootstrap
[ "$(admin -d tes_dev -c "select rolcreatedb from pg_roles where rolname='$M'")" = f ] && ok "CREATEDB removed" || bad "CREATEDB still set"
env_dev
export PGUSER="$M"
expect "migrate-dev refuses wrong user" nz env PGUSER=postgres bash $D/migrate-dev.sh
expect "migrate-dev refuses the transaction-pooler port" nz env PGPORT=6543 bash $D/migrate-dev.sh
expect "migrate-dev refuses a production-looking host" nz env TES_DEV_LOCAL_TEST= PGHOST=tes-postgres-prod.example.com bash $D/migrate-dev.sh
expect "migrate-dev refuses a Cloud SQL socket host" nz env TES_DEV_LOCAL_TEST= PGHOST=/cloudsql/tes-production-510007:x:y bash $D/migrate-dev.sh
expect "migrate-dev refuses a non-Supabase host" nz env TES_DEV_LOCAL_TEST= PGHOST=db.example.com bash $D/migrate-dev.sh
expect "migrate-dev refuses a Supabase host without verify-full" nz env TES_DEV_LOCAL_TEST= PGHOST=aws-0-us-east-1.pooler.supabase.com bash $D/migrate-dev.sh
expect "migrate-dev refuses a missing target declaration" nz env -u TES_DATABASE_TARGET bash $D/migrate-dev.sh
expect "migrate-dev refuses TES_DEV_LOCAL_TEST on a remote host" nz env PGHOST=db.example.com bash $D/migrate-dev.sh
PGPORT_SAVE="$PGPORT"
expect "migrate-dev applies 0001-0043 as the migrator" 0 env TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
expect "migrate-dev re-run is a no-op" 0 env TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
[ "$(admin -d tes_dev -c "select count(*) from tes_system.schema_migrations")" = 43 ] && ok "ledger = 43" || bad "ledger != 43"
[ "$(admin -d tes_dev -c "select count(*) from tes_system.schema_migrations where applied_by='$M'")" = 43 ] && ok "all applied by the migrator" || bad "applied_by differs"

echo "== verifier"
export TES_MIGRATOR_USER="$M" TES_BACKEND_USER="$B" MIN_SERVER_VERSION_NUM="${MIN_SERVER_VERSION_NUM:-160000}"
unset PGUSER
verify() { bash $D/verify-readonly.sh; }
verify >/tmp/sbv.$$ 2>&1; grep -q '^RESULT .*: FAIL' /tmp/sbv.$$ && { bad "verifier on a correct database has FAIL items"; grep FAIL /tmp/sbv.$$; } || ok "verifier: no FAIL on a correct database"
grep -Eq 'RESULT synthetic_identity_isolation: (PASS - an unknown identity sees 0 of [1-9][0-9]* rows|UNVERIFIED - no rows)' /tmp/sbv.$$ && ok "isolation is PASS only when rows exist (else UNVERIFIED, never a vacuous PASS)" || bad "isolation result unexpected"
mut() { # mut <label> <check> <mutate-sql> <undo-sql>
  admin -d tes_dev -c "$3" >/dev/null
  verify >/tmp/sbv.$$ 2>&1; grep -q "^RESULT $2: FAIL" /tmp/sbv.$$ && ok "verifier detects: $1" || { bad "verifier misses: $1"; }
  admin -d tes_dev -c "$4" >/dev/null
}
mut "SELECT on a TES table granted to anon" dataapi_relation_privileges "GRANT SELECT ON public.driver_events TO anon" "REVOKE SELECT ON public.driver_events FROM anon"
mut "column privilege granted to authenticated" dataapi_relation_privileges "GRANT SELECT (id) ON public.driver_events TO authenticated" "REVOKE SELECT (id) ON public.driver_events FROM authenticated"
mut "privilege reaching service_role through PUBLIC" dataapi_relation_privileges "GRANT SELECT ON public.driver_events TO PUBLIC" "REVOKE SELECT ON public.driver_events FROM PUBLIC"
mut "USAGE on tes_security granted to authenticated" dataapi_schema_privileges "GRANT USAGE ON SCHEMA tes_security TO authenticated" "REVOKE USAGE ON SCHEMA tes_security FROM authenticated"
mut "CREATE on public granted to anon" dataapi_schema_privileges "GRANT CREATE ON SCHEMA public TO anon" "REVOKE CREATE ON SCHEMA public FROM anon"
mut "Data API role made a member of the backend role" dataapi_not_in_tes_roles "GRANT \"$B\" TO anon" "REVOKE \"$B\" FROM anon"
mut "backend role given BYPASSRLS" roles_attributes "ALTER ROLE \"$B\" BYPASSRLS" "ALTER ROLE \"$B\" NOBYPASSRLS"
mut "table owned by another role" object_ownership "ALTER TABLE public.driver_events OWNER TO postgres" "ALTER TABLE public.driver_events OWNER TO \"$M\""
mut "default privilege toward anon by the migrator" default_acl_no_dataapi "ALTER DEFAULT PRIVILEGES FOR ROLE \"$M\" IN SCHEMA public GRANT SELECT ON TABLES TO anon" "ALTER DEFAULT PRIVILEGES FOR ROLE \"$M\" IN SCHEMA public REVOKE SELECT ON TABLES FROM anon"
mut "policy that is a literal true" policy_roles_and_quals "CREATE POLICY zz_open ON public.driver_events FOR SELECT USING (true)" "DROP POLICY zz_open ON public.driver_events"
admin -d tes_dev -c "CREATE FUNCTION public.zz_probe() RETURNS int LANGUAGE sql AS 'select 1'; GRANT EXECUTE ON FUNCTION public.zz_probe() TO anon" >/dev/null
verify >/tmp/sbv.$$ 2>&1; grep -q '^RESULT dataapi_function_execute: FAIL' /tmp/sbv.$$ && ok "verifier detects: function in public executable by anon (direct grant)" || bad "verifier misses direct function grant"
admin -d tes_dev -c "DROP FUNCTION public.zz_probe()" >/dev/null
TRG="tes_security.guard_contract_line_item()"
mut "PUBLIC EXECUTE restored on a trigger function" dataapi_function_execute "GRANT EXECUTE ON FUNCTION $TRG TO PUBLIC" "REVOKE EXECUTE ON FUNCTION $TRG FROM PUBLIC"
mut "EXECUTE inherited through a role anon belongs to" dataapi_function_execute "CREATE ROLE zz_exec NOLOGIN; GRANT EXECUTE ON FUNCTION $TRG TO zz_exec; GRANT zz_exec TO anon WITH INHERIT TRUE" "DROP OWNED BY zz_exec; DROP ROLE zz_exec"
verify >/tmp/sbv.$$ 2>&1; grep -q '^RESULT .*: FAIL' /tmp/sbv.$$ && bad "verifier not clean after undo" || ok "verifier clean again after undoing every mutation"
SHA7="$(admin -d tes_dev -c "select sha256 from tes_system.schema_migrations where version='0007'")"
admin -d tes_dev -c "UPDATE tes_system.schema_migrations SET sha256 = repeat('0',64) WHERE version='0007'" >/dev/null
verify >/tmp/sbv.$$ 2>&1; grep -q '^RESULT ledger_checksums: FAIL' /tmp/sbv.$$ && ok "verifier detects a ledger checksum mismatch" || bad "verifier misses a checksum mismatch"
expect "migrate-dev refuses to proceed over a checksum mismatch" nz env PGUSER="$M" PGPORT="$PGPORT" TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
admin -d tes_dev -c "UPDATE tes_system.schema_migrations SET sha256 = '$SHA7' WHERE version='0007'" >/dev/null
echo "== function privileges after hardening"
[ "$(admin -d tes_dev -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tes_security','tes_system') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))")" = 0 ] && ok "no TES function is executable by a Data API role (0 of the 20 remain)" || bad "Data API roles can still execute TES functions"
[ "$(admin -d tes_dev -c "select count(*) from pg_proc p where pronamespace='tes_security'::regnamespace and prorettype<>'trigger'::regtype and has_function_privilege('$B',p.oid,'EXECUTE')")" = 44 ] && ok "backend keeps EXECUTE on all 44 non-trigger tes_security functions" || bad "backend lost EXECUTE on a tes_security function"
[ "$(admin -d tes_dev -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tes_security') and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') and p.prorettype='trigger'::regtype and has_function_privilege('$M',p.oid,'EXECUTE')")" -gt 0 ] && ok "migrator (owner) keeps EXECUTE on trigger functions" || bad "owner lost EXECUTE"
expect "hardening refuses a non-migrator" nz env PGUSER=postgres PGDATABASE=tes_dev psql -X -q -v ON_ERROR_STOP=1 -f $D/harden.sql
expect "hardening is idempotent (migrate-dev re-run)" 0 env PGUSER="$M" TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
expect "migrate-dev refuses PGHOSTADDR" nz env PGUSER="$M" PGHOSTADDR=10.0.0.1 TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
expect "migrate-dev refuses PGSERVICE" nz env PGUSER="$M" PGSERVICE=x TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
expect "migrate-dev refuses PGOPTIONS" nz env PGUSER="$M" PGOPTIONS="-c role=postgres" TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
expect "local test mode refuses a database other than tes_dev" nz env PGUSER="$M" PGDATABASE=tes_prod TES_DEV_SESSION_PORT="$PGPORT" bash $D/migrate-dev.sh
echo "== Data API roles and the application role against the live schema"
for r in anon authenticated service_role; do
  admin -d tes_dev -c "SET ROLE $r; SELECT count(*) FROM public.driver_events" >/dev/null 2>&1 && bad "$r can read a TES table" || ok "$r cannot read a TES table"
  admin -d tes_dev -c "SET ROLE $r; SELECT 1 FROM tes_system.schema_migrations" >/dev/null 2>&1 && bad "$r can read the ledger" || ok "$r cannot read the ledger"
done
admin -d tes_dev -c "SET ROLE \"$B\"; SELECT 1 FROM tes_system.schema_migrations" >/dev/null 2>&1 && bad "backend can read the ledger" || ok "backend cannot read the ledger"
admin -d tes_dev -c "SET ROLE \"$B\"; CREATE TABLE public.zz (x int)" >/dev/null 2>&1 && bad "backend can create in public" || ok "backend cannot create in public"

echo "== adversarial cross-tenant matrix (existing CI script) on the Supabase-shaped database"
expect "system-wide-authorization-rls.sql" 0 env PGUSER=supabase_admin PGDATABASE=tes_dev psql -X -q -v ON_ERROR_STOP=1 -f test/database/system-wide-authorization-rls.sql

rm -f /tmp/sbt.$$ /tmp/sbv.$$
echo "== $((n-fail))/$n passed"
[ "$fail" = 0 ]
