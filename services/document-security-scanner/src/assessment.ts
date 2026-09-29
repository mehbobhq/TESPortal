import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clamScanTimeoutMs, maxObjectBytes } from "./config.js";
import { scanFile, scannerReadiness } from "./clamav.js";
import { decideSecurityOutcome } from "./decision.js";
import { claimedTypeMatchesDetectedFamily, detectFileFamily } from "./fileSignature.js";
import { computeSha256, resolvePromotionIntegrity } from "./integrity.js";
import { logger } from "./logger.js";
import { deriveIntakeObjectName, parseQuarantineObjectName } from "./pathValidation.js";
import {
  downloadIntakeObject,
  downloadQuarantineObject,
  getQuarantineObjectMetadata,
  promoteQuarantineObjectToIntake,
} from "./storage.js";
import type { ReasonCode, SecurityAssessment } from "./types.js";

const SCANNER_NAME = "clamav";

/** Input as extracted from a validated Eventarc/CloudEvent GCS-finalize payload. See server.ts for extraction. */
export interface ScanRequest {
  bucket: string;
  objectName: string;
  generation?: string;
  contentType?: string;
  size?: number;
}

function buildAssessment(partial: Partial<SecurityAssessment> & Pick<SecurityAssessment, "sourceObjectName" | "securityDecision" | "reasonCodes">): SecurityAssessment {
  return {
    securityAssessmentId: randomUUID(),
    scanner: SCANNER_NAME,
    scanStartedAt: new Date().toISOString(),
    promotionStatus: "NOT_ATTEMPTED",
    ...partial,
  };
}

/**
 * Runs the full quarantine -> security decision -> (maybe) promotion flow
 * for one GCS object-finalize event. Never throws for an expected failure
 * mode - every branch returns a SecurityAssessment with an appropriate
 * SecurityDecision and reasonCodes, so callers (the HTTP handler) always
 * have a structured result to log and acknowledge with.
 *
 * This function does not persist the assessment anywhere - see this
 * service's README "Persistence gap" section. It is returned to the caller
 * for sanitized logging only.
 */
