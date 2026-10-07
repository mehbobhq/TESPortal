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

DO $bootstrap$
DECLARE
  v_actor_id uuid;
  v_existing_actor_id uuid;
  v_actor_count bigint;
BEGIN
  SELECT ai.actor_id
    INTO v_existing_actor_id
  FROM public.authentication_identities AS ai
  WHERE ai.provider = 'clerk'
    AND ai.provider_subject = :'clerk_user_id';

  IF v_existing_actor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Clerk identity is already linked; bootstrap refused.';
  END IF;

  SELECT count(*)
    INTO v_actor_count
  FROM public.actors;

  IF v_actor_count <> 0 THEN
    RAISE EXCEPTION 'TES actors already exist; first-actor bootstrap refused.';
  END IF;

  INSERT INTO public.actors (actor_type)
  VALUES ('HUMAN')
  RETURNING id INTO v_actor_id;

  INSERT INTO public.authentication_identities (
    actor_id,
    provider,
    provider_subject
  )
  VALUES (
    v_actor_id,
    'clerk',
    :'clerk_user_id'
  );
END
$bootstrap$;

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
