import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
import { asDocumentId, asProcessingRunId } from "../../../lib/ingestion/ids.ts";
import type { ProcessingRun } from "../../../lib/ingestion/processing-run.ts";
// @ts-expect-error TS5097: same as above.
import { validateCoverage } from "../../../lib/master-register/coverage.ts";

test("ProcessingRun.coverage is a real, reused MaterialOperationCoverage - Master Register's own validator accepts a well-formed one", () => {
  const run: ProcessingRun = {
    processingRunId: asProcessingRunId("run-1"),
    documentId: asDocumentId("doc-1"),
    status: "PROCESSING_PARTIAL",
    provider: "google-document-ai",
    attemptNumber: 1,
    startedAt: new Date().toISOString(),
    coverage: { expectedCount: 10, attemptedCount: 8, succeededCount: 6, failedCount: 1, unresolvedCount: 1 },
  };

  assert.doesNotThrow(() => validateCoverage(run.coverage!));
});

test("a retry run links back to the run it retries via previousProcessingRunId", () => {
  const firstAttempt: ProcessingRun = {
    processingRunId: asProcessingRunId("run-1"),
    documentId: asDocumentId("doc-1"),
    status: "PROCESSING_FAILED",
    provider: "google-document-ai",
    attemptNumber: 1,
    startedAt: new Date().toISOString(),
    failureClassification: "TIMEOUT",
  };
  const retry: ProcessingRun = {
    processingRunId: asProcessingRunId("run-2"),
    documentId: asDocumentId("doc-1"),
    status: "PROCESSED",
    provider: "google-document-ai",
    attemptNumber: 2,
    previousProcessingRunId: firstAttempt.processingRunId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  assert.equal(retry.previousProcessingRunId, firstAttempt.processingRunId);
  assert.equal(retry.documentId, firstAttempt.documentId);
});
