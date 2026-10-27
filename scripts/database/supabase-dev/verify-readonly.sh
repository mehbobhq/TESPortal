#!/usr/bin/env bash
# READ-ONLY verification of the Supabase DEVELOPMENT database after bootstrap + migrations. Prints no row data and no secret.
# Never writes: every session is read-only and every query runs in BEGIN TRANSACTION READ ONLY. Each item is PASS / FAIL / UNVERIFIED.
#
# Environment:
#   TES_DATABASE_TARGET=supabase-dev                     required (see guard-target.sh)
#   PGHOST PGDATABASE PGPORT                             the endpoint under test (session pooler 5432 for the catalogue stage)
#   TES_MIGRATOR_USER / TES_MIGRATOR_PASSWORD            catalogue + ledger stage (the user may carry a pooler tenant suffix)
#   TES_BACKEND_USER  / TES_BACKEND_PASSWORD             runtime stage
#   TES_BACKEND_PORT                                     runtime endpoint port (default PGPORT; use 6543 to prove the transaction pooler)
#   PGSSLMODE=verify-full  PGSSLROOTCERT=<CA file>       required for any non-local host
#   MIGRATIONS_DIR (default database/migrations); EXPECTED_RLS_TABLES (116); EXPECTED_POLICIES (198); MIN_SERVER_VERSION_NUM (170000)
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="${MIGRATIONS_DIR:-database/migrations}"
EXP_RLS="${EXPECTED_RLS_TABLES:-116}"; EXP_POL="${EXPECTED_POLICIES:-198}"
# shellcheck source=guard-target.sh
. "$here/guard-target.sh"
# shellcheck source=probe-lib.sh
. "$here/probe-lib.sh"
BACKEND_ROLE='tes-backend@tes-production-510007.iam'
overall=0
record() { echo "RESULT $1: $2 - $3"; [ "$2" = PASS ] || overall=1; }
# No PGOPTIONS / startup parameters (poolers may reject them): every query runs in an explicit BEGIN TRANSACTION READ ONLY.
unset PGOPTIONS
export PGCONNECT_TIMEOUT=20

as() { # as <migrator|backend> <port> ; reads SQL on stdin, wrapped read-only
  local who="$1" port="$2" user pass
  if [ "$who" = migrator ]; then user="${TES_MIGRATOR_USER:-}"; pass="${TES_MIGRATOR_PASSWORD:-}"; else user="${TES_BACKEND_USER:-}"; pass="${TES_BACKEND_PASSWORD:-}"; fi
  { printf 'BEGIN TRANSACTION READ ONLY;\n'; cat; printf '\n;\nROLLBACK;\n'; } | PGUSER="$user" PGPASSWORD="$pass" PGPORT="$port" psql -X -At -q --no-password -v ON_ERROR_STOP=1 "${@:3}"
}
tes_dev_guard "" || exit 2
BPORT="${TES_BACKEND_PORT:-$PGPORT}"
[ -n "${TES_MIGRATOR_USER:-}" ] && [ -n "${TES_BACKEND_USER:-}" ] || { echo "REFUSED: TES_MIGRATOR_USER and TES_BACKEND_USER are required." >&2; exit 2; }
case "$TES_MIGRATOR_USER" in "tes-database-migrator@tes-production-510007.iam"|"tes-database-migrator@tes-production-510007.iam".*) ;; *) echo "REFUSED: TES_MIGRATOR_USER is not the migrator role." >&2; exit 2;; esac
case "$TES_BACKEND_USER" in "$BACKEND_ROLE"|"$BACKEND_ROLE".*) ;; *) echo "REFUSED: TES_BACKEND_USER is not the backend role." >&2; exit 2;; esac

