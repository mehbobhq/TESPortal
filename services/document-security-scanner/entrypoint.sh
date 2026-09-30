#!/bin/sh
# Container entrypoint - Phase 2 persistent clamd + coordinated lifecycle
# supervision.
#
# PID/process model: this script remains PID 1 for the life of the
# container - it never `exec`s away to Node. It starts `clamd`, gates Node's
# start on a real PING/PONG readiness check (never on process/socket
# existence alone), and starts Node once that gate passes. After startup,
# Node and clamd form ONE required service unit: this script polls BOTH
# every second and reacts to whichever exits first.
#
# Runtime lifecycle testing of an earlier version of this script found a
# real supervision defect: after startup it only ever `wait`ed on Node, so
# killing clamd directly (`pkill -TERM clamd`) left Node running and the
# container reporting "Up" indefinitely, even though the security engine and
# its Unix socket were gone - a silent, half-alive failure. That defect is
# fixed here: an unexpected exit of EITHER required process now stops the
# other, stops the log tail, reaps children, and exits this script
# non-zero, so the container itself is reported as failed rather than
# continuing to run degraded.
#
# Supervision mechanism: POSIX `wait` can only block on one specific PID (or
# on all children at once) - it cannot report "whichever of these two exits
# first" the way bash's `wait -n` can, and this script's shebang is
# `#!/bin/sh` (dash on this image), which does not support `wait -n` at all.
# A short (1-second) polling loop checking `kill -0` on both required PIDs
# is the smallest robust, fully POSIX-portable way to detect whichever
# required process exits first - no bash-only features, no new supervisor
# binary such as tini.
#
# On an external SIGTERM/SIGINT (Cloud Run's own shutdown signal), a single
# shared `cleanup()` function performs a coordinated, intentional shutdown -
# Node first (it is the one accepting external/Eventarc traffic), then
# clamd, then the log tail - and this script exits 0, since that is a normal
# platform-initiated stop, not a failure. The same `cleanup()` function is
# reused for the two unexpected-exit cases above; it is guarded so its body
# only ever runs once, even if invoked more than once (e.g. a second signal
# arriving mid-shutdown), which avoids recursive trap execution or
# double-cleanup races. Each already-dead process is simply skipped (its
# `kill -0` check is false), so the same fixed Node-then-clamd-then-tail
# order still matches whichever process(es) actually remain alive in each of
# the three scenarios.
#
# Phase 2 scope: the application's scanFile() (src/clamav.ts) now uses
# clamdscan against this persistent daemon (see this service's Phase 2
# report) - this script only manages the daemon's process lifecycle, not
# how the application invokes it.
set -u

SOCKET_DIR=/tmp/tes-clamd
CLAMD_CONFIG=/etc/clamav/clamd.conf
# Must match clamd.conf's LogFile (clamd cannot log to /dev/stdout directly
# in this runtime - see clamd.conf). `tail -F` below is the ONLY path this
# content takes to reach the container's own stdout; clamd's own stdio is
# discarded to avoid logging each line twice.
CLAMD_LOG_FILE=/var/log/clamav/clamd.log

# Bounded startup budget for clamd to become genuinely usable (PING/PONG).
# Standalone clamscan's proven production database-load time was ~23-30s
# (see the Phase 1 scalability architecture review) - clamd's own one-time
# startup load is the same underlying work (loading main/daily/bytecode
# CVDs), so 60s gives roughly 2x that as margin. Real runtime validation of
# this exact image measured clamd actually becoming ready in ~16s, well
# within this budget.
CLAMD_STARTUP_TIMEOUT_SECONDS=60

CLAMD_PID=""
NODE_PID=""
TAIL_PID=""
CLEANED_UP=0

# Stops whichever of the three tracked processes are still running, in the
# fixed order Node -> clamd -> tail, waiting for each to actually exit
# before moving on to the next. Guarded by CLEANED_UP so its body only ever
# executes once, regardless of how many times or from where it is called.
cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill -TERM "$NODE_PID" 2>/dev/null
    wait "$NODE_PID" 2>/dev/null
  fi
  if [ -n "$CLAMD_PID" ] && kill -0 "$CLAMD_PID" 2>/dev/null; then
    kill -TERM "$CLAMD_PID" 2>/dev/null
    wait "$CLAMD_PID" 2>/dev/null
  fi
  if [ -n "$TAIL_PID" ] && kill -0 "$TAIL_PID" 2>/dev/null; then
    kill -TERM "$TAIL_PID" 2>/dev/null
    wait "$TAIL_PID" 2>/dev/null
  fi
}

