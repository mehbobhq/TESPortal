export type CanonicalEntityType = "ORGANIZATION" | "PERSON" | "VEHICLE"
export type ResolutionOutcome =
  | "EXACT_IDENTITY_MATCH"
  | "STRONG_PROBABLE_MATCH"
  | "AMBIGUOUS_MATCH"
  | "NEW_ENTITY"
  | "CONFLICT"

export type ResolutionState = "PENDING" | "REVIEW_REQUIRED" | "RESOLVED" | "REJECTED" | "INVALIDATED"

export interface EntityResolutionInput {
  entityType: CanonicalEntityType
  sourceSystem: string
  sourceRecordKey: string
  organizationContextId?: string
}

export interface VehicleCreateInput {
  vehicleTypeCode: "TRUCK_TRACTOR" | "STRAIGHT_TRUCK" | "TRAILER" | "OTHER"
  vin?: string
  modelYear?: number
  make?: string
  model?: string
}

export interface DriverProfileCreateInput {
  personId: string
}

export interface DriverLicenceInput {
  personId: string
  jurisdictionCountry: string
  jurisdictionRegion: string
  licenceNumber: string
  licenceClass?: string
  issueDate?: string
  expiryDate?: string
  effectiveFrom: string
}

export interface OrganizationVehicleRelationshipInput {
  organizationId: string
  vehicleId: string
  relationshipType: "OPERATES" | "OWNS" | "LEASES"
  unitNumber?: string
  effectiveFrom: string
}

export interface OrganizationDriverRelationshipInput {
  organizationId: string
  personId: string
  relationshipType: "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR"
  driverNumber?: string
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "ON_LEAVE"
  effectiveFrom: string
}

export type DriverEndReason = "ENDED" | "TRANSFERRED"
export type DriverIdentityMethod = "LICENCE_DOCUMENT_REVIEW" | "GOVERNMENT_ID_REVIEW" | "REGISTRY_CONFIRMATION"
export type DriverIdentityStatus = "UNVERIFIED" | "VERIFIED" | "REVOKED"

export interface EndOrganizationDriverInput {
  organizationId: string
  personId: string
  /** YYYY-MM-DD, not after today (UTC). Defaults to today. */
  effectiveTo?: string
}

export interface TransferOrganizationDriverInput {
  fromOrganizationId: string
  toOrganizationId: string
  personId: string
  relationshipType: "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR"
  driverNumber?: string
  status?: "ONBOARDING" | "ACTIVE"
  /** YYYY-MM-DD, not after today (UTC). Defaults to today. The previous assignment ends and the new one starts on this date. */
  effectiveDate?: string
}

export interface DriverIdentityVerificationInput {
  personId: string
  organizationId: string
  evidenceDocumentId: string
  method: DriverIdentityMethod
  licenceId?: string
}

export interface DriverIdentityRevocationInput {
  personId: string
  reason: string
}
