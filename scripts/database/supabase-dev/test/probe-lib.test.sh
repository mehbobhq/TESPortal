#!/usr/bin/env bash
# Synthetic tests for probe-lib.sh (no database, no network). A probe PASSES only for: connected AND server SQLSTATE 25006.
cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." || exit 1
D=scripts/database/supabase-dev
. $D/probe-lib.sh
export PSQL_BIN="$PWD/$D/test/fake-psql.sh"
fail=0; n=0
t() { # t <mode> <expected-return 0|1> <expected-category> [user] [pass]
  n=$((n+1)); export FAKE_MODE="$1"
  probe_write "${4-u}" "${5-p}" 5432; local rc=$?
  if [ "$rc" = "$2" ] && [ "$PROBE_CATEGORY" = "$3" ]; then echo "ok   $1 -> rc=$rc category=$PROBE_CATEGORY"; else echo "FAIL $1 -> rc=$rc category=$PROBE_CATEGORY (wanted rc=$2 category=$3)"; fail=$((fail+1)); fi
}
t refuse              0 ok
t write_accepted      1 write_accepted
t other_sqlstate      1 sql_error:42501
t readonly_words_only 1 unclassified      # English text containing "read-only" without SQLSTATE 25006 is NOT a pass
t auth                1 auth
t startup             1 startup_parameter
t tenant              1 pooler_identity
t role                1 role
t database            1 database
t tls                 1 tls
t network             1 network
t weird               1 unclassified
t drop_mid_probe      1 network
t refuse              1 missing_credential u ""
t refuse              1 missing_credential "" p
t refuse              1 malformed_credential u $'p\n'
t refuse              1 malformed_credential "u " p
t refuse              1 malformed_credential u $'p\r'
# no raw driver text, user name or address is ever printed by the probes
n=$((n+1)); export FAKE_MODE=auth; out="$(probe_write tes-backend@x pw 5432 2>&1; echo "$PROBE_CATEGORY")"
if grep -Eq 'tes-backend|10\.1\.2\.3|password authentication|abcdefghij' <<<"$out"; then echo "FAIL probe printed raw driver text"; fail=$((fail+1)); else echo "ok   probes print nothing from the driver"; fi
# redacted message: no user, password, host, address or quoted string survives; the template does
n=$((n+1)); export FAKE_MODE=auth; SANITIZE_VALUES=(tes-backend@tes-production-510007.iam.abcdefghijklmnopqrst S3cretPw db.example.supabase.com)
probe_connect tes-backend@tes-production-510007.iam.abcdefghijklmnopqrst S3cretPw 5432
if grep -Eq 'tes-backend|abcdefghij|S3cretPw|10\.1\.2\.3|example' <<<"$PROBE_DETAIL" || ! grep -q 'password authentication failed for user "<q>"' <<<"$PROBE_DETAIL"; then echo "FAIL sanitized message: $PROBE_DETAIL"; fail=$((fail+1)); else echo "ok   sanitized message keeps only the template: $PROBE_DETAIL"; fi
n=$((n+1)); out="$(sanitize_error $'line one S3cretPw at 10.1.2.3 host.supabase.com "quoted" \x01weird\nsecond line')"
if grep -Eq 'S3cretPw|10\.1\.2\.3|supabase|quoted|second' <<<"$out"; then echo "FAIL sanitize leaks: $out"; fail=$((fail+1)); else echo "ok   sanitize drops values, hosts, quotes and later lines"; fi
echo "== $((n-fail))/$n passed"; [ "$fail" = 0 ]
