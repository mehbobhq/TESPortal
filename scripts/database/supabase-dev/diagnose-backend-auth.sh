#!/usr/bin/env bash
# READ-ONLY diagnostic for "the backend role authenticates locally but not from GitHub Actions". Prints no secret and no
# secret-derived value: only yes/no properties, fixed category words and a REDACTED one-line message template.
# Same environment as verify-readonly.sh. It writes nothing to the database (read-only transactions) and changes no setting.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=guard-target.sh
. "$here/guard-target.sh"
# shellcheck source=probe-lib.sh
. "$here/probe-lib.sh"
tes_dev_guard "" || exit 2
unset PGOPTIONS
PROBE_ALLOW_NON_ASCII=1   # diagnostics only: try the credentials as given (verify-readonly.sh rejects non-ASCII)
export PGCONNECT_TIMEOUT=20
BACKEND_ROLE='tes-backend@tes-production-510007.iam'; MIGRATOR_ROLE='tes-database-migrator@tes-production-510007.iam'
MU="${TES_MIGRATOR_USER:-}"; MP="${TES_MIGRATOR_PASSWORD:-}"; BU="${TES_BACKEND_USER:-}"; BP="${TES_BACKEND_PASSWORD:-}"
SANITIZE_VALUES=("$MU" "$BU" "$MP" "$BP" "$PGHOST" "$PGDATABASE")
show() { # show <name> <0|1>  -> "name: yes|no"
  if [ "$2" = 1 ]; then echo "$1: yes"; else echo "$1: no"; fi
}
ref_of() { [[ "$1" =~ \.([a-z0-9]{20})$ ]] && printf '%s' "${BASH_REMATCH[1]}"; }

echo "== client"
echo "psql: $(psql --version | head -1 | sed -E 's/[^0-9A-Za-z .()-]//g')"
echo "== identity shape (yes/no only)"
rb="$(ref_of "$BU")"; rm_="$(ref_of "$MU")"
c=0; [ "${BU%.????????????????????}" = "$BACKEND_ROLE" ] && c=1; show backend_user_base_is_exact_role $c
c=0; [ "${MU%.????????????????????}" = "$MIGRATOR_ROLE" ] && c=1; show migrator_user_base_is_exact_role $c
c=0; [ -n "$rb" ] && [ -n "$rm_" ] && c=1; show both_have_tenant_suffix $c
c=0; [ -n "$rb" ] && [ "$rb" = "$rm_" ] && c=1; show tenant_suffix_identical_for_both $c
c=1; LC_ALL=C grep -q '[^ -~]' <<<"$BU" && c=0; show backend_user_printable_ascii_only $c
c=1; LC_ALL=C grep -q '[^ -~]' <<<"$BP" && c=0; show backend_password_printable_ascii_only $c
c=1; [[ "$BP" =~ ^[[:space:]]|[[:space:]]$|[[:cntrl:]] ]] && c=0; show backend_password_has_no_edge_or_control_whitespace $c
c=0; [ -n "$BP" ] && [ "$BP" != "$MP" ] && c=1; show backend_password_differs_from_migrator_password $c
echo "== role state as seen by the migrator (read-only catalogue)"
q() { { printf 'BEGIN TRANSACTION READ ONLY;\n%s\n;\nROLLBACK;\n' "$1"; } | env -u PGOPTIONS PGUSER="$MU" PGPASSWORD="$MP" PGPORT="$PGPORT" "${PSQL_BIN:-psql}" -X -At -q --no-password -v ON_ERROR_STOP=1 2>/dev/null; }
role_row="$(q "SELECT (r.rolcanlogin)::text||'|'||(r.rolvaliduntil IS NULL)::text||'|'||r.rolconnlimit::text||'|'||(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole)::text FROM pg_roles r WHERE r.rolname = '$BACKEND_ROLE'")"
if [ -n "$role_row" ]; then IFS='|' read -r can_login no_expiry connlimit elevated <<<"$role_row"
  echo "backend_role_exists: yes"; echo "backend_role_can_login: $([ "$can_login" = true ] && echo yes || echo no)"; echo "backend_role_has_no_expiry: $([ "$no_expiry" = true ] && echo yes || echo no)"
  echo "backend_role_connection_limit_unlimited: $([ "$connlimit" = -1 ] && echo yes || echo no)"; echo "backend_role_has_elevated_attribute: $([ "$elevated" = true ] && echo yes || echo no)"
