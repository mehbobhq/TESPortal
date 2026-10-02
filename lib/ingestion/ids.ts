/**
 * TES Ingestion Spine — branded identifier types.
 *
 * Every ID below serializes to a plain string, but each is a structurally
 * distinct TypeScript type: a BatchId cannot be assigned where a
 * SourceFileId is expected, even though both are "just strings" at runtime.
 * This exists specifically so these identifiers can never become
 * interchangeable merely because they share a representation - see
 * ids.typecheck.ts for a compile-time proof of this.
 *
 * `companyId` is deliberately NOT given a branded type here. TES does not
 * yet have one canonical companyId scheme (see app/companies/new/page.tsx's
 * own ad hoc `CMP-...` generation) - inventing a second, ingestion-specific
 * CompanyId standard now would create exactly the duplicate-ID-space problem
 * this module exists to avoid elsewhere. Every contract in lib/ingestion/
 * takes `companyId: string` and normalizing that type is left to whatever
 * future work normalizes companyId repository-wide.
 */

declare const IdBrand: unique symbol;

/** A string branded with a specific, literal name - distinct IDs with different names are not mutually assignable. */
export type Id<Name extends string> = string & { readonly [IdBrand]: Name };

export type BatchId = Id<"BatchId">;
export type SourceFileId = Id<"SourceFileId">;
export type DocumentId = Id<"DocumentId">;
export type ProcessingRunId = Id<"ProcessingRunId">;
export type EvidenceId = Id<"EvidenceId">;
export type ReviewId = Id<"ReviewId">;
export type CorrelationId = Id<"CorrelationId">;

/**
 * No centralized ID generator is implemented in this phase - none is needed
 * to compile or test these contracts, and generating real IDs is an
 * application-behavior concern (today, ad hoc `crypto.randomUUID()` calls
 * scattered across call sites - see the ingestion spine preflight report).
 * These are plain, zero-validation brand casts, used only to construct
 * values of the right type from a string an application already has (e.g.
 * one obtained from `crypto.randomUUID()` elsewhere).
 */
export function asBatchId(value: string): BatchId {
  return value as BatchId;
}
export function asSourceFileId(value: string): SourceFileId {
  return value as SourceFileId;
}
export function asDocumentId(value: string): DocumentId {
  return value as DocumentId;
}
export function asProcessingRunId(value: string): ProcessingRunId {
  return value as ProcessingRunId;
}
export function asEvidenceId(value: string): EvidenceId {
  return value as EvidenceId;
}
export function asReviewId(value: string): ReviewId {
  return value as ReviewId;
}
export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}
