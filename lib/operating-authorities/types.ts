import type { AuthorityKind, AuthorityStatus, JurisdictionInput } from "@/lib/operating-authorities/definitions"

export type RecordLifecycle = "active" | "archived"

/** Business time: ISO-8601 instant with a zone. Omitted means "now" (database clock). Never in the future. */
export type EffectiveFrom = string

export type CreateAuthorityInput = {
  organizationId: string
  kind: AuthorityKind
  number: string
  /** Required for every kind except USDOT / MC (national) and CVOR (defaults to ON). */
  jurisdiction?: JurisdictionInput
  /** YYYY-MM-DD */
  issuedOn?: string
  /** YYYY-MM-DD; only for kinds where expiry applies. */
  expiresOn?: string
  /** Initial regulatory status; defaults to ACTIVE. */
  status?: AuthorityStatus
  effectiveFrom?: EffectiveFrom
}

/** Fields of a version a caller can change or correct. `null` clears a date. */
export type VersionFields = {
  number?: string
  jurisdiction?: JurisdictionInput
  issuedOn?: string | null
  expiresOn?: string | null
}

export type ChangeVersionInput = VersionFields & {
  organizationId: string
  authorityId: string
  effectiveFrom?: EffectiveFrom
}

export type CorrectVersionInput = VersionFields & {
  organizationId: string
  authorityId: string
}

export type ChangeStatusInput = {
  organizationId: string
  authorityId: string
  status: AuthorityStatus
  effectiveFrom?: EffectiveFrom
}

export type ReactivateInput = {
  organizationId: string
  authorityId: string
  effectiveFrom?: EffectiveFrom
}

export type CorrectStatusInput = {
  organizationId: string
  authorityId: string
  status: AuthorityStatus
}

export type CheckNumberInput = {
  kind: AuthorityKind
  number: string
  jurisdiction?: JurisdictionInput
}

export type AuthorityRecord = {
  id: string
  organizationId: string
  kind: AuthorityKind
  /** Record lifecycle (NOT regulatory status). */
  recordStatus: RecordLifecycle
  archivedAt: string | null
  createdAt: string
}

export type VersionRecord = {
  id: string
  authorityId: string
  numberDisplay: string
  numberNormalized: string
  normalizationRuleVersion: string
  jurisdictionCountry: string
  jurisdictionRegion: string | null
  issuedOn: string | null
  expiresOn: string | null
  versionReason: "INITIAL" | "CHANGE" | "CORRECTION"
  effectiveFrom: string
  effectiveTo: string | null
  /** 'corrected' versions were wrongly recorded: preserved, but never a genuine business fact. */
  recordStatus: "active" | "corrected"
  correctedAt: string | null
  supersededByVersionId: string | null
  createdAt: string
}

export type StatusPeriodRecord = {
  id: string
  authorityId: string
  authorityStatus: AuthorityStatus
  periodReason: "INITIAL" | "TRANSITION" | "REACTIVATION" | "CORRECTION"
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected"
  correctedAt: string | null
  supersededByPeriodId: string | null
  createdAt: string
}

export type AuthorityView = {
  authority: AuthorityRecord
  /** What is true now: the current genuine version and regulatory status. */
  current: { version: VersionRecord | null; status: StatusPeriodRecord | null }
  /** Present only when an as-of instant was requested; corrected rows are never returned here. */
  asOf: { at: string; version: VersionRecord | null; status: StatusPeriodRecord | null } | null
  /** Every version ever recorded, including corrected ones (flagged recordStatus = 'corrected') for audit. */
  versions: VersionRecord[]
  statusPeriods: StatusPeriodRecord[]
}

export type OrganizationAuthoritiesView = {
  organizationId: string
  authorities: AuthorityView[]
}

/** Weaker evidence shown for review; only produced for callers holding ORGANIZATION_REGISTRY_READ. */
export type ReviewMatch = {
  kind: "ENDED_OR_CORRECTED_NUMBER"
  organizationId: string
  organizationLegalName: string
  authorityId: string
  versionRecordStatus: "active" | "corrected"
}

export type AuthorityMutationResult = {
  view: AuthorityView
  reviewMatches: ReviewMatch[]
}

export type NumberCheckResult = {
  registered: boolean
  match: import("@/lib/operating-authorities/errors").NumberCollisionMatch | null
  reviewMatches: ReviewMatch[]
}
