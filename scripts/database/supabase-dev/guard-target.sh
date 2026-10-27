#!/usr/bin/env bash
# Sourced by the Supabase DEVELOPMENT migration and verification scripts. Fails closed: the target must be
# explicitly declared as Supabase development, must not look like Cloud SQL / production, and the transport
# must be encrypted with certificate verification. Prints no secret.
#   TES_DATABASE_TARGET=supabase-dev   required
#   PGHOST PGPORT PGDATABASE           required (PGUSER too when a second argument is passed); PGPORT must equal the first argument when given
#   PGSSLMODE=verify-full + PGSSLROOTCERT=<file>   required for any non-local host
#   TES_DEV_LOCAL_TEST=1               local disposable cluster only (loopback host); skips the TLS and host-name rules
tes_dev_guard() {
  local expect_port="${1:-}"
  [ "${TES_DATABASE_TARGET:-}" = "supabase-dev" ] || { echo "REFUSED: TES_DATABASE_TARGET must be supabase-dev." >&2; return 1; }
  local v
  for v in PGHOST PGPORT PGDATABASE ${2:+PGUSER}; do
    [ -n "${!v:-}" ] || { echo "REFUSED: $v is not set." >&2; return 1; }
  done
  # the role names legitimately contain tes-production-510007, so only host, database and service are screened
  if printf '%s %s %s' "$PGHOST" "$PGDATABASE" "${PGSERVICE:-}${PGSERVICEFILE:-}" | grep -Eqi 'tes-production|tes-postgres-prod|510007|cloudsql|googleapis'; then
    echo "REFUSED: the target looks like Cloud SQL / production." >&2; return 1
  fi
  # libpq environment that could redirect the connection after the host-name checks, or weaken TLS
  for v in PGHOSTADDR PGSERVICE PGSERVICEFILE PGSSLCERT PGSSLKEY PGSSLCRL PGSSLSNI PGREQUIRESSL PGSYSCONFDIR PGKRBSRVNAME PGGSSENCMODE; do
    [ -z "${!v:-}" ] || { echo "REFUSED: $v must not be set." >&2; return 1; }
  done
  case "$PGHOST" in /*) [ "${TES_DEV_LOCAL_TEST:-}" = 1 ] || { echo "REFUSED: unix-socket hosts are for local tests only." >&2; return 1; };; esac
  if [ "${TES_DEV_LOCAL_TEST:-}" = 1 ]; then
    case "$PGHOST" in 127.0.0.1|localhost|::1|/*) ;; *) echo "REFUSED: TES_DEV_LOCAL_TEST is only valid for a loopback host." >&2; return 1;; esac
    # a loopback port-forward (for example a Cloud SQL proxy) must not pass as a disposable test database
    [ "$PGDATABASE" = "tes_dev" ] || { echo "REFUSED: local test mode only accepts the database tes_dev." >&2; return 1; }
  else
    case "$PGHOST" in
      *.supabase.com|*.supabase.co) ;;
      *) echo "REFUSED: host is not a Supabase host (*.supabase.com / *.supabase.co)." >&2; return 1;;
    esac
    [ "${PGSSLMODE:-}" = "verify-full" ] || { echo "REFUSED: PGSSLMODE must be verify-full." >&2; return 1; }
    [ -s "${PGSSLROOTCERT:-}" ] || { echo "REFUSED: PGSSLROOTCERT must name a CA file." >&2; return 1; }
  fi
  if [ -n "$expect_port" ] && [ "$PGPORT" != "$expect_port" ]; then
    echo "REFUSED: PGPORT must be $expect_port (session mode: migrations need a session advisory lock; the transaction pooler cannot be used)." >&2; return 1
  fi
  return 0
}
