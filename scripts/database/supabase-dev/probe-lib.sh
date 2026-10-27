#!/usr/bin/env bash
# Connection and read-only probes for verify-readonly.sh. Sourced; also sourced by the synthetic tests with PSQL_BIN
# pointing at a stub. Output is limited to a fixed category word and a five-character SQLSTATE: raw psql/libpq text
# (which can name users, hosts or addresses) is never printed.
#
# Categories: ok | missing_credential | non_ascii_credential | malformed_credential | auth | pooler_identity | role | database | login_privilege | tls |
#             startup_parameter | network | sql_error:<SQLSTATE> | unclassified

SANITIZE_VALUES=()   # callers add secrets/identifiers that must never appear in a message
PROBE_ENV=()         # extra VAR=VALUE for the probe's psql (diagnostics only)
PROBE_DETAIL=""

# classify_connection_error <captured stderr text> -> category word (no echo of the text)
classify_connection_error() {
  local t="${1,,}"
  case "$t" in
    *"unsupported startup parameter"*|*"startup parameter"*|*"unknown parameter"*) echo startup_parameter;;
    *"tenant or user not found"*|*"user not found"*)                              echo pooler_identity;;
    *"password authentication failed"*|*"authentication failed"*|*"no password supplied"*|*"password is required"*|*"scram"*|*"sasl"*) echo auth;;
    *"role "*"does not exist"*)                                                   echo role;;
    *"database "*"does not exist"*)                                               echo database;;
    *"not permitted to log in"*|*"permission denied for database"*|*"too many connections"*|*"connection limit"*) echo login_privilege;;
    *"ssl"*|*"tls"*|*"certificate"*)                                              echo tls;;
    *"timeout"*|*"timed out"*|*"could not translate"*|*"connection refused"*|*"could not connect"*|*"server closed the connection"*|*"no route"*|*"network is unreachable"*|*"connection reset"*) echo network;;
    *) echo unclassified;;
  esac
}

# sanitize_error <captured text> -> ONE redacted line: first line only; every quoted string, host name, IP address and any
# value listed in SANITIZE_VALUES (user names, password, host, database) is replaced by a placeholder; only a safe character
# set survives; at most 160 characters. What remains is the message template (e.g. `FATAL: password authentication failed for user "<q>"`).
sanitize_error() {
  local line v
  line="$(printf '%s\n' "$1" | head -n1)"
  for v in "${SANITIZE_VALUES[@]:-}"; do [ -n "$v" ] && line="${line//"$v"/<s>}"; done
  printf '%s' "$line" | sed -E "s/\"[^\"]*\"/\"<q>\"/g; s/'[^']*'/'<q>'/g; s/[A-Za-z0-9._-]+\.(com|co|net|org|io|internal|local)\b/<host>/g; s/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/<ip>/g; s/[0-9a-fA-F]*:[0-9a-fA-F:]{4,}/<ip6>/g; s/[^A-Za-z0-9 _:;,.()<>\"'\/-]/?/g" | cut -c1-160
}

# psql_run <user> <password> <port>   (SQL on stdin; stderr -> stdout, stdout discarded). No PGOPTIONS: poolers may reject startup parameters.
psql_run() {
  env -u PGOPTIONS "${PROBE_ENV[@]}" PGUSER="$1" PGPASSWORD="$2" PGPORT="$3" "${PSQL_BIN:-psql}" -X -At -q --no-password -v ON_ERROR_STOP=1 2>&1 >/dev/null
}

# probe_connect <user> <password> <port>  -> sets PROBE_CATEGORY (ok only when a session was established and answered SELECT 1)
probe_connect() {
  PROBE_CATEGORY=""
  if [ -z "$1" ] || [ -z "$2" ]; then PROBE_CATEGORY=missing_credential; return 1; fi
  # the stored SCRAM verifier depends on the exact bytes the setting client sent; non-ASCII passwords/users are encoding-dependent
  if [ "${PROBE_ALLOW_NON_ASCII:-}" != 1 ] && LC_ALL=C grep -qP '[\x80-\xFF]' <<<"$1$2"; then PROBE_CATEGORY=non_ascii_credential; return 1; fi
  # a pasted secret with a leading/trailing blank or a newline/CR inside can never authenticate; name it instead of guessing
  if [[ "$1" =~ ^[[:space:]]|[[:space:]]$|[[:cntrl:]] ]] || [[ "$2" =~ ^[[:space:]]|[[:space:]]$|[[:cntrl:]] ]]; then PROBE_CATEGORY=malformed_credential; return 1; fi
  local out rc
  out="$(printf 'SELECT 1;\n' | psql_run "$1" "$2" "$3")"; rc=$?
  if [ $rc = 0 ]; then PROBE_CATEGORY=ok; return 0; fi
  PROBE_CATEGORY="$(classify_connection_error "$out")"; PROBE_DETAIL="$(sanitize_error "$out")"; return 1
}

# probe_write <user> <password> <port>  -> PASS only if the connection worked AND the server itself answered the write with
# SQLSTATE 25006 (read_only_sql_transaction). Success of the write, any other SQLSTATE, or any connection problem is not PASS.
probe_write() {
  PROBE_CATEGORY=""
  probe_connect "$@" || return 1
  local out rc state
  out="$(printf '\\set VERBOSITY sqlstate\nBEGIN TRANSACTION READ ONLY;\nCREATE TEMP TABLE _tes_ro_probe (x int);\nROLLBACK;\n' | psql_run "$1" "$2" "$3")"; rc=$?
  if [ $rc = 0 ]; then PROBE_CATEGORY=write_accepted; return 1; fi
  state="$(grep -Eo '^ERROR:  [0-9A-Z]{5}$' <<<"$out" | head -1 | grep -Eo '[0-9A-Z]{5}$')"
  if [ "$state" = 25006 ]; then PROBE_CATEGORY=ok; return 0; fi
  if [ -n "$state" ]; then PROBE_CATEGORY="sql_error:$state"; return 1; fi
  PROBE_CATEGORY="$(classify_connection_error "$out")"; return 1   # connection dropped mid-probe
}

# tls_verdict <server-side status PASS|UNVERIFIED|FAIL> <PGSSLMODE> <TES_DEV_LOCAL_TEST>  -> prints "STATUS|detail"
# pg_stat_ssl describes only the pooler->database hop when a pooler is in the path, so the server may be unable to confirm the
# client's session. For a non-local target the guard already requires PGSSLMODE=verify-full with a pinned CA, and the probes
# only reach this point on a connection libpq accepted, so the client leg is verified by the client itself. A local test
# (no TLS) is never promoted.
tls_verdict() {
  local status="$1" mode="$2" local_test="$3"
  if [ "$status" = PASS ] || [ "$status" = FAIL ]; then printf '%s|server reports the session encrypted' "$status"; return; fi
  if [ "$mode" = verify-full ] && [ "$local_test" != 1 ]; then
    printf 'PASS|client-to-pooler TLS verified by the client (sslmode=verify-full, pinned CA); the pooler-to-database hop is not observable from the session'
  else
    printf 'UNVERIFIED|no TLS verification is in effect for this target'
  fi
}
