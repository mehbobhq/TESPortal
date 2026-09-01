import { compareExactIdentifier, comparePersonIdentity, type DuplicateFinding } from "@/lib/duplicate-detection"
import { normalizeName } from "@/lib/identifier-normalization"
import { getJurisdictionLabel, resolveCountryForJurisdiction } from "@/lib/jurisdictions"

export const DRIVER_MASTER_STORAGE_KEY = "tes_driver_masters_v1"
export const companyDriverStorageKey = (companyId: string) => `tes_company_drivers_${companyId}`

export type RecordType = "Employee" | "Owner-Operator" | "Contractor" | "Temporary Driver"
export type OperatingRegion = "Canada" | "United States" | "Cross-Border"
export type DriverRole = "Driver" | "Driver / Trainer" | "Trainer" | "Safety Manager" | "General Manager" | "Owner" | "Other"
export type DriverStatus = "Active" | "On Leave" | "Suspended" | "Inactive" | "Terminated"
export type EmploymentStatus = "Employed" | "Self-Employed" | "Contractor" | "On Leave" | "Inactive" | "Terminated"

export type EffectiveRecord = {
  id: string
  effectiveFrom: string
  effectiveTo: string | null
  status: "Current" | "Historical"
  source: string
  createdAt: string
}

export type LicenceRecord = EffectiveRecord & {
  licenceNumber: string
  jurisdiction: string
  country: "Canada" | "United States"
  class?: string
}

export type AddressRecord = EffectiveRecord & {
  addressLine1: string
  addressLine2?: string
  city: string
  stateProvince: string
  postalZip: string
  country: "Canada" | "United States"
}

export type RoleHistory = EffectiveRecord & { role: DriverRole }
export type StatusHistory = EffectiveRecord & { statusValue: DriverStatus; reason?: string }

export type IdentityReference = {
  id: string
  type: "DRIVER_LICENCE" | "OTHER"
  value: string
  jurisdiction?: string
  country?: "Canada" | "United States"
  createdAt: string
  source: string
}

export type JurisdictionReview = {
  id: string
  status: "OPEN" | "RESOLVED"
  reason: string
  explanation: string
  expectedResolutionDate?: string
  createdAt: string
  resolvedAt?: string
}

export type IdentitySourceReview = {
  id: string
  domain: "LEGAL_IDENTITY" | "ADDRESS" | "DRIVER_LICENCE"
  suppliedValue: string
  existingValue: string
  source: string
  createdAt: string
  status: "OPEN" | "RESOLVED"
  resolvedAt?: string
}

export type DriverMaster = {
  id: string
  createdAt: string
  updatedAt: string
  identity: {
    legalFirstName: string
    legalMiddleName?: string
    legalLastName: string
    preferredName?: string
    dateOfBirth: string
  }
  identityReferences: IdentityReference[]
  licenceHistory: LicenceRecord[]
  addressHistory: AddressRecord[]
  identityResolution: {
    status: "UNREVIEWED" | "CLEAR" | "REVIEW"
    matchedDriverMasterId?: string
    confidence?: "HIGH" | "MEDIUM" | "LOW"
    notes?: string
  }
  jurisdictionReviews: JurisdictionReview[]
  identitySourceReviews?: IdentitySourceReview[]
  archive: {
    isArchived: boolean
    archivedAt?: string
    archiveReason?: string
  }
}

export type CompanyDriverRelationship = {
  id: string
  companyId: string
  driverMasterId: string
  recordType: RecordType
  operatingRegion: OperatingRegion
  currentRole: DriverRole
  driverStatus: DriverStatus
  employmentStatus: EmploymentStatus
  startDate: string
  endDate?: string
  roleHistory: RoleHistory[]
  statusHistory: StatusHistory[]
  createdAt: string
  updatedAt: string
  archive: {
    isArchived: boolean
    archivedAt?: string
    archiveReason?: string
  }
}

export type DriverMasterStore = { version: 1; drivers: DriverMaster[] }
export type CompanyDriverStore = { version: 1; companyId: string; relationships: CompanyDriverRelationship[] }

export type DriverInput = {
  legalFirstName: string
  legalMiddleName: string
  legalLastName: string
  preferredName: string
  dateOfBirth: string
  recordType: RecordType
  operatingRegion: OperatingRegion
  currentRole: DriverRole
  driverStatus: DriverStatus
  employmentStatus: EmploymentStatus
  relationshipStartDate: string
  relationshipEndDate: string
  addressLine1: string
  addressLine2: string
  city: string
  stateProvince: string
  postalZip: string
  country: "Canada" | "United States"
  addressEffectiveFrom: string
  licenceNumber: string
  licenceJurisdiction: string
  licenceCountry: "Canada" | "United States"
  licenceClass: string
  licenceEffectiveFrom: string
  jurisdictionReview?: {
    reason: string
    explanation: string
    expectedResolutionDate: string
  }
}

