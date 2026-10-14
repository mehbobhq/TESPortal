/**
 * Canonical (PostgreSQL) driver records -> the shapes the original driver components expect, and back for the values that have a
 * canonical home. The mapping is honest: a field with no canonical home stays EMPTY (the original components render "—"), nothing
 * is invented, and nothing is defaulted into looking recorded.
 */
import type { CompanyDriverRelationship, DriverMaster, DriverStatus, LicenceRecord, OperatingRegion, RecordType, ScreeningRecord, StatusHistory } from "@/types/drivers"
import type { CanonicalDriverDetail } from "./canonical-client"

export const MEDICAL_QUALIFICATION_TYPE = "DOT_MEDICAL_CERTIFICATE"

type RelationshipRow = CanonicalDriverDetail["relationships"][number]
type CanonicalType = RelationshipRow["relationshipType"]
type CanonicalStatus = RelationshipRow["status"]

export const RECORD_TYPE_TO_UI: Record<CanonicalType, RecordType> = { EMPLOYEE: "Employee", CONTRACTOR: "Contractor", OWNER_OPERATOR: "Owner-Operator" }
export const RECORD_TYPE_FROM_UI: Partial<Record<RecordType, CanonicalType>> = { Employee: "EMPLOYEE", Contractor: "CONTRACTOR", "Owner-Operator": "OWNER_OPERATOR" }

/** ONBOARDING shows as "Onboarding" (a canonical status the original list lacked); ENDED shows as "Terminated". */
export const STATUS_TO_UI: Record<CanonicalStatus, DriverStatus> = { ONBOARDING: "Onboarding" as DriverStatus, ACTIVE: "Active", SUSPENDED: "Suspended", ENDED: "Terminated" }
export const STATUS_FROM_UI: Partial<Record<DriverStatus, CanonicalStatus>> = { ["Onboarding" as DriverStatus]: "ONBOARDING", Active: "ACTIVE", Suspended: "SUSPENDED", Terminated: "ENDED" }

const country = (value: string): LicenceRecord["country"] => (value === "United States" ? "United States" : "Canada")
const SOURCE = "TES canonical record"

export function currentRelationshipRow(detail: CanonicalDriverDetail): RelationshipRow | undefined {
  const genuine = detail.relationships.filter((row) => row.recordStatus === "active")
  return genuine.find((row) => row.effectiveTo === null) ?? genuine[genuine.length - 1]
}

export function toDriverMaster(detail: CanonicalDriverDetail): DriverMaster {
  const name = [...detail.names].reverse().find((row) => row.recordStatus === "active" && row.effectiveTo === null) ?? detail.names[detail.names.length - 1]
  const channel = (type: string) => {
    const row = [...detail.channels].reverse().find((item) => item.channelType === type && item.recordStatus === "active" && item.effectiveTo === null)
    return row ? `${row.value}${row.extension ? ` ext ${row.extension}` : ""}` : undefined
  }
  const created = detail.names[0]?.effectiveFrom ?? new Date(0).toISOString()
  const licenceHistory: LicenceRecord[] = detail.licences
    .filter((row) => row.recordStatus === "active")
    .map((row) => ({
      id: row.id,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      status: row.effectiveTo ? ("Historical" as const) : ("Current" as const),
      source: SOURCE,
      createdAt: row.effectiveFrom,
      licenceNumber: row.number,
      licenceNumberRaw: row.number,
      licenceNumberNormalized: row.number.toUpperCase().replace(/[^A-Z0-9]/g, ""),
      jurisdiction: row.jurisdictionRegion,
      country: country(row.jurisdictionCountry),
      class: row.licenceClass ?? undefined,
      issueDate: row.issueDate ?? undefined,
      expiryDate: row.expiryDate ?? undefined,
    }))
  return {
    id: detail.personId,
    driverMasterId: detail.personId,
    createdAt: created,
    updatedAt: created,
    identity: {
      legalFirstName: name?.givenName ?? "",
      legalLastName: name?.familyName ?? "",
      dateOfBirth: "",
      phone: channel("PHONE"),
      email: channel("EMAIL"),
    },
    identityReferences: [],
    licenceHistory,
    addressHistory: [],
    identityResolution: { status: "UNREVIEWED" },
    jurisdictionReviews: [],
    archive: { isArchived: detail.profileStatus === "archived" || detail.personStatus === "archived" },
  }
}

export function toRelationship(companyId: string, detail: CanonicalDriverDetail): CompanyDriverRelationship | null {
  const row = currentRelationshipRow(detail)
  if (!row) return null
  const statusHistory: StatusHistory[] = detail.relationships
    .filter((item) => item.recordStatus === "active")
    .map((item) => ({
      id: item.id,
      effectiveFrom: item.effectiveFrom,
      effectiveTo: item.effectiveTo,
      status: item.effectiveTo ? ("Historical" as const) : ("Current" as const),
      source: SOURCE,
      createdAt: item.effectiveFrom,
      statusValue: STATUS_TO_UI[item.status],
    }))
  return {
    id: row.id,
    companyDriverRecordId: row.driverNumber ?? row.id,
    companyId,
    driverMasterId: detail.personId,
    recordType: RECORD_TYPE_TO_UI[row.relationshipType],
    operatingRegion: "Not Established" as OperatingRegion,
    driverStatus: STATUS_TO_UI[row.status],
    startDate: row.effectiveFrom,
    endDate: row.effectiveTo ?? undefined,
    statusHistory,
    createdAt: row.effectiveFrom,
    updatedAt: row.effectiveFrom,
    archive: { isArchived: false },
  }
}

/** Canonical medical qualification periods shown as the original "Medical Card / DOT Physical" screening records. */
export function toMedicalScreenings(companyId: string, detail: CanonicalDriverDetail): ScreeningRecord[] {
  return detail.medicalPeriods
    .filter((row) => row.recordStatus === "active" && row.qualificationType === MEDICAL_QUALIFICATION_TYPE)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .map((row) => ({
      id: row.id,
      companyId,
      driverMasterId: detail.personId,
      category: "Medical Card / DOT Physical" as const,
      recordDate: row.issuedOn ?? row.effectiveFrom,
      expiryDate: row.expiresOn ?? undefined,
      status: row.effectiveTo ? ("Archived" as const) : ("Incomplete" as const),
      resultSummary: row.effectiveTo
        ? `Superseded on ${row.effectiveTo} by a later qualification period (canonical record).`
        : "Canonical medical qualification period: certificate dates only. Examiner, result and verification are not recorded.",
      providerOrAuthority: "Not recorded",
      medicalCardDetails: { certificateIssueDate: row.issuedOn ?? undefined, expiryDate: row.expiresOn ?? undefined },
      evidenceIds: [],
      isArchived: Boolean(row.effectiveTo),
      createdAt: row.effectiveFrom,
      updatedAt: row.effectiveFrom,
    }))
}

export const fullName = (row: { givenName: string | null; familyName: string | null }, fallback = "Unnamed driver") => [row.givenName, row.familyName].filter(Boolean).join(" ") || fallback
