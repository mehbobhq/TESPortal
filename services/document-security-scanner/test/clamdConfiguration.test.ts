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

test("freshclam.conf establishes a real clamd reload path via NotifyClamd", () => {
  assert.match(readConfig("freshclam.conf"), /^NotifyClamd\s+\/etc\/clamav\/clamd\.conf$/m);
});

test("freshclam.conf's DatabaseDirectory matches clamd.conf's", () => {
  assert.match(readConfig("freshclam.conf"), /^DatabaseDirectory\s+\/var\/lib\/clamav$/m);
});

test("freshclam.conf is not the unedited Debian package template (no bare Example guard line)", () => {
  assert.doesNotMatch(readConfig("freshclam.conf"), /^Example$/m);
});
