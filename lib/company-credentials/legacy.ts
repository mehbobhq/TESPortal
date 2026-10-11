/**
 * Legacy Credentials page vocabulary -> canonical vocabulary (app/companies/[id]/credentials/page.tsx).
 *
 * PURE mapping tables and functions: no browser storage, no database, no I/O. It exists so a later, deterministic and
 * reconcilable import has an agreed mapping. A legacy value with no canonical equivalent maps to an explicit `null` or an
 * explicit marker, never to a guess.
 *
 * THE LEGACY SECRETS ARE NEVER MAPPED. The legacy page held passwords, security-question answers and recovery values in
 * the browser. None of them is imported into PostgreSQL, ever: legacySecretDisposition always answers SECRET_NOT_MIGRATED.
 * The canonical model has only secret SLOTS (state plus an opaque secret-store reference); a later, separate step may
 * create UNRESOLVED slots for the kinds that legacy data says exist, and a person re-enters each secret into the secret
 * store. Nothing in this file touches a secret value.
 */

import {
  isLoginUrl,
  normalizeSystemName,
  type CredentialCategory,
  type CredentialStatus,
  type SlotKind,
} from "@/lib/company-credentials/definitions"

export const UNMAPPABLE = "UNMAPPABLE" as const
export type Unmappable = typeof UNMAPPABLE

// --- credential category and status ---------------------------------------------------------------------------------

export const LEGACY_CATEGORY_MAP: Readonly<Record<string, CredentialCategory>> = {
  Fleet: "FLEET",
  Compliance: "COMPLIANCE",
  Registration: "REGISTRATION",
  Insurance: "INSURANCE",
  Accounting: "ACCOUNTING",
  Fuel: "FUEL",
  Other: "OTHER",
}

export const LEGACY_STATUS_MAP: Readonly<Record<string, CredentialStatus>> = {
  Active: "ACTIVE",
  "Needs verification": "NEEDS_VERIFICATION",
  Locked: "LOCKED",
  Disabled: "DISABLED",
}

const own = <T>(table: Readonly<Record<string, T>>, key: unknown): T | null =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null

/** The canonical category code, or null for a value the legacy page never offered. */
export const mapLegacyCategory = (value: unknown): CredentialCategory | null => own(LEGACY_CATEGORY_MAP, value)

/** The canonical status code, or null for a value the legacy page never offered. */
export const mapLegacyStatus = (value: unknown): CredentialStatus | null => own(LEGACY_STATUS_MAP, value)

/**
 * The legacy recoveryStatus ("Not added" | "Partially added" | "Recovery added") has NO canonical equivalent: it is a
 * summary DERIVED from the state of the credential's secret slots. It is never stored and never imported.
 */
export const DERIVED = "DERIVED_FROM_SLOT_STATE" as const
export const mapLegacyRecoveryStatus = (_value: unknown): typeof DERIVED => DERIVED

// --- recovery methods and secrets -----------------------------------------------------------------------------------

export const LEGACY_RECOVERY_METHOD_MAP: Readonly<Record<string, SlotKind>> = {
  "Recovery email": "RECOVERY_EMAIL",
  "Recovery phone": "RECOVERY_PHONE",
  "Recovery PIN": "RECOVERY_PIN",
  "Backup codes": "BACKUP_CODES",
  "MFA recovery": "OTHER_RECOVERY",
  Other: "OTHER_RECOVERY",
}

/** The slot KIND a legacy recovery method corresponds to (only the kind: the legacy value is never migrated). */
export const mapLegacyRecoveryMethodType = (value: unknown): SlotKind | null => own(LEGACY_RECOVERY_METHOD_MAP, value)

/** The legacy "security question" drafts correspond to SECURITY_ANSWER slots; only the kind survives. */
export const LEGACY_SECURITY_QUESTION_SLOT_KIND: SlotKind = "SECURITY_ANSWER"

/** Every legacy field that held a secret. None is ever imported. */
export const LEGACY_SECRET_FIELDS = ["password", "securityQuestionAnswer", "recoveryValue"] as const
export type LegacySecretField = (typeof LEGACY_SECRET_FIELDS)[number]

export type SecretDisposition = { outcome: "SECRET_NOT_MIGRATED"; field: string }

/** The one answer for any legacy secret, whatever the field or value: it is not migrated. The value is never read or echoed. */
export function legacySecretDisposition(field: string, _value?: unknown): SecretDisposition {
  return { outcome: "SECRET_NOT_MIGRATED", field }
}

// --- credential metadata --------------------------------------------------------------------------------------------

export type LegacyCredentialMetadata = {
  category?: unknown
  status?: unknown
  username?: unknown
  recoveryStatus?: unknown
  lastVerifiedAt?: unknown
}

export type MappedCredentialMetadata = {
  /** null = the legacy value could not be mapped; the import must report it, not guess. */
  category: CredentialCategory | null
  status: CredentialStatus | null
  recoveryStatus: typeof DERIVED
  /**
   * A legacy "last verified" date carries no verifying actor and no method, both of which a canonical verification
   * requires, so it is not imported as a verification.
   */
  lastVerifiedAt: "NOT_IMPORTED_NO_ACTOR_OR_METHOD" | null
}

