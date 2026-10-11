/**
 * Company Credentials vocabulary and normalization. PostgreSQL's credential_categories catalogue (migration 0018) is
 * authoritative for categories; the other vocabularies are closed CHECK lists in the same migration. This file lets
 * application code name the codes it may request, and a drift test proves the two agree.
 *
 * NO SECRET VALUE IS REPRESENTED ANYWHERE IN THIS DOMAIN. A secret slot has a kind and a state; the only thing that can
 * ever be attached to one is an opaque secret-store RESOURCE NAME (isSecretReference), never a value.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node.
 */

import { CompanyCredentialValidationError } from "@/lib/company-credentials/errors"

export const CREDENTIAL_CATEGORIES = ["FLEET", "COMPLIANCE", "REGISTRATION", "INSURANCE", "ACCOUNTING", "FUEL", "OTHER"] as const
export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number]

export const CREDENTIAL_STATUSES = ["ACTIVE", "NEEDS_VERIFICATION", "LOCKED", "DISABLED"] as const
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number]

export const MFA_METHODS = ["NONE", "AUTHENTICATOR_APP", "SMS", "EMAIL", "HARDWARE_KEY", "OTHER"] as const
export type MfaMethod = (typeof MFA_METHODS)[number]

export const SLOT_KINDS = ["PASSWORD", "MFA_SECRET", "RECOVERY_EMAIL", "RECOVERY_PHONE", "RECOVERY_PIN", "BACKUP_CODES", "SECURITY_ANSWER", "OTHER_RECOVERY"] as const
export type SlotKind = (typeof SLOT_KINDS)[number]

/** UNRESOLVED: expected but not held anywhere TES can reach (the honest state until a secret store exists). STORED: a store reference is attached. RETIRED: no longer valid. */
export const SECRET_STATES = ["UNRESOLVED", "STORED", "RETIRED"] as const
export type SecretState = (typeof SECRET_STATES)[number]

export const SECRET_STORES = ["GCP_SECRET_MANAGER"] as const
export type SecretStore = (typeof SECRET_STORES)[number]

export const VERIFICATION_OUTCOMES = ["VERIFIED", "FAILED", "LOCKED_OUT"] as const
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number]

export const VERIFICATION_METHODS = ["MANUAL_LOGIN", "PORTAL_CHECK", "CLIENT_CONFIRMATION"] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

export const REPLACEMENT_REASONS = ["USERNAME_CHANGED", "CORRECTION"] as const
export type ReplacementReason = (typeof REPLACEMENT_REASONS)[number]

export const PERIOD_REASONS = ["INITIAL", "TRANSITION", "CORRECTION"] as const
export type PeriodReason = (typeof PERIOD_REASONS)[number]

const member = <T extends readonly string[]>(list: T) => (value: unknown): value is T[number] => typeof value === "string" && list.includes(value)

export const isCredentialCategory = member(CREDENTIAL_CATEGORIES)
export const isCredentialStatus = member(CREDENTIAL_STATUSES)
export const isMfaMethod = member(MFA_METHODS)
export const isSlotKind = member(SLOT_KINDS)
export const isSecretState = member(SECRET_STATES)
export const isSecretStore = member(SECRET_STORES)
export const isVerificationOutcome = member(VERIFICATION_OUTCOMES)
export const isVerificationMethod = member(VERIFICATION_METHODS)
export const isReplacementReason = member(REPLACEMENT_REASONS)

// ---------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------

export const SYSTEM_NAME_MAX_LENGTH = 120
export const SYSTEM_DISPLAY_MAX_LENGTH = 200
export const USERNAME_MAX_LENGTH = 254

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * The comparison form of a system name or alias, mirroring credential_systems.display_name_normalized: NFKD, combining
 * marks removed, lower-case, every run of characters outside [a-z0-9] collapsed to one space, trimmed. So "ATIOS Alberta",
 * "ATIOS-Alberta", "atios   alberta" and "Átios Alberta" are one name, while "ATIOS Alberta" and "TRACS Alberta" are not.
 * Rejects a name with nothing comparable left in it, or one longer than 120 normalized characters.
 */
