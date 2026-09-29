import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyExecFileFailure, mapExitCodeToResult, sanitizeClamavDiagnosticText } from "../src/clamav.js";

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

test("diagnostic classification and sanitization do not change mapExitCodeToResult's outcomes", () => {
  // Re-asserts the exact same five outcomes as above, proving that adding
  // diagnostic classification/logging alongside mapExitCodeToResult did not
  // alter its pure exit-code-to-outcome mapping in any way.
  assert.equal(mapExitCodeToResult(0, "").outcome, "CLEAN");
  assert.equal(mapExitCodeToResult(1, "x: Eicar-Test-Signature FOUND").outcome, "THREAT_DETECTED");
  assert.equal(mapExitCodeToResult(2, "").outcome, "SCAN_ERROR");
  assert.equal(mapExitCodeToResult(undefined, "").outcome, "SCAN_ERROR");
  assert.equal(mapExitCodeToResult(127, "").outcome, "SCAN_ERROR");
});

test("classifyExecFileFailure: a numeric code with no signal is EXIT_CODE", () => {
  assert.equal(classifyExecFileFailure({ code: 2 }), "EXIT_CODE");
});

test("classifyExecFileFailure: a signal (execFile's timeout kill) is TIMEOUT_OR_SIGNAL, even with a code present", () => {
  assert.equal(classifyExecFileFailure({ signal: "SIGTERM" }), "TIMEOUT_OR_SIGNAL");
  assert.equal(classifyExecFileFailure({ code: null, signal: "SIGTERM" }), "TIMEOUT_OR_SIGNAL");
  assert.equal(classifyExecFileFailure({ code: 0, signal: "SIGTERM" }), "TIMEOUT_OR_SIGNAL");
});

test("classifyExecFileFailure: a non-numeric code with no signal (e.g. ENOENT) is SPAWN_FAILURE", () => {
  assert.equal(classifyExecFileFailure({ code: "ENOENT" }), "SPAWN_FAILURE");
});

test("classifyExecFileFailure: neither code nor signal present is SPAWN_FAILURE", () => {
  assert.equal(classifyExecFileFailure({}), "SPAWN_FAILURE");
});

test("sanitizeClamavDiagnosticText redacts filesystem paths", () => {
  const result = sanitizeClamavDiagnosticText("ERROR: cli_loaddbdir(): /var/lib/clamav is empty");
  assert.ok(!result.includes("/var/lib/clamav"));
  assert.ok(result.includes("<path>"));
});

test("sanitizeClamavDiagnosticText redacts a scanned-file-style temp path", () => {
  const result = sanitizeClamavDiagnosticText("/tmp/tes-scan-readiness-abc123/readiness-check.bin: some error");
  assert.ok(!result.includes("/tmp/tes-scan-readiness-abc123"));
  assert.ok(!result.includes("readiness-check.bin"));
});

test("sanitizeClamavDiagnosticText collapses newlines/whitespace to a single line", () => {
  const result = sanitizeClamavDiagnosticText("line one\nline two\r\n  line three");
  assert.equal(result, "line one line two line three");
});

test("sanitizeClamavDiagnosticText truncates long output to a small fixed length", () => {
  const result = sanitizeClamavDiagnosticText("x".repeat(5000));
  assert.ok(result.length <= 200);
});

test("sanitizeClamavDiagnosticText never contains raw newlines even for very long input", () => {
  const result = sanitizeClamavDiagnosticText(`${"line\n".repeat(1000)}`);
  assert.ok(!result.includes("\n"));
});
