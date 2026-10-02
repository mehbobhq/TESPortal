/**
 * TES Ingestion Spine — ProcessingRun: one attempt to process one Document
 * (OCR/extraction). A Document can have multiple ProcessingRuns (retries,
 * reprocessing) - this is exactly what keeps a retry an honest, separate,
 * observable attempt rather than an overwritten status field. References
 * its parent Document by id; does not embed it, and does not embed whatever
 * canonical records/evidence it may eventually produce (those remain
 * 0..N, external, reference-linked facts - see the ingestion spine
 * reconciliation preflight's cardinality lock).
 *
 * Deliberately excluded from this shape: raw OCR text, observation arrays,
 * extracted document contents, complete provider responses, or any
 * unknown/any/generic-metadata field. A ProcessingRun records that
 * processing happened and how it concluded - the actual extraction result
 * lives wherever the processor already puts it today, not duplicated here.
 */

import type { MaterialOperationCoverage } from "../master-register/coverage.ts";
import type { DocumentId, ProcessingRunId } from "./ids.ts";

/**
 * Distinct from state.ts's document-level ProcessingState: a Document can
 * be NOT_STARTED before any run exists, but a ProcessingRun row only ever
 * exists once an attempt has actually begun, so "not started" is not a
 * meaningful value for a run's own status.
 */
export type ProcessingRunStatus = "PROCESSING" | "PROCESSED" | "PROCESSING_FAILED" | "PROCESSING_PARTIAL";

/**
 * A controlled, bounded vocabulary for why a run failed - distinguishing,
 * at minimum, a technical/provider problem from the document's own content
 * being unsupported, so these are never collapsed into one opaque reason.
 */
export type ProcessingFailureClassification =
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "CONFIGURATION_ERROR"
  | "UNSUPPORTED_DOCUMENT"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export interface ProcessingRun {
  processingRunId: ProcessingRunId;
  documentId: DocumentId;
  status: ProcessingRunStatus;
  /** e.g. "google-document-ai". */
  provider: string;
  processor?: string;
  processorVersion?: string;
  /** 1 for the first attempt; increments with each retry/reprocessing of the same Document. */
  attemptNumber: number;
  /** Links a retry back to the run it is retrying - a causal fact, not a new concept. */
  previousProcessingRunId?: ProcessingRunId;
  startedAt: string;
  completedAt?: string;
  failureClassification?: ProcessingFailureClassification;
  /** Pointer to detailed logs/diagnostics elsewhere - never the raw error payload. */
  failureReference?: string;
  /** Reused directly from the Master Register foundation (see processing-run.test.ts) rather than duplicated - see this phase's report for why that reuse is architecturally safe here. */
  coverage?: MaterialOperationCoverage;
}
