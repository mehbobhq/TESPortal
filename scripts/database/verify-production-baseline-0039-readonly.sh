#!/usr/bin/env bash
# TES: READ-ONLY verification of the production database against the migration 0039 baseline (the state before migrations 0040-0043). It changes nothing and prints NO row data:
# only counts, booleans and migration file names. Run by .github/workflows/production-0037-0038-readonly-verification.yml with phase `baseline-0039`
# (manual dispatch, production-database environment, GitHub OIDC -> Workload Identity -> Cloud SQL Auth Proxy), and runnable by an operator against any database.
#
#   PGHOST/PGPORT/PGDATABASE/PGUSER (+ PGPASSWORD or IAM auth) as for psql
#   MIGRATIONS_DIR   directory holding the repository migration files (default database/migrations)
#
# What it checks, each reported as PASS / FAIL / UNVERIFIED:
#   read_only_enforcement  the session is read-only and the database itself refuses a write attempt (otherwise it stops before reading anything)
#   ledger_count           exactly 39 applied migrations
#   ledger_latest          latest version is 0039 and the sequence is contiguous from 0001
#   ledger_filenames       the ledger and the repository files 0001-0039 name exactly the same files
#   ledger_checksums       every ledger SHA-256 equals the SHA-256 of the repository file of that name
#   live_invitations       count of driver application invitations with status SENT/OPENED and expires_at in the future (a number only)
# Exit status 0 only if every item is PASS. It never runs the migration runner, never writes, and never "fixes" anything.
set -uo pipefail
MIG_DIR="${MIGRATIONS_DIR:-database/migrations}"
BASELINE="0039"
EXPECTED_COUNT=39
# Session-level read-only: PostgreSQL itself refuses any write, even by mistake. Every query below also runs inside an explicit READ ONLY transaction.
export PGOPTIONS="-c default_transaction_read_only=on"   # deliberately not appended to a caller-supplied PGOPTIONS, so it cannot be overridden by the environment
overall=0
record() { echo "RESULT $1: $2 - $3"; [ "$2" = PASS ] || overall=1; }
ro() { printf 'BEGIN TRANSACTION READ ONLY;\n%s;\nROLLBACK;\n' "$1" | psql -X -At -q --no-password -v ON_ERROR_STOP=1 "${@:2}"; }

echo "== verification time (database clock, UTC)"
ro "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')" || { record read_only_enforcement UNVERIFIED "could not connect or read"; echo "== RESULT: BLOCKED"; exit 1; }

echo "== read-only enforcement"
# session-level default (outside any explicit transaction), then the explicit READ ONLY transaction is proved below by a refused write
if [ "$(psql -X -At -q --no-password -c 'SHOW default_transaction_read_only' 2>/dev/null)" != "on" ]; then record read_only_enforcement FAIL "the session default is not read-only; nothing was read"; echo "== RESULT: BLOCKED"; exit 1; fi
if printf 'BEGIN TRANSACTION READ ONLY;\nCREATE TEMP TABLE _tes_read_only_probe (x int);\nROLLBACK;\n' | psql -X -At -q --no-password -v ON_ERROR_STOP=1 >/dev/null 2>/tmp/ro-probe.$$; then
  record read_only_enforcement FAIL "a write attempt was NOT refused by the database; nothing was read"; rm -f /tmp/ro-probe.$$; echo "== RESULT: BLOCKED"; exit 1
fi
grep -qi "read-only" /tmp/ro-probe.$$ && rm -f /tmp/ro-probe.$$ || { rm -f /tmp/ro-probe.$$; record read_only_enforcement UNVERIFIED "the probe failed for a reason other than read-only"; echo "== RESULT: BLOCKED"; exit 1; }
record read_only_enforcement PASS "session read-only; the database refused a probe write (nothing was written)"
echo "identity: current_user=$(ro 'SELECT current_user') superuser=$(ro "SELECT rolsuper FROM pg_roles WHERE rolname = current_user") (read-only is enforced per session and transaction, not by the identity's privileges)"

echo "== ledger"
if ! [ "$(ro "SELECT to_regclass('tes_system.schema_migrations') IS NOT NULL")" = t ]; then
  for i in ledger_count ledger_latest ledger_filenames ledger_checksums; do record $i FAIL "tes_system.schema_migrations does not exist"; done