export async function assessQuarantineObject(request: ScanRequest): Promise<SecurityAssessment> {
  const identity = parseQuarantineObjectName(request.objectName);
  if (!identity) {
    return buildAssessment({
      sourceObjectName: request.objectName,
      sourceGeneration: request.generation,
      claimedMimeType: request.contentType,
      securityDecision: "REVIEW_REQUIRED",
      reasonCodes: ["INVALID_SOURCE_PATH"],
      scanCompletedAt: new Date().toISOString(),
    });
  }

  const assessment = buildAssessment({
    sourceObjectName: request.objectName,
    sourceGeneration: request.generation,
    companyId: identity.companyId,
    batchId: identity.batchId,
    sourceFileId: identity.sourceFileId,
    claimedMimeType: request.contentType,
    securityDecision: "UNABLE_TO_SCAN",
    reasonCodes: [],
  });

  // Size is checked from GCS metadata BEFORE any byte download or temp-file
  // allocation, per the "do not consume unbounded resources" requirement.
  let sourceSize: number;
  try {
    const metadata = await getQuarantineObjectMetadata(request.objectName);
    sourceSize = metadata.size;
    assessment.sourceSize = metadata.size;
    if (!assessment.claimedMimeType) assessment.claimedMimeType = metadata.contentType;
  } catch (error) {
    logger.error({ securityAssessmentId: assessment.securityAssessmentId, sourceObjectName: request.objectName, message: "failed to read quarantine object metadata" });
    return finalize(assessment, "UNABLE_TO_SCAN", ["SOURCE_DOWNLOAD_FAILED"]);
  }

  const limit = maxObjectBytes();
  if (sourceSize > limit) {
    return finalize(assessment, "UNABLE_TO_SCAN", ["FILE_TOO_LARGE"]);
  }
  // A zero-byte object is not a size-limit problem; it falls through to the
  // normal signature check below, which will correctly find no recognizable
  // file family in an empty prefix and report UNSUPPORTED_FILE_TYPE.

  let bytes: Buffer;
  try {
    bytes = await downloadQuarantineObject(request.objectName);
  } catch {
    logger.error({ securityAssessmentId: assessment.securityAssessmentId, sourceObjectName: request.objectName, message: "failed to download quarantine object" });
    return finalize(assessment, "UNABLE_TO_SCAN", ["SOURCE_DOWNLOAD_FAILED"]);
  }

  assessment.sha256 = computeSha256(bytes);

  const detectedFamily = detectFileFamily(bytes.subarray(0, 16));
  const reasonCodes: ReasonCode[] = [];
  let typeIsAcceptable = true;
  if (!detectedFamily) {
    typeIsAcceptable = false;
    reasonCodes.push("UNSUPPORTED_FILE_TYPE");
  } else {
    assessment.detectedFileType = detectedFamily;
    if (assessment.claimedMimeType && !claimedTypeMatchesDetectedFamily(assessment.claimedMimeType, detectedFamily)) {
      typeIsAcceptable = false;
      reasonCodes.push("FILE_SIGNATURE_MISMATCH");
    }
  }

  // A temp path built entirely from a freshly generated UUID - never from
  // the original filename or any request-supplied string - so there is no
  // path-traversal surface here by construction, not by sanitization.
  const tempDir = await mkdtemp(join(tmpdir(), "tes-scan-"));
  const tempFilePath = join(tempDir, `${randomUUID()}.bin`);
  try {
    await writeFile(tempFilePath, bytes);

    const scanResult = await scanFile(tempFilePath, clamScanTimeoutMs());
    assessment.scanOutcome = scanResult.outcome;
    assessment.scannerVersion = scanResult.scannerVersion;
    assessment.threatName = scanResult.threatName;

    const outcome = decideSecurityOutcome({
      typeIsAcceptable,
      typeReasonCodes: reasonCodes,
      scanOutcome: scanResult.outcome,
    });

    if (!outcome.shouldPromote) {
      return finalize(assessment, outcome.decision, outcome.reasonCodes);
    }

    // CLEARED - attempt promotion. Only reachable when ClamAV reported CLEAN
    // AND the detected file family is one of TES's allowed document types.
    const intakeObjectName = deriveIntakeObjectName(identity);
    assessment.intakeObjectName = intakeObjectName;
    const promotion = await promoteQuarantineObjectToIntake(request.objectName, intakeObjectName);

    if (promotion.status === "PROMOTED" || promotion.status === "SKIPPED_ALREADY_EXISTS") {
      // Full destination integrity re-verification, now that
      // tes-security-scanner also holds Storage Object Viewer on Intake: the
      // destination object (whether freshly copied by this invocation, or
      // already present from a prior/duplicate delivery) is re-downloaded
      // and re-hashed, and NEVER assumed identical to the source merely
      // because the copy call succeeded or the object was found to exist.
      // The destination is never overwritten or repaired here regardless of
      // the comparison result - only what gets reported differs.
      const integrityContext = promotion.status === "PROMOTED" ? "FRESH_COPY" : "EXISTING_DESTINATION";
      let destinationSha256: string;
      try {
        const destinationBytes = await downloadIntakeObject(intakeObjectName);
        destinationSha256 = computeSha256(destinationBytes);
      } catch {
        logger.error({ securityAssessmentId: assessment.securityAssessmentId, sourceObjectName: request.objectName, message: "failed to download intake object for integrity verification" });
        assessment.promotionStatus = "FAILED";
        return finalize(assessment, "REVIEW_REQUIRED", ["INTEGRITY_CHECK_FAILED"]);
      }

      const integrity = resolvePromotionIntegrity(integrityContext, assessment.sha256, destinationSha256);
      assessment.promotionStatus = integrity.promotionStatus;
      return finalize(assessment, integrity.decision, integrity.reasonCodes);
    }
    assessment.promotionStatus = "FAILED";
    logger.error({ securityAssessmentId: assessment.securityAssessmentId, sourceObjectName: request.objectName, message: "intake promotion failed" });
    return finalize(assessment, "REVIEW_REQUIRED", ["INTAKE_PROMOTION_FAILED"]);
  } finally {
    // Always clean up, regardless of outcome or error path.
    await rm(tempDir, { recursive: true, force: true });
  }
}

function finalize(assessment: SecurityAssessment, decision: SecurityAssessment["securityDecision"], reasonCodes: ReasonCode[]): SecurityAssessment {
  assessment.securityDecision = decision;
  assessment.reasonCodes = reasonCodes;
  assessment.scanCompletedAt = new Date().toISOString();
  logger.info({
    securityAssessmentId: assessment.securityAssessmentId,
    companyId: assessment.companyId,
    batchId: assessment.batchId,
    sourceFileId: assessment.sourceFileId,
    sourceObjectName: assessment.sourceObjectName,
    scanOutcome: assessment.scanOutcome,
    securityDecision: assessment.securityDecision,
    reasonCode: reasonCodes[0],
  });
  return assessment;
}

/** Non-mutating readiness check for the health endpoint - see clamav.ts's scannerReadiness for what this actually verifies. */
export async function scannerEngineReady() {
  return scannerReadiness();
}