[ -z "${TES_BACKEND_PORT:-}" ] || [ "${TES_DEV_LOCAL_TEST:-}" = 1 ] || [[ "$TES_BACKEND_PORT" =~ ^(5432|6543)$ ]] || { echo "REFUSED: TES_BACKEND_PORT must be 5432 or 6543." >&2; exit 2; }
echo "== connection and read-only enforcement (categories only; raw driver text is never printed)"
yn() { [ -n "$1" ] && echo yes || echo no; }
set_mu=$(yn "$TES_MIGRATOR_USER"); set_mp=$(yn "${TES_MIGRATOR_PASSWORD:-}"); set_bu=$(yn "$TES_BACKEND_USER"); set_bp=$(yn "${TES_BACKEND_PASSWORD:-}")
tenant_suffix() { [[ "$1" =~ \.[a-z0-9]{20}$ ]] && echo yes || echo no; }
echo "endpoints: migrator port=$PGPORT, backend port=$BPORT ($([ "$BPORT" = 6543 ] && echo transaction-pooler || echo session-mode)); credentials present (yes/no only): migrator_user=$set_mu migrator_secret=$set_mp backend_user=$set_bu backend_secret=$set_bp; user_has_pooler_tenant_suffix: migrator=$(tenant_suffix "$TES_MIGRATOR_USER") backend=$(tenant_suffix "$TES_BACKEND_USER")"
blocked=0
for who in migrator backend; do
  port="$PGPORT"; user="$TES_MIGRATOR_USER"; pass="${TES_MIGRATOR_PASSWORD:-}"
  [ "$who" = backend ] && { port="$BPORT"; user="$TES_BACKEND_USER"; pass="${TES_BACKEND_PASSWORD:-}"; }
  if probe_connect "$user" "$pass" "$port"; then record "connect_$who" PASS "a session was established and answered SELECT 1"
  else record "connect_$who" FAIL "no session; category=$PROBE_CATEGORY"; record "read_only_$who" FAIL "not attempted: no connection; nothing was read for this identity"; blocked=1; continue; fi
  if probe_write "$user" "$pass" "$port"; then record "read_only_$who" PASS "the server refused a probe write with SQLSTATE 25006 (nothing was written)"
  else record "read_only_$who" FAIL "the probe did not prove a server-side refusal; category=$PROBE_CATEGORY"; blocked=1; fi
done
[ "$blocked" = 0 ] || { echo "== RESULT: BLOCKED"; exit 1; }

echo "== ledger (as migrator)"
ledger="$(as migrator "$PGPORT" -F '|' <<<"SELECT version, filename, sha256 FROM tes_system.schema_migrations ORDER BY version")" || { record ledger FAIL "could not read tes_system.schema_migrations"; ledger=""; }
mapfile -t repo_files < <(cd "$MIG_DIR" 2>/dev/null && ls -1 [0-9][0-9][0-9][0-9]_*.sql 2>/dev/null | LC_ALL=C sort)
n_repo="${#repo_files[@]}"; applied=0; [ -n "$ledger" ] && applied="$(printf '%s\n' "$ledger" | wc -l)"
if [ "$applied" = "$n_repo" ] && [ "$n_repo" -gt 0 ]; then record ledger_count PASS "applied=$applied repository_files=$n_repo"; else record ledger_count FAIL "applied=$applied repository_files=$n_repo"; fi
expected_versions="$(printf '%04d\n' $(seq 1 "$n_repo"))"; actual_versions="$(printf '%s\n' "$ledger" | cut -d'|' -f1)"
[ "$actual_versions" = "$expected_versions" ] && record ledger_sequence PASS "versions are exactly 0001..$(printf '%04d' "$n_repo")" || record ledger_sequence FAIL "versions are not exactly the contiguous sequence of repository files"
bad=0; declare -A seen=()
while IFS='|' read -r v f c; do
  [ -n "$v$f" ] || continue; seen["$f"]=1
  [ "$v" = "${f:0:4}" ] || bad=$((bad+1))
  if [ -f "$MIG_DIR/$f" ]; then [ "$(sha256sum "$MIG_DIR/$f" | awk '{print $1}')" = "$c" ] || { echo "checksum differs: $f"; bad=$((bad+1)); }; else echo "not in repository: $f"; bad=$((bad+1)); fi
