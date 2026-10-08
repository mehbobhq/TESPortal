#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${TES_MASTER_ACTOR_ID:?TES_MASTER_ACTOR_ID is required}"

if [[ ! "$TES_MASTER_ACTOR_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]; then
  echo "Invalid TES actor UUID format." >&2
  exit 1
fi

psql \
  --no-password \
  --set=ON_ERROR_STOP=1 \
  --set=master_actor_id="$TES_MASTER_ACTOR_ID" <<'SQL'
BEGIN;

SELECT count(*) = 1 AS actor_exists_once
FROM public.actors
WHERE id = :'master_actor_id'
  AND actor_type = 'HUMAN'
  AND status = 'active'
\gset

\if :actor_exists_once
\else
  \echo 'ERROR: Target actor is not exactly one active HUMAN actor; Master Account bootstrap refused.'
  \quit 3
\endif

SELECT count(*) = 0 AS no_active_master_account
FROM public.master_account_authority
WHERE status = 'active'
\gset

\if :no_active_master_account
\else
  \echo 'ERROR: An active Master Account already exists; bootstrap refused.'
  \quit 3
\endif

INSERT INTO public.master_account_authority (
  actor_id,
  status,
  designated_at,
  designated_by_actor_id
)
VALUES (
  :'master_actor_id',
  'active',
  CURRENT_TIMESTAMP,
  :'master_actor_id'
);

COMMIT;

SELECT
  maa.actor_id,
  a.actor_type,
  a.status AS actor_status,
  maa.status AS master_account_status,
  maa.designated_at,
  maa.designated_by_actor_id
FROM public.master_account_authority AS maa
JOIN public.actors AS a
  ON a.id = maa.actor_id
WHERE maa.actor_id = :'master_actor_id'
  AND maa.status = 'active';
SQL
