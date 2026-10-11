import type { ProgramCode, RegistrationStatus, JurisdictionInput } from "@/lib/tax-registrations/definitions"
import type { NumberCollisionMatch } from "@/lib/tax-registrations/errors"

export type RecordLifecycle = "active" | "archived"

/** Business time: ISO-8601 instant with a zone. Omitted means "now" (database clock). Never in the future. */
export type EffectiveFrom = string

export type CreateRegistrationInput = {
  organizationId: string
  program: ProgramCode
  number: string
  /** Required for BASE_JURISDICTION programs (IFTA); optional (checked) for COUNTRY_REGION / NATIONAL; rejected for GLOBAL (SCAC). */
  jurisdiction?: JurisdictionInput
  /** YYYY-MM-DD */
  issuedOn?: string
  /** YYYY-MM-DD; optional for every program. */
  expiresOn?: string
  /** Initial registration status; defaults to ACTIVE. */
  status?: RegistrationStatus
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
  registrationId: string
  effectiveFrom?: EffectiveFrom
}

export type CorrectVersionInput = VersionFields & {
  organizationId: string
  registrationId: string
}

export type ChangeStatusInput = {
  organizationId: string
  registrationId: string
  status: RegistrationStatus
  effectiveFrom?: EffectiveFrom
}

export type CorrectStatusInput = {
  organizationId: string
  registrationId: string
  status: RegistrationStatus
}

export type CheckNumberInput = {
  program: ProgramCode
  number: string
  jurisdiction?: JurisdictionInput
}

export type RegistrationRecord = {
  id: string
  organizationId: string
  program: ProgramCode
  /** Record lifecycle (NOT registration status). */
  recordStatus: RecordLifecycle
  archivedAt: string | null
  createdAt: string
}

export type VersionRecord = {
  id: string
  registrationId: string
  numberDisplay: string
  numberNormalized: string
  normalizationRuleVersion: string
  /** null only for GLOBAL programs (SCAC). */
  jurisdictionCountry: string | null
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
  registrationId: string
  registrationStatus: RegistrationStatus
  periodReason: "INITIAL" | "TRANSITION" | "REACTIVATION" | "CORRECTION"
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected"
  correctedAt: string | null
  supersededByPeriodId: string | null
  createdAt: string
}

export type RegistrationView = {
  registration: RegistrationRecord
  /** What is true now: the current genuine version and registration status. */
  current: { version: VersionRecord | null; status: StatusPeriodRecord | null }
  /** Present only when an as-of instant was requested; corrected rows are never returned here. */
  asOf: { at: string; version: VersionRecord | null; status: StatusPeriodRecord | null } | null
  /** Every version ever recorded, including corrected ones (flagged recordStatus = 'corrected') for audit. */
  versions: VersionRecord[]
  statusPeriods: StatusPeriodRecord[]
}

export type OrganizationRegistrationsView = {
  organizationId: string
  registrations: RegistrationView[]
}

/** Weaker evidence shown for review; only produced for callers holding TAX_REGISTRATION_READ. */
export type ReviewMatch = {
  kind: "ENDED_OR_CORRECTED_NUMBER"
  organizationId: string
  organizationLegalName: string
  registrationId: string
  versionRecordStatus: "active" | "corrected"
}

export type RegistrationMutationResult = {
  view: RegistrationView
  reviewMatches: ReviewMatch[]
}

export type NumberCheckResult = {
  registered: boolean
  match: NumberCollisionMatch | null
  reviewMatches: ReviewMatch[]
}
