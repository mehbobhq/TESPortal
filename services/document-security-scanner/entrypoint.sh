#!/bin/sh
# Container entrypoint - Phase 1 signature-update strategy.
#
# The image is built with a signature database already present (freshclam
# ran once during `docker build`, see Dockerfile). At container startup,
# this script makes ONE best-effort attempt to refresh that database before
# the Node process starts accepting traffic, with a bounded timeout so a
# slow/unreachable ClamAV mirror network never blocks Cloud Run's own
# startup-probe deadline indefinitely.
#
# This is a documented, intentional Phase 1 simplification, not a final
# production signature-distribution design - see README.md "Signature
# update strategy" for exactly what is missing (freshness guarantees across
# long-lived instances, a shared/cached mirror, and what to do if freshclam
# fails here beyond falling back to the build-time database).
set -e

timeout 30s freshclam --quiet || echo "[entrypoint] freshclam did not complete within 30s; continuing with the database baked into this image."

exec node dist/src/server.js
