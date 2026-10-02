/**
 * TES Ingestion Spine — independent state dimensions.
 *
 * These five dimensions are kept as five separate types, never collapsed
 * into one "status" field, because they genuinely vary independently: a
 * SourceFile can be CLEAN but PROCESSING_FAILED; EVIDENCE_STORED but still
 * REVIEW_REQUIRED. See the ingestion spine reconciliation preflight for the
 * full rationale.
 */

/** Which GCS bucket currently holds the authoritative bytes - a location, not a judgment. */
export type StorageLocation = "QUARANTINE" | "INTAKE" | "EVIDENCE";

/** What the security scanner concluded, if anything. Mirrors (does not import - see security-assessment-reference.ts) the scanner service's own SecurityDecision vocabulary. */
export type SecurityState = "UNSCANNED" | "CLEAN" | "UNSAFE" | "SCAN_FAILED" | "SCAN_UNAVAILABLE";

/** Whether OCR/extraction has run on a document and how it concluded. */
export type ProcessingState = "NOT_STARTED" | "PROCESSING" | "PROCESSED" | "PROCESSING_FAILED" | "PROCESSING_PARTIAL";

/** Whether a durable, retained artifact backs a canonical record. */
export type EvidenceState = "NOT_EVIDENCED" | "EVIDENCE_STORED";

/** Whether a human decision is pending, independent of why (security or processing can each independently require one). */
export type ReviewState = "NO_REVIEW_NEEDED" | "REVIEW_REQUIRED" | "REVIEWED";

/**
 * Valid forward transitions for ProcessingState. A document cannot go
 * backward from a terminal PROCESSED state, and re-processing after a
 * failure/partial result must pass back through PROCESSING rather than
 * jumping directly to another terminal state - this is what makes a retry a
 * real, observable attempt rather than a silent status overwrite.
 */
const VALID_PROCESSING_TRANSITIONS: Record<ProcessingState, readonly ProcessingState[]> = {
  NOT_STARTED: ["PROCESSING"],
  PROCESSING: ["PROCESSED", "PROCESSING_FAILED", "PROCESSING_PARTIAL"],
  PROCESSED: [],
  PROCESSING_FAILED: ["PROCESSING"],
  PROCESSING_PARTIAL: ["PROCESSING"],
};

export function isValidProcessingStateTransition(from: ProcessingState, to: ProcessingState): boolean {
  return VALID_PROCESSING_TRANSITIONS[from].includes(to);
}

/**
 * Valid forward transitions for StorageLocation. Promotion is monotonic -
 * QUARANTINE -> INTAKE -> EVIDENCE - matching the scanner's own "never
 * deletes the quarantine source" design (an object's location only ever
 * advances; nothing in this spine models moving an object backward).
 */
const VALID_STORAGE_LOCATION_TRANSITIONS: Record<StorageLocation, readonly StorageLocation[]> = {
  QUARANTINE: ["INTAKE"],
  INTAKE: ["EVIDENCE"],
  EVIDENCE: [],
};

export function isValidStorageLocationTransition(from: StorageLocation, to: StorageLocation): boolean {
  return VALID_STORAGE_LOCATION_TRANSITIONS[from].includes(to);
}
