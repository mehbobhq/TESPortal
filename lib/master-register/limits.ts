/**
 * TES Master Register — length limits for the free text/reference/identifier
 * values the recording service controls.
 *
 * These are structural data-minimization limits, not PII detection: a short
 * identifier/reference field must never become a vehicle for an entire
 * document, raw OCR text, or an unbounded blob, regardless of what a caller
 * tries to put there. Deliberately conservative, not exhaustive content
 * validation — this does not and cannot determine whether a value is
 * actually sensitive, only bound how much text any single field can carry.
 */

/** Short opaque identifiers: actorId, resource/company IDs, relationship IDs, source identifiers, field names. */
export const IDENTIFIER_MAX_LENGTH = 128;

/** Opaque references/URIs pointing at evidence/documents/artifacts elsewhere — longer than a bare ID, still bounded. */
export const REFERENCE_MAX_LENGTH = 512;

/** Short, human-authored explanatory text (e.g. outcome.reason, a LITERAL change value) — never a document body. */
export const SHORT_TEXT_MAX_LENGTH = 1000;

/** Hex/base64-style hash digest value — 128 chars comfortably covers SHA-512 in hex. */
export const HASH_VALUE_MAX_LENGTH = 128;

/** Hash algorithm name, e.g. "SHA-256". */
export const HASH_ALGORITHM_MAX_LENGTH = 32;
