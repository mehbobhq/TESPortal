#!/bin/sh
# Manual/CI verification script for the Phase 1 clamd foundation.
#
# NOT run by `npm test`, and NOT executed during the Phase 1 implementation
# session that authored it (no Docker/ClamAV installation was available in
# that environment - see the Phase 1 report's "Actual container-runtime
# tests performed" section). Run this INSIDE a container built from this
# service's Dockerfile (or any host with clamd/clamdscan/freshclam installed
# matching this service's clamd.conf) to verify, for real, the items the
# static config test (test/clamdConfiguration.test.ts) cannot:
#   B. clamd starts successfully as the intended non-root runtime user
#   C. database loads successfully
#   D. Unix socket becomes available
#   E. PING/PONG (or equivalent) succeeds
#   F. a harmless test file scans clean through clamd/clamdscan
#   G. EICAR test content (generated here, never committed to the repo) is
#      detected
# It also reports several of the measurements the Phase 1 report's
# "Measurements still required in Cloud Run" section calls for.
#
# Usage (from inside the built image, or an equivalent host):
#   sh test/manual/verify-clamd-daemon.sh
set -u

SOCKET_DIR=/tmp/tes-clamd-verify
CLAMD_CONFIG=/etc/clamav/clamd.conf
STARTUP_TIMEOUT_SECONDS=60

mkdir -p "$SOCKET_DIR"

echo "== [B] Starting clamd =="
STARTED_AT=$(date +%s)
clamd &
CLAMD_PID=$!
trap 'kill -TERM "$CLAMD_PID" 2>/dev/null' EXIT

echo "== [D, E] Waiting for the Unix socket + PING/PONG (up to ${STARTUP_TIMEOUT_SECONDS}s) =="
elapsed=0
until clamdscan --config-file="$CLAMD_CONFIG" --ping 1 >/dev/null 2>&1; do
  if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
    echo "FAIL: clamd exited during startup"
    exit 1
  fi
  if [ "$elapsed" -ge "$STARTUP_TIMEOUT_SECONDS" ]; then
    echo "FAIL: clamd did not answer PING within ${STARTUP_TIMEOUT_SECONDS}s"
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
READY_AT=$(date +%s)
echo "PASS: clamd ready after $((READY_AT - STARTED_AT))s (MEASUREMENT: clamd startup/database-load time)"

echo "== [B] Confirming clamd's runtime user =="
ps -o user= -p "$CLAMD_PID"

echo "== [C] Confirming a loaded, non-empty signature database =="
ls -la /var/lib/clamav

echo "== Memory footprint once loaded (MEASUREMENT: idle memory after database loaded) =="
ps -o rss=,vsz= -p "$CLAMD_PID"

echo "== [F] Scanning a harmless, dynamically generated file =="
HARMLESS_FILE=$(mktemp)
echo "TES clamd verification - not a real document." > "$HARMLESS_FILE"
START_NS=$(date +%s%N)
clamdscan --config-file="$CLAMD_CONFIG" "$HARMLESS_FILE"
HARMLESS_EXIT=$?
END_NS=$(date +%s%N)
rm -f "$HARMLESS_FILE"
echo "harmless scan exit=$HARMLESS_EXIT latency_ms=$(( (END_NS - START_NS) / 1000000 )) (MEASUREMENT: warm scan latency)"
if [ "$HARMLESS_EXIT" -ne 0 ]; then
  echo "FAIL: harmless file was not reported clean (exit=$HARMLESS_EXIT)"
  exit 1
fi

echo "== Second consecutive warm scan (harmless) =="
HARMLESS_FILE2=$(mktemp)
echo "TES clamd verification - second scan." > "$HARMLESS_FILE2"
START_NS=$(date +%s%N)
clamdscan --config-file="$CLAMD_CONFIG" "$HARMLESS_FILE2"
END_NS=$(date +%s%N)
rm -f "$HARMLESS_FILE2"
echo "second warm scan latency_ms=$(( (END_NS - START_NS) / 1000000 )) (MEASUREMENT: second consecutive warm scan latency)"

echo "== [G] Scanning dynamically generated EICAR test content (never committed to this repository) =="
EICAR_FILE=$(mktemp)
printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > "$EICAR_FILE"
START_NS=$(date +%s%N)
clamdscan --config-file="$CLAMD_CONFIG" "$EICAR_FILE"
EICAR_EXIT=$?
END_NS=$(date +%s%N)
rm -f "$EICAR_FILE"
echo "eicar scan exit=$EICAR_EXIT latency_ms=$(( (END_NS - START_NS) / 1000000 )) (MEASUREMENT: EICAR detection latency)"
if [ "$EICAR_EXIT" -ne 1 ]; then
  echo "FAIL: EICAR test content was not detected (exit=$EICAR_EXIT, expected 1)"
  exit 1
fi

echo "ALL CHECKS PASSED"
