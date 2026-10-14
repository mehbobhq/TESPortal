/**
 * Restored-UI replacement for `lib/driver-data` (the legacy browser store: tes_driver_masters_v1 / tes_company_drivers_<id>).
 *
 *  - PURE helpers the original components use (names, licences, age, hiring assessment) are copied here unchanged in behaviour.
 *  - Every MUTATOR of a record family with no canonical (PostgreSQL) domain refuses with CanonicalOperationUnavailableError naming the
 *    exact gap. Nothing is written anywhere and nothing pretends to be saved.
 *  - Mutators that DO have a canonical home (identity, relationship, licence, medical period) are in ./actions.ts and call the API.
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import { TRAINING_COURSE_CATALOG } from "@/lib/driver-taxonomy"
import type { CompanyDriverRelationship, DriverApplicationRecord, DriverMaster, HiringPackageRecord, ScreeningRecord, TrainingCourseDefinition } from "@/types/drivers"
import type { PerformanceEventWorkflowUpdate, RoadsideLinkedCitation } from "@/lib/driver-data"

export type { PerformanceEventWorkflowUpdate, RoadsideLinkedCitation }

// --- pure helpers ----------------------------------------------------------------------------------------------------------

const clean = (value: string) => value.replace(/\s+/g, " ").trim()
export const normalizeLicenceNumber = (value: string) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "")
export const fullLegalName = (d: DriverMaster) => [d.identity.legalFirstName, d.identity.legalMiddleName, d.identity.legalLastName].filter(Boolean).join(" ")
export const currentLicence = (d: DriverMaster) => [...d.licenceHistory].filter((x) => !x.effectiveTo).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
export const currentAddress = (d: DriverMaster) => [...d.addressHistory].filter((x) => !x.effectiveTo).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
export const calculateAge = (dob: string, today = new Date()) => {
  const d = new Date(`${dob}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  let age = today.getFullYear() - d.getFullYear()
  const m = today.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--
  return age >= 0 ? age : null
}
export const displayCompanyDriverRecordId = (_companyId: string, r: CompanyDriverRelationship) => r.companyDriverRecordId || r.id
export function getTrainingCourseCatalog(): TrainingCourseDefinition[] {
  return TRAINING_COURSE_CATALOG
}

/** The original hiring-file assessment, computed from the records passed in (none of which have a canonical store, so the file starts at "Send Application"). */
export function assessDriverHiringFile(
  companyId: string,
  driverMasterId: string,
  company: { [key: string]: any } | undefined,
  relationship: CompanyDriverRelationship | undefined,
  records: { applications: DriverApplicationRecord[]; hiringPackages: HiringPackageRecord[]; screenings: ScreeningRecord[] },
) {
  const applications = records.applications.filter((item) => item.driverMasterId === driverMasterId)
  const packages = records.hiringPackages.filter((item) => item.driverMasterId === driverMasterId)
  const screenings = records.screenings.filter((item) => item.driverMasterId === driverMasterId && !item.isArchived)
  const latestApplication = applications[0]
  const latestPackage = packages[0]
  const serviceStartDate = (company?.startDate as string | undefined) || undefined
  const employmentStartDate = relationship?.startDate || undefined
  const isInheritedDriver = Boolean(serviceStartDate && employmentStartDate && employmentStartDate < serviceStartDate)
  const applicationSatisfied = Boolean(latestApplication && (latestApplication.status === "Submitted" || latestApplication.status === "Under Review" || latestApplication.status === "Approved"))
  const referenceRecords = screenings.filter((item) => item.category === "Previous Employer Verification")
  const referenceSatisfied =
    referenceRecords.length > 0 &&
    referenceRecords.every(
      (item) =>
        item.status === "Passed" ||
        item.status === "Qualified" ||
        item.employerVerificationDetails?.verificationOutcome === "Verified as Claimed" ||
        item.employerVerificationDetails?.verificationOutcome === "No Record / Unable to Verify",
    )
  const packageRequiredItems = latestPackage?.items.filter((item) => item.required) || []
  const packageSatisfied = Boolean(latestPackage && (latestPackage.status === "Completed" || (packageRequiredItems.length > 0 && packageRequiredItems.every((item) => item.signed))))

  let nextAction: import("@/types/drivers").HiringWorkflowAction = "NONE"
  let nextActionLabel: string | undefined
  if (!latestApplication || latestApplication.status === "Invitation Ready") {
    nextAction = "SEND_APPLICATION"
    nextActionLabel = "Send Application"
  } else if (!applicationSatisfied) {
    nextAction = "CONTINUE_APPLICATION"
    nextActionLabel = "Application Pending"
  } else if (!referenceSatisfied) {
    nextAction = "COMPLETE_REFERENCE_CHECKS"
    nextActionLabel = "Complete Reference Checks"
  } else if (!packageSatisfied) {
    nextAction = "COMPLETE_HIRING_PACKAGE"
    nextActionLabel = "Complete Hiring Package"
  }
  const applicationStatus = !latestApplication ? "MISSING" : applicationSatisfied ? "SATISFIED" : "PENDING"
  const referenceCheckStatus = referenceSatisfied ? "SATISFIED" : applicationSatisfied ? "MISSING" : "PENDING"
  const hiringPackageStatus = packageSatisfied ? "SATISFIED" : referenceSatisfied ? "MISSING" : "PENDING"
  return {
    driverMasterId,
    companyId,
    tesServiceStartDate: serviceStartDate,
    employmentStartDate,
    isInheritedDriver,
    applicationStatus,
    referenceCheckStatus,
    hiringPackageStatus,
    nextAction,
    nextActionLabel,
    requirements: [
      { id: "HIRING_APPLICATION", label: "Driver hiring application", status: applicationStatus, evidenceIds: latestApplication?.evidenceIds || [] },
      { id: "REFERENCE_CHECKS", label: "Previous employer / reference checks", status: referenceCheckStatus, evidenceIds: referenceRecords.flatMap((item) => item.evidenceIds || []) },
      { id: "HIRING_PACKAGE", label: "Hiring / onboarding package", status: hiringPackageStatus, evidenceIds: latestPackage?.evidenceIds || [] },
    ],
    assessedAt: new Date().toISOString(),
  } satisfies import("@/types/drivers").DriverHiringFileAssessment
}

