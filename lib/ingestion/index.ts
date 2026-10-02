/**
 * TES Ingestion Spine — Phase A canonical domain contracts.
 *
 * Pure types and pure state-transition validators only. No persistence, no
 * I/O, no behavioral change to document-intake/scanner/OCR/entity-resolution/
 * evidence-storage code - see the ingestion spine reconciliation preflight
 * for the full architecture this is the first phase of.
 */

// Every re-export below needs the literal .ts extension for Node's native
// runtime module resolution to find these files at all (confirmed: an
// extensionless or .js-suffixed specifier fails to resolve under plain
// `node --test`). TS5097 flags this extension without
// `allowImportingTsExtensions`, which is intentionally left unset
// repository-wide - so each line is individually, narrowly suppressed here
// rather than changing tsconfig.json.
// @ts-expect-error TS5097
export * from "./ids.ts";
// @ts-expect-error TS5097
export * from "./state.ts";
// @ts-expect-error TS5097
export * from "./security-assessment-reference.ts";
// @ts-expect-error TS5097
export * from "./batch.ts";
// @ts-expect-error TS5097
export * from "./source-file.ts";
// @ts-expect-error TS5097
export * from "./document.ts";
// @ts-expect-error TS5097
export * from "./processing-run.ts";
// @ts-expect-error TS5097
export * from "./object-paths.ts";
