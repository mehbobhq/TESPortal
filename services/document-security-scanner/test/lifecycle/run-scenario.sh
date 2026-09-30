#!/bin/sh
# Controlled stub-process lifecycle test harness for entrypoint.sh.
#
# Usage: sh run-scenario.sh <clamd-dies|node-dies|sigterm|clamd-dies-during-startup> <entrypoint-path>
#
# Runs the REAL entrypoint.sh (the exact file this service ships, not a
# copy or a rewritten excerpt) against stub `clamd`/`clamdscan`/`freshclam`/
# `node` executables placed first on PATH - never a real ClamAV
# installation or real Node server. This proves actual process-supervision
# BEHAVIOR (does entrypoint.sh really stop the survivor and exit non-zero
# when a required process dies unexpectedly, or perform a coordinated
# shutdown on SIGTERM?) rather than merely asserting that its source text
# contains a particular string.
#
# The stub `clamdscan --ping` success/failure is decided purely by whether
# the stub `clamd` has touched its own readiness-marker file - this
# deliberately does not exercise ClamAV's real wire protocol (that is
# covered separately, against a real daemon, by
# test/manual/verify-clamd-daemon.sh); this harness exists only to prove
# entrypoint.sh's own supervision logic.
#
# Prints simple KEY=VALUE result lines to stdout for the calling test to
# parse and assert on.
set -u

SCENARIO="$1"
# Resolved to an absolute path up front: this harness `cd`s into its own
# temp work directory below, which would silently break a relative path
# passed by the caller.
ENTRYPOINT_PATH=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
WORKDIR=$(mktemp -d)
STUBDIR="$WORKDIR/bin"
mkdir -p "$STUBDIR"
ENTRYPOINT_LOG="$WORKDIR/entrypoint.log"

cleanup_harness() {
  # Best-effort: make sure nothing from this scenario is left running even
  # if an assertion below fails outright.
  [ -f "$WORKDIR/clamd.pid" ] && kill -TERM "$(cat "$WORKDIR/clamd.pid")" 2>/dev/null
  [ -f "$WORKDIR/node.pid" ] && kill -TERM "$(cat "$WORKDIR/node.pid")" 2>/dev/null
  [ -n "${ENTRYPOINT_PID:-}" ] && kill -TERM "$ENTRYPOINT_PID" 2>/dev/null
  rm -rf "$WORKDIR" 2>/dev/null
}
trap cleanup_harness EXIT

cat > "$STUBDIR/freshclam" <<'EOF'
#!/bin/sh
exit 0
EOF

if [ "$SCENARIO" = "clamd-dies-during-startup" ]; then
  # Simulates clamd crashing on its own before it ever becomes ready
  # (never touches clamd.ready) - proves the startup gate itself still
  # fails closed and never starts Node, not just the post-startup
  # supervision loop this defect fix primarily targets.
  cat > "$STUBDIR/clamd" <<'EOF'
#!/bin/sh
echo $$ > "$STUB_STATE_DIR/clamd.pid"
sleep 1
exit 1
EOF
else
  cat > "$STUBDIR/clamd" <<'EOF'
#!/bin/sh
echo $$ > "$STUB_STATE_DIR/clamd.pid"
touch "$STUB_STATE_DIR/clamd.ready"
trap 'exit 0' TERM
while true; do sleep 1; done
EOF
fi

cat > "$STUBDIR/clamdscan" <<'EOF'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --ping*)
      if [ -f "$STUB_STATE_DIR/clamd.ready" ]; then exit 0; else exit 1; fi
      ;;
  esac
done
exit 0
EOF

if [ "$SCENARIO" = "node-dies" ]; then
  # Simulates Node crashing on its own shortly after startup.
  cat > "$STUBDIR/node" <<'EOF'
#!/bin/sh
echo $$ > "$STUB_STATE_DIR/node.pid"
sleep 2
exit 7
EOF
else
  cat > "$STUBDIR/node" <<'EOF'
#!/bin/sh
echo $$ > "$STUB_STATE_DIR/node.pid"
trap 'exit 0' TERM
while true; do sleep 1; done
EOF
fi

chmod +x "$STUBDIR/freshclam" "$STUBDIR/clamd" "$STUBDIR/clamdscan" "$STUBDIR/node"

export STUB_STATE_DIR="$WORKDIR"
export PATH="$STUBDIR:$PATH"

cd "$WORKDIR" || exit 1
sh "$ENTRYPOINT_PATH" >"$ENTRYPOINT_LOG" 2>&1 &
ENTRYPOINT_PID=$!

if [ "$SCENARIO" = "clamd-dies-during-startup" ]; then
  # Node is never expected to start in this scenario at all - the startup
  # gate must detect clamd's death and fail before ever reaching that
  # point. Just wait (briefly - clamd exits after 1s on its own, and the
  # startup gate polls every 1s) for entrypoint.sh to exit by itself.
  i=0
  while kill -0 "$ENTRYPOINT_PID" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 10 ]; then
      echo "SETUP_FAILED=entrypoint_never_exited_during_startup"
      exit 0
    fi
    sleep 1
  done
  wait "$ENTRYPOINT_PID" 2>/dev/null
  ENTRYPOINT_EXIT_CODE=$?
  if [ -f "$WORKDIR/node.pid" ]; then NODE_EVER_STARTED=yes; else NODE_EVER_STARTED=no; fi
  echo "ENTRYPOINT_EXIT_CODE=$ENTRYPOINT_EXIT_CODE"
  echo "NODE_EVER_STARTED=$NODE_EVER_STARTED"
  exit 0
fi

# Wait for the stub Node to actually start (proves the startup/readiness
# gate passed) before triggering the scenario.
i=0
while [ ! -f "$WORKDIR/node.pid" ]; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "SETUP_FAILED=node_never_started"
    exit 0
  fi
  if ! kill -0 "$ENTRYPOINT_PID" 2>/dev/null; then
    echo "SETUP_FAILED=entrypoint_exited_before_node_started"
    exit 0
  fi
  sleep 1
done

CLAMD_PID=$(cat "$WORKDIR/clamd.pid")
NODE_PID=$(cat "$WORKDIR/node.pid")

case "$SCENARIO" in
  clamd-dies)
    kill -TERM "$CLAMD_PID" 2>/dev/null
    ;;
  node-dies)
    : # the stub node exits on its own after 2s - nothing to trigger here
    ;;
  sigterm)
    kill -TERM "$ENTRYPOINT_PID" 2>/dev/null
    ;;
  *)
    echo "SETUP_FAILED=unknown_scenario"
    exit 0
    ;;
esac

# Bounded wait for entrypoint.sh itself to exit.
i=0
while kill -0 "$ENTRYPOINT_PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 20 ]; then
    echo "SETUP_FAILED=entrypoint_never_exited"
    exit 0
  fi
  sleep 1
done
wait "$ENTRYPOINT_PID" 2>/dev/null
ENTRYPOINT_EXIT_CODE=$?

if kill -0 "$CLAMD_PID" 2>/dev/null; then CLAMD_ALIVE_AFTER=yes; else CLAMD_ALIVE_AFTER=no; fi
if kill -0 "$NODE_PID" 2>/dev/null; then NODE_ALIVE_AFTER=yes; else NODE_ALIVE_AFTER=no; fi

echo "ENTRYPOINT_EXIT_CODE=$ENTRYPOINT_EXIT_CODE"
echo "CLAMD_ALIVE_AFTER=$CLAMD_ALIVE_AFTER"
echo "NODE_ALIVE_AFTER=$NODE_ALIVE_AFTER"