# External SIGTERM/SIGINT: coordinated, intentional shutdown. Exits 0 - this
# is a normal, platform-initiated stop, not a failure.
on_terminate() {
  echo "[entrypoint] received termination signal, shutting down"
  cleanup
  exit 0
}
trap on_terminate TERM INT

mkdir -p "$SOCKET_DIR"

# Verify the readiness client exists BEFORE starting clamd at all - real
# runtime validation of an earlier build proved `clamd` can start, load all
# 3.6M+ signatures, and open its Unix socket successfully while `clamdscan`
# is nonetheless completely absent from the image ("clamdscan: not found",
# exit 127) - the readiness poll below would then wait the full 60-second
# budget every single time, correctly failing closed but only after
# uselessly burning that entire budget and reporting a generic "no PONG"
# that gives no hint the actual problem is a missing client binary, not a
# slow or broken daemon. Checking this upfront makes that exact class of
# problem impossible to hide behind the timeout again: it fails in
# milliseconds with an unambiguous message, and clamd is never even started.
if ! command -v clamdscan >/dev/null 2>&1; then
  echo "[entrypoint] clamdscan is not installed or not on PATH - cannot verify clamd readiness. Failing container startup (fail closed, not starting clamd or Node)."
  exit 1
fi

# Best-effort signature refresh - unchanged behavior/budget. A successful
# update now also triggers a real reload of the running clamd via
# freshclam.conf's NotifyClamd directive (see freshclam.conf) - clamd is not
# running yet at this specific point (it starts below), so this particular
# invocation's NotifyClamd attempt has nothing to notify yet; that is
# expected and harmless, matching the same non-fatal-warning behavior noted
# in the Dockerfile's build-time freshclam step.
timeout 30s freshclam || echo "[entrypoint] freshclam did not refresh signatures within 30s (see freshclam output above, if any); continuing with the database already present in this image."

# Start the log tail before clamd so it is already attached when clamd's
# first line is written (`-F` retries opening by name, so a not-yet-existing
# file is fine). Purely diagnostic - never gates startup.
touch "$CLAMD_LOG_FILE" 2>/dev/null
tail -F "$CLAMD_LOG_FILE" 2>/dev/null &
TAIL_PID=$!

# clamd's own stdio is discarded: it already writes everything to
# CLAMD_LOG_FILE regardless, and leaving its stdio connected here duplicated
# every line in Cloud Run logs (once directly, once via the tail above).
clamd >/dev/null 2>&1 &
CLAMD_PID=$!

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
    cleanup
    exit 1
  fi
  if [ "$elapsed" -ge "$CLAMD_STARTUP_TIMEOUT_SECONDS" ]; then
    echo "[entrypoint] clamd did not become ready (no PONG) within ${CLAMD_STARTUP_TIMEOUT_SECONDS}s - failing container startup (fail closed, not starting Node in a degraded mode)."
    cleanup
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
echo "[entrypoint] clamd is ready (PING/PONG succeeded) after ${elapsed}s."

node dist/src/server.js &
NODE_PID=$!

# Post-startup supervision: Node and clamd now form one required service
# unit. Poll both every second; an exit detected here (as opposed to via the
# on_terminate trap above, which calls cleanup()/exit 0 directly and never
# reaches this loop again) is by definition an UNEXPECTED exit of a required
# process, not an intentional shutdown - the survivor is stopped, the log
# tail is stopped, children are reaped (via cleanup()'s own `wait` calls),
# and this script exits non-zero so the container is reported as failed.
while true; do
  if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
    echo "[entrypoint] clamd exited unexpectedly - stopping Node and failing the container (fail closed)."
    cleanup
    exit 1
  fi
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    wait "$NODE_PID" 2>/dev/null
    NODE_EXIT_CODE=$?
    echo "[entrypoint] Node exited unexpectedly (exit code ${NODE_EXIT_CODE}) - stopping clamd and failing the container."
    cleanup
    if [ "$NODE_EXIT_CODE" -eq 0 ]; then
      # Node is a required long-lived process - it is never expected to
      # exit on its own during normal operation, so even a reported "0"
      # here must not be allowed to make the container look successful.
      exit 1
    fi
    exit "$NODE_EXIT_CODE"
  fi
  sleep 1
done
