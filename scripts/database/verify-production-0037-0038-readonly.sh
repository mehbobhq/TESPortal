#!/usr/bin/env bash
# TES: READ-ONLY verification of the production database for migrations 0037 / 0038. It changes nothing and prints NO row data: only counts,
# booleans, catalogue facts and migration file names. Intended to be run by .github/workflows/production-0037-0038-readonly-verification.yml
# (manual dispatch, production-database environment), and runnable by an operator against any database for the same evidence.
#
#   TES_VERIFY_PHASE   pre-0037 | post-0037 | post-0038     what the ledger must hold (36 | 37 | 38 migrations)
#   PGHOST/PGPORT/PGDATABASE/PGUSER (+ PGPASSWORD or IAM auth) as for psql
#
# Exit status 0 = every gate for the phase is clear; 1 = at least one BLOCKER (listed); the script never "fixes" anything.
set -uo pipefail
: "${TES_VERIFY_PHASE:?TES_VERIFY_PHASE must be pre-0037, post-0037 or post-0038}"
case "$TES_VERIFY_PHASE" in pre-0037) EXPECT=36 ;; post-0037) EXPECT=37 ;; post-0038) EXPECT=38 ;; *) echo "unknown phase" >&2; exit 2 ;; esac
RUNTIME_ROLE="${TES_RUNTIME_ROLE:-tes-backend@tes-production-510007.iam}"
# Session-level read-only: any write, even by mistake, is refused by PostgreSQL itself.
export PGOPTIONS="-c default_transaction_read_only=on ${PGOPTIONS:-}"
MIG_DIR="${MIGRATIONS_DIR:-database/migrations}"
status=0
blocker() { echo "BLOCKER: $*"; status=1; }
sql() { psql -X -At --no-password -v ON_ERROR_STOP=1 "$@"; }

echo "== phase: $TES_VERIFY_PHASE (expecting $EXPECT applied migrations)"

echo "== G1 ledger, ordering and integrity"
read -r applied highest contiguous <<<"$(sql -F ' ' -c "SELECT count(*), coalesce(max(substr(filename,1,4)),'none'), (count(*) = coalesce(max(substr(filename,1,4)::int),0) AND count(DISTINCT filename) = count(*)) FROM tes_system.schema_migrations")" || { blocker "the migration ledger cannot be read"; applied=-1; }
echo "applied=$applied highest=$highest contiguous_from_0001=$contiguous"
[ "$applied" = "$EXPECT" ] || blocker "ledger holds $applied migrations; this phase expects exactly $EXPECT"
[ "$contiguous" = "t" ] || blocker "ledger is not a contiguous 0001..N sequence"
mismatch=0
while IFS='|' read -r filename checksum; do
  [ -f "$MIG_DIR/$filename" ] || { echo "ledger names $filename which is not in the repository"; mismatch=$((mismatch + 1)); continue; }
  [ "$(sha256sum "$MIG_DIR/$filename" | awk '{print $1}')" = "$checksum" ] || { echo "checksum differs from the repository: $filename"; mismatch=$((mismatch + 1)); }
done < <(sql -F '|' -c "SELECT filename, sha256 FROM tes_system.schema_migrations ORDER BY filename")
echo "ledger_entries_not_matching_repository=$mismatch"
[ "$mismatch" = 0 ] || blocker "$mismatch ledger entr(y/ies) differ from the repository migration files"

echo "== G2 encoding"
enc="$(sql -c "SHOW server_encoding")"; echo "server_encoding=$enc"
[ "$enc" = "UTF8" ] || blocker "database encoding is $enc; migration 0037 needs UTF8"

echo "== G3 execution identity and permissions (no credentials printed)"
sql -F ' | ' -c "SELECT 'current_user=' || current_user, 'session_user=' || session_user, 'superuser=' || rolsuper, 'createrole=' || rolcreaterole, 'bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = current_user"
sql -F ' | ' -c "SELECT 'create_on_public=' || has_schema_privilege(current_user,'public','CREATE'), 'create_on_tes_security=' || has_schema_privilege(current_user,'tes_security','CREATE'), 'usage_on_tes_system=' || has_schema_privilege(current_user,'tes_system','USAGE'), 'runtime_role_exists=' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RUNTIME_ROLE')"
[ "$(sql -c "SELECT has_schema_privilege(current_user,'public','CREATE') AND has_schema_privilege(current_user,'tes_security','CREATE')")" = "t" ] || blocker "the execution identity cannot create objects in public/tes_security (it could not apply the migrations)"
[ "$(sql -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RUNTIME_ROLE')")" = "t" ] || blocker "the runtime role $RUNTIME_ROLE does not exist"

