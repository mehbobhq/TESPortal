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
#   ledger_latest          latest version is 0039
#   ledger_sequence        the versions are EXACTLY 0001..0039: no gap, duplicate, substitution (e.g. 0000) or unexpected version
#   ledger_filenames       the ledger and the repository files 0001-0039 name exactly the same files, and every version equals the four-digit prefix of its file name
#   ledger_checksums       every ledger SHA-256 equals the SHA-256 of the repository file of that name
#   live_invitations       count of driver application invitations that are usable and unexpired: status PENDING, SENT or OPENED (the live statuses of migration 0039) and expires_at in the future (a number only)
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
  for i in ledger_count ledger_latest ledger_sequence ledger_filenames ledger_checksums; do record $i FAIL "tes_system.schema_migrations does not exist"; done
else
  # The whole ledger is read once (version, filename, checksum: file names and hashes only) and judged here, so no SQL expression decides what "contiguous" means.
  ledger="$(ro "SELECT version, filename, sha256 FROM tes_system.schema_migrations ORDER BY version, filename" -F '|')"
  applied=0; [ -n "$ledger" ] && applied="$(printf '%s\n' "$ledger" | wc -l)"
  actual_versions="$(printf '%s\n' "$ledger" | cut -d'|' -f1 | LC_ALL=C sort)"; [ -n "$ledger" ] || actual_versions=""
  expected_versions="$(printf '%04d\n' $(seq 1 "$EXPECTED_COUNT"))"
  latest="$(printf '%s\n' "$actual_versions" | tail -1)"; [ -n "$latest" ] || latest=none
  echo "applied=$applied latest=$latest"

  [ "$applied" = "$EXPECTED_COUNT" ] && record ledger_count PASS "applied=$applied" || record ledger_count FAIL "applied=$applied, expected exactly $EXPECTED_COUNT"
  [ "$latest" = "$BASELINE" ] && record ledger_latest PASS "latest=$latest" || record ledger_latest FAIL "latest=$latest, expected $BASELINE"

  # exact version sequence 0001..0039: no gap, duplicate, substitution (such as 0000 for 0001) or unexpected version
  unexpected="$(comm -13 <(printf '%s\n' "$expected_versions") <(printf '%s\n' "$actual_versions" | LC_ALL=C sort -u) | grep -v '^$' || true)"
  absent="$(comm -23 <(printf '%s\n' "$expected_versions") <(printf '%s\n' "$actual_versions" | LC_ALL=C sort -u) | grep -v '^$' || true)"
  dupes="$(printf '%s\n' "$actual_versions" | LC_ALL=C uniq -d | grep -v '^$' || true)"
  if [ "$actual_versions" = "$expected_versions" ]; then record ledger_sequence PASS "versions are exactly 0001..$BASELINE"
  else
    [ -z "$unexpected" ] || echo "unexpected ledger version(s): $(echo $unexpected)"; [ -z "$absent" ] || echo "version(s) missing from the ledger: $(echo $absent)"; [ -z "$dupes" ] || echo "duplicated ledger version(s): $(echo $dupes)"
    record ledger_sequence FAIL "unexpected=$(echo $unexpected | wc -w) missing=$(echo $absent | wc -w) duplicated=$(echo $dupes | wc -w)"
  fi

  mapfile -t repo_files < <(cd "$MIG_DIR" 2>/dev/null && ls -1 [0-9][0-9][0-9][0-9]_*.sql 2>/dev/null | LC_ALL=C sort | awk -v b="$BASELINE" 'substr($0,1,4) <= b')
  pending="$(cd "$MIG_DIR" 2>/dev/null && ls -1 [0-9][0-9][0-9][0-9]_*.sql 2>/dev/null | awk -v b="$BASELINE" 'substr($0,1,4) > b' | wc -l)"
  echo "repository_files_0001_to_$BASELINE=${#repo_files[@]} repository_files_above_$BASELINE=$pending (informational: pending, never touched here)"
  if [ "${#repo_files[@]}" != "$EXPECTED_COUNT" ]; then
    record ledger_filenames UNVERIFIED "the repository holds ${#repo_files[@]} files up to $BASELINE, expected $EXPECTED_COUNT; cannot compare"
    record ledger_checksums UNVERIFIED "repository files incomplete"
  else
    missing=0; extra=0; badprefix=0; mismatch=0
    declare -A in_ledger=()
    while IFS='|' read -r version filename checksum; do
      [ -n "$version$filename" ] || continue
      in_ledger["$filename"]=1
      # the version column must equal the four-digit prefix of the file name
      [ "$version" = "${filename:0:4}" ] || { echo "version/filename mismatch: version=$version filename=$filename"; badprefix=$((badprefix + 1)); }
      if [ -f "$MIG_DIR/$filename" ] && [[ "${filename:0:4}" =~ ^[0-9]{4}$ ]] && [[ ! "${filename:0:4}" > "$BASELINE" ]]; then
        [ "$(sha256sum "$MIG_DIR/$filename" | awk '{print $1}')" = "$checksum" ] || { echo "checksum differs from the repository: $filename"; mismatch=$((mismatch + 1)); }
      else
        echo "ledger names a file that is not a repository migration up to $BASELINE: $filename"; extra=$((extra + 1))
      fi
    done <<<"$ledger"
    for f in "${repo_files[@]}"; do [ -n "${in_ledger[$f]:-}" ] || { echo "repository file not in the ledger: $f"; missing=$((missing + 1)); }; done
    if [ "$missing" = 0 ] && [ "$extra" = 0 ] && [ "$badprefix" = 0 ]; then record ledger_filenames PASS "ledger and repository name the same $EXPECTED_COUNT files, each version equals its file name prefix"
    else record ledger_filenames FAIL "missing_from_ledger=$missing not_in_repository=$extra version_filename_mismatches=$badprefix"; fi
    if [ "$mismatch" = 0 ] && [ "$extra" = 0 ]; then record ledger_checksums PASS "all ledger SHA-256 values equal the repository files"
    else record ledger_checksums FAIL "checksum_mismatches=$mismatch unmatched_entries=$extra"; fi
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
    n="$(ro "SELECT count(*) FROM public.driver_application_invitations WHERE status IN ('PENDING', 'SENT', 'OPENED') AND expires_at > now()")"
    if [[ "$n" =~ ^[0-9]+$ ]]; then record live_invitations PASS "live_invitations=$n"; [ "$n" -gt 0 ] && echo "NOTE: $n usable invitation link(s) would be affected by migration 0041 until the new application is serving"; else record live_invitations UNVERIFIED "unexpected result"; fi
  fi
fi

echo "== RESULT"
if [ "$overall" = 0 ]; then echo "CLEAR: every item PASSED (read-only; nothing was changed)"; else echo "NOT CLEAR: at least one item is FAIL or UNVERIFIED (read-only; nothing was changed)"; fi
exit "$overall"