done <<<"$ledger"
for f in "${repo_files[@]}"; do [ -n "${seen[$f]:-}" ] || { echo "not in ledger: $f"; bad=$((bad+1)); }; done
[ "$bad" = 0 ] && record ledger_checksums PASS "every ledger filename/version/SHA-256 equals the repository" || record ledger_checksums FAIL "discrepancies=$bad"

echo "== catalogue (as migrator)"
cat_out="$(as migrator "$PGPORT" -v expected_rls_tables="$EXP_RLS" -v expected_policies="$EXP_POL" -v min_server_version_num="${MIN_SERVER_VERSION_NUM:-170000}" < "$here/verify-catalog.sql")" || { record catalogue FAIL "the catalogue query failed"; cat_out=""; }
while IFS='|' read -r name status detail; do [ -n "$name" ] && record "$name" "$status" "$detail"; done <<<"$cat_out"
[ -n "$cat_out" ] || overall=1

echo "== runtime (as backend, port $BPORT)"
rt_out="$(as backend "$BPORT" < "$here/verify-runtime.sql")" || { record runtime FAIL "the runtime query failed"; rt_out=""; }
while IFS='|' read -r name status detail; do [ -n "$name" ] && record "$name" "$status" "$detail"; done <<<"$rt_out"
# Transaction-local context must not leak to the next transaction or the next pooled client.
leak="$(printf "BEGIN TRANSACTION READ ONLY;\nSELECT set_config('tes.system_actor_id','00000000-0000-4000-8000-0000000000aa',true);\nCOMMIT;\nBEGIN TRANSACTION READ ONLY;\nSELECT coalesce(current_setting('tes.system_actor_id',true),'');\nCOMMIT;\n" | PGUSER="$TES_BACKEND_USER" PGPASSWORD="${TES_BACKEND_PASSWORD:-}" PGPORT="$BPORT" psql -X -At -q --no-password -v ON_ERROR_STOP=1 2>&1 | tail -n 1)"
if [ -z "$leak" ]; then record txn_context_isolation PASS "a setting made with set_config(...,true) is gone in the next transaction"
else record txn_context_isolation FAIL "the next transaction saw: $(printf '%s' "$leak" | cut -c1-60)"; fi

echo "== synthetic-identity isolation (as backend; counts only)"
total_sql="SELECT coalesce(sum((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint), 0) FROM pg_tables t JOIN pg_class c ON c.oid = format('%I.%I', schemaname, tablename)::regclass WHERE schemaname = 'public' AND c.relrowsecurity AND has_table_privilege(current_user, c.oid, 'SELECT')"
owner_rows="$(as migrator "$PGPORT" <<<"$total_sql")" || owner_rows=""
synth_rows="$(as backend "$BPORT" <<<"SELECT set_config('tes.system_actor_id','00000000-0000-4000-8000-0000000000ab',true), set_config('tes.system_capability','master_register.manage',true), set_config('tes.customer_id','00000000-0000-4000-8000-0000000000ac',true);
$total_sql" | tail -1)" || synth_rows=""
if ! [[ "$owner_rows" =~ ^[0-9]+$ && "$synth_rows" =~ ^[0-9]+$ ]]; then record synthetic_identity_isolation FAIL "could not count rows"
elif [ "$synth_rows" != 0 ]; then record synthetic_identity_isolation FAIL "an unknown identity can read $synth_rows rows across RLS tables (owner sees $owner_rows)"
elif [ "$owner_rows" = 0 ]; then record synthetic_identity_isolation UNVERIFIED "no rows exist in the RLS tables, so a zero is vacuous; the adversarial matrix (test/database/system-wide-authorization-rls.sql) is the isolation proof"
else record synthetic_identity_isolation PASS "an unknown identity sees 0 of $owner_rows rows across RLS tables"; fi

echo "== RESULT"
if [ "$overall" = 0 ]; then echo "CLEAR: every item PASSED (read-only; nothing was changed)"; else echo "NOT CLEAR: at least one item is FAIL or UNVERIFIED (read-only; nothing was changed)"; fi
exit "$overall"
