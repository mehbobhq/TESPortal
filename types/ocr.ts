/**
 * TES Generic OCR Ingestion & Review Interface
 * Domain-neutral contract and data structures for document OCR workflows.
 * The consuming module supplies its field schema, OCR provider adapter, and persistence callback.
 */

export interface OCRFieldResult<T = string | number | boolean> {
  fieldKey: string;
  label: string;
  rawValue?: string;
  normalizedValue?: T;
  confidence: number; // 0 to 100
  boundingRegion?: {
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isManuallyCorrected?: boolean;
  validationStatus?: "valid" | "warning" | "error";
  validationMessage?: string;
}

export interface OCRDocumentResult {
  documentId: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  overallConfidence: number;
  extractedFields: Record<string, OCRFieldResult>;
  rawExtractedText?: string;
  processedAt: string;
  adapterVersion?: string;
}

export type OCRProcessingState = "idle" | "capturing" | "uploading" | "processing" | "reviewing" | "error" | "confirmed";

export interface DocumentOCRAdapter {
  name: string;
  version: string;
  processDocument: (
    file: File | Blob,
    documentType: string,
    metadata?: Record<string, unknown>
  ) => Promise<OCRDocumentResult>;
}
