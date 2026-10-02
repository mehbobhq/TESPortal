/**
 * Compile-time-only proof that branded ingestion IDs are not mutually
 * assignable merely because they all serialize to strings. This file
 * contains no runtime assertions and is not executed by `node --test` - it
 * is checked by `tsc --noEmit`, which must fail if any `@ts-expect-error`
 * line below stops being a real type error (meaning the brand protection
 * silently broke).
 */

// @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
import { asBatchId, asDocumentId, asSourceFileId, type BatchId, type DocumentId, type SourceFileId } from "../../../lib/ingestion/ids.ts";

const batchId: BatchId = asBatchId("batch-1");
const sourceFileId: SourceFileId = asSourceFileId("source-1");
const documentId: DocumentId = asDocumentId("document-1");

// @ts-expect-error - a BatchId must not be assignable where a SourceFileId is expected, even though both are strings.
const wrongAssignment1: SourceFileId = batchId;

// @ts-expect-error - a SourceFileId must not be assignable where a DocumentId is expected.
const wrongAssignment2: DocumentId = sourceFileId;

// @ts-expect-error - a plain, unbranded string must not be assignable to a branded ID type.
const wrongAssignment3: BatchId = "just-a-string";

// Reference every binding so this file has no "unused variable" noise beyond its intentional type-error lines.
void batchId;
void sourceFileId;
void documentId;
void wrongAssignment1;
void wrongAssignment2;
void wrongAssignment3;
