import type { AddressInput } from "@/lib/organization-locations/address-normalization"

export const LOCATION_KINDS = ["PHYSICAL", "POSTAL_ONLY"] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]

export const ASSIGNMENT_ROLES = ["REGISTERED", "MAILING", "HOME_YARD"] as const
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]

export type LocationStatus = "active" | "archived"

/** Business time: ISO-8601 instant. Omitted means "now" (database clock). Never in the future. */
export type EffectiveFrom = string

export type AssignmentRequest = {
  organizationId: string
  role: AssignmentRole
  effectiveFrom?: EffectiveFrom
}

export type CreateLocationInput = {
  kind: LocationKind
  address: AddressInput
  /** When present the Location, its initial address and this assignment are created in one transaction. */
  assignment?: AssignmentRequest
}

export type AssignLocationInput = AssignmentRequest & {
  /** Explicit reuse of an existing Location. */
  locationId: string
}

/** Correct a wrongly recorded assignment: supply the right Location (existing, or a new one). */
export type CorrectAssignmentInput = {
  organizationId: string
  /** The wrongly recorded assignment (current or ended); its role does not change. */
  assignmentId: string
  /** Exactly one of: an existing Location (explicit reuse rules apply)... */
  locationId?: string
  /** ...or a new Location to create for the correction. */
  location?: { kind: LocationKind; address: AddressInput }
}

export type CorrectAssignmentResult = {
  /** The wrong assignment, now flagged corrected and kept for audit. */
  correctedAssignment: AssignmentRecord
  /** The assignment representing the actual business fact; it inherits the corrected one's business time. */
  assignment: AssignmentRecord
  /** Set when the correction created a new Location. */
  createdLocation: LocationRecord | null
}

export type EndAssignmentInput = {
  organizationId: string
  role: AssignmentRole
  /** Business time the Organization stopped using the role; omitted means now. */
  effectiveTo?: string
}

export type AddressChangeInput = {
  /** The Organization on whose behalf the Location's address is revised; it must currently use the Location. */
  organizationId?: string
  locationId: string
  address: AddressInput
}

export type AddressRecord = {
  id: string
  locationId: string
  country: string
  region: string
  locality: string
  postalCode: string | null
  addressLine1: string
  addressLine2: string | null
  unit: string | null
  versionReason: "INITIAL" | "POSTAL_CHANGE" | "CORRECTION"
  effectiveFrom: string
  effectiveTo: string | null
  /** 'corrected' versions were wrongly recorded: preserved, but never a genuine business fact. */
  status: "active" | "corrected"
  correctedAt: string | null
  supersededByAddressId: string | null
  createdAt: string
}

export type LocationRecord = {
  id: string
  kind: LocationKind
  status: LocationStatus
  archivedAt: string | null
  createdAt: string
  /** The current (active, open-ended) address version. */
  currentAddress: AddressRecord | null
}

export type AssignmentRecord = {
  id: string
  organizationId: string
  locationId: string
  role: AssignmentRole
  effectiveFrom: string
  effectiveTo: string | null
  /** CHANGED / CEASED are real-world lifecycle events. A corrected assignment has neither. */
  endReason: "CHANGED" | "CEASED" | null
  /** 'corrected' assignments were wrongly recorded: preserved for audit, never a genuine business fact. */
  status: "active" | "corrected"
  correctedAt: string | null
  supersededByAssignmentId: string | null
  createdAt: string
}

/** Advisory suggestion that another Location may be the same place. Only produced for registry readers. */
export type LocationMatch = {
  location: LocationRecord
  /** Same building-level key. */
  buildingMatch: true
  /** Same unit-level key too (a stronger hint, still not proof). */
  unitMatch: boolean
  /** Organizations with a current assignment at that Location. */
  currentOrganizationIds: string[]
}

export type CreateLocationResult = {
  location: LocationRecord
  assignment: AssignmentRecord | null
  /** The assignment this one replaced, if any. */
  endedAssignment: AssignmentRecord | null
  /** Empty unless the caller holds ORGANIZATION_REGISTRY_READ. */
  matches: LocationMatch[]
}

export type AssignLocationResult = {
  assignment: AssignmentRecord
  endedAssignment: AssignmentRecord | null
}

export type AddressChangeResult = {
  address: AddressRecord
  /** Only reported to callers who hold ORGANIZATION_REGISTRY_READ; undefined otherwise. */
  usedByOtherOrganizations: boolean | undefined
}

export type AssignedLocation = {
  assignment: AssignmentRecord
  location: Omit<LocationRecord, "currentAddress">
  /** The address version in effect at the evaluation instant; null when the view carries only history. */
  address: AddressRecord | null
  /** Every version of the Location's address, including corrected ones (flagged by status). */
  versions: AddressRecord[]
}

export type OrganizationLocationsView = {
  organizationId: string
  /** Assignments open now, by role. */
  current: Record<AssignmentRole, AssignedLocation | null>
  /** Present only when an as-of instant was requested: assignments in force then, with the address then in effect. */
  asOf: { at: string; assignments: Record<AssignmentRole, AssignedLocation | null> } | null
  /** Every assignment ever recorded (newest first): ended ones, and corrected ones flagged status = 'corrected' for audit. */
  history: AssignedLocation[]
}
