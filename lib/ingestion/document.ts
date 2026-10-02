/**
 * TES Ingestion Spine — Document: one logical document within a SourceFile.
 *
 * Today's intake code only ever produces one Document per SourceFile (no
 * segmentation exists yet), but this stays a distinct type/id rather than
 * being folded into SourceFile, so segmentation (one SourceFile splitting
 * into several Documents) never requires a later identity-scheme rewrite.
 * References its parent SourceFile by id; does not embed it.
 */

import type { DocumentId, SourceFileId } from "./ids.ts";

export interface Document {
  documentId: DocumentId;
  sourceFileId: SourceFileId;
  /** Not yet a canonical/normalized type repository-wide - see ids.ts's header note. */
  companyId: string;
  /** Which pages of the parent SourceFile this Document covers, once segmentation exists. Page numbers only - never page content. */
  pageNumbers?: number[];
  createdAt: string;
}
