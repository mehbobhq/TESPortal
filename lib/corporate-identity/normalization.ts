/**
 * Canonical persistence normalization for Corporate Identity text.
 *
 * The Corporate Identity service owns these rules; browser normalization (lib/identifier-normalization.ts,
 * app/companies/new) is deliberately not reused for persisted values:
 *   - normalizeName() there only trims/collapses whitespace (no case folding), so it cannot back a lookup key.
 *   - normalizeSuffix() in lib/company-validation.ts strips legal-form words (Inc, Ltd, LLC ...), which is right for a
 *     fuzzy similarity hint and wrong for a stored key: "Acme Inc" and "Acme Ltd" can be different entities.
 *
 * Legal-form words are therefore KEPT. Name normalization is a lookup/review aid only; names never decide identity.
 */

import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"

export const NAME_MAX_LENGTH = 300

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/** Trims, NFC-normalizes and collapses internal whitespace. Rejects blank, over-long and control-character text. */
export function cleanDisplayText(value: unknown, field: string, maxLength = NAME_MAX_LENGTH): string {
  if (typeof value !== "string") {
    throw new CorporateIdentityValidationError(field, `${field} is required.`)
  }
  const cleaned = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (cleaned === "") throw new CorporateIdentityValidationError(field, `${field} is required.`)
  if (cleaned.length > maxLength) {
    throw new CorporateIdentityValidationError(field, `${field} must not exceed ${maxLength} characters.`)
  }
  if (CONTROL_CHARACTERS.test(cleaned)) {
    throw new CorporateIdentityValidationError(field, `${field} contains invalid characters.`)
  }
  return cleaned
}

/**
 * Normalized form of a legal name or alias, for lookup and review only:
 * NFKC, lower case, "&" as "and", everything that is not a letter or digit (any script) becomes a space, whitespace
 * collapsed. Never empty for a cleaned name that contains a letter or digit.
 */
export function normalizeBusinessName(cleaned: string, field: string): string {
  const normalized = cleaned
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (normalized === "") {
    throw new CorporateIdentityValidationError(field, `${field} must contain at least one letter or digit.`)
  }
  return normalized
}
