#!/usr/bin/env bash
# Reproducible test report for the baseline-0039 read-only verifier. Runs the verifier-specific tests against a DISPOSABLE local PostgreSQL cluster and writes a report
# (tested commit, exact commands, PostgreSQL version, UTC time, PASS/FAIL summary, disposable-database confirmation).
#   PGHOST=127.0.0.1 PGPORT=55441 PGUSER=postgres bash scripts/database/test/report-baseline-0039.sh [report-file]
set -uo pipefail
case "${PGHOST:-}" in 127.0.0.1|localhost|/*) ;; *) echo "refusing: PGHOST must be a local disposable cluster" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
OUT="${1:-docs/driver-events/test-results/baseline-0039-verifier-report.txt}"
SHA="$(git rev-parse HEAD)"; DIRTY="$(git status --porcelain -- scripts test .github | wc -l)"
PGV="$(psql -X -At -d postgres -c 'select version()')"; DATADIR="$(psql -X -At -d postgres -c 'show data_directory' 2>/dev/null || echo unknown)"
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CMD1="PGHOST=$PGHOST PGPORT=${PGPORT:-5432} PGUSER=$PGUSER bash scripts/database/test/verify-baseline-0039.test.sh"
CMD2="node --experimental-strip-types --import ./test/helpers/register-alias-loader.mjs --test test/lib/production-verification/baseline-0039.test.ts"
db_log="$(mktemp)"; unit_log="$(mktemp)"
bash scripts/database/test/verify-baseline-0039.test.sh 2>&1 | grep -v '^NOTICE' > "$db_log"; db_code=${PIPESTATUS[0]}
$CMD2 > "$unit_log" 2>&1; unit_code=$?
LEFT="$(psql -X -At -d postgres -c "select count(*) from pg_database where datname in ('t_base','t_full','t_rls','t_inv','t_neg')")"
db_pass="$(grep -c '^ok ' "$db_log")"; db_fail="$(grep -c '^FAIL' "$db_log")"
unit_pass="$(grep -E '^# pass' "$unit_log" | awk '{print $3}')"; unit_fail="$(grep -E '^# fail' "$unit_log" | awk '{print $3}')"
{
  echo "TES baseline-0039 read-only verifier: test report"
  echo "tested commit:        $SHA$( [ "$DIRTY" != 0 ] && echo ' (WITH UNCOMMITTED CHANGES in scripts/test/.github)')"
  echo "executed (UTC):       $START"
  echo "PostgreSQL:           $PGV"
  echo "disposable database:  YES. Local cluster only (host $PGHOST, port ${PGPORT:-5432}, data directory $DATADIR), throwaway databases t_base, t_full, t_rls, t_inv, t_neg created by the test and dropped at its end (left over: $LEFT). No production host, credential or workflow was used."
  echo
  echo "commands executed:"
  echo "  1. $CMD1"
  echo "  2. $CMD2"
  echo
  echo "RESULTS"
  echo "  database tests (verify-baseline-0039.test.sh): passed=$db_pass failed=$db_fail exit=$db_code"
  echo "  static tests (baseline-0039.test.ts):          passed=$unit_pass failed=$unit_fail exit=$unit_code"
  [ "$db_code" = 0 ] && [ "$unit_code" = 0 ] && [ "$LEFT" = 0 ] && echo "  OVERALL: PASS" || echo "  OVERALL: FAIL"
  echo
  echo "---- database test output ----"; cat "$db_log"
  echo "---- static test summary ----"; grep -E '^# (tests|pass|fail)|^\s+(ok|not ok)' "$unit_log" | head -40
} > "$OUT"
rm -f "$db_log" "$unit_log"; tail -n +1 "$OUT" | head -16; [ "$db_code" = 0 ] && [ "$unit_code" = 0 ] && [ "$LEFT" = 0 ]