else echo "backend_role_exists: no_or_unreadable"; fi
for r in "$BACKEND_ROLE" "$MIGRATOR_ROLE"; do
  v="$(q "SELECT left(rolpassword, 14) = 'SCRAM-SHA-256\$' FROM pg_authid WHERE rolname = '$r'")"
  echo "${r%%@*}_password_stored_as_scram: $([ "$v" = t ] && echo yes || { [ "$v" = f ] && echo no || echo unreadable; })"
done

echo "== connection attempts (category + redacted message template)"
attempt() { # attempt <label> <user> <password> <port> [VAR=VALUE ...]
  local label="$1" u="$2" p="$3" port="$4"; shift 4; PROBE_ENV=("$@")
  if probe_connect "$u" "$p" "$port"; then echo "$label: PASS"; else echo "$label: FAIL category=$PROBE_CATEGORY message=$PROBE_DETAIL"; fi
  PROBE_ENV=()
}
for i in 1 2 3; do
  attempt "migrator_attempt_$i(port $PGPORT)" "$MU" "$MP" "$PGPORT"
  attempt "backend_attempt_$i(port $PGPORT)" "$BU" "$BP" "$PGPORT"
  [ "$i" = 3 ] || sleep 5
done
attempt "backend_channel_binding_disabled(port $PGPORT)" "$BU" "$BP" "$PGPORT" PGCHANNELBINDING=disable
attempt "backend_transaction_pooler(port 6543)" "$BU" "$BP" 6543
# password supplied through a password file instead of PGPASSWORD (rules out environment-variable handling)
pf="$(mktemp)"; chmod 600 "$pf"; trap 'rm -f "$pf"' EXIT
# the same password re-encoded as a Windows/legacy client would have sent it (decides whether the stored verifier was made from non-UTF-8 bytes)
for enc in ISO-8859-1 CP1252 CP850 CP437; do
  if conv="$(printf '%s' "$BP" | iconv -f UTF-8 -t "$enc" 2>/dev/null; printf x)" && conv="${conv%x}" && [ -n "$conv" ] && [ "$conv" != "$BP" ]; then
    if probe_connect "$BU" "$conv" "$PGPORT"; then echo "backend_password_reencoded_as_$enc: PASS"; else echo "backend_password_reencoded_as_$enc: FAIL category=$PROBE_CATEGORY"; fi
  else echo "backend_password_reencoded_as_$enc: not_applicable"; fi
done
unset conv
esc() { local x="${1//\\/\\\\}"; printf '%s' "${x//:/\\:}"; }
printf '%s:%s:%s:%s:%s\n' "$(esc "$PGHOST")" "$PGPORT" "$(esc "$PGDATABASE")" "$(esc "$BU")" "$(esc "$BP")" > "$pf"
out="$(printf 'SELECT 1;\n' | env -u PGOPTIONS -u PGPASSWORD PGPASSFILE="$pf" PGUSER="$BU" PGPORT="$PGPORT" "${PSQL_BIN:-psql}" -X -At -q --no-password -v ON_ERROR_STOP=1 2>&1 >/dev/null)" \
  && echo "backend_via_password_file(port $PGPORT): PASS" || echo "backend_via_password_file(port $PGPORT): FAIL category=$(classify_connection_error "$out") message=$(sanitize_error "$out")"
echo "== done (read-only; nothing was changed)"
