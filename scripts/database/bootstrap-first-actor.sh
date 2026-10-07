#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${TES_BOOTSTRAP_CLERK_USER_ID:?TES_BOOTSTRAP_CLERK_USER_ID is required}"

if [[ ! "$TES_BOOTSTRAP_CLERK_USER_ID" =~ ^user_[A-Za-z0-9]+$ ]]; then
  echo "Invalid Clerk user ID format." >&2
  exit 1
fi

psql \
  --no-password \
  --set=ON_ERROR_STOP=1 \
  --set=clerk_user_id="$TES_BOOTSTRAP_CLERK_USER_ID" <<'SQL'
BEGIN;

SELECT count(*) = 0 AS no_existing_clerk_identity
FROM public.authentication_identities
WHERE provider = 'clerk'
  AND provider_subject = :'clerk_user_id'
\gset

\if :no_existing_clerk_identity
\else
  \echo 'ERROR: Clerk identity is already linked; bootstrap refused.'
  \quit 3
\endif

SELECT count(*) = 0 AS no_existing_actors
FROM public.actors
\gset

\if :no_existing_actors
\else
  \echo 'ERROR: TES actors already exist; first-actor bootstrap refused.'
  \quit 3
\endif

INSERT INTO public.actors (actor_type)
VALUES ('HUMAN')
RETURNING id AS actor_id
\gset

INSERT INTO public.authentication_identities (
  actor_id,
  provider,
  provider_subject
)
VALUES (
  :'actor_id',
  'clerk',
  :'clerk_user_id'
);

COMMIT;

SELECT
  a.id AS actor_id,
  a.actor_type,
  a.status AS actor_status,
  ai.provider,
  ai.status AS identity_status,
  ai.linked_at
FROM public.actors AS a
JOIN public.authentication_identities AS ai
  ON ai.actor_id = a.id
WHERE ai.provider = 'clerk'
  AND ai.provider_subject = :'clerk_user_id';
SQL
