#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-database/migrations}"
LOCK_KEY="741938221"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Migration directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

mapfile -t migrations < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -printf '%f\n' | LC_ALL=C sort)

# Validate repository migration history before touching PostgreSQL.
declare -A seen_versions=()
expected_version=1
for filename in "${migrations[@]}"; do
  if [[ ! "$filename" =~ ^([0-9]{4})_[a-z0-9][a-z0-9_-]*\.sql$ ]]; then
    echo "Invalid migration filename: $filename" >&2
    exit 1
  fi

  version="${BASH_REMATCH[1]}"
  if [[ -n "${seen_versions[$version]:-}" ]]; then
    echo "Duplicate migration version $version: ${seen_versions[$version]} and $filename" >&2
    exit 1
  fi

  expected_padded="$(printf '%04d' "$expected_version")"
  if [[ "$version" != "$expected_padded" ]]; then
    echo "Migration sequence gap or invalid starting version: expected $expected_padded, found $version ($filename)" >&2
    exit 1
  fi

  seen_versions[$version]="$filename"
  expected_version=$((expected_version + 1))
done

sql_file="$(mktemp)"
trap 'rm -f "$sql_file"' EXIT

cat > "$sql_file" <<SQL
\\set ON_ERROR_STOP on

SELECT pg_advisory_lock(${LOCK_KEY});

CREATE SCHEMA IF NOT EXISTS tes_system;
REVOKE ALL ON SCHEMA tes_system FROM PUBLIC;

CREATE TABLE IF NOT EXISTS tes_system.schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  applied_by text NOT NULL DEFAULT current_user
);

REVOKE ALL ON tes_system.schema_migrations FROM PUBLIC;

CREATE TEMP TABLE migration_repository_manifest (
  version text PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$')
) ON COMMIT PRESERVE ROWS;
SQL

# Build the repository manifest and reject SQL constructs reserved for the runner.
for filename in "${migrations[@]}"; do
  path="$MIGRATIONS_DIR/$filename"
  version="${filename%%_*}"
  checksum="$(sha256sum "$path" | awk '{print $1}')"

  if grep -Eq '^[[:space:]]*\\\\' "$path"; then
    echo "Migration $filename contains a psql meta-command, which is not allowed." >&2
    exit 1
  fi
  if grep -Eiq '^[[:space:]]*(BEGIN|START[[:space:]]+TRANSACTION|COMMIT|ROLLBACK)([[:space:];]|$)' "$path"; then
    echo "Migration $filename contains transaction control, which is managed by the runner." >&2
    exit 1
  fi

  cat >> "$sql_file" <<SQL
INSERT INTO migration_repository_manifest (version, filename, sha256)
VALUES ('${version}', '${filename}', '${checksum}');
SQL
done

# Reconcile production history against Git in both directions before applying anything.
cat >> "$sql_file" <<'SQL'

SELECT NOT EXISTS (
  SELECT 1
  FROM tes_system.schema_migrations applied
  LEFT JOIN migration_repository_manifest repo USING (version)
  WHERE repo.version IS NULL
) AS no_applied_migrations_missing_from_repository,
NOT EXISTS (
  SELECT 1
  FROM tes_system.schema_migrations applied
  JOIN migration_repository_manifest repo USING (version)
  WHERE applied.filename <> repo.filename
) AS all_applied_filenames_match,
NOT EXISTS (
  SELECT 1
  FROM tes_system.schema_migrations applied
  JOIN migration_repository_manifest repo USING (version)
  WHERE applied.sha256 <> repo.sha256
) AS all_applied_checksums_match
\gset

\if :no_applied_migrations_missing_from_repository
\else
  \echo 'ERROR: an applied migration is missing from the repository. Migration history is immutable.'
  \quit 3
\endif

\if :all_applied_filenames_match
\else
  \echo 'ERROR: an applied migration filename differs from the repository. Migration history is immutable.'
  \quit 3
\endif

\if :all_applied_checksums_match
\else
  \echo 'ERROR: an applied migration checksum differs from the repository. Migration history is immutable.'
  \quit 3
\endif
SQL

for filename in "${migrations[@]}"; do
  path="$MIGRATIONS_DIR/$filename"
  version="${filename%%_*}"
  checksum="$(sha256sum "$path" | awk '{print $1}')"

  cat >> "$sql_file" <<SQL

\\echo 'Checking migration ${filename}'
SELECT EXISTS (
  SELECT 1 FROM tes_system.schema_migrations WHERE version = '${version}'
) AS migration_applied
\\gset

\\if :migration_applied
  \\echo 'Already applied: ${filename}'
\\else
  BEGIN;
  \\echo 'Applying: ${filename}'
SQL

  cat "$path" >> "$sql_file"

  cat >> "$sql_file" <<SQL

  INSERT INTO tes_system.schema_migrations (version, filename, sha256, applied_by)
  VALUES ('${version}', '${filename}', '${checksum}', current_user);
  COMMIT;
  \\echo 'Applied: ${filename}'
\\endif
SQL
done

cat >> "$sql_file" <<SQL

SELECT pg_advisory_unlock(${LOCK_KEY});
\\echo 'Database migrations completed successfully.'
SQL

psql --no-password --file="$sql_file"
