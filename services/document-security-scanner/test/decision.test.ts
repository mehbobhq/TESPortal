import assert from "node:assert/strict";
import { test } from "node:test";

import { decideSecurityOutcome } from "../src/decision.js";

test("a threat detection always wins, even for an acceptable file type", () => {
  const result = decideSecurityOutcome({ typeIsAcceptable: true, typeReasonCodes: [], scanOutcome: "THREAT_DETECTED" });
  assert.equal(result.decision, "THREAT_DETECTED");
  assert.deepEqual(result.reasonCodes, ["MALWARE_SIGNATURE_DETECTED"]);
  assert.equal(result.shouldPromote, false);
});

test("a threat detection wins even for an unacceptable file type", () => {
  const result = decideSecurityOutcome({
    typeIsAcceptable: false,
    typeReasonCodes: ["UNSUPPORTED_FILE_TYPE"],
    scanOutcome: "THREAT_DETECTED",
  });
  assert.equal(result.decision, "THREAT_DETECTED");
  assert.equal(result.shouldPromote, false);
});

test("a scan engine error is never treated as clean, regardless of file type", () => {
  const result = decideSecurityOutcome({ typeIsAcceptable: true, typeReasonCodes: [], scanOutcome: "SCAN_ERROR" });
  assert.equal(result.decision, "UNABLE_TO_SCAN");
  assert.deepEqual(result.reasonCodes, ["SCAN_ENGINE_ERROR"]);
  assert.equal(result.shouldPromote, false);
});

test("a clean scan on an unacceptable file type is REVIEW_REQUIRED, not CLEARED", () => {
  const result = decideSecurityOutcome({
    typeIsAcceptable: false,
    typeReasonCodes: ["FILE_SIGNATURE_MISMATCH"],
    scanOutcome: "CLEAN",
  });
  assert.equal(result.decision, "REVIEW_REQUIRED");
  assert.deepEqual(result.reasonCodes, ["FILE_SIGNATURE_MISMATCH"]);
  assert.equal(result.shouldPromote, false);
});

test("a clean scan on an acceptable file type is the only path to CLEARED", () => {
  const result = decideSecurityOutcome({ typeIsAcceptable: true, typeReasonCodes: [], scanOutcome: "CLEAN" });
  assert.equal(result.decision, "CLEARED");
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.shouldPromote, true);
});

test("shouldPromote is true if and only if decision is CLEARED, across every combination", () => {
  const outcomes: Array<"CLEAN" | "THREAT_DETECTED" | "SCAN_ERROR"> = ["CLEAN", "THREAT_DETECTED", "SCAN_ERROR"];
  for (const scanOutcome of outcomes) {
    for (const typeIsAcceptable of [true, false]) {
      const result = decideSecurityOutcome({ typeIsAcceptable, typeReasonCodes: ["UNSUPPORTED_FILE_TYPE"], scanOutcome });
      assert.equal(result.shouldPromote, result.decision === "CLEARED");
    }
  }
});
