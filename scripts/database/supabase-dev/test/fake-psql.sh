#!/usr/bin/env bash
# Synthetic psql stand-in for probe-lib tests. FAKE_MODE selects the behaviour; it never connects anywhere.
sql="$(cat)"
is_write=0; grep -q 'CREATE TEMP' <<<"$sql" && is_write=1
case "${FAKE_MODE:?}" in
  refuse)          [ $is_write = 1 ] && { echo 'ERROR:  25006' >&2; exit 3; }; exit 0;;
  write_accepted)  exit 0;;
  other_sqlstate)  [ $is_write = 1 ] && { echo 'ERROR:  42501' >&2; exit 3; }; exit 0;;
  readonly_words_only) [ $is_write = 1 ] && { echo 'ERROR:  cannot execute CREATE TABLE in a read-only transaction' >&2; exit 3; }; exit 0;;
  auth)            echo 'psql: error: connection to server at "10.1.2.3", port 5432 failed: FATAL:  password authentication failed for user "tes-backend@tes-production-510007.iam.abcdefghijklmnopqrst"' >&2; exit 2;;
  startup)         echo 'psql: error: connection to server failed: FATAL:  unsupported startup parameter: options' >&2; exit 2;;
  tenant)          echo 'psql: error: connection to server failed: FATAL:  Tenant or user not found' >&2; exit 2;;
  role)            echo 'psql: error: FATAL:  role "x" does not exist' >&2; exit 2;;
  database)        echo 'psql: error: FATAL:  database "x" does not exist' >&2; exit 2;;
  tls)             echo 'psql: error: SSL error: certificate verify failed' >&2; exit 2;;
  network)         echo 'psql: error: connection to server failed: Connection timed out' >&2; exit 2;;
  weird)           echo 'psql: error: something nobody has seen' >&2; exit 2;;
  drop_mid_probe)  [ $is_write = 1 ] && { echo 'psql: error: server closed the connection unexpectedly' >&2; exit 2; }; exit 0;;
esac
