import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Static validation of clamd.conf/freshclam.conf - runs without Docker or a
 * real ClamAV installation (unlike the daemon itself, this is genuinely
 * testable in any environment). Proves the Phase 1 configuration files are
 * present, are not unedited Debian package templates, and contain the
 * specific directives this service's architecture depends on. See
 * test/manual/verify-clamd-daemon.sh for the daemon-runtime checks (PING,
 * real scans) that DO require a real clamd/clamdscan installation and were
 * not executed in this environment.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serviceRoot = join(here, "..", "..");

function readConfig(name: string): string {
  return readFileSync(join(serviceRoot, name), "utf8");
}

test("clamd.conf runs clamd in the foreground (no self-detaching daemon)", () => {
  assert.match(readConfig("clamd.conf"), /^Foreground yes$/m);
});

test("clamd.conf configures a Unix domain socket and no TCP listener", () => {
  const config = readConfig("clamd.conf");
  assert.match(config, /^LocalSocket\s+\S+/m);
  assert.doesNotMatch(config, /^TCPSocket\b/m);
  assert.doesNotMatch(config, /^TCPAddr\b/m);
});

test("clamd.conf's socket lives under /tmp, not /run (avoids a root-owned-directory permission problem for the non-root tesscan user)", () => {
  assert.match(readConfig("clamd.conf"), /^LocalSocket\s+\/tmp\//m);
});

test("clamd.conf's DatabaseDirectory matches the directory the rest of this image already uses", () => {
  assert.match(readConfig("clamd.conf"), /^DatabaseDirectory\s+\/var\/lib\/clamav$/m);
});

test("clamd.conf is not the unedited Debian package template (no bare Example guard line)", () => {
  assert.doesNotMatch(readConfig("clamd.conf"), /^Example$/m);
});

test("clamd.conf logs to a regular writable file, never /dev/stdout (regression guard: clamd's internal logger cannot open /dev/stdout in this container runtime - \"Too many levels of symbolic links\", proven by real runtime validation)", () => {
  const config = readConfig("clamd.conf");
  assert.doesNotMatch(config, /^LogFile\s+\/dev\/stdout\s*$/m);
  assert.match(config, /^LogFile\s+\/var\/log\/clamav\/clamd\.log$/m);
});

test("entrypoint.sh tails clamd's log file to stdout at the exact same path clamd.conf writes it to (keeps clamd's own startup/error output visible in Cloud Run logs despite no longer using /dev/stdout directly)", () => {
  const entrypoint = readConfig("entrypoint.sh");
  assert.match(entrypoint, /CLAMD_LOG_FILE=\/var\/log\/clamav\/clamd\.log/);
  assert.match(entrypoint, /tail -F "\$CLAMD_LOG_FILE"/);
});

test("clamd's own stdio is discarded, so its log content reaches Cloud Run through the tail only (regression guard: production evidence proved every clamd startup/limits/support line reached Cloud Run logs TWICE before this fix - once via clamd's own direct, unredirected stdio, once via the tail of its log file)", () => {
  const entrypoint = readConfig("entrypoint.sh");
  // Anchored to the exact clamd invocation line, not an arbitrary/incidental
  // string elsewhere in the file - this is the specific architectural
  // property (clamd's stdio is redirected away) the fix depends on.
  assert.match(entrypoint, /^clamd >\/dev\/null 2>&1 &$/m);
  // Regression guard against reverting to the exact prior (buggy) form.
  assert.doesNotMatch(entrypoint, /^clamd &$/m);
});

test("the log tail is started before clamd, so tail -F is already attached when clamd's first line is written (no race window for an early line to be missed or double-counted)", () => {
  const entrypoint = readConfig("entrypoint.sh");
  const tailIndex = entrypoint.search(/^tail -F "\$CLAMD_LOG_FILE"/m);
  const clamdStartIndex = entrypoint.search(/^clamd >\/dev\/null 2>&1 &$/m);
  assert.notEqual(tailIndex, -1, "expected to find the tail invocation");
  assert.notEqual(clamdStartIndex, -1, "expected to find the redirected clamd invocation");
  assert.ok(tailIndex < clamdStartIndex, "tail -F must start before clamd itself");
});

test("Dockerfile explicitly installs the clamdscan package, not merely assumed via clamav-daemon (regression guard: real runtime validation proved clamd-daemon does NOT bring in clamdscan on this base image - \"clamdscan: not found\", exit 127)", () => {
  const dockerfile = readConfig("Dockerfile");
  const installLine = dockerfile
    .split("\n")
    .find((line) => line.includes("apt-get install") && line.includes("clamav-daemon"));
  assert.ok(installLine, "expected to find the apt-get install line for clamav-daemon");
  assert.match(installLine as string, /\bclamdscan\b/);
});

test("entrypoint.sh verifies clamdscan is available BEFORE starting clamd, failing fast rather than burning the full startup timeout on a missing client", () => {
  const entrypoint = readConfig("entrypoint.sh");
  const clamdscanCheckIndex = entrypoint.indexOf("command -v clamdscan");
  const clamdStartIndex = entrypoint.search(/^clamd >\/dev\/null 2>&1 &$/m);
  assert.notEqual(clamdscanCheckIndex, -1, "expected an explicit clamdscan availability check");
  assert.notEqual(clamdStartIndex, -1, "expected clamd to still be started in the background");
  assert.ok(clamdscanCheckIndex < clamdStartIndex, "the clamdscan availability check must run before clamd is started");
});

test("entrypoint.sh's clamdscan availability check fails closed (exits) rather than continuing to start Node", () => {
  const entrypoint = readConfig("entrypoint.sh");
  const checkBlockMatch = entrypoint.match(/if ! command -v clamdscan[\s\S]*?\nfi\n/);
  assert.ok(checkBlockMatch, "expected a complete if/fi block for the clamdscan check");
  assert.match(checkBlockMatch![0], /exit 1/);
});

test("freshclam.conf establishes a real clamd reload path via NotifyClamd", () => {
  assert.match(readConfig("freshclam.conf"), /^NotifyClamd\s+\/etc\/clamav\/clamd\.conf$/m);
});

test("freshclam.conf's DatabaseDirectory matches clamd.conf's", () => {
  assert.match(readConfig("freshclam.conf"), /^DatabaseDirectory\s+\/var\/lib\/clamav$/m);
});

test("freshclam.conf is not the unedited Debian package template (no bare Example guard line)", () => {
  assert.doesNotMatch(readConfig("freshclam.conf"), /^Example$/m);
});
