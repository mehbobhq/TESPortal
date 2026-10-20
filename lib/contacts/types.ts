import type { ChannelType, ContactPurpose, OrganizationChannelUsage } from "@/lib/contacts/definitions"

export type ContactRecordStatus = "active" | "corrected" | "voided"
export type ChangeReason = "INITIAL" | "CHANGE" | "CORRECTION"

/** Business time: ISO-8601 instant with a zone. Omitted means "now" (database clock). Never in the future. */
export type EffectiveInstant = string

type PeriodRecord = {
  id: string
  changeReason: ChangeReason
  effectiveFrom: string
  effectiveTo: string | null
  /** 'corrected' / 'voided' rows were wrongly recorded: preserved, but never a genuine business fact. */
  recordStatus: ContactRecordStatus
  correctedAt: string | null
  supersededById: string | null
  createdAt: string
}

export type PersonRecord = {
  id: string
  /** Record lifecycle (a person is never "ended"). */
  recordStatus: "active" | "archived"
  archivedAt: string | null
  createdAt: string
}

export type NameRecord = PeriodRecord & {
  personId: string
  givenName: string | null
  familyName: string | null
}

export type ChannelRecord = PeriodRecord & {
  /** The person (person channels) or Organization (Organization channels) that owns the channel. */
  ownerType: "PERSON" | "ORGANIZATION"
  ownerId: string
  channelType: ChannelType
  /** Organization channels only. */
  usage: OrganizationChannelUsage | null
  valueDisplay: string
  valueNormalized: string
  normalizationRuleVersion: string
  extension: string | null
  isPreferred: boolean
  /** Deliberately absent: TES does not verify channels, so no channel is ever reported as verified. */
}

export type RelationshipRecord = {
  id: string
  organizationId: string
  personId: string
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "voided"
  correctedAt: string | null
  createdAt: string
}

export type TitleRecord = PeriodRecord & {
  relationshipId: string
  titleDisplay: string
}

export type PurposeAssignmentRecord = PeriodRecord & {
  relationshipId: string
  purpose: ContactPurpose
  isPrimary: boolean
}

export type ContactView = {
  relationship: RelationshipRecord
  person: PersonRecord
  names: NameRecord[]
  channels: ChannelRecord[]
  titles: TitleRecord[]
  purposes: PurposeAssignmentRecord[]
  /** What is true now: genuine ('active') rows that have not ended. Corrected / voided rows never appear here. */
  current: {
    name: NameRecord | null
    channels: ChannelRecord[]
    titles: TitleRecord[]
    purposes: PurposeAssignmentRecord[]
  }
  /** Present only when an as-of instant was requested; corrected / voided rows are never returned here. */
  asOf: {
    at: string
    relationshipInForce: boolean
    name: NameRecord | null
    channels: ChannelRecord[]
    titles: TitleRecord[]
    purposes: PurposeAssignmentRecord[]
  } | null
}

/**
 * An audited, effective-dated instruction NOT to copy a contact on the company's OPERATIONAL email. It is separate from the person,
 * their email, their company relationship and the PRIMARY designation: none of those changes when an exclusion is recorded or ended.
 * Only exclusions exist (inclusion is the default). Instruction text is a reference, never a message body.
 */
export type OperationalEmailExclusionRecord = {
  id: string
  organizationId: string
  personId: string
  relationshipId: string
  effectiveFrom: string
  effectiveTo: string | null
  instructionSource: "COMPANY_WRITTEN_REQUEST" | "COMPANY_VERBAL_CONFIRMED" | "TES_DECISION"
  instructionReference: string
  instructedByPersonId: string | null
  evidenceDocumentId: string | null
  changeReason: ChangeReason
  recordStatus: ContactRecordStatus
  createdAt: string
}

export type OrganizationContactsView = {
  organizationId: string
  /** Organization channels, all history (corrected / voided flagged). */
  channels: ChannelRecord[]
  currentChannels: ChannelRecord[]
  asOfChannels: ChannelRecord[] | null
  contacts: ContactView[]
  /** Operational-email exclusions of this company's contacts, all history (corrected / voided flagged). */
  operationalEmailExclusions: OperationalEmailExclusionRecord[]
  /**
   * What this database supports. `operationalEmailExclusions` is true only when migration 0035 is COMPLETE (false while it is absent or partly applied; see schema-state.ts): the list above is then
   * empty because no exclusion CAN exist, and recording one is refused with an explanation (never silently skipped).
   */
  features: { operationalEmailExclusions: boolean; migration0035: "ABSENT" | "COMPLETE" | "INCONSISTENT" }
}

export type PersonMatchReason = "NAME" | "EMAIL" | "PHONE"

/** Advisory only: a possible duplicate for human review. Never produces a merge. */
export type PersonMatch = {
  personId: string
  displayName: string
  reasons: PersonMatchReason[]
  organizationIds: string[]
}

export type ChannelInput = {
  type: ChannelType
  value: string
  extension?: string
  preferred?: boolean
}

export type CreateContactInput = {
  organizationId: string
  name: { givenName?: string; familyName?: string }
  channels?: ChannelInput[]
  titles?: string[]
  purposes?: Array<{ purpose: ContactPurpose; primary?: boolean }>
  effectiveFrom?: EffectiveInstant
}

export type CreateContactResult = { contact: ContactView; matches: PersonMatch[] }

export type FindPersonMatchesInput = {
  givenName?: string
  familyName?: string
  email?: string
  phone?: string
}

export type OrganizationChannelInput = ChannelInput & { usage: OrganizationChannelUsage }
