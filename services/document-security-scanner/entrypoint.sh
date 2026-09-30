#!/bin/sh
# Container entrypoint - Phase 1 persistent clamd foundation.
#
# PID/process model: this script itself remains PID 1 for the life of the
# container - it never `exec`s away to Node (an earlier version of this
# script did `exec node ...`, which is no longer correct now that a second
# long-lived process, clamd, needs its own lifecycle managed from here). It
# starts `clamd` as a background child, gates Node's start on a real
# PING/PONG readiness check (never on process/socket existence alone),
# starts Node as a second background child once that gate passes, and then
# blocks on Node's own exit. Two `trap` handlers (redefined once clamd is
# running, then again once Node is also running) forward Cloud Run's
# SIGTERM/SIGINT to whichever children are still alive and wait for each to
# exit before this script itself exits.
#
# This is the smallest reliable mechanism for two cooperating processes in
# one container - no separate init/supervisor binary (e.g. tini) is
# introduced, since plain POSIX `trap`/`wait`/`kill -0` already give
# predictable shutdown here without adding image surface.
#
# Phase 1 scope: this establishes the daemon foundation and its lifecycle
# only. The application's scanFile() (src/clamav.ts) still uses standalone
# `clamscan` in this phase, not this daemon - see this service's Phase 1
# report for why, and what Phase 2 changes.
set -u

SOCKET_DIR=/tmp/tes-clamd
CLAMD_CONFIG=/etc/clamav/clamd.conf
# Must match clamd.conf's LogFile. clamd's internal logger cannot open
# /dev/stdout directly in this container runtime (proven by a real runtime
# validation - see clamd.conf's own note), so clamd logs to this regular
# file instead; `tail -F` below re-surfaces it into this container's own
# stdout/stderr so Cloud Run's log capture still sees clamd's own startup/
# reload/error messages, exactly as it already does for freshclam's output.
CLAMD_LOG_FILE=/var/log/clamav/clamd.log

# Bounded startup budget for clamd to become genuinely usable (PING/PONG).
# Standalone clamscan's proven production database-load time was ~23-30s
# (see the Phase 1 scalability architecture review) - clamd's own one-time
# startup load is the same underlying work (loading main/daily/bytecode
# CVDs), so 60s gives roughly 2x that as margin. This exact value has NOT
# been measured against a real clamd startup in this environment (no Docker
# available in this session) and should be revisited once real container/
# Cloud Run measurement exists.
CLAMD_STARTUP_TIMEOUT_SECONDS=60

mkdir -p "$SOCKET_DIR"

# Best-effort signature refresh - unchanged behavior/budget from before this
# phase. A successful update now also triggers a real reload of the running
# clamd via freshclam.conf's NotifyClamd directive (see freshclam.conf) -
# clamd is not running yet at this specific point (it starts below), so this
# particular invocation's NotifyClamd attempt has nothing to notify yet;
# that is expected and harmless, matching the same non-fatal-warning
# behavior noted in the Dockerfile's build-time freshclam step.
timeout 30s freshclam || echo "[entrypoint] freshclam did not refresh signatures within 30s (see freshclam output above, if any); continuing with the database already present in this image."

clamd &
CLAMD_PID=$!

# Re-surface clamd's log file to this container's own stdout as it's
# written. `-F` (not `-f`) retries opening by name, so this works even
# though the file doesn't exist until clamd itself creates it moments after
# starting. Purely diagnostic - never gates startup, and its own failure
# (e.g. if the log file is somehow never created) does not fail the
# container: clamd startup is still proven solely by the real PING/PONG
# check below, not by anything this tail process does or doesn't see.
touch "$CLAMD_LOG_FILE" 2>/dev/null
tail -F "$CLAMD_LOG_FILE" 2>/dev/null &
TAIL_PID=$!

# Stage 1 trap: only clamd (and the log tail) are running yet (Node has not
# started). Forwards termination to clamd and waits for it before this
# script exits.
trap 'echo "[entrypoint] received termination signal during clamd startup"; kill -TERM "$CLAMD_PID" 2>/dev/null; wait "$CLAMD_PID" 2>/dev/null; kill -TERM "$TAIL_PID" 2>/dev/null; exit 0' TERM INT

# Startup gate: Node must NOT start merely because the clamd PROCESS exists
# or the socket FILE exists - only a real PING/PONG proves clamd has
# actually finished loading its database and is accepting connections
# (clamd does not open its listening socket until database load completes).
# If clamd cannot become ready within the budget, or exits on its own during
# startup, THIS CONTAINER'S STARTUP FAILS OUTRIGHT (fail closed) - Node is
# never started in a degraded/unproven mode.
elapsed=0
until clamdscan --config-file="$CLAMD_CONFIG" --ping 1 >/dev/null 2>&1; do
  if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
    echo "[entrypoint] clamd exited unexpectedly during startup - failing container startup."
    kill -TERM "$TAIL_PID" 2>/dev/null
    exit 1
  fi
  if [ "$elapsed" -ge "$CLAMD_STARTUP_TIMEOUT_SECONDS" ]; then
    echo "[entrypoint] clamd did not become ready (no PONG) within ${CLAMD_STARTUP_TIMEOUT_SECONDS}s - failing container startup (fail closed, not starting Node in a degraded mode)."
    kill -TERM "$CLAMD_PID" 2>/dev/null
    kill -TERM "$TAIL_PID" 2>/dev/null
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
echo "[entrypoint] clamd is ready (PING/PONG succeeded) after ${elapsed}s."

node dist/src/server.js &
NODE_PID=$!

# Stage 2 trap: all three processes are running now. On termination, stop
# Node first (it is the one accepting external/Eventarc traffic), then
# clamd, then the log tail.
trap 'echo "[entrypoint] received termination signal, shutting down"; kill -TERM "$NODE_PID" 2>/dev/null; wait "$NODE_PID" 2>/dev/null; kill -TERM "$CLAMD_PID" 2>/dev/null; wait "$CLAMD_PID" 2>/dev/null; kill -TERM "$TAIL_PID" 2>/dev/null; exit 0' TERM INT

wait "$NODE_PID"
NODE_EXIT_CODE=$?
kill -TERM "$CLAMD_PID" 2>/dev/null
wait "$CLAMD_PID" 2>/dev/null
kill -TERM "$TAIL_PID" 2>/dev/null
exit "$NODE_EXIT_CODE"