export type DriverMatch =
  | { kind: "CLEAR"; driver: DriverMaster; finding: DuplicateFinding }
  | { kind: "AMBIGUOUS"; drivers: DriverMaster[]; findings: DuplicateFinding[] }
  | { kind: "NONE" }

export type DriverCreationOptions = {
  confirmedDriverMasterId?: string
}

const read = <T>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback

  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const write = <T>(key: string, value: T) => {
  if (typeof window === "undefined") {
    throw new Error("Driver persistence requires a browser context.")
  }

  localStorage.setItem(key, JSON.stringify(value))
}

const normalizeMaster = (driver: DriverMaster): DriverMaster => ({
  ...driver,
  identityReferences: Array.isArray(driver.identityReferences) ? driver.identityReferences : [],
  licenceHistory: Array.isArray(driver.licenceHistory) ? driver.licenceHistory : [],
  addressHistory: Array.isArray(driver.addressHistory) ? driver.addressHistory : [],
  jurisdictionReviews: Array.isArray(driver.jurisdictionReviews) ? driver.jurisdictionReviews : [],
  identitySourceReviews: Array.isArray(driver.identitySourceReviews) ? driver.identitySourceReviews : [],
  identityResolution: driver.identityResolution ?? { status: "UNREVIEWED" },
  archive: driver.archive ?? { isArchived: false },
})

const normalizeRelationship = (
  relationship: CompanyDriverRelationship,
  companyId: string,
): CompanyDriverRelationship => ({
  ...relationship,
  companyId: relationship.companyId || companyId,
  roleHistory: Array.isArray(relationship.roleHistory) ? relationship.roleHistory : [],
  statusHistory: Array.isArray(relationship.statusHistory) ? relationship.statusHistory : [],
  archive: relationship.archive ?? { isArchived: false },
})

export const loadDriverMasterStore = (): DriverMasterStore => {
  const raw = read<unknown>(DRIVER_MASTER_STORAGE_KEY, null)

  if (Array.isArray(raw)) {
    return { version: 1, drivers: raw.map((driver) => normalizeMaster(driver as DriverMaster)) }
  }

  if (raw && typeof raw === "object") {
    const drivers = Array.isArray((raw as { drivers?: unknown }).drivers)
      ? ((raw as { drivers: DriverMaster[] }).drivers ?? [])
      : []
    return { version: 1, drivers: drivers.map(normalizeMaster) }
  }

  return { version: 1, drivers: [] }
}

export const saveDriverMasterStore = (store: DriverMasterStore) =>
  write(DRIVER_MASTER_STORAGE_KEY, store)

export const loadCompanyDriverStore = (companyId: string): CompanyDriverStore => {
  const raw = read<unknown>(companyDriverStorageKey(companyId), null)

  if (Array.isArray(raw)) {
    return {
      version: 1,
      companyId,
      relationships: raw.map((relationship) =>
        normalizeRelationship(relationship as CompanyDriverRelationship, companyId),
      ),
    }
  }

  if (raw && typeof raw === "object") {
    const relationships = Array.isArray((raw as { relationships?: unknown }).relationships)
      ? ((raw as { relationships: CompanyDriverRelationship[] }).relationships ?? [])
      : []
    return {
      version: 1,
      companyId,
      relationships: relationships.map((relationship) =>
        normalizeRelationship(relationship, companyId),
      ),
    }
  }

  return { version: 1, companyId, relationships: [] }
}

export const saveCompanyDriverStore = (store: CompanyDriverStore) =>
  write(companyDriverStorageKey(store.companyId), store)

export const readCompanies = () =>
  read<any[]>("tes_companies", [])
    .filter((company) => company && company.id)
    .map((company) => ({
      id: String(company.id),
      name: String(company.name || company.companyName || ""),
      status: company.status,
    }))

export const getCompany = (id: string) => readCompanies().find((company) => company.id === id) || null

