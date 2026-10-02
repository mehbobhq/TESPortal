/**
 * TES Ingestion Spine — SourceFile: one originally-uploaded file's bytes,
 * referenced by (not embedding) its parent Batch and (not embedding) any
 * Document(s) later derived from it via segmentation. See document.ts for
 * the SourceFile -> Document 1-to-N relationship.
 */

import type { BatchId, SourceFileId } from "./ids.ts";
import type { SecurityAssessmentReference } from "./security-assessment-reference.ts";
import type { StorageLocation } from "./state.ts";

export interface SourceFile {
  sourceFileId: SourceFileId;
  batchId: BatchId;
  /** Not yet a canonical/normalized type repository-wide - see ids.ts's header note. */
  companyId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  /** Content hash only - never the bytes themselves. */
  sha256?: string;
  storageLocation: StorageLocation;
  /** Present once a scan has actually run - absent means UNSCANNED, not a judgment either way. */
  securityAssessment?: SecurityAssessmentReference;
  uploadedAt: string;
}
