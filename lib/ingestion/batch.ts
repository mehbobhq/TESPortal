/**
 * TES Ingestion Spine — Batch: one upload operation, which may contain one
 * or more SourceFiles. See source-file.ts for the SourceFile side of this
 * 1-to-N relationship - a Batch holds no embedded child objects, only its
 * own identity; a SourceFile references its batchId instead.
 */

import type { BatchId } from "./ids.ts";

/** Where a batch originated. Extend as new intake surfaces are added - do not repurpose an existing value's meaning. */
export type BatchSource = "API_UPLOAD";

export interface Batch {
  batchId: BatchId;
  /** Not yet a canonical/normalized type repository-wide - see ids.ts's header note. */
  companyId: string;
  source: BatchSource;
  createdAt: string;
}
