#!/usr/bin/env bash
# Local validation of scripts/database/verify-production-baseline-0039-readonly.sh against DISPOSABLE PostgreSQL clusters only.
# Needs a superuser connection through PGHOST/PGPORT/PGUSER (a throwaway local cluster). Refuses anything that does not look local.
#   PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres bash scripts/database/test/verify-baseline-0039.test.sh
set -uo pipefail
case "${PGHOST:-}" in 127.0.0.1|localhost|/*) ;; *) echo "refusing: PGHOST must be a local disposable cluster" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VERIFY="$ROOT/scripts/database/verify-production-baseline-0039-readonly.sh"
MIGRATOR="tes-database-migrator@tes-production-510007.iam"
fails=0; passes=0
ok() { echo "ok   - $1"; passes=$((passes + 1)); }
bad() { echo "FAIL - $1"; fails=$((fails + 1)); }
expect() { # name needle haystack
  if grep -qF -- "$2" <<<"$3"; then ok "$1"; else bad "$1 (expected: $2)"; echo "$3" | sed 's/^/       /' | tail -14; fi
}
su() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
for r in "tes-backend@tes-production-510007.iam" "$MIGRATOR"; do su -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$r') THEN CREATE ROLE \"$r\" LOGIN; END IF; END \$\$" >/dev/null; done
build() { # db count   (applies the first N repository migrations as the migrator, the way the production workflow's runner would)
  local db="$1" n="$2" dir; dir="$(mktemp -d)"
  for f in "$ROOT"/database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do b="$(basename "$f")"; [ "$((10#${b:0:4}))" -le "$n" ] && cp "$f" "$dir/"; done
  su -d postgres -c "DROP DATABASE IF EXISTS \"$db\"" >/dev/null 2>&1; su -d postgres -c "CREATE DATABASE \"$db\" OWNER \"$MIGRATOR\" ENCODING 'UTF8' TEMPLATE template0" >/dev/null
  PGUSER="$MIGRATOR" PGDATABASE="$db" MIGRATIONS_DIR="$dir" bash "$ROOT/scripts/database/migrate.sh" >/dev/null 2>&1 || { bad "build $db"; return 1; }
}
clone() { su -d postgres -c "DROP DATABASE IF EXISTS \"$2\"" >/dev/null 2>&1; su -d postgres -c "CREATE DATABASE \"$2\" TEMPLATE \"$1\" OWNER \"$MIGRATOR\"" >/dev/null; }
verify() { PGUSER="$MIGRATOR" PGDATABASE="$1" MIGRATIONS_DIR="${2:-$ROOT/database/migrations}" bash "$VERIFY" 2>&1; }
ledger_sql() { su -d "$1" -c "ALTER TABLE tes_system.schema_migrations DISABLE TRIGGER USER" >/dev/null 2>&1; su -d "$1" -c "$2" >/dev/null 2>&1; }
# every malformed ledger must be a FAIL (never PASS) and a nonzero exit; $1 name, $2 SQL applied to a fresh copy of the clean baseline, $3 the FAIL line expected
negative() {
  clone t_base t_neg
  if ! su -d t_neg -c "$2" >/dev/null 2>&1; then bad "$1: could not construct the malformed ledger"; return; fi
  local out code; out="$(verify t_neg)"; code=$?
  if [ "$code" = 1 ] && grep -q "^NOT CLEAR" <<<"$out" && ! grep -q "^CLEAR" <<<"$out"; then ok "$1: exit 1 and NOT CLEAR"; else bad "$1: exit $code"; fi
  expect "$1: reported as FAIL" "$3" "$out"
}

echo "== A. clean 0039 baseline"
build t_base 39
out="$(verify t_base)"; code=$?
expect "all items PASS" "CLEAR: every item PASSED" "$out"; [ $code = 0 ] && ok "exit 0" || bad "exit code $code"
for i in ledger_count ledger_latest ledger_sequence ledger_filenames ledger_checksums live_invitations read_only_enforcement; do expect "$i PASS" "RESULT $i: PASS" "$out"; done
expect "invitations zero" "live_invitations=0" "$out"; expect "pending files reported, not touched" "repository_files_above_0039=4" "$out"

echo "== B. invitation counting: PENDING, SENT and OPENED unexpired are counted; expired and other statuses are not; aggregate only"
clone t_base t_inv
su -d t_inv <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO public.actors (actor_type) VALUES ('SYSTEM');
INSERT INTO public.driver_application_invitations (prospect_id, organization_id, token_hash, recipient_email_normalized, status, expires_at, created_by_actor_id)
SELECT gen_random_uuid(), gen_random_uuid(), lpad(to_hex(n), 64, '0'), 'person' || n || '@example.invalid', s, now() + e, (SELECT id FROM public.actors LIMIT 1)
FROM (VALUES
  (1,'PENDING',  interval '2 days'),   -- counted
  (2,'SENT',     interval '2 days'),   -- counted
  (3,'OPENED',   interval '1 day'),    -- counted
  (4,'PENDING',  interval '-1 hour'),  -- expired: excluded
  (5,'SENT',     interval '-1 day'),   -- expired: excluded
  (6,'OPENED',   interval '-1 minute'),-- expired: excluded
  (7,'FAILED',   interval '2 days'),   -- not usable: excluded
  (8,'SUBMITTED',interval '2 days'),   -- excluded
  (9,'REVOKED',  interval '2 days')    -- excluded
) v(n, s, e);
SQL
[ "$(su -d t_inv -c "SELECT count(*) FROM public.driver_application_invitations")" = 9 ] && ok "9 fixture rows (inserted by the test as superuser, disposable)" || bad "fixture insert"
out="$(verify t_inv)"; expect "counts exactly the 3 usable, unexpired invitations" "live_invitations=3" "$out"
if grep -qE "person[0-9]|example\.invalid|[0-9a-f]{64}" <<<"$out"; then bad "output contains applicant data"; else ok "output contains no email, token or other applicant data"; fi
out="$(verify t_base)"; expect "no invitations -> 0" "live_invitations=0" "$out"

echo "== C. ledger tampering"
clone t_base t_neg; ledger_sql t_neg "UPDATE tes_system.schema_migrations SET sha256 = repeat('0', 64) WHERE version = '0010'"
out="$(verify t_neg)"; code=$?
expect "checksum mismatch named" "checksum differs from the repository: 0010_" "$out"; expect "checksums FAIL" "RESULT ledger_checksums: FAIL" "$out"; [ $code = 1 ] && ok "exit 1" || bad "exit code $code"
negative "C2 checksum swapped with another row's" "ALTER TABLE tes_system.schema_migrations DISABLE TRIGGER USER; UPDATE tes_system.schema_migrations SET sha256 = (SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0011') WHERE version = '0010'" "RESULT ledger_checksums: FAIL"

echo "== D. malformed ledgers: every one is a FAIL with exit 1"
negative "D1 0000 replaces 0001" "UPDATE tes_system.schema_migrations SET version = '0000' WHERE version = '0001'" "RESULT ledger_sequence: FAIL"
negative "D1b 0000 replaces 0001 (filename untouched => version/filename mismatch)" "UPDATE tes_system.schema_migrations SET version = '0000' WHERE version = '0001'" "version/filename mismatch: version=0000"
negative "D2 versions swapped between two files (sequence still 0001..0039, prefixes no longer match)" "ALTER TABLE tes_system.schema_migrations DROP CONSTRAINT schema_migrations_pkey; UPDATE tes_system.schema_migrations SET version = CASE version WHEN '0005' THEN '0006' WHEN '0006' THEN '0005' ELSE version END" "version/filename mismatch: version=0006 filename=0005_"
negative "D2b the same swap is a filenames FAIL" "ALTER TABLE tes_system.schema_migrations DROP CONSTRAINT schema_migrations_pkey; UPDATE tes_system.schema_migrations SET version = CASE version WHEN '0005' THEN '0006' WHEN '0006' THEN '0005' ELSE version END" "RESULT ledger_filenames: FAIL"
negative "D3 a version missing" "DELETE FROM tes_system.schema_migrations WHERE version = '0020'" "version(s) missing from the ledger: 0020"
negative "D3b a version missing: count FAIL" "DELETE FROM tes_system.schema_migrations WHERE version = '0020'" "RESULT ledger_count: FAIL"
negative "D4 duplicated version (constraint dropped in the disposable copy to build it)" "ALTER TABLE tes_system.schema_migrations DROP CONSTRAINT schema_migrations_pkey; ALTER TABLE tes_system.schema_migrations DROP CONSTRAINT schema_migrations_filename_key; INSERT INTO tes_system.schema_migrations (version, filename, sha256) SELECT version, filename, sha256 FROM tes_system.schema_migrations WHERE version = '0010'" "duplicated ledger version(s): 0010"
negative "D4b duplicate replacing another version (count stays 39)" "ALTER TABLE tes_system.schema_migrations DROP CONSTRAINT schema_migrations_pkey; UPDATE tes_system.schema_migrations SET version = '0010' WHERE version = '0011'" "RESULT ledger_sequence: FAIL"
negative "D5 an unexpected version 0040 beyond the baseline" "INSERT INTO tes_system.schema_migrations (version, filename, sha256) VALUES ('0040', '0040_driver_operating_scope_and_presentation_jurisdiction.sql', repeat('b', 64))" "unexpected ledger version(s): 0040"
negative "D6 substitution: 0040 in place of 0039" "UPDATE tes_system.schema_migrations SET version = '0040' WHERE version = '0039'" "RESULT ledger_latest: FAIL"
negative "D7 a non-numeric version" "UPDATE tes_system.schema_migrations SET version = 'abcd' WHERE version = '0007'" "unexpected ledger version(s): abcd"
negative "D8 an unknown file in the ledger" "INSERT INTO tes_system.schema_migrations (version, filename, sha256) VALUES ('0099', '0099_unknown.sql', repeat('a', 64))" "ledger names a file that is not a repository migration up to 0039: 0099_unknown.sql"
negative "D9 an empty ledger" "DELETE FROM tes_system.schema_migrations" "RESULT ledger_count: FAIL"
clone t_base t_neg; su -d t_neg -c "DROP TABLE tes_system.schema_migrations" >/dev/null 2>&1
out="$(verify t_neg)"; code=$?; expect "D10 no ledger table: FAIL" "RESULT ledger_sequence: FAIL - tes_system.schema_migrations does not exist" "$out"; [ $code = 1 ] && ok "D10 exit 1" || bad "D10 exit $code"
build t_full 43
out="$(verify t_full)"; code=$?; expect "D11 full 0043 chain: count FAIL" "RESULT ledger_count: FAIL - applied=43" "$out"; expect "D11 unexpected versions listed" "unexpected ledger version(s): 0040 0041 0042 0043" "$out"; [ $code = 1 ] && ok "D11 exit 1" || bad "D11 exit $code"
incomplete="$(mktemp -d)"; cp "$ROOT"/database/migrations/00[0-2]*.sql "$incomplete/"
out="$(verify t_base "$incomplete")"; code=$?; expect "D12 incomplete repository directory is UNVERIFIED, not PASS" "RESULT ledger_filenames: UNVERIFIED" "$out"; [ $code = 1 ] && ok "D12 exit 1" || bad "D12 exit $code"

echo "== E. row-level security that applies to the identity makes the count UNVERIFIED"
clone t_base t_rls; su -d t_rls -c "ALTER TABLE public.driver_application_invitations FORCE ROW LEVEL SECURITY" >/dev/null
out="$(verify t_rls)"; code=$?; expect "forced RLS -> UNVERIFIED" "RESULT live_invitations: UNVERIFIED" "$out"; [ $code = 1 ] && ok "exit 1" || bad "exit $code"

echo "== F. read-only enforcement is unchanged"
out="$(PGUSER="$MIGRATOR" PGDATABASE=t_base PGOPTIONS='-c default_transaction_read_only=off' bash "$VERIFY" 2>&1)"; expect "a caller PGOPTIONS cannot switch the session to read-write" "RESULT read_only_enforcement: PASS" "$out"
w="$(PGUSER="$MIGRATOR" PGDATABASE=t_base PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At -c "CREATE TABLE public._probe(x int)" 2>&1)"; expect "the same session options refuse a write" "read-only transaction" "$w"
[ "$(su -d t_base -c "SELECT to_regclass('public._probe') IS NULL")" = t ] && ok "nothing was created" || bad "a table was created"
before="$(su -d t_inv -c "SELECT (SELECT count(*) FROM tes_system.schema_migrations) || '/' || (SELECT count(*) FROM public.driver_application_invitations) || '/' || (SELECT count(*) FROM public.actors)")"; verify t_inv >/dev/null; after="$(su -d t_inv -c "SELECT (SELECT count(*) FROM tes_system.schema_migrations) || '/' || (SELECT count(*) FROM public.driver_application_invitations) || '/' || (SELECT count(*) FROM public.actors)")"; [ "$before" = "$after" ] && ok "ledger, invitations and actors unchanged by verification ($after)" || bad "data changed ($before -> $after)"
no_conn="$(PGUSER="$MIGRATOR" PGDATABASE=does_not_exist bash "$VERIFY" 2>&1)"; expect "unreachable database is UNVERIFIED and blocks" "RESULT read_only_enforcement: UNVERIFIED" "$no_conn"

for d in t_base t_full t_rls t_inv t_neg; do su -d postgres -c "DROP DATABASE IF EXISTS \"$d\"" >/dev/null 2>&1; done
echo; echo "SUMMARY passed=$passes failed=$fails"; [ "$fails" = 0 ] && echo "ALL CHECKS PASSED" || echo "$fails CHECK(S) FAILED"; exit $((fails > 0))
