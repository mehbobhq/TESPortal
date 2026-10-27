# Temporary: backend credential-equivalence diagnostic

Purpose: decide whether `SUPABASE_DEV_BACKEND_PASSWORD` in the `supabase-dev` GitHub environment equals the password that
authenticates locally, without ever sending the working password to GitHub and without printing any secret-derived value.

Method (keyed HMAC-SHA-256 comparison): `credential_equivalence.py local` asks for the working password on your terminal (no echo; not an argument,
file or environment variable), generates a fresh 256-bit one-time key, computes `HMAC-SHA256(key, label || password)`,
and stores **only the key and the MAC** as two environment secrets (`SUPABASE_DEV_CMP_KEY`, `SUPABASE_DEV_CMP_EXPECTED`) via
`gh secret set` with the value on stdin. The workflow recomputes the MAC from the GitHub password secret and compares in
constant time. The only output is `MATCH`, `MISMATCH` or `INCONCLUSIVE`; the MAC is never printed, logged, uploaded or
used as a workflow output. The one-time key makes the stored MAC useless for guessing the password without also reading
the key secret, which has the same exposure as the password secret itself.

Steps (all on your side):
1. `python3 -I scripts/database/supabase-dev/diagnostics/credential_equivalence.py local` (needs `gh` logged in with permission to write environment secrets).
2. Dispatch **Supabase Dev Credential Equivalence** on `main`, confirm `credential-equivalence`; read the single word in the log.
3. `python3 -I scripts/database/supabase-dev/diagnostics/credential_equivalence.py cleanup`.
4. Ask for this directory and the workflow to be removed from `main`.

MISMATCH: re-enter `SUPABASE_DEV_BACKEND_PASSWORD` (paste without a trailing newline or space). The database password is not reset.
MATCH: the secret is right; the cause is on the GitHub-to-Supabase path (see the report). INCONCLUSIVE: a secret is missing or malformed; rerun step 1.
