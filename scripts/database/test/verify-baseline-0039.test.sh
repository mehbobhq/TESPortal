#!/usr/bin/env bash
# Local validation of scripts/database/verify-production-baseline-0039-readonly.sh against DISPOSABLE PostgreSQL clusters only.
# Needs a superuser connection through PGHOST/PGPORT/PGUSER (e.g. a throwaway local cluster). Refuses anything that does not look local.
#   PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres bash scripts/database/test/verify-baseline-0039.test.sh
set -uo pipefail
case "${PGHOST:-}" in 127.0.0.1|localhost|/*) ;; *) echo "refusing: PGHOST must be a local disposable cluster" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VERIFY="$ROOT/scripts/database/verify-production-baseline-0039-readonly.sh"
MIGRATOR="tes-database-migrator@tes-production-510007.iam"
fails=0
ok() { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; fails=$((fails + 1)); }
expect() { # name needle haystack
  if grep -qF -- "$2" <<<"$3"; then ok "$1"; else bad "$1 (expected: $2)"; echo "$3" | sed 's/^/       /' | tail -12; fi
}
su() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
for r in "tes-backend@tes-production-510007.iam" "$MIGRATOR"; do su -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$r') THEN CREATE ROLE \"$r\" LOGIN; END IF; END \$\$" >/dev/null; done
build() { # db count   (applies the first N repository migrations as the migrator, the way the production workflow's runner would)
  local db="$1" n="$2" dir; dir="$(mktemp -d)"
  for f in "$ROOT"/database/migrations/[0-9][0-9][0-9][0-9]_*.sql; do b="$(basename "$f")"; [ "${b:0:4}" -le "$(printf '%04d' "$n")" ] && cp "$f" "$dir/"; done
  su -d postgres -c "DROP DATABASE IF EXISTS \"$db\"" >/dev/null; su -d postgres -c "CREATE DATABASE \"$db\" OWNER \"$MIGRATOR\" ENCODING 'UTF8' TEMPLATE template0" >/dev/null
  PGUSER="$MIGRATOR" PGDATABASE="$db" MIGRATIONS_DIR="$dir" bash "$ROOT/scripts/database/migrate.sh" >/dev/null 2>&1 || { bad "build $db"; return 1; }
}
verify() { PGUSER="$MIGRATOR" PGDATABASE="$1" MIGRATIONS_DIR="${2:-$ROOT/database/migrations}" bash "$VERIFY" 2>&1; }

echo "== A. clean 0039 baseline"
build t_base 39
out="$(verify t_base)"; code=$?
expect "all six items PASS" "CLEAR: every item PASSED" "$out"; [ $code = 0 ] && ok "exit 0" || bad "exit code $code"
expect "ledger count" "RESULT ledger_count: PASS" "$out"; expect "latest" "RESULT ledger_latest: PASS" "$out"; expect "filenames" "RESULT ledger_filenames: PASS" "$out"; expect "checksums" "RESULT ledger_checksums: PASS" "$out"
expect "invitations zero" "live_invitations=0" "$out"; expect "read-only probe refused" "RESULT read_only_enforcement: PASS" "$out"
expect "pending files reported, not touched" "repository_files_above_0039=4" "$out"

echo "== B. live invitation counting (aggregate only)"
su -d t_base <<'SQL' >/dev/null
SET session_replication_role = replica;
INSERT INTO public.actors (actor_type) VALUES ('SYSTEM');
INSERT INTO public.driver_application_invitations (prospect_id, organization_id, token_hash, recipient_email_normalized, status, expires_at, created_by_actor_id)
SELECT gen_random_uuid(), gen_random_uuid(), lpad(to_hex(n), 64, '0'), 'x' || n || '@example.invalid', s, now() + e, (SELECT id FROM public.actors LIMIT 1)
FROM (VALUES (1,'SENT', interval '2 days'), (2,'OPENED', interval '1 day'), (3,'SENT', interval '-1 day'), (4,'SUBMITTED', interval '2 days'), (5,'REVOKED', interval '2 days')) v(n, s, e);
SQL
n="$(su -d t_base -c "SELECT count(*) FROM public.driver_application_invitations")"
if [ "$n" = 5 ]; then ok "fixture rows inserted by the test (superuser, disposable)"; else bad "fixture insert ($n rows)"; fi
out="$(verify t_base)"; expect "counts only SENT/OPENED and unexpired" "live_invitations=2" "$out"
grep -qE "example\.invalid|[0-9a-f]{64}" <<<"$out" && bad "output contains applicant data" || ok "output contains no emails or tokens"

echo "== C. ledger tampering is a FAIL"
su -d t_base -c "ALTER TABLE tes_system.schema_migrations DISABLE TRIGGER USER" >/dev/null 2>&1
su -d t_base -c "UPDATE tes_system.schema_migrations SET sha256 = repeat('0', 64) WHERE version = '0010'" >/dev/null 2>&1 && ok "tamper applied (test only)" || bad "could not tamper"
out="$(verify t_base)"; code=$?
expect "checksum mismatch reported with the file name" "checksum differs from the repository: 0010_" "$out"; expect "checksums FAIL" "RESULT ledger_checksums: FAIL" "$out"; [ $code = 1 ] && ok "exit 1" || bad "exit code $code"
su -d t_base -c "UPDATE tes_system.schema_migrations SET sha256 = (SELECT sha256 FROM tes_system.schema_migrations WHERE version = '0011') WHERE version = '0010'" >/dev/null 2>&1; build t_base 39

echo "== D. wrong ledger shape"
su -d t_base -c "DELETE FROM tes_system.schema_migrations WHERE version = '0020'" >/dev/null 2>&1
out="$(verify t_base)"; expect "count FAIL" "RESULT ledger_count: FAIL" "$out"; expect "missing file named" "repository file not in the ledger: 0020_" "$out"; expect "contiguity FAIL" "RESULT ledger_latest: FAIL" "$out"
build t_full 43
out="$(verify t_full)"; code=$?
expect "full chain: count FAIL (43)" "RESULT ledger_count: FAIL - applied=43" "$out"; expect "full chain: latest FAIL" "latest=0043" "$out"; [ $code = 1 ] && ok "exit 1" || bad "exit code $code"
expect "full chain: extra ledger files not at baseline" "ledger names a file that is not a repository migration up to 0039: 0040_" "$out"
incomplete="$(mktemp -d)"; cp "$ROOT"/database/migrations/00[0-2]*.sql "$incomplete/"
out="$(verify t_base "$incomplete")"; expect "incomplete repository directory is UNVERIFIED, not PASS" "RESULT ledger_filenames: UNVERIFIED" "$out"

echo "== E. row-level security that applies to the identity makes the count UNVERIFIED"
build t_rls 39
su -d t_rls -c "ALTER TABLE public.driver_application_invitations FORCE ROW LEVEL SECURITY" >/dev/null
out="$(verify t_rls)"; expect "forced RLS -> UNVERIFIED" "RESULT live_invitations: UNVERIFIED" "$out"

echo "== F. read-only enforcement"
out="$(PGUSER="$MIGRATOR" PGDATABASE=t_rls PGOPTIONS='-c default_transaction_read_only=off' bash "$VERIFY" 2>&1)"; expect "a caller PGOPTIONS cannot switch the session to read-write" "RESULT read_only_enforcement: PASS" "$out"
w="$(PGUSER="$MIGRATOR" PGDATABASE=t_base PGOPTIONS='-c default_transaction_read_only=on' psql -X -q -At -c "CREATE TABLE public._probe(x int)" 2>&1)"; expect "the same session options refuse a write" "read-only transaction" "$w"
[ "$(su -d t_base -c "SELECT to_regclass('public._probe') IS NULL")" = t ] && ok "nothing was created" || bad "a table was created"
before="$(su -d t_base -c "SELECT count(*) FROM tes_system.schema_migrations")"; verify t_base >/dev/null; after="$(su -d t_base -c "SELECT count(*) FROM tes_system.schema_migrations")"; [ "$before" = "$after" ] && ok "ledger unchanged by verification" || bad "ledger changed"
no_conn="$(PGUSER="$MIGRATOR" PGDATABASE=does_not_exist bash "$VERIFY" 2>&1)"; expect "unreachable database is UNVERIFIED and blocks" "RESULT read_only_enforcement: UNVERIFIED" "$no_conn"

for d in t_base t_full t_rls; do su -d postgres -c "DROP DATABASE IF EXISTS \"$d\"" >/dev/null; done
echo; [ "$fails" = 0 ] && echo "ALL CHECKS PASSED" || echo "$fails CHECK(S) FAILED"; exit $((fails > 0))