export function mapLegacyCredentialMetadata(legacy: LegacyCredentialMetadata): MappedCredentialMetadata {
  const verified = typeof legacy.lastVerifiedAt === "string" && legacy.lastVerifiedAt.trim() !== ""
  return {
    category: mapLegacyCategory(legacy.category),
    status: mapLegacyStatus(legacy.status),
    recoveryStatus: DERIVED,
    lastVerifiedAt: verified ? "NOT_IMPORTED_NO_ACTOR_OR_METHOD" : null,
  }
}

// --- portal registry ------------------------------------------------------------------------------------------------

export type LegacyPortalDefinition = {
  id?: unknown
  providerCompanyId?: unknown
  name?: unknown
  legalName?: unknown
  jurisdiction?: unknown
  country?: unknown
  services?: unknown
  aliases?: unknown
  loginUrl?: unknown
}

/** The createSystem input a legacy portal maps to. */
export type MappedSystemInput = {
  name: string
  aliases: string[]
  jurisdictionCountry?: string
  jurisdictionRegion?: string
  loginUrl?: string
}

/** Legacy fields with no canonical home. They are listed so an import reconciliation can show what was left behind. */
export const DROPPED_NO_CANONICAL_FIELD = ["services", "legalName"] as const

export type MappedPortal =
  | {
      status: "MAPPED"
      /** The legacy portal id, kept for reconciliation only (it is not a canonical identifier). */
      legacyId: string | null
      /** The legacy provider company id: a browser-local id, resolvable to an Organization only by a separate reviewed step. */
      legacyProviderCompanyId: string | null
      input: MappedSystemInput
      dropped: typeof DROPPED_NO_CANONICAL_FIELD
      /** Fields present in the legacy portal that could not be mapped (the system is still created without them). */
      unmapped: Array<"jurisdiction" | "country" | "loginUrl">
      /** Aliases left out because they normalize to the system's own name or to an earlier alias. */
      duplicateAliasesDropped: string[]
    }
  | { status: typeof UNMAPPABLE; reason: "NAME_MISSING_OR_NOT_COMPARABLE" }

export const LEGACY_COUNTRY_MAP: Readonly<Record<string, string>> = {
  canada: "CA",
  ca: "CA",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  us: "US",
}

export const LEGACY_REGION_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  CA: {
    alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB", "newfoundland and labrador": "NL", "northwest territories": "NT",
    "nova scotia": "NS", nunavut: "NU", ontario: "ON", "prince edward island": "PE", quebec: "QC", saskatchewan: "SK", yukon: "YT",
  },
}

function mapCountry(value: unknown): string | null {
  return typeof value === "string" ? (LEGACY_COUNTRY_MAP[value.trim().toLowerCase()] ?? null) : null
}

function mapRegion(country: string, value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  // A value that is already a region code (AB, ON) is accepted as such.
  if (/^[A-Z]{2}$/.test(text)) return Object.values(LEGACY_REGION_MAP[country] ?? {}).includes(text) ? text : null
  return LEGACY_REGION_MAP[country]?.[text.toLowerCase()] ?? null
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

/** Maps one legacy PortalDefinition to a createSystem input. A name that cannot be compared is UNMAPPABLE; every other gap is reported in `unmapped`. */
export function mapLegacyPortal(portal: LegacyPortalDefinition): MappedPortal {
  const name = text(portal.name)
  let normalized: string
  try {
    normalized = normalizeSystemName(name)
  } catch {
    return { status: UNMAPPABLE, reason: "NAME_MISSING_OR_NOT_COMPARABLE" }
  }

  const unmapped: Array<"jurisdiction" | "country" | "loginUrl"> = []
  const input: MappedSystemInput = { name, aliases: [] }

  const countryGiven = text(portal.country) !== ""
  const country = mapCountry(portal.country)
  if (country) {
    input.jurisdictionCountry = country
    if (text(portal.jurisdiction) !== "") {
      const region = mapRegion(country, portal.jurisdiction)
      if (region) input.jurisdictionRegion = region
      else unmapped.push("jurisdiction")
    }
  } else {
    if (countryGiven) unmapped.push("country")
    // A region without a country cannot be stored (the canonical region needs a country).
    if (text(portal.jurisdiction) !== "") unmapped.push("jurisdiction")
  }

  const loginUrl = text(portal.loginUrl)
  if (loginUrl !== "") {
    if (isLoginUrl(loginUrl)) input.loginUrl = loginUrl
    else unmapped.push("loginUrl")
  }

  const seen = new Set<string>([normalized])
  const duplicateAliasesDropped: string[] = []
  if (Array.isArray(portal.aliases)) {
    for (const alias of portal.aliases) {
      const display = text(alias)
      let aliasNormalized: string
      try {
        aliasNormalized = normalizeSystemName(display, "alias")
      } catch {
        continue
      }
      if (seen.has(aliasNormalized)) duplicateAliasesDropped.push(display)
      else {
        seen.add(aliasNormalized)
        input.aliases.push(display)
      }
    }
  }

  return {
    status: "MAPPED",
    legacyId: text(portal.id) === "" ? null : text(portal.id),
    legacyProviderCompanyId: text(portal.providerCompanyId) === "" ? null : text(portal.providerCompanyId),
    input,
    dropped: DROPPED_NO_CANONICAL_FIELD,
    unmapped,
    duplicateAliasesDropped,
  }
}
