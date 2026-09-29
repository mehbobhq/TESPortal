import type { ReasonCode, ScanOutcome, SecurityDecision } from "./types.js";

export interface DecisionInput {
  /** Whether the detected file family is an allowed TES document type AND matches the claimed MIME type (when a claim was present). */
  typeIsAcceptable: boolean;
  /** Populated when typeIsAcceptable is false - UNSUPPORTED_FILE_TYPE or FILE_SIGNATURE_MISMATCH. */
  typeReasonCodes: ReasonCode[];
  scanOutcome: ScanOutcome;
}

export interface DecisionResult {
  decision: SecurityDecision;
  reasonCodes: ReasonCode[];
  /** True only when the object may be promoted to Intake. Only ever true for decision === "CLEARED". */
  shouldPromote: boolean;
}

/**
 * Pure mapping from (file-type acceptability x ClamAV outcome) to a
 * SecurityDecision. Isolated from all I/O (GCS, ClamAV process execution) so
 * it can be exhaustively unit tested.
 *
 * Precedence, matching the task's stated priorities:
 * 1. A detected threat always wins, regardless of file-type acceptability -
 *    THREAT_DETECTED.
 * 2. A scan engine failure is never treated as clean (fail closed) -
 *    UNABLE_TO_SCAN.
 * 3. A clean scan on an unacceptable file type is still not promotable -
 *    REVIEW_REQUIRED (ClamAV is one layer, not the entire decision).
 * 4. A clean scan on an acceptable file type is the only path to CLEARED.
 */
export function decideSecurityOutcome(input: DecisionInput): DecisionResult {
  if (input.scanOutcome === "THREAT_DETECTED") {
    return { decision: "THREAT_DETECTED", reasonCodes: ["MALWARE_SIGNATURE_DETECTED"], shouldPromote: false };
  }
  if (input.scanOutcome === "SCAN_ERROR") {
    return { decision: "UNABLE_TO_SCAN", reasonCodes: ["SCAN_ENGINE_ERROR"], shouldPromote: false };
  }
  // scanOutcome === "CLEAN" from here.
  if (!input.typeIsAcceptable) {
    return { decision: "REVIEW_REQUIRED", reasonCodes: input.typeReasonCodes, shouldPromote: false };
  }
  return { decision: "CLEARED", reasonCodes: [], shouldPromote: true };
}
