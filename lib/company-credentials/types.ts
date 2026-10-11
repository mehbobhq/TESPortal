import type {
  CredentialCategory,
  CredentialStatus,
  MfaMethod,
  PeriodReason,
  ReplacementReason,
  SecretState,
  SlotKind,
  VerificationMethod,
  VerificationOutcome,
} from "@/lib/company-credentials/definitions"

/** Every business-time value is an ISO-8601 UTC string with microsecond precision. */
export type SystemRecord = {
  id: string
  displayName: string
  providerOrganizationId: string | null
  jurisdictionCountry: string | null
  jurisdictionRegion: string | null
  loginUrl: string | null
  recordStatus: "active" | "archived"
  archivedAt: string | null
  createdAt: string
}

export type AliasRecord = {
  id: string
  systemId: string
  alias: string
  recordStatus: "active" | "retired"
  retiredAt: string | null
}

export type SystemView = SystemRecord & { aliases: AliasRecord[] }

export type CredentialRecord = {
  id: string
  organizationId: string
  systemId: string
  category: CredentialCategory
  username: string
  mfaMethod: MfaMethod | null
  replacesCredentialId: string | null
  replacementReason: ReplacementReason | null
  recordStatus: "active" | "archived"
  archivedAt: string | null
  createdAt: string
}

export type StatusPeriodRecord = {
  id: string
  credentialId: string
  status: CredentialStatus
  reason: PeriodReason
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected"
  correctedAt: string | null
  supersededById: string | null
}

export type VerificationRecord = {
  id: string
  credentialId: string
  outcome: VerificationOutcome
  method: VerificationMethod
  verifiedAt: string
  /** The authenticated TES actor who recorded it. */
  recordedByActorId: string
  recordStatus: "active" | "voided"
  voidedAt: string | null
}

/**
 * Secret slot STATE only. By construction there is no field here for a secret value, a store or a store reference: the
 * repository never selects them, so no read path can return them.
 */
export type SecretSlotRecord = {
  id: string
  credentialId: string
  slotKind: SlotKind
  secretState: SecretState
  storedAt: string | null
  retiredAt: string | null
}

export type CredentialView = {
  credential: CredentialRecord
  system: { id: string; displayName: string }
  /** Every status period, corrected ones flagged. */
  statusHistory: StatusPeriodRecord[]
  /** The genuine open status period, if any. */
  currentStatus: StatusPeriodRecord | null
  verifications: VerificationRecord[]
  /** The most recent genuine (not voided) verification. */
  lastVerification: VerificationRecord | null
  slots: SecretSlotRecord[]
  /** The credential that replaced this one, if any. */
  replacedByCredentialId: string | null
  asOf: null | { at: string; status: StatusPeriodRecord | null }
}

export type OrganizationCredentialsView = {
  organizationId: string
  asOf: string | null
  credentials: CredentialView[]
}