// --- unavailable mutators --------------------------------------------------------------------------------------------------

const NOT_CANONICAL = "the approved canonical schema (migrations 0014, 0021, 0022) holds a driver's person, name, licence, medical qualification period and Organization relationship only; this record family has no PostgreSQL table, so nothing was saved"

const refuse = (action: string, reason: string) => (..._args: unknown[]): never => {
  throw new CanonicalOperationUnavailableError(action, reason)
}

export const addDriverApplication = refuse("Creating a driver application", `driver applications have no canonical domain (${NOT_CANONICAL}); the invitation was not created and no email was sent`)
export const updateDriverApplication = refuse("Updating a driver application", `driver applications have no canonical domain (${NOT_CANONICAL})`)
export const updateDriverApplicationDetermination = refuse("Recording an application determination", `driver applications have no canonical domain (${NOT_CANONICAL})`)
export const queueDriverApplicationProcessing = refuse("Processing a driver application", `driver applications have no canonical domain (${NOT_CANONICAL})`)
export const addDriverApplicationFinding = refuse("Adding an application finding", `driver applications have no canonical domain (${NOT_CANONICAL})`)
export const resolveDriverApplicationFinding = refuse("Resolving an application finding", `driver applications have no canonical domain (${NOT_CANONICAL})`)
export const createReplacementDriverApplication: (...args: unknown[]) => { id?: string } = refuse("Creating a replacement application", `driver applications have no canonical domain (${NOT_CANONICAL})`)
export const addHiringPackage = refuse("Issuing a hiring package", `hiring packages have no canonical domain (${NOT_CANONICAL})`)
export const updateHiringPackageItem = refuse("Updating a hiring package item", `hiring packages have no canonical domain (${NOT_CANONICAL})`)
export const addDriverTaxDoc = refuse("Adding a tax / onboarding record", `driver tax records have no canonical domain (${NOT_CANONICAL})`)
export const addTrainingRecord = refuse("Adding a training record", `training has no canonical domain (${NOT_CANONICAL})`)
export const addTrainingRequirement = refuse("Adding a training requirement", `training has no canonical domain (${NOT_CANONICAL})`)
export const waiveTrainingRecord = refuse("Waiving a training requirement", `training has no canonical domain (${NOT_CANONICAL})`)
export const addManualPerformanceEvent = refuse("Recording a performance event", `driver performance events (roadside, collisions, cargo, spills, near misses, customer events) have no canonical domain (${NOT_CANONICAL})`)
export const updatePerformanceEventWorkflow = refuse("Updating a performance event", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const linkPerformanceEventDetermination = refuse("Linking a company determination", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const archivePerformanceEvent = refuse("Archiving a performance event", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const applyPerformanceEngineWrite = refuse("Saving a performance record", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const resolveNearMissUnsafeConditionForEvent = refuse("Resolving an unsafe condition", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const correctPerformanceEventFacts = refuse("Correcting performance event facts", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const recordRoadsideDriverStatement = refuse("Recording a roadside driver statement", `driver performance events have no canonical domain (${NOT_CANONICAL})`)
export const linkRoadsideInspectionCitation = refuse("Linking a citation to a roadside inspection", `citations have no canonical domain (${NOT_CANONICAL})`)
export const getRoadsideLinkedCitations = (_companyId: string, _event: unknown): RoadsideLinkedCitation[] => []
export const getLinkableCitationsForRoadside = (_companyId: string, _event: unknown): RoadsideLinkedCitation[] => []
export const addHOSReview = refuse("Adding an hours-of-service review", `hours of service has no canonical domain (${NOT_CANONICAL})`)
export const addCompanyAction = refuse("Recording a company action", `company actions have no canonical domain (${NOT_CANONICAL})`)
export const addCompanyDetermination = refuse("Recording a company determination", `company determinations have no canonical domain (${NOT_CANONICAL})`)
export const addDriverEvidence = refuse(
  "Attaching driver evidence",
  "the approved evidence lifecycle (/api/companies/[id]/evidence) has no driver evidence target yet, and the browser evidence store is retired; the file was not stored anywhere",
)