else
  read -r applied latest contiguous <<<"$(ro "SELECT count(*), coalesce(max(version), 'none'), (count(*) = coalesce(max(version::int), 0) AND count(DISTINCT version) = count(*)) FROM tes_system.schema_migrations" -F ' ')"
  echo "applied=$applied latest=$latest contiguous_from_0001=$contiguous"
  [ "$applied" = "$EXPECTED_COUNT" ] && record ledger_count PASS "applied=$applied" || record ledger_count FAIL "applied=$applied, expected $EXPECTED_COUNT"
  if [ "$latest" = "$BASELINE" ] && [ "$contiguous" = t ]; then record ledger_latest PASS "latest=$latest, contiguous"; else record ledger_latest FAIL "latest=$latest contiguous=$contiguous, expected $BASELINE contiguous"; fi

  mapfile -t repo_files < <(cd "$MIG_DIR" 2>/dev/null && ls -1 [0-9][0-9][0-9][0-9]_*.sql 2>/dev/null | LC_ALL=C sort | awk -v b="$BASELINE" 'substr($0,1,4) <= b')
  pending="$(cd "$MIG_DIR" 2>/dev/null && ls -1 [0-9][0-9][0-9][0-9]_*.sql 2>/dev/null | awk -v b="$BASELINE" 'substr($0,1,4) > b' | wc -l)"
  echo "repository_files_0001_to_$BASELINE=${#repo_files[@]} repository_files_above_$BASELINE=$pending (informational: pending, never touched here)"
  if [ "${#repo_files[@]}" != "$EXPECTED_COUNT" ]; then
    record ledger_filenames UNVERIFIED "the repository holds ${#repo_files[@]} files up to $BASELINE, expected $EXPECTED_COUNT; cannot compare"
    record ledger_checksums UNVERIFIED "repository files incomplete"
  else
    missing=0; extra=0; mismatch=0
    declare -A in_ledger=()
    while IFS='|' read -r filename checksum; do
      in_ledger["$filename"]=1
      if [ -f "$MIG_DIR/$filename" ] && [ "${filename:0:4}" \< "0040" ]; then
        [ "$(sha256sum "$MIG_DIR/$filename" | awk '{print $1}')" = "$checksum" ] || { echo "checksum differs from the repository: $filename"; mismatch=$((mismatch + 1)); }
      else
        echo "ledger names a file that is not a repository migration up to $BASELINE: $filename"; extra=$((extra + 1))
      fi
    done < <(ro "SELECT filename, sha256 FROM tes_system.schema_migrations ORDER BY version" -F '|')
    for f in "${repo_files[@]}"; do [ -n "${in_ledger[$f]:-}" ] || { echo "repository file not in the ledger: $f"; missing=$((missing + 1)); }; done
    [ "$missing" = 0 ] && [ "$extra" = 0 ] && record ledger_filenames PASS "ledger and repository name the same $EXPECTED_COUNT files" || record ledger_filenames FAIL "missing_from_ledger=$missing not_in_repository=$extra"
    [ "$mismatch" = 0 ] && [ "$extra" = 0 ] && record ledger_checksums PASS "all ledger SHA-256 values equal the repository files" || record ledger_checksums FAIL "checksum_mismatches=$mismatch unmatched_entries=$extra"
  fi
fi

echo "== live driver application invitations (a count only; no applicant data is selected)"
if ! [ "$(ro "SELECT to_regclass('public.driver_application_invitations') IS NOT NULL")" = t ]; then
  record live_invitations UNVERIFIED "table public.driver_application_invitations does not exist"
elif [ "$(ro "SELECT has_table_privilege(current_user, 'public.driver_application_invitations', 'SELECT')")" != t ]; then
  record live_invitations UNVERIFIED "the identity has no SELECT on the table"
else
  # Row-level security would silently filter rows for an identity it applies to, which would make a count of 0 meaningless: refuse to report in that case.
  rls_applies="$(ro "SELECT c.relrowsecurity AND (c.relforcerowsecurity OR NOT (pg_has_role(current_user, c.relowner, 'USAGE') OR r.rolbypassrls OR r.rolsuper)) FROM pg_class c, pg_roles r WHERE c.oid = 'public.driver_application_invitations'::regclass AND r.rolname = current_user")"
  if [ "$rls_applies" != f ]; then
    record live_invitations UNVERIFIED "row-level security applies to this identity (or could not be determined); a count would be unreliable"
  else
    n="$(ro "SELECT count(*) FROM public.driver_application_invitations WHERE status IN ('SENT', 'OPENED') AND expires_at > now()")"
    if [[ "$n" =~ ^[0-9]+$ ]]; then record live_invitations PASS "live_invitations=$n"; [ "$n" -gt 0 ] && echo "NOTE: $n live invitation link(s) would be affected by migration 0041 until the new application is serving"; else record live_invitations UNVERIFIED "unexpected result"; fi
  fi
fi

echo "== RESULT"
if [ "$overall" = 0 ]; then echo "CLEAR: every item PASSED (read-only; nothing was changed)"; else echo "NOT CLEAR: at least one item is FAIL or UNVERIFIED (read-only; nothing was changed)"; fi
exit "$overall"
