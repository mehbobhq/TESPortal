/**
 * Server-owned Contacts vocabulary and normalization.
 *
 * PostgreSQL owns the purpose catalogue (contact_purpose_types, migration 0014) and its primary_mode rules; a drift test
 * proves PURPOSE_DEFINITIONS agrees. Channel types and Organization channel usages are SERVER policy: the database only
 * checks their shape, so a new channel type is added here without a migration.
 *
 * Normalization exists ONLY to assist advisory matching and to detect an identical current duplicate. It never merges
 * people, and no rule is regulatory or provider validation:
 *   email   lower-cased; structural check only (one @, a dot in the domain). No provider-specific folding (for example
 *           removing dots from a Gmail local part), which would equate distinct mailboxes.
 *   phone   digits only; a leading + keeps the international form, a bare 10-digit or 1+10-digit number is read as North
 *           American. Anything else must be given in international (+) form.
 * Rule names say so, and every version stays resolvable so a stricter rule can be added without rewriting history.
 */

import { ContactValidationError } from "@/lib/contacts/errors"

export const CHANNEL_TYPES = ["EMAIL", "PHONE"] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]

export const ORGANIZATION_CHANNEL_USAGES = ["GENERAL", "DISPATCH", "OFFICE", "ACCOUNTING", "SAFETY"] as const
export type OrganizationChannelUsage = (typeof ORGANIZATION_CHANNEL_USAGES)[number]

export type PrimaryMode = "NONE" | "OPTIONAL" | "REQUIRED"

export const PURPOSE_DEFINITIONS = {
  PRIMARY: { primaryMode: "REQUIRED" },
  BILLING: { primaryMode: "OPTIONAL" },
  SAFETY: { primaryMode: "OPTIONAL" },
  OPERATIONS: { primaryMode: "OPTIONAL" },
  COMPLIANCE: { primaryMode: "OPTIONAL" },
  EMERGENCY: { primaryMode: "OPTIONAL" },
} as const satisfies Record<string, { primaryMode: PrimaryMode }>

export type ContactPurpose = keyof typeof PURPOSE_DEFINITIONS
export const CONTACT_PURPOSES = Object.keys(PURPOSE_DEFINITIONS) as ContactPurpose[]

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === "string" && (CHANNEL_TYPES as readonly string[]).includes(value)
}
export function isChannelUsage(value: unknown): value is OrganizationChannelUsage {
  return typeof value === "string" && (ORGANIZATION_CHANNEL_USAGES as readonly string[]).includes(value)
}
export function isContactPurpose(value: unknown): value is ContactPurpose {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PURPOSE_DEFINITIONS, value)
}

// ---------------------------------------------------------------------------------------------------------------
// Channel values
// ---------------------------------------------------------------------------------------------------------------

export type ChannelRule = {
  readonly version: string
  readonly apply: (raw: string) => { ok: true; normalized: string } | { ok: false; reason: string }
}

const EMAIL_RULE: ChannelRule = {
  version: "email.lowercase_structural_permissive.v1",
  apply(raw) {
    const value = raw.normalize("NFKC").trim()
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { ok: false, reason: "An email address needs one @ and a dotted domain, without spaces." }
    }
    return { ok: true, normalized: value.toLowerCase() }
  },
}

const PHONE_RULE: ChannelRule = {
  version: "phone.nanp_or_international_permissive.v1",
  apply(raw) {
    const value = raw.normalize("NFKC").trim()
    const digits = value.replace(/\D/g, "")
    if (value.startsWith("+")) {
      return digits.length >= 7 && digits.length <= 15
        ? { ok: true, normalized: `+${digits}` }
        : { ok: false, reason: "An international phone number has 7-15 digits after the +." }
    }
    if (digits.length === 10) return { ok: true, normalized: `+1${digits}` }
    if (digits.length === 11 && digits.startsWith("1")) return { ok: true, normalized: `+${digits}` }
    return { ok: false, reason: "Give a 10-digit North American number, or an international number starting with +." }
  },
}