export function normalizeSystemName(display: unknown, field = "name"): string {
  if (typeof display !== "string") throw new CompanyCredentialValidationError(field, `${field} must be text.`)
  const normalized = display
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (normalized === "") throw new CompanyCredentialValidationError(field, `${field} must contain letters or digits.`)
  if (normalized.length > SYSTEM_NAME_MAX_LENGTH) throw new CompanyCredentialValidationError(field, `${field} must be at most ${SYSTEM_NAME_MAX_LENGTH} characters.`)
  return normalized
}

/** The name as entered (trimmed): required, bounded, no control characters. */
export function parseSystemDisplayName(value: unknown, field = "name"): string {
  if (typeof value !== "string") throw new CompanyCredentialValidationError(field, `${field} must be text.`)
  const display = value.trim()
  if (display === "") throw new CompanyCredentialValidationError(field, `${field} is required.`)
  if (display.length > SYSTEM_DISPLAY_MAX_LENGTH) throw new CompanyCredentialValidationError(field, `${field} must be at most ${SYSTEM_DISPLAY_MAX_LENGTH} characters.`)
  if (CONTROL_CHARACTERS.test(display)) throw new CompanyCredentialValidationError(field, `${field} contains characters that are not allowed.`)
  return display
}

/** The comparison form of a username: NFKC, trimmed, lower-cased. Only trimming and case are folded; inner characters are significant. */
export function normalizeUsername(value: unknown, field = "username"): string {
  if (typeof value !== "string") throw new CompanyCredentialValidationError(field, `${field} must be text.`)
  const normalized = value.normalize("NFKC").trim().toLowerCase()
  if (normalized === "") throw new CompanyCredentialValidationError(field, `${field} is required.`)
  if (normalized.length > USERNAME_MAX_LENGTH) throw new CompanyCredentialValidationError(field, `${field} must be at most ${USERNAME_MAX_LENGTH} characters.`)
  if (CONTROL_CHARACTERS.test(normalized)) throw new CompanyCredentialValidationError(field, `${field} contains characters that are not allowed.`)
  return normalized
}

/** The username as entered (trimmed); the comparison form is normalizeUsername. */
export function parseUsernameDisplay(value: unknown, field = "username"): string {
  normalizeUsername(value, field)
  return (value as string).trim()
}

// ---------------------------------------------------------------------------------------------------------------
// Secret-store references and login URLs (mirror the database CHECKs)
// ---------------------------------------------------------------------------------------------------------------

export const SECRET_REFERENCE_MAX_LENGTH = 400
const SECRET_REFERENCE_SHAPE = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/secrets\/[A-Za-z0-9_-]{1,255}(\/versions\/([0-9]+|latest))?$/

/**
 * True only for a GCP Secret Manager RESOURCE NAME (projects/<id>/secrets/<name>[/versions/<n>|latest]). A password,
 * a URL, a token or a hex string does not have this shape, so it cannot be attached as a "reference".
 */
export function isSecretReference(value: unknown): value is string {
  return typeof value === "string" && value.length <= SECRET_REFERENCE_MAX_LENGTH && SECRET_REFERENCE_SHAPE.test(value)
}

export const LOGIN_URL_MAX_LENGTH = 500
const LOGIN_URL_SHAPE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s?#]*)?$/

/** True for a public https sign-in page: https only, no userinfo, no query string, no fragment (mirrors the database CHECK). */
export function isLoginUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > LOGIN_URL_MAX_LENGTH || !LOGIN_URL_SHAPE.test(value)) return false
  const port = /^https:\/\/[A-Za-z0-9.-]+:([0-9]{1,5})/.exec(value)?.[1]
  return port === undefined || Number(port) <= 65535
}

export function parseLoginUrl(value: unknown, field = "loginUrl"): string {
  if (typeof value !== "string" || !isLoginUrl(value.trim())) {
    throw new CompanyCredentialValidationError(field, `${field} must be an https address without credentials, query string or fragment.`)
  }
  return value.trim()
}
