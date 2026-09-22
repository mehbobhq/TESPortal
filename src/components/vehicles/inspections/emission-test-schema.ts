export type EmissionProgramLayout =
  | "ONTARIO_DRIVE_CLEAN_LEGACY"
  | "ONTARIO_DRIVEON_CURRENT"
  | "US_STATE_OPACITY"
  | "US_STATE_OBD"
  | "OTHER"
  | "UNKNOWN"

export type EmissionRequirementTrigger =
  | "INITIAL_REGISTRATION"
  | "OWNERSHIP_TRANSFER"
  | "REGISTRATION_RENEWAL"
  | "PERIODIC_INSPECTION"
  | "ROADSIDE_ENFORCEMENT"
  | "RETEST"
  | "OTHER"

export type EmissionTestMethod =
  | "SNAP_ACCELERATION_OPACITY"
  | "ROLLING_ACCELERATION_OPACITY"
  | "STALL_ACCELERATION_OPACITY"
  | "OBD"
  | "OBD_II"
  | "VISUAL_EMISSION_CONTROL"
  | "ROADSIDE_SMOKE_OPACITY"
  | "COMBINED_METHOD"
  | "OTHER"

export type EmissionTestResult = "PASS" | "FAIL" | "INVALID" | "UNKNOWN"
export type PlateMatchStatus =
  | "MATCHED_TO_REGISTRATION"
  | "SOURCE_PLATE_NOT_PRINTED"
  | "NO_REGISTRATION_AT_TEST_DATE"
  | "MISMATCH_REVIEW_REQUIRED"

export interface EmissionVehicleSnapshot {
  unitNumber: string
  vin: string
  sourceFleetId?: string
  sourcePlate?: string
  sourcePlateJurisdiction?: string
  gvwrKg?: number
  odometer?: number
  odometerUnit?: "KM" | "MI"
  chassisYear?: number
  chassisMake?: string
  chassisModel?: string
  engineYear?: number
  engineMake?: string
  engineModel?: string
  engineDisplacementLitres?: number
}

export interface LinkedRegistrationSnapshot {
  registrationRecordId?: string
  plate?: string
  jurisdiction?: string
  registrationStatus?: string
  registrationEffectiveAtTest?: boolean
  plateMatchStatus: PlateMatchStatus
}

export interface OpacityMeasurement {
  readings: number[]
  rpmReadings: Array<number | null>
  result?: number
  limit?: number
  zeroDriftStatus?: "VALID" | "INVALID" | "UNKNOWN"
  zeroDriftResult?: number
  zeroDriftLimit?: number
  snapSpreadStatus?: "VALID" | "INVALID" | "UNKNOWN"
  snapSpreadResult?: number
  snapSpreadLimit?: number
}

export interface EmissionInspectionFacilitySnapshot {
  facilityNumber?: string
  name?: string
  address?: string
  phone?: string
  technicianNumber?: string
  technicianName?: string
  technicianSignaturePresent?: boolean
  deviceId?: string
  deviceType?: "TABLET" | "ANALYZER" | "UNKNOWN"
  softwareVersion?: string
}

export interface VehicleEmissionTestRecord {
  id: string
  companyId: string
  vehicleId: string
  recordType: "EMISSION_TEST"
  jurisdiction: string
  programName: string
  documentLayoutVersion: EmissionProgramLayout
  requirementTrigger: EmissionRequirementTrigger
  testMethods: EmissionTestMethod[]
  inspectionId?: string
  certificateNumber?: string
  reportNumber?: string
  verificationCode?: string
  testedAt: string
  expiryDate?: string
  sourceResult: string
  normalizedResult: EmissionTestResult
  vehicle: EmissionVehicleSnapshot
  registration: LinkedRegistrationSnapshot
  opacity?: OpacityMeasurement
  facility: EmissionInspectionFacilitySnapshot
  evidenceIds: string[]
  evidenceCompleteness: "COMPLETE" | "MISSING"
  ruleVersion?: string
  notes?: string
  createdAt: string
}

export interface RegistrationForEmissionLink {
  id: string
  vehicleId: string
  stateProvince: string
  registrationDate: string
  expiryDate: string
  plate: string
  status: "Draft" | "Active" | "Expired" | "Replaced" | "Cancelled"
  archived: boolean
  /** Direct reverse navigation to every emission test tied to this plate record. */
  relatedEmissionTestIds?: string[]
}

