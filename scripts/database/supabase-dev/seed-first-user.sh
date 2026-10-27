#!/usr/bin/env bash
# One-off, idempotent seeding of the FIRST user in the Supabase DEVELOPMENT database: one active HUMAN actor, its Clerk identity
# link, and the Master Account authority, using the repository's own fail-closed bootstrap scripts. Creates no organization,
# customer or other business data. Runs as the migrator (the identity that owns the schema), manual dispatch only.
#   TES_BOOTSTRAP_CLERK_USER_ID   the Clerk user id (user_...), an identifier, not a secret
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=guard-target.sh
. "$here/guard-target.sh"
tes_dev_guard "" || exit 2
unset PGOPTIONS
export PGCONNECT_TIMEOUT=20 PGUSER="${TES_MIGRATOR_USER:?}" PGPASSWORD="${TES_MIGRATOR_PASSWORD:?}"
cid="${TES_BOOTSTRAP_CLERK_USER_ID:?TES_BOOTSTRAP_CLERK_USER_ID is required}"
[[ "$cid" =~ ^user_[A-Za-z0-9]+$ ]] || { echo "Invalid Clerk user ID format." >&2; exit 1; }
q() { psql -X -At -q --no-password -v ON_ERROR_STOP=1 -v cid="$cid" -c "$1"; }

actors="$(q "SELECT count(*) FROM public.actors")"
linked="$(psql -X -At -q --no-password -v ON_ERROR_STOP=1 -v cid="$cid" <<<"SELECT count(*) FROM public.authentication_identities WHERE provider='clerk' AND provider_subject = :'cid'")"
if [ "$actors" = 0 ]; then
  echo "== creating the first actor and Clerk identity link"
  TES_BOOTSTRAP_CLERK_USER_ID="$cid" bash "$here/../bootstrap-first-actor.sh" >/dev/null
elif [ "$linked" = 1 ]; then
  echo "== actor and Clerk identity link already present; skipping"
else
  echo "REFUSED: actors already exist and none is linked to this Clerk user; this script only seeds an empty database." >&2; exit 3
fi

actor_id="$(psql -X -At -q --no-password -v ON_ERROR_STOP=1 -v cid="$cid" <<<"SELECT actor_id FROM public.authentication_identities WHERE provider='clerk' AND provider_subject = :'cid' AND status='active'")"
[[ "$actor_id" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "REFUSED: the Clerk identity is not linked to exactly one active actor." >&2; exit 3; }
if [ "$(q "SELECT count(*) FROM public.master_account_authority WHERE status='active'")" = 0 ]; then
  echo "== designating the Master Account authority"
  TES_MASTER_ACTOR_ID="$actor_id" bash "$here/../bootstrap-first-master-account.sh" >/dev/null
else
  echo "== an active Master Account already exists; skipping"
fi
echo "== resulting counts"
bash "$here/data-check.sh"
