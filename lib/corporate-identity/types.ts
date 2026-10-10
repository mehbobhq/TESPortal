import type { CorporateIdentifierInput, CorporateIdentifierKind } from "@/lib/corporate-identity/identifier-definitions"

export type OrganizationStatus = "active" | "archived" | "merged"

/** Legal formation / registration jurisdiction. NOT an operating area, IRP base, tax jurisdiction, address or yard. */
export type FormationInput = { country: string; region?: string | null }

export const ALIAS_TYPES = ["TRADE_NAME", "FORMER_NAME", "ABBREVIATION"] as const
export type AliasType = (typeof ALIAS_TYPES)[number]

export type AliasInput = { alias: string; aliasType: AliasType }

export type ClassificationInput = { code: string; isPrimary?: boolean }

export type CreateOrganizationInput = {
  legalName: string
  displayName?: string | null
  /** Primary legal formation. When omitted it is taken from an INCORPORATION identifier, if one is supplied. */
  formation?: FormationInput | null
  identifiers?: CorporateIdentifierInput[]
  aliases?: AliasInput[]
  classifications?: ClassificationInput[]
}

export type UpdateLegalIdentityInput = {
  legalName?: string
  /** null clears the display name. */
  displayName?: string | null
  /** null clears the formation jurisdiction; only allowed while no active INCORPORATION identifier exists. */
  formation?: FormationInput | null
}

export type IdentifierRecord = {
  id: string
  /** null only for a row whose stored vocabulary this service does not own. */
  kind: CorporateIdentifierKind | null
  identifierType: string
  namespace: string
  jurisdictionCountry: string | null
  jurisdictionRegion: string | null
  value: string
  normalizedValue: string
  normalizationRuleVersion: string | null
  verificationStatus: string
  verifiedAt: string | null
  status: "active" | "superseded"
  supersededAt: string | null
  createdAt: string
}

export type AliasRecord = {
  id: string
  alias: string
  normalizedAlias: string
  aliasType: string | null
  status: "active" | "inactive"
  createdAt: string
}

export type ClassificationRecord = {
  id: string
  code: string
  isPrimary: boolean
  effectiveFrom: string
  effectiveTo: string | null
}

export type OrganizationRecord = {
  id: string
  legalName: string
  displayName: string | null
  normalizedLegalName: string
  status: OrganizationStatus
  formationCountry: string | null
  formationRegion: string | null
  mergedIntoOrganizationId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  identifiers: IdentifierRecord[]
  aliases: AliasRecord[]
  classifications: ClassificationRecord[]
  /**
   * Derived, never stored: the active INCORPORATION identifier registered in the Organization's formation
   * jurisdiction. Extra-provincial registrations never appear here.
   */
  primaryRegistration: IdentifierRecord | null
}

/** Weaker evidence that is shown for review and never blocks creation. Only produced for callers who may see it. */
export type ReviewMatch = {
  kind: "SUPERSEDED_IDENTIFIER"
  organizationId: string
  legalName: string
  identifierKind: CorporateIdentifierKind | null
}

export type CreateOrganizationResult = {
  organization: OrganizationRecord
  reviewMatches: ReviewMatch[]
}

export type MutationResult = {
  organization: OrganizationRecord
  reviewMatches: ReviewMatch[]
}