/** Every rule version ever stored must remain here, unchanged. */
export const CHANNEL_RULES: Readonly<Record<string, ChannelRule>> = {
  [EMAIL_RULE.version]: EMAIL_RULE,
  [PHONE_RULE.version]: PHONE_RULE,
}

const CURRENT_CHANNEL_RULE: Readonly<Record<ChannelType, ChannelRule>> = { EMAIL: EMAIL_RULE, PHONE: PHONE_RULE }

export type PreparedChannel = {
  display: string
  normalized: string
  ruleVersion: string
  extension: string | null
}

/** Splits a trailing "ext 12" / "x12" off a phone number. */
function splitPhoneExtension(raw: string): { body: string; extension: string | null } {
  const match = /^(.*?)[\s,;]*(?:ext\.?|extension|x)\s*(\d{1,8})\s*$/i.exec(raw.trim())
  return match ? { body: match[1], extension: match[2] } : { body: raw, extension: null }
}

export function prepareChannel(type: ChannelType, value: unknown, extension?: unknown, field = "value"): PreparedChannel {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContactValidationError(field, `${field} is required.`)
  }
  let body = value
  let ext: string | null = null
  if (extension !== undefined && extension !== null) {
    if (type !== "PHONE") throw new ContactValidationError("extension", "An extension applies only to a phone channel.")
    if (typeof extension !== "string" || !/^\d{1,8}$/.test(extension.trim())) {
      throw new ContactValidationError("extension", "An extension is 1-8 digits.")
    }
    ext = extension.trim()
  } else if (type === "PHONE") {
    const split = splitPhoneExtension(value)
    body = split.body
    ext = split.extension
  }
  const display = value.normalize("NFC").replace(/\s+/g, " ").trim()
  if (display.length > 254) throw new ContactValidationError(field, `${field} is too long.`)
  const rule = CURRENT_CHANNEL_RULE[type]
  const result = rule.apply(body)
  if (!result.ok) throw new ContactValidationError(field, result.reason)
  return { display, normalized: result.normalized, ruleVersion: rule.version, extension: ext }
}

// ---------------------------------------------------------------------------------------------------------------
// Names and titles
// ---------------------------------------------------------------------------------------------------------------

export type PreparedName = { givenName: string | null; familyName: string | null; normalized: string }

const tidy = (value: string): string => value.normalize("NFC").replace(/\s+/g, " ").trim()

/** Lower-cased, accent-folded, punctuation-free; advisory matching only. */
export function normalizeForMatching(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function optionalName(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new ContactValidationError(field, `${field} must be text.`)
  const name = tidy(value)
  if (name === "") return null
  if (name.length > 100) throw new ContactValidationError(field, `${field} must not exceed 100 characters.`)
  return name
}

export function prepareName(givenName: unknown, familyName: unknown): PreparedName {
  const given = optionalName(givenName, "givenName")
  const family = optionalName(familyName, "familyName")
  if (given === null && family === null) {
    throw new ContactValidationError("name", "A person needs a given name or a family name.")
  }
  const normalized = normalizeForMatching([given, family].filter(Boolean).join(" "))
  if (normalized === "") throw new ContactValidationError("name", "The name must contain letters or digits.")
  return { givenName: given, familyName: family, normalized }
}

export type PreparedTitle = { display: string; normalized: string }

/** A job title is free text and never an authorization input. */
export function prepareTitle(value: unknown, field = "title"): PreparedTitle {
  if (typeof value !== "string" || tidy(value) === "") throw new ContactValidationError(field, `${field} is required.`)
  const display = tidy(value)
  if (display.length > 100) throw new ContactValidationError(field, `${field} must not exceed 100 characters.`)
  const normalized = normalizeForMatching(display)
  if (normalized === "") throw new ContactValidationError(field, `${field} must contain letters or digits.`)
  return { display, normalized }
}
