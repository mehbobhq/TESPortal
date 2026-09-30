import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * Phase 2 regression guard: proves scanFile() actually invokes the
 * persistent-daemon client (clamdscan) with the correct explicit clamd.conf,
 * and that no standalone-clamscan invocation remains anywhere in this
 * module. Reads the TypeScript SOURCE directly (the same static-inspection
 * approach test/clamdConfiguration.test.ts already uses for Dockerfile/
 * entrypoint.sh) rather than mocking node:child_process, consistent with
 * this test suite's existing style of testing real, verifiable artifacts
 * without requiring a real ClamAV/daemon installation.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serviceRoot = join(here, "..", "..");

function readSource(relativePath: string): string {
  return readFileSync(join(serviceRoot, relativePath), "utf8");
}

test("scanFile() invokes clamdscan via an explicit absolute-path constant, not a bare command name or standalone clamscan", () => {
  const source = readSource("src/clamav.ts");
  assert.match(source, /CLAMDSCAN_BIN\s*=\s*"\/usr\/local\/bin\/clamdscan"/);
  assert.match(source, /execFile\(\s*\n?\s*CLAMDSCAN_BIN/);
  // Never a bare "clamdscan" string passed directly to execFile (PATH-based
  // resolution) - only the absolute-path constant above.
  assert.doesNotMatch(source, /execFile\(\s*\n?\s*"clamdscan"/);
  // Exact-token check (not a substring check): "clamscan" is NOT a substring
  // of "clamdscan" ("clamdscan" has a "d" clamscan doesn't), so this
  // correctly fails if a standalone-clamscan invocation is ever
  // reintroduced, without false-triggering on the (intentional) "clamdscan"
  // references throughout this file.
  assert.doesNotMatch(source, /"clamscan"/);
});

test("scanFile() supplies the same explicit clamd.conf that clamd.conf/entrypoint.sh already use", () => {
  const source = readSource("src/clamav.ts");
  assert.match(source, /CLAMD_CONFIG_FILE\s*=\s*"\/etc\/clamav\/clamd\.conf"/);
  assert.match(source, /--config-file=\$\{CLAMD_CONFIG_FILE\}/);
});

test("scannerReadiness() validates the same daemon-backed scan path as production scans (calls scanFile(), no separate/duplicated engine invocation)", () => {
  const source = readSource("src/clamav.ts");
  const readinessBody = source.slice(source.indexOf("export async function scannerReadiness"));
  assert.match(readinessBody, /await scanFile\(/);
  assert.doesNotMatch(readinessBody, /"clamscan"/);
  assert.doesNotMatch(readinessBody, /execFile\(/);
});
