/**
 * TES Canonical Document Intake — Phase 1 server-side foundation types.
 *
 * These describe only the intake stage: an uploaded source file has been
 * received and its original bytes stored in the GCS intake bucket. Nothing
 * here implies segmentation, classification, OCR, entity resolution, or
 * domain-record creation — those are later, unimplemented pipeline stages
 * (see DocumentProcessingStatus below for the full planned chain).
 *
 * IDs are UUID-based and assigned by the server. Filenames and company names
 * are never used as identity — see DocumentSourceFile.originalFilename,
 * which is preserved as metadata only.
 */

/** Where a document upload batch originated. Extend as new intake surfaces are added. */
export type DocumentIntakeSource = "api_upload";

/** Lifecycle status of an upload batch as a whole. */
export type DocumentBatchStatus = "RECEIVED" | "STORED" | "UNABLE_TO_PROCESS";

/**
 * Lifecycle status of a single source file within a batch.
 *
 * This is deliberately a neutral, non-judgmental vocabulary: it describes
 * whether TES was technically able to receive and store the bytes, never
 * whether the document itself is valid, expected, or correctly matched to
 * anything. Do not add statuses like REJECTED/INVALID_DOCUMENT/WRONG_DOCUMENT
 * at this stage — that is a future, separate concern (validation/ownership
 * verification), not intake.
 */
export type DocumentProcessingStatus = "RECEIVED" | "STORED" | "UNABLE_TO_PROCESS";

/**
 * One upload operation, which may contain one or more source files. Phase 1
 * only ever creates single-file batches, but the shape supports multi-file
 * batches for a later phase without changing this type.
 */
export interface DocumentUploadBatch {
  batchId: string;
  companyId: string;
  createdAt: string;
  source: DocumentIntakeSource;
  status: DocumentBatchStatus;
}

/**
 * One originally-uploaded file, stored byte-for-byte in the GCS intake
 * bucket. `documentId` is a distinct identifier from `sourceFileId` so that a
 * later pipeline stage (segmentation) can split one source file into multiple
 * logical documents without renaming or duplicating the source file record.
 * For Phase 1, exactly one DocumentSourceFile maps to exactly one conceptual
 * document, but the two ids are kept separate to avoid modeling that
 * assumption into the identity scheme itself.
 */
export interface DocumentSourceFile {
  sourceFileId: string;
  documentId: string;
  batchId: string;
  companyId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  intakeObjectName: string;
  uploadedAt: string;
  processingStatus: DocumentProcessingStatus;
}

/** The result returned by the intake API for a single accepted upload. */
export interface DocumentIntakeResult {
  batch: DocumentUploadBatch;
  sourceFile: DocumentSourceFile;
}

/**
 * Event names a future server-side Master Register could record against a
 * DocumentUploadBatch/DocumentSourceFile. Not implemented or emitted by this
 * phase — listed here only so the intake result's ids/shape stay compatible
 * with recording these later.
 */
export type DocumentIntakeRegisterEvent =
  | "DOCUMENT_INTAKE_RECEIVED"
  | "DOCUMENT_INTAKE_STORED"
  | "DOCUMENT_INTAKE_FAILED";