echo "== G-schema: expected presence or ABSENCE of the new objects for this phase"
has37="$(sql -c "SELECT to_regprocedure('tes_security.canonical_country_code(text)') IS NOT NULL")"
has38="$(sql -c "SELECT to_regclass('public.organization_vehicle_open_operator_uq') IS NOT NULL")"
echo "migration_0037_objects_present=$has37 migration_0038_objects_present=$has38"
case "$TES_VERIFY_PHASE" in
  pre-0037)  [ "$has37" = f ] && [ "$has38" = f ] && echo "(expected: 0037 and 0038 objects are absent before 0037; absence is not a failure)" || blocker "0037/0038 objects already exist but the ledger phase is pre-0037" ;;
  post-0037) [ "$has37" = t ] && [ "$has38" = f ] || blocker "post-0037 expects the 0037 objects present and the 0038 objects absent" ;;
  post-0038) [ "$has37" = t ] && [ "$has38" = t ] || blocker "post-0038 expects both sets of objects present" ;;
esac

echo "== G4 gate checks (after 0037: SECURITY DEFINER owner / search_path / ACL / role membership / RLS)"
if [ "$has37" = t ]; then sql -f scripts/database/verify-production-0037-0038-gates.sql 2>&1 | grep -v "^SET$" || blocker "gate SQL failed"; else echo "skipped: migration 0037 is not applied (its functions are expected to be absent)"; fi

echo "== G5 conflict preflights (COUNTS only; a nonzero count in a non-[INFO] section is a blocker)"
run_preflight() { # file label
  python3 - "$1" "$2" <<'PY'
import re, subprocess, sys
path, label = sys.argv[1], sys.argv[2]
sections, title, buf = [], None, []
for line in open(path, encoding="utf-8"):
    m = re.match(r"\\echo '(.*)'\s*$", line)
    if m:
        title, buf = m.group(1), []
        continue
    if title is None or line.startswith("--") or line.startswith("SET ") or not line.strip():
        continue
    buf.append(line.rstrip("\n"))
    if line.rstrip().endswith(";"):
        sections.append((title, " ".join(buf).rstrip(";"))); title, buf = None, []
blocked = 0
for title, query in sections:
    info = title.startswith("[INFO]")
    r = subprocess.run(["psql", "-X", "-At", "--no-password", "-v", "ON_ERROR_STOP=1", "-c", f"SELECT count(*) FROM ({query}) q"], capture_output=True, text=True)
    if r.returncode != 0:
        why = "needs migration 0037 (canonical functions absent)" if "does not exist" in r.stderr and "canonical" in r.stderr else "query error"
        print(f"{label} :: {title[:90]} -> SKIPPED ({why})")
        if why == "query error": blocked += 1
        continue
    n = int(r.stdout.strip() or 0)
    print(f"{label} :: {title[:90]} -> {n} row(s){' [informational]' if info else ''}")
    if n > 0 and not info: blocked += 1
sys.exit(1 if blocked else 0)
PY
}
run_preflight scripts/database/preflight-0037-driver-identity.sql "0037" || blocker "0037 preflight reports blocking conflicts or a query error"
if [ "$TES_VERIFY_PHASE" = pre-0037 ]; then
  echo "0038 preflight: sections that need the 0037 canonical functions are reported SKIPPED; run again as post-0037 before applying 0038"
fi
run_preflight scripts/database/preflight-0038-duplicate-prevention.sql "0038" || { [ "$TES_VERIFY_PHASE" = pre-0037 ] && echo "(0038 preflight outcome before 0037 is provisional)" ; blocker "0038 preflight reports blocking conflicts or a query error"; }

echo "== RESULT"
if [ "$status" = 0 ]; then echo "CLEAR: every gate for phase $TES_VERIFY_PHASE passed (read-only; nothing was changed)"; else echo "BLOCKED: see BLOCKER lines above (read-only; nothing was changed)"; fi
exit "$status"