function normalize(value: string | undefined) {
  return (value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function effectiveOn(record: RegistrationForEmissionLink, testedAt: string) {
  if (record.archived || record.status === "Cancelled") return false
  const date = testedAt.slice(0, 10)
  if (record.registrationDate && record.registrationDate.slice(0, 10) > date) return false
  if (record.expiryDate && record.expiryDate !== "Continuous" && record.expiryDate.slice(0, 10) < date) return false
  return true
}

/**
 * Resolves the exact registration/plate record that applied when the emission
 * test occurred. A current plate must never be copied backward over a historic
 * test when a different registration record was effective on the test date.
 */
export function resolveEmissionPlateLink(args: {
  vehicleId: string
  testedAt: string
  sourcePlate?: string
  sourcePlateJurisdiction?: string
  registrations: RegistrationForEmissionLink[]
}): LinkedRegistrationSnapshot {
  const registrations = args.registrations.filter(
    (record) => record.vehicleId === args.vehicleId && !record.archived,
  )
  const effective = registrations.filter((record) => effectiveOn(record, args.testedAt))
  const sourcePlate = normalize(args.sourcePlate)
  const sourceJurisdiction = normalize(args.sourcePlateJurisdiction)

  const sourceMatch = effective.find(
    (record) =>
      normalize(record.plate) === sourcePlate &&
      (!sourceJurisdiction || normalize(record.stateProvince) === sourceJurisdiction),
  )

  if (sourceMatch) {
    return {
      registrationRecordId: sourceMatch.id,
      plate: sourceMatch.plate,
      jurisdiction: sourceMatch.stateProvince,
      registrationStatus: sourceMatch.status,
      registrationEffectiveAtTest: true,
      plateMatchStatus: "MATCHED_TO_REGISTRATION",
    }
  }

  if (sourcePlate && effective.length) {
    const preferred = effective.find((record) => record.status === "Active") || effective[0]
    return {
      registrationRecordId: preferred.id,
      plate: preferred.plate,
      jurisdiction: preferred.stateProvince,
      registrationStatus: preferred.status,
      registrationEffectiveAtTest: true,
      plateMatchStatus: "MISMATCH_REVIEW_REQUIRED",
    }
  }

  if (!sourcePlate && effective.length) {
    const preferred = effective.find((record) => record.status === "Active") || effective[0]
    return {
      registrationRecordId: preferred.id,
      plate: preferred.plate,
      jurisdiction: preferred.stateProvince,
      registrationStatus: preferred.status,
      registrationEffectiveAtTest: true,
      plateMatchStatus: "SOURCE_PLATE_NOT_PRINTED",
    }
  }

  return {
    plateMatchStatus: sourcePlate
      ? "MISMATCH_REVIEW_REQUIRED"
      : "NO_REGISTRATION_AT_TEST_DATE",
  }
}

export function opacityLimitUtilization(result?: number, limit?: number) {
  if (result == null || limit == null || limit <= 0) return undefined
  return Math.round((result / limit) * 1000) / 10
}

export function validateEmissionTestRecord(record: VehicleEmissionTestRecord) {
  const errors: string[] = []
  if (!record.vehicleId) errors.push("Vehicle is required.")
  if (!record.vehicle.vin) errors.push("VIN is required.")
  if (!record.testedAt) errors.push("Test date and time are required.")
  if (!record.jurisdiction) errors.push("Jurisdiction is required.")
  if (!record.programName) errors.push("Program name is required.")
  if (!record.testMethods.length) errors.push("At least one test method is required.")
  if (!record.evidenceIds.length) errors.push("The source emission certificate is required as evidence.")
  if (record.registration.plateMatchStatus === "MISMATCH_REVIEW_REQUIRED") {
    errors.push("Certificate plate conflicts with the vehicle registration effective on the test date.")
  }
  return errors
}

/**
 * Persists the reverse side of the portal-wide relationship rule. The caller
 * should save the Emission Test and this updated registration set in the same
 * transaction. Merely displaying a matching plate is not a durable link.
 */
export function connectEmissionTestToRegistration(
  record: VehicleEmissionTestRecord,
  registrations: RegistrationForEmissionLink[],
) {
  const registrationRecordId = record.registration.registrationRecordId
  if (!registrationRecordId) return registrations
  return registrations.map((registration) => registration.id === registrationRecordId
    ? {
        ...registration,
        relatedEmissionTestIds: Array.from(new Set([
          ...(registration.relatedEmissionTestIds || []),
          record.id,
        ])),
      }
    : registration)
}