const createId = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export const allocateDriverMasterId = (drivers: DriverMaster[]) => {
  const used = new Set(
    drivers
      .map((driver) => driver.id.match(/^DRV-(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number),
  )

  let number = 1
  while (used.has(number)) number += 1
  return `DRV-${String(number).padStart(6, "0")}`
}

export const fullLegalName = (driver: DriverMaster) =>
  [
    driver.identity.legalFirstName,
    driver.identity.legalMiddleName,
    driver.identity.legalLastName,
  ]
    .filter(Boolean)
    .join(" ")

export const currentLicence = (driver: DriverMaster) =>
  [...driver.licenceHistory]
    .filter((record) => !record.effectiveTo)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

export const currentAddress = (driver: DriverMaster) =>
  [...driver.addressHistory]
    .filter((record) => !record.effectiveTo)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

export const calculateAge = (dob: string, today = new Date()) => {
  const date = new Date(`${dob}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null

  let age = today.getFullYear() - date.getFullYear()
  const month = today.getMonth() - date.getMonth()
  if (month < 0 || (month === 0 && today.getDate() < date.getDate())) age -= 1

  return age >= 0 ? age : null
}

const normalizeIdentifier = (value: string) =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")

const normalizePerson = (value: string) => normalizeName(value).toLowerCase()

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const allowedRecordTypes: readonly RecordType[] = [
  "Employee",
  "Owner-Operator",
  "Contractor",
  "Temporary Driver",
]

const allowedRegions: readonly OperatingRegion[] = ["Canada", "United States", "Cross-Border"]
const allowedRoles: readonly DriverRole[] = [
  "Driver",
  "Driver / Trainer",
  "Trainer",
  "Safety Manager",
  "General Manager",
  "Owner",
  "Other",
]
const allowedStatuses: readonly DriverStatus[] = [
  "Active",
  "On Leave",
  "Suspended",
  "Inactive",
  "Terminated",
]
const allowedEmploymentStatuses: readonly EmploymentStatus[] = [
  "Employed",
  "Self-Employed",
  "Contractor",
  "On Leave",
  "Inactive",
  "Terminated",
]

const jurisdictionCountry = (code: string) => resolveCountryForJurisdiction(code)

const validateDateField = (label: string, value: string) => {
  if (!value.trim()) throw new Error(`${label} is required.`)
  if (!isValidDate(value)) throw new Error(`${label} must be a valid date.`)
}

export function validateDriverInput(input: DriverInput) {
  const required: Array<[string, string]> = [
    ["Legal First Name", input.legalFirstName],
    ["Legal Last Name", input.legalLastName],
    ["Date of Birth", input.dateOfBirth],
    ["Record Type", input.recordType],
    ["Operating Region", input.operatingRegion],
    ["Current Role", input.currentRole],
    ["Driver Status", input.driverStatus],
    ["Employment Status", input.employmentStatus],
    ["Relationship Start Date", input.relationshipStartDate],
    ["Address", input.addressLine1],
    ["City", input.city],
    ["State / Province", input.stateProvince],
    ["Postal / ZIP", input.postalZip],
    ["Country", input.country],
    ["Address Effective From", input.addressEffectiveFrom],
    ["Licence Number", input.licenceNumber],
    ["Licence State / Province", input.licenceJurisdiction],
    ["Licence Country", input.licenceCountry],
    ["Licence Effective From", input.licenceEffectiveFrom],
  ]

  const missing = required.filter(([, value]) => !String(value || "").trim()).map(([label]) => label)
  if (missing.length) throw new Error(`Please complete: ${missing.join(", ")}.`)

  if (!allowedRecordTypes.includes(input.recordType)) throw new Error("Invalid Record Type.")
  if (!allowedRegions.includes(input.operatingRegion)) throw new Error("Invalid Operating Region.")
  if (!allowedRoles.includes(input.currentRole)) throw new Error("Invalid Current Role.")
  if (!allowedStatuses.includes(input.driverStatus)) throw new Error("Invalid Driver Status.")
  if (!allowedEmploymentStatuses.includes(input.employmentStatus)) {
    throw new Error("Invalid Employment Status.")
  }

  validateDateField("Date of Birth", input.dateOfBirth)
  validateDateField("Relationship Start Date", input.relationshipStartDate)
  validateDateField("Address Effective From", input.addressEffectiveFrom)
  validateDateField("Licence Effective From", input.licenceEffectiveFrom)

  if (input.dateOfBirth > todayIso()) throw new Error("Date of Birth cannot be in the future.")
  if (input.relationshipEndDate && !isValidDate(input.relationshipEndDate)) {
    throw new Error("End Date must be a valid date.")
  }
  if (input.relationshipEndDate && input.relationshipEndDate < input.relationshipStartDate) {
    throw new Error("End Date cannot be before Start Date.")
  }

  const residenceCountry = jurisdictionCountry(input.stateProvince)
  if (residenceCountry && residenceCountry !== input.country) {
    throw new Error(
      `Residential jurisdiction ${getJurisdictionLabel(input.stateProvince)} does not match the selected country.`,
    )
  }

  const licenceCountry = jurisdictionCountry(input.licenceJurisdiction)
  if (licenceCountry && licenceCountry !== input.licenceCountry) {
    throw new Error(
      `Licence jurisdiction ${getJurisdictionLabel(input.licenceJurisdiction)} does not match the selected country.`,
    )
  }

  if (
    input.stateProvince.trim().toUpperCase() !== input.licenceJurisdiction.trim().toUpperCase() &&
    (!input.jurisdictionReview?.reason || !input.jurisdictionReview.explanation.trim())
  ) {
    throw new Error(
      "Residence and licence jurisdictions differ. A reason and explanation are required before saving.",
    )
  }
}

const driverIdentityForDuplicate = (input: DriverInput) => ({
  name: [input.legalFirstName, input.legalMiddleName, input.legalLastName].filter(Boolean).join(" "),
  dob: input.dateOfBirth,
  licenseNumber: normalizeIdentifier(input.licenceNumber),
})

const driverCandidateIdentity = (driver: DriverMaster) => ({
  id: driver.id,
  label: fullLegalName(driver),
  name: fullLegalName(driver),
  dob: driver.identity.dateOfBirth,
  licenseNumber: currentLicence(driver)?.licenceNumber,
})

export function findDriverDuplicate(input: DriverInput, drivers: DriverMaster[]): DriverMatch {
  const target = driverIdentityForDuplicate(input)
  const clear: Array<{ driver: DriverMaster; finding: DuplicateFinding }> = []
  const possible: Array<{ driver: DriverMaster; finding: DuplicateFinding }> = []

  for (const driver of drivers) {
    // Archived Driver Masters remain part of permanent identity resolution.
    const exactLicence = driver.licenceHistory.some(
      (record) =>
        normalizeIdentifier(record.licenceNumber) === normalizeIdentifier(input.licenceNumber) &&
        record.jurisdiction.trim().toUpperCase() === input.licenceJurisdiction.trim().toUpperCase() &&
        record.country === input.licenceCountry,
    )

    if (exactLicence) {
      const finding =
        compareExactIdentifier(
          normalizeIdentifier(input.licenceNumber),
          normalizeIdentifier(currentLicence(driver)?.licenceNumber || ""),
          "Driver License",
          driver.id,
          fullLegalName(driver),
        ) ||
        ({
          classification: "ExactIdentifierConflict",
          matchedField: "Driver License + Jurisdiction + Country",
          matchedValue: normalizeIdentifier(input.licenceNumber),
          conflictEntityId: driver.id,
          conflictEntityLabel: fullLegalName(driver),
          confidenceScore: 100,
          notes: "Historical/current driver licence identity match.",
        } satisfies DuplicateFinding)
      clear.push({ driver, finding })
      continue
    }

    const finding = comparePersonIdentity(target, driverCandidateIdentity(driver))
    if (!finding) continue

    if (finding.classification === "StrongIdentityMatch") {
      clear.push({ driver, finding })
    } else {
      possible.push({ driver, finding })
    }
  }

  if (clear.length === 1) {
    return { kind: "CLEAR", driver: clear[0].driver, finding: clear[0].finding }
  }

  if (clear.length > 1) {
    return {
      kind: "AMBIGUOUS",
      drivers: clear.map((item) => item.driver),
      findings: clear.map((item) => item.finding),
    }
  }

  const uniquePossible = possible.filter(
    (item, index, list) => list.findIndex((candidate) => candidate.driver.id === item.driver.id) === index,
  )

  if (uniquePossible.length) {
    return {
      kind: "AMBIGUOUS",
      drivers: uniquePossible.map((item) => item.driver),
      findings: uniquePossible.map((item) => item.finding),
    }
  }

  return { kind: "NONE" }
}

const minusOne = (value: string) => {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

const closeOpen = <T extends { effectiveFrom: string; effectiveTo: string | null; status: "Current" | "Historical" }>(
  records: T[],
  from: string,
) => {
  const current = records.filter((record) => !record.effectiveTo)

  if (current.length === 0) return records

  if (current.some((record) => record.effectiveFrom >= from)) {
    throw new Error(
      "The effective date must be after the current record effective date. Use a correction workflow for an earlier historical correction.",
    )
  }

  return records.map((record) =>
    !record.effectiveTo
      ? { ...record, effectiveTo: minusOne(from), status: "Historical" }
      : record,
  )
}

const ensureSingleCurrent = <T extends { effectiveFrom: string; effectiveTo: string | null; status: "Current" | "Historical" }>(
  records: T[],
  label: string,
) => {
  const current = records.filter((record) => !record.effectiveTo)
  if (current.length > 1) throw new Error(`${label} contains overlapping current records.`)
  return records
}

const addressSignature = (record: AddressRecord) =>
  [
    record.addressLine1,
    record.addressLine2 || "",
    record.city,
    record.stateProvince,
    record.postalZip,
    record.country,
  ]
    .map((value) => value.trim().toUpperCase())
    .join("|")

const normalizeDateForLegacy = (value: string | undefined, fallback: string) =>
  value && isValidDate(value) ? value : fallback

const sourceReviewForConflict = (
  domain: IdentitySourceReview["domain"],
  suppliedValue: string,
  existingValue: string,
  createdAt: string,
): IdentitySourceReview => ({
  id: createId("REV"),
  domain,
  suppliedValue,
  existingValue,
  source: "Driver Profile",
  createdAt,
  status: "OPEN",
})

const calculateIdentityResolutionStatus = (driver: DriverMaster) => {
  const hasOpenSourceReview = (driver.identitySourceReviews || []).some((review) => review.status === "OPEN")
  const hasOpenJurisdictionReview = driver.jurisdictionReviews.some((review) => review.status === "OPEN")
  return hasOpenSourceReview || hasOpenJurisdictionReview ? "REVIEW" : "CLEAR"
}

const buildConflictReviews = (
  existing: DriverMaster,
  input: DriverInput,
  now: string,
): IdentitySourceReview[] => {
  const reviews: IdentitySourceReview[] = []
  const suppliedName = [input.legalFirstName, input.legalMiddleName, input.legalLastName]
    .filter(Boolean)
    .map(normalizeName)
    .join(" ")
  const existingName = fullLegalName(existing)

  if (normalizePerson(suppliedName) !== normalizePerson(existingName) || input.dateOfBirth !== existing.identity.dateOfBirth) {
    reviews.push(
      sourceReviewForConflict(
        "LEGAL_IDENTITY",
        `${suppliedName} | DOB ${input.dateOfBirth}`,
        `${existingName} | DOB ${existing.identity.dateOfBirth}`,
        now,
      ),
    )
  }

  const existingAddress = currentAddress(existing)
  const suppliedAddress = [
    input.addressLine1,
    input.addressLine2,
    input.city,
    input.stateProvince,
    input.postalZip,
    input.country,
  ]
    .filter(Boolean)
    .join(", ")
  if (!existingAddress) {
    reviews.push(
      sourceReviewForConflict(
        "ADDRESS",
        suppliedAddress,
        "No current address on Driver Master",
        now,
      ),
    )
  } else if (addressSignature(existingAddress) !== addressSignature({
    id: "SOURCE",
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 || undefined,
    city: input.city,
    stateProvince: input.stateProvince,
    postalZip: input.postalZip,
    country: input.country,
    effectiveFrom: input.addressEffectiveFrom,
    effectiveTo: null,
    status: "Current",
    source: "Driver Profile",
    createdAt: now,
  })) {
    reviews.push(
      sourceReviewForConflict(
        "ADDRESS",
        suppliedAddress,
        `${existingAddress.addressLine1}, ${existingAddress.city}, ${existingAddress.stateProvince} ${existingAddress.postalZip}, ${existingAddress.country}`,
        now,
      ),
    )
  }

  const existingLicence = currentLicence(existing)
  if (!existingLicence) {
    reviews.push(
      sourceReviewForConflict(
        "DRIVER_LICENCE",
        `${normalizeIdentifier(input.licenceNumber)} | ${input.licenceJurisdiction} | ${input.licenceCountry}`,
        "No current licence on Driver Master",
        now,
      ),
    )
  } else if (
    normalizeIdentifier(existingLicence.licenceNumber) !== normalizeIdentifier(input.licenceNumber) ||
    existingLicence.jurisdiction.trim().toUpperCase() !== input.licenceJurisdiction.trim().toUpperCase() ||
    existingLicence.country !== input.licenceCountry
  ) {
    reviews.push(
      sourceReviewForConflict(
        "DRIVER_LICENCE",
        `${normalizeIdentifier(input.licenceNumber)} | ${input.licenceJurisdiction} | ${input.licenceCountry}`,
        `${normalizeIdentifier(existingLicence.licenceNumber)} | ${existingLicence.jurisdiction} | ${existingLicence.country}`,
        now,
      ),
    )
  }

  return reviews
}

export function createDriver(
  companyId: string,
  input: DriverInput,
  options: DriverCreationOptions = {},
) {
  validateDriverInput(input)

  const beforeMaster = loadDriverMasterStore()
  const beforeCompany = loadCompanyDriverStore(companyId)
  const match = findDriverDuplicate(input, beforeMaster.drivers)

  if (match.kind === "AMBIGUOUS") {
    throw new Error(
      `Possible existing Driver match: ${match.drivers
        .map((driver) => `${fullLegalName(driver)} (${driver.id})`)
        .join(", ")}. Human review is required before creating or linking a Driver.`,
    )
  }

  if (match.kind === "CLEAR" && options.confirmedDriverMasterId !== match.driver.id) {
    throw new Error(`Existing Driver Master ${match.driver.id} requires explicit operator confirmation before linking.`)
  }

  const now = new Date().toISOString()
  const master: DriverMaster =
    match.kind === "CLEAR"
      ? (() => {
          const conflictReviews = buildConflictReviews(match.driver, input, now)
          const identitySourceReviews = [
            ...(match.driver.identitySourceReviews || []),
            ...conflictReviews,
          ]
          const candidate = {
            ...match.driver,
            identitySourceReviews,
            identityResolution: {
              ...match.driver.identityResolution,
              matchedDriverMasterId: match.driver.id,
              status: "CLEAR" as const,
            },
            updatedAt: now,
          }
          return {
            ...candidate,
            identityResolution: {
              ...candidate.identityResolution,
              status: calculateIdentityResolutionStatus(candidate),
            },
          }
        })()
      : {
          id: allocateDriverMasterId(beforeMaster.drivers),
          createdAt: now,
          updatedAt: now,
          identity: {
            legalFirstName: normalizeName(input.legalFirstName),
            legalMiddleName: normalizeName(input.legalMiddleName) || undefined,
            legalLastName: normalizeName(input.legalLastName),
            preferredName: normalizeName(input.preferredName) || undefined,
            dateOfBirth: input.dateOfBirth,
          },
          identityReferences: [
            {
              id: createId("IDR"),
              type: "DRIVER_LICENCE",
              value: normalizeIdentifier(input.licenceNumber),
              jurisdiction: input.licenceJurisdiction,
              country: input.licenceCountry,
              createdAt: now,
              source: "Driver Profile",
            },
          ],
          licenceHistory: [
            {
              id: createId("LIC"),
              licenceNumber: normalizeIdentifier(input.licenceNumber),
              jurisdiction: input.licenceJurisdiction,
              country: input.licenceCountry,
              class: normalizeName(input.licenceClass) || undefined,
              effectiveFrom: input.licenceEffectiveFrom,
              effectiveTo: null,
              status: "Current",
              source: "Driver Profile",
              createdAt: now,
            },
          ],
          addressHistory: [
            {
              id: createId("ADR"),
              addressLine1: normalizeName(input.addressLine1),
              addressLine2: normalizeName(input.addressLine2) || undefined,
              city: normalizeName(input.city),
              stateProvince: input.stateProvince.trim().toUpperCase(),
              postalZip: input.postalZip.trim(),
              country: input.country,
              effectiveFrom: input.addressEffectiveFrom,
              effectiveTo: null,
              status: "Current",
              source: "Driver Profile",
              createdAt: now,
            },
          ],
          identityResolution: {
            status: input.stateProvince.trim().toUpperCase() === input.licenceJurisdiction.trim().toUpperCase() ? "CLEAR" : "REVIEW",
          },
          jurisdictionReviews:
            input.stateProvince.trim().toUpperCase() !== input.licenceJurisdiction.trim().toUpperCase()
              ? [
                  {
                    id: createId("JUR"),
                    status: "OPEN",
                    reason: input.jurisdictionReview?.reason || "Other",
                    explanation: input.jurisdictionReview?.explanation || "",
                    expectedResolutionDate: input.jurisdictionReview?.expectedResolutionDate || undefined,
                    createdAt: now,
                  },
                ]
              : [],
          identitySourceReviews: [],
          archive: { isArchived: false },
        }

  if (beforeCompany.relationships.some((relationship) => relationship.driverMasterId === master.id && !relationship.archive.isArchived)) {
    throw new Error(`Driver ${master.id} already has an active relationship with this company.`)
  }

  const relationship: CompanyDriverRelationship = {
    id: createId("CDR"),
    companyId,
    driverMasterId: master.id,
    recordType: input.recordType,
    operatingRegion: input.operatingRegion,
    currentRole: input.currentRole,
    driverStatus: input.driverStatus,
    employmentStatus: input.employmentStatus,
    startDate: input.relationshipStartDate,
    endDate: input.relationshipEndDate || undefined,
    roleHistory: [
      {
        id: createId("ROLE"),
        role: input.currentRole,
        effectiveFrom: input.relationshipStartDate,
        effectiveTo: null,
        status: "Current",
        source: "Driver Profile",
        createdAt: now,
      },
    ],
    statusHistory: [
      {
        id: createId("STA"),
        statusValue: input.driverStatus,
        effectiveFrom: input.relationshipStartDate,
        effectiveTo: null,
        status: "Current",
        reason: "Initial Driver relationship",
        source: "Driver Profile",
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
    archive: { isArchived: false },
  }

  const nextMaster: DriverMasterStore = {
    version: 1,
    drivers:
      match.kind === "CLEAR"
        ? beforeMaster.drivers.map((driver) => (driver.id === master.id ? master : driver))
        : [...beforeMaster.drivers, master],
  }
  const nextCompany: CompanyDriverStore = {
    version: 1,
    companyId,
    relationships: [...beforeCompany.relationships, relationship],
  }

  try {
    saveDriverMasterStore(nextMaster)
    try {
      saveCompanyDriverStore(nextCompany)
    } catch (error) {
      saveDriverMasterStore(beforeMaster)
      throw error
    }
  } catch (error) {
    try {
      saveDriverMasterStore(beforeMaster)
    } catch {}
    try {
      saveCompanyDriverStore(beforeCompany)
    } catch {}
    throw error instanceof Error ? error : new Error("Unable to persist Driver.")
  }

  return {
    master,
    relationship,
    matchedExisting: match.kind === "CLEAR",
    matchFinding: match.kind === "CLEAR" ? match.finding : undefined,
  }
}

export function validateMasterIdentityPatch(patch: Partial<DriverMaster["identity"]>, current: DriverMaster["identity"]) {
  const next = { ...current, ...patch }

  if (!next.legalFirstName.trim()) throw new Error("Legal First Name is required.")
  if (!next.legalLastName.trim()) throw new Error("Legal Last Name is required.")
  if (!next.dateOfBirth.trim()) throw new Error("Date of Birth is required.")
  validateDateField("Date of Birth", next.dateOfBirth)
  if (next.dateOfBirth > todayIso()) throw new Error("Date of Birth cannot be in the future.")
}

export function validateRelationshipPatch(
  patch: Partial<Pick<CompanyDriverRelationship, "recordType" | "operatingRegion" | "currentRole" | "driverStatus" | "employmentStatus" | "startDate" | "endDate">>,
  current: CompanyDriverRelationship,
) {
  const next = { ...current, ...patch }

  if (!next.startDate.trim()) throw new Error("Relationship Start Date is required.")
  validateDateField("Relationship Start Date", next.startDate)
  if (next.endDate) {
    validateDateField("End Date", next.endDate)
    if (next.endDate < next.startDate) throw new Error("End Date cannot be before Start Date.")
  }
  if (!allowedRecordTypes.includes(next.recordType)) throw new Error("Invalid Record Type.")
  if (!allowedRegions.includes(next.operatingRegion)) throw new Error("Invalid Operating Region.")
  if (!allowedRoles.includes(next.currentRole)) throw new Error("Invalid Current Role.")
  if (!allowedStatuses.includes(next.driverStatus)) throw new Error("Invalid Driver Status.")
  if (!allowedEmploymentStatuses.includes(next.employmentStatus)) throw new Error("Invalid Employment Status.")
}

export function updateMaster(driverId: string, patch: Partial<DriverMaster["identity"]>) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((item) => item.id === driverId)
  if (!driver) throw new Error("Driver not found.")

  validateMasterIdentityPatch(patch, driver.identity)

  const now = new Date().toISOString()
  const updated: DriverMaster = {
    ...driver,
    identity: {
      ...driver.identity,
      ...patch,
      legalFirstName: normalizeName(patch.legalFirstName ?? driver.identity.legalFirstName),
      legalMiddleName: normalizeName(patch.legalMiddleName ?? driver.identity.legalMiddleName ?? "") || undefined,
      legalLastName: normalizeName(patch.legalLastName ?? driver.identity.legalLastName),
      preferredName: normalizeName(patch.preferredName ?? driver.identity.preferredName ?? "") || undefined,
    },
    updatedAt: now,
  }

  saveDriverMasterStore({
    version: 1,
    drivers: store.drivers.map((item) => (item.id === driverId ? updated : item)),
  })

  return updated
}

export function updateRelationship(
  companyId: string,
  driverId: string,
  patch: Partial<Pick<CompanyDriverRelationship, "recordType" | "operatingRegion" | "currentRole" | "driverStatus" | "employmentStatus" | "startDate" | "endDate">>,
) {
  const store = loadCompanyDriverStore(companyId)
  const relationship = store.relationships.find(
    (item) => item.driverMasterId === driverId && !item.archive.isArchived,
  )
  if (!relationship) throw new Error("Driver relationship not found.")

  validateRelationshipPatch(patch, relationship)

  const now = new Date().toISOString()
  const effectiveFrom = patch.startDate || relationship.startDate
  let updated: CompanyDriverRelationship = {
    ...relationship,
    ...patch,
    updatedAt: now,
  }

  if (patch.currentRole && patch.currentRole !== relationship.currentRole) {
    updated.roleHistory = [
      ...closeOpen(relationship.roleHistory, effectiveFrom),
      {
        id: createId("ROLE"),
        role: patch.currentRole,
        effectiveFrom,
        effectiveTo: null,
        status: "Current",
        source: "Driver Profile",
        createdAt: now,
      },
    ]
  }

  if (patch.driverStatus && patch.driverStatus !== relationship.driverStatus) {
    updated.statusHistory = [
      ...closeOpen(relationship.statusHistory, effectiveFrom),
      {
        id: createId("STA"),
        statusValue: patch.driverStatus,
        effectiveFrom,
        effectiveTo: null,
        status: "Current",
        reason: "Driver status changed",
        source: "Driver Profile",
        createdAt: now,
      },
    ]
  }

  ensureSingleCurrent(updated.roleHistory, "Role history")
  ensureSingleCurrent(updated.statusHistory, "Status history")

  saveCompanyDriverStore({
    version: 1,
    companyId,
    relationships: store.relationships.map((item) => (item.id === relationship.id ? updated : item)),
  })

  return updated
}

export function updateAddress(
  driverId: string,
  input: Omit<AddressRecord, "id" | "createdAt" | "effectiveTo" | "status" | "source">,
) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((item) => item.id === driverId)
  if (!driver) throw new Error("Driver not found.")

  if (!input.addressLine1.trim()) throw new Error("Address Line 1 is required.")
  if (!input.city.trim()) throw new Error("City is required.")
  if (!input.stateProvince.trim()) throw new Error("State / Province is required.")
  if (!input.postalZip.trim()) throw new Error("Postal / ZIP is required.")
  if (!input.country.trim()) throw new Error("Country is required.")
  validateDateField("Address Effective From", input.effectiveFrom)

  const residenceCountry = resolveCountryForJurisdiction(input.stateProvince)
  if (residenceCountry && residenceCountry !== input.country) {
    throw new Error(
      `Residential jurisdiction ${getJurisdictionLabel(input.stateProvince)} does not match the selected country.`,
    )
  }

  const existing = currentAddress(driver)
  const candidate: AddressRecord = {
    ...input,
    id: createId("ADR"),
    addressLine1: normalizeName(input.addressLine1),
    addressLine2: normalizeName(input.addressLine2 || "") || undefined,
    city: normalizeName(input.city),
    stateProvince: input.stateProvince.trim().toUpperCase(),
    postalZip: input.postalZip.trim(),
    effectiveTo: null,
    status: "Current",
    source: "Driver Profile",
    createdAt: new Date().toISOString(),
  }

  if (existing && addressSignature(existing) === addressSignature(candidate)) {
    return existing
  }

  const addressHistory = existing
    ? [...closeOpen(driver.addressHistory, input.effectiveFrom), candidate]
    : [...driver.addressHistory, candidate]

  ensureSingleCurrent(addressHistory, "Address history")

  const updated: DriverMaster = {
    ...driver,
    addressHistory,
    updatedAt: new Date().toISOString(),
  }

  saveDriverMasterStore({
    version: 1,
    drivers: store.drivers.map((item) => (item.id === driverId ? updated : item)),
  })

  return candidate
}

export function updateJurisdictionReview(
  driverId: string,
  reviewId: string,
  patch: Pick<JurisdictionReview, "status"> & { resolvedAt?: string },
) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((item) => item.id === driverId)
  if (!driver) throw new Error("Driver not found.")

  const now = new Date().toISOString()
  const updatedReviews = driver.jurisdictionReviews.map((review) =>
    review.id === reviewId
      ? {
          ...review,
          status: patch.status,
          resolvedAt: patch.status === "RESOLVED" ? patch.resolvedAt || now : undefined,
        }
      : review,
  )

  const updated: DriverMaster = {
    ...driver,
    jurisdictionReviews: updatedReviews,
    identityResolution: {
      ...driver.identityResolution,
      status:
        updatedReviews.some((review) => review.status === "OPEN") ||
        (driver.identitySourceReviews || []).some((review) => review.status === "OPEN")
          ? "REVIEW"
          : "CLEAR",
    },
    updatedAt: now,
  }

  saveDriverMasterStore({
    version: 1,
    drivers: store.drivers.map((item) => (item.id === driverId ? updated : item)),
  })

  return updated
}

export function getOpenJurisdictionReview(driver: DriverMaster) {
  return driver.jurisdictionReviews.find((review) => review.status === "OPEN")
}

export function syncJurisdictionReviewForAddress(
  driverId: string,
  addressStateProvince: string,
  licenceJurisdiction: string | undefined,
  review?: DriverInput["jurisdictionReview"],
) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((item) => item.id === driverId)
  if (!driver) throw new Error("Driver not found.")

  const residence = addressStateProvince.trim().toUpperCase()
  const licence = licenceJurisdiction?.trim().toUpperCase() || ""
  const now = new Date().toISOString()
  const mismatch = Boolean(residence && licence && residence !== licence)
  let jurisdictionReviews = [...driver.jurisdictionReviews]

  if (mismatch) {
    const open = jurisdictionReviews.find((item) => item.status === "OPEN")
    if (open) {
      if (!review?.reason || !review.explanation.trim()) {
        throw new Error("Explain the open jurisdiction discrepancy before saving the address change.")
      }
      jurisdictionReviews = jurisdictionReviews.map((item) =>
        item.id === open.id
          ? {
              ...item,
              reason: review.reason,
              explanation: review.explanation,
              expectedResolutionDate: review.expectedResolutionDate || undefined,
            }
          : item,
      )
    } else {
      if (!review?.reason || !review.explanation.trim()) {
        throw new Error("Residence and licence jurisdictions differ. Record the discrepancy before saving.")
      }
      jurisdictionReviews.push({
        id: createId("JUR"),
        status: "OPEN",
        reason: review.reason,
        explanation: review.explanation,
        expectedResolutionDate: review.expectedResolutionDate || undefined,
        createdAt: now,
      })
    }
  } else {
    jurisdictionReviews = jurisdictionReviews.map((item) =>
      item.status === "OPEN"
        ? { ...item, status: "RESOLVED", resolvedAt: now }
        : item,
    )
  }

  const identityResolution = {
    ...driver.identityResolution,
    status:
      jurisdictionReviews.some((item) => item.status === "OPEN") ||
      (driver.identitySourceReviews || []).some((item) => item.status === "OPEN")
        ? "REVIEW"
        : "CLEAR",
  } as DriverMaster["identityResolution"]

  const updated = {
    ...driver,
    jurisdictionReviews,
    identityResolution,
    updatedAt: now,
  }

  saveDriverMasterStore({
    version: 1,
    drivers: store.drivers.map((item) => (item.id === driverId ? updated : item)),
  })

  return updated
}

export function captureDriverStoreSnapshot(companyId: string) {
  return {
    master: loadDriverMasterStore(),
    company: loadCompanyDriverStore(companyId),
  }
}

export function restoreDriverStoreSnapshot(snapshot: ReturnType<typeof captureDriverStoreSnapshot>) {
  saveDriverMasterStore(snapshot.master)
  saveCompanyDriverStore(snapshot.company)
}
