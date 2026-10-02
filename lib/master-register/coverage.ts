/**
 * TES Master Register — material-operation coverage contract.
 *
 * Reusable for any batch/material operation (automation run, integration
 * sync, bulk validation pass, etc.) that needs to report reconstructable
 * coverage without duplicating the full subject manifest into the Master
 * Register event. `artifactReference` points callers at that manifest in
 * its own system of record instead.
 */

export interface MaterialOperationCoverage {
  expectedCount: number;
  attemptedCount: number;
  succeededCount: number;
  failedCount: number;
  unresolvedCount: number;
  /** Pointer to a detailed manifest/artifact elsewhere — never the manifest itself. */
  artifactReference?: string;
}

export class InvalidCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCoverageError";
  }
}

const COUNT_FIELDS = ["expectedCount", "attemptedCount", "succeededCount", "failedCount", "unresolvedCount"] as const;

/**
 * Rejects obviously impossible states:
 *  - any negative or non-integer count
 *  - more items attempted than were ever expected
 *  - succeeded + failed + unresolved not equal to attempted (every attempted
 *    item must resolve to exactly one terminal/pending bucket — this is
 *    what makes "partial coverage" and "zero findings on a successful run"
 *    both representable without being ambiguous with each other)
 *
 * Retries are tracked by a separate event (e.g. AUTOMATION_EXECUTION_RETRIED
 * / INTEGRATION_OPERATION_RETRIED), not by inflating attemptedCount beyond
 * the number of distinct items — this contract counts items, not attempts.
 */
export function validateCoverage(coverage: MaterialOperationCoverage): void {
  for (const field of COUNT_FIELDS) {
    const value = coverage[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new InvalidCoverageError(`MaterialOperationCoverage.${field} must be a non-negative integer, got ${String(value)}.`);
    }
  }

  if (coverage.attemptedCount > coverage.expectedCount) {
    throw new InvalidCoverageError(
      `MaterialOperationCoverage.attemptedCount (${coverage.attemptedCount}) cannot exceed expectedCount (${coverage.expectedCount}).`,
    );
  }

  const resolved = coverage.succeededCount + coverage.failedCount + coverage.unresolvedCount;
  if (resolved !== coverage.attemptedCount) {
    throw new InvalidCoverageError(
      `MaterialOperationCoverage: succeededCount + failedCount + unresolvedCount (${resolved}) must equal attemptedCount (${coverage.attemptedCount}).`,
    );
  }
}
