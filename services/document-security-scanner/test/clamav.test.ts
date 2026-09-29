import assert from "node:assert/strict";
import { test } from "node:test";

import { mapExitCodeToResult } from "../src/clamav.js";

test("exit code 0 maps to CLEAN", () => {
  const result = mapExitCodeToResult(0, "");
  assert.equal(result.outcome, "CLEAN");
});

test("exit code 1 maps to THREAT_DETECTED and extracts the threat name", () => {
  const result = mapExitCodeToResult(1, "/tmp/tes-scan-abc/file.bin: Eicar-Test-Signature FOUND\n");
  assert.equal(result.outcome, "THREAT_DETECTED");
  assert.equal(result.threatName, "Eicar-Test-Signature");
});

test("exit code 1 with unparsable stdout still reports THREAT_DETECTED without a threat name", () => {
  const result = mapExitCodeToResult(1, "unexpected output shape");
  assert.equal(result.outcome, "THREAT_DETECTED");
  assert.equal(result.threatName, undefined);
});

test("exit code 2 (ClamAV error) maps to SCAN_ERROR, never CLEAN", () => {
  const result = mapExitCodeToResult(2, "");
  assert.equal(result.outcome, "SCAN_ERROR");
});

test("an undefined exit code (spawn failure or timeout kill) maps to SCAN_ERROR, never CLEAN", () => {
  const result = mapExitCodeToResult(undefined, "");
  assert.equal(result.outcome, "SCAN_ERROR");
});

test("an unexpected exit code maps to SCAN_ERROR, never CLEAN", () => {
  const result = mapExitCodeToResult(127, "");
  assert.equal(result.outcome, "SCAN_ERROR");
});
