#!/bin/sh
# Container entrypoint - Phase 1 signature-update strategy.
#
# The image is built with a signature database already present (freshclam
# ran once during `docker build`, and that build step now fails outright if
# it cannot seed a real database - see Dockerfile). At container startup,
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
#
# freshclam's own stdout/stderr (mirror hostnames, CVD version/build numbers,
# HTTP/network error text) is intentionally let through to the container's
# own stdout/stderr here, unlike earlier versions of this script that
# discarded it behind a fixed message - this made a real production
# signature-initialization failure invisible in Cloud Run logs and required
# static code inspection to diagnose. freshclam never has access to, and
# therefore can never emit, document contents, GCS object paths/credentials,
# access tokens, or any other TES runtime data - none of that is passed to
# or touched by this command.
set -e

timeout 30s freshclam || echo "[entrypoint] freshclam did not refresh signatures within 30s (see freshclam output above, if any); continuing with the database already present in this image."

exec node dist/src/server.js
