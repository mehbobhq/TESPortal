import { normalizeName } from "@/lib/identifier-normalization"
import { TRAINING_COURSE_CATALOG } from "@/lib/driver-taxonomy"
import { recordAuditEvent } from "@/lib/audit-logger"

import type {
  AddressRecord,
  CompanyActionRecord,
  CompanyDetermination,
  CompanyDriverRelationship,
  CompanyDriverStore,
  DriverApplicationRecord,
  DriverEvidenceItem,
  DriverInput,
  DriverMaster,
  DriverMasterStore,
  DriverPerformanceEvent,
  DriverTaxDocRecord,
  EffectiveRecord,
  HOSReview,
  HiringPackageRecord,
  LicenceRecord,
  RecordType,
  OperatingRegion,
  DriverStatus,
  ScreeningRecord,
  TrainingRecord,
  TrainingCourseDefinition,
  TrainingRequirement,
  TrainingType,
  VerificationState,
} from "@/types/drivers"

export type {
  AddressRecord,
  CompanyDriverRelationship,
  DriverApplicationRecord,
  DriverEvidenceItem,
  DriverInput,
  DriverMaster,
  DriverMasterStore,
  DriverPerformanceEvent,
  DriverTaxDocRecord,
  EffectiveRecord,
  HOSReview,
  HiringPackageRecord,
  LicenceRecord,
  RecordType,
  OperatingRegion,
  DriverStatus,
  ScreeningRecord,
  TrainingRecord,
  TrainingRequirement,
  TrainingType,
  VerificationState,
}

export type Country = "Canada" | "United States"
export type RecordState = "Draft" | "Current" | "Historical" | "Expired" | "Archived"

// Compatibility aliases. The canonical definitions live in types/drivers.ts.
export type DriverApplication = DriverApplicationRecord & { relationshipId?: string }
export type TaxFormRecord = DriverTaxDocRecord & { recordId?: string; signedDate?: string; formVersion?: string; completedDate?: string }
export type EvidenceRecord = DriverEvidenceItem
export type TrainingCourseCatalog = TrainingCourseDefinition[]

const auditDriverMutation = (companyId: string, entityId: string, action: "CREATE" | "UPDATE" | "ARCHIVE", details: string) => {
  try {
    recordAuditEvent({
      action,
      entityType: "Driver",
      entityId,
      companyId,
      actor: "",
      role: "",
      details,
    })
  } catch {
    // Audit buffering must never corrupt or block the underlying domain mutation.
  }
}

export const DRIVER_MASTER_STORAGE_KEY = "tes_driver_masters_v1"
export const DRIVER_MASTER_SCHEMA_VERSION = 2 as const
export const companyDriverStorageKey = (companyId: string) => `tes_company_drivers_${companyId}`

const clean = (v?: string) => String(v ?? "").trim()
const person = (v: string) => normalizeName(v).toLowerCase()
const uid = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export const normalizeLicenceNumber = (value: string) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "")

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const write = <T,>(key: string, value: T) => {
  if (typeof window === "undefined") throw new Error("Driver persistence requires a browser context.")
  localStorage.setItem(key, JSON.stringify(value))
}

const clone = <T,>(value: T): T => (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)))

function normalizeMaster(raw: Partial<DriverMaster> & { id?: string }): DriverMaster {
  const id = clean(raw.id) || uid("DRV")
  const identity = raw.identity ?? { legalFirstName: "", legalLastName: "", dateOfBirth: "" }
  return {
    ...(raw as DriverMaster),
    id,
    driverMasterId: raw.driverMasterId || id,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    identity: {
      legalFirstName: clean(identity.legalFirstName),
      legalMiddleName: clean(identity.legalMiddleName) || undefined,
      legalLastName: clean(identity.legalLastName),
      preferredName: clean(identity.preferredName) || undefined,
      dateOfBirth: clean(identity.dateOfBirth),
      phone: clean(identity.phone) || undefined,
      email: clean(identity.email) || undefined,
    },
    identityReferences: Array.isArray(raw.identityReferences) ? raw.identityReferences : [],
    licenceHistory: Array.isArray(raw.licenceHistory) ? raw.licenceHistory.map((licence) => ({
      ...licence,
      licenceNumber: licence.licenceNumber || licence.licenceNumberNormalized || licence.licenceNumberRaw || "",
      licenceNumberRaw: licence.licenceNumberRaw || licence.licenceNumber || undefined,
      licenceNumberNormalized: normalizeLicenceNumber(licence.licenceNumberNormalized || licence.licenceNumber || licence.licenceNumberRaw || ""),
      status: licence.status || (licence.effectiveTo ? "Historical" : "Current"),
    })) : [],
    addressHistory: Array.isArray(raw.addressHistory) ? raw.addressHistory : [],
    identityResolution: raw.identityResolution || { status: "UNREVIEWED" },
    jurisdictionReviews: Array.isArray(raw.jurisdictionReviews) ? raw.jurisdictionReviews : [],
    identitySourceReviews: Array.isArray(raw.identitySourceReviews) ? raw.identitySourceReviews : [],
    archive: raw.archive || { isArchived: false },
  }
}

function normalizeRelationship(raw: Partial<CompanyDriverRelationship> & { id?: string }, companyId: string): CompanyDriverRelationship {
  const id = clean(raw.id) || uid("CDR")
  return {
    ...(raw as CompanyDriverRelationship),
    id,
    companyDriverRecordId: raw.companyDriverRecordId || id,
    companyId: companyId || raw.companyId || "",
    driverMasterId: raw.driverMasterId || "",
    recordType: raw.recordType as RecordType,
    operatingRegion: raw.operatingRegion as OperatingRegion,
    driverStatus: raw.driverStatus as DriverStatus,
    startDate: raw.startDate || "",
    statusHistory: Array.isArray(raw.statusHistory) ? raw.statusHistory : [],
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    archive: raw.archive || { isArchived: false },
  }
}

function deterministicCourseMapping(title: string, catalog: TrainingCourseDefinition[]): TrainingCourseDefinition | undefined {
  const normalized = clean(title).toLowerCase()
  const exact = catalog.find((course) => course.title.toLowerCase() === normalized)
  if (exact) return exact
  const aliases: Record<string, string> = {
    "hours of service (hos) & electronic logging devices (eld) regulations": "DRV-TRN-HOS-ELD",
    "hos & eld regulations": "DRV-TRN-HOS-ELD",
    "cargo securement standard 10 (flatbed / van)": "DRV-TRN-CARGO",
    "daily vehicle inspection standard (schedule 1 / dvir)": "DRV-TRN-DVIR",
    "commercial vehicle air brake systems & pre-trip air loss tests": "DRV-TRN-AIRBRAKE",
    "post-incident corrective re-training": "DRV-TRN-REMEDIAL",
  }
  const courseId = aliases[normalized]
  return courseId ? catalog.find((course) => course.courseId === courseId) : undefined
}

const TRAINING_TYPE_MAP: Record<string, TrainingType> = {
  INITIAL_ONBOARDING: "INITIAL_ONBOARDING",
  ANNUAL_REFRESHER: "ANNUAL_REFRESHER",
  POST_INCIDENT_CORRECTIVE: "POST_INCIDENT_CORRECTIVE",
  REGULATORY_MANDATED: "REGULATORY_MANDATED",
  CERTIFICATION: "CERTIFICATION",
  ORIENTATION: "ORIENTATION",
  SAFETY_SEMINAR: "SAFETY_SEMINAR",
  COMPANY_POLICY: "COMPANY_POLICY",
  CORRECTIVE_ACTION_RETRAINING: "CORRECTIVE_ACTION_RETRAINING",
  SPECIALIZED_CARGO: "SPECIALIZED_CARGO",
  WINTER_GRADE_OPERATIONS: "WINTER_GRADE_OPERATIONS",
  INITIAL: "INITIAL",
  REFRESHER: "REFRESHER",
  EXTERNAL_HISTORICAL: "EXTERNAL_HISTORICAL",
  REMEDIAL: "REMEDIAL",
  OTHER: "OTHER",
  "Initial Onboarding": "INITIAL_ONBOARDING",
  "Annual Refresher": "ANNUAL_REFRESHER",
  "Post-Incident Corrective": "POST_INCIDENT_CORRECTIVE",
  "Regulatory Mandated": "REGULATORY_MANDATED",
  "Regulatory Mandate": "REGULATORY_MANDATED",
  "Certification": "CERTIFICATION",
  "Orientation": "ORIENTATION",
  "Safety Seminar": "SAFETY_SEMINAR",
  "Company Policy": "COMPANY_POLICY",
  "Corrective Action Re-training": "CORRECTIVE_ACTION_RETRAINING",
  "Specialized Cargo": "SPECIALIZED_CARGO",
  "Winter / Grade Operations": "WINTER_GRADE_OPERATIONS",
  "Initial": "INITIAL",
  "Refresher": "REFRESHER",
  "External / Historical": "EXTERNAL_HISTORICAL",
  "Remedial": "REMEDIAL",
  "Other": "OTHER",
}

function migrateTrainingRecord(raw: any, companyId: string, catalog: TrainingCourseDefinition[]): TrainingRecord {
  const title = clean(raw.courseTitle || raw.course || raw.legacyCourseTitle)
  const rawTrainingType = clean(raw.legacyTrainingType || raw.trainingType)
  const mappedTrainingType = TRAINING_TYPE_MAP[rawTrainingType]

  const mapped = raw.courseId ? catalog.find((c) => c.courseId === raw.courseId) : deterministicCourseMapping(title, catalog)
  const status = raw.status || ({
    Assigned: "Assigned",
    Scheduled: "Scheduled",
    "In Progress": "In Progress",
    Completed: "Completed",
    Cancelled: "Cancelled",
    Exempted: "Exempted",
  } as Record<string, TrainingRecord["status"]>)[raw.recordStatus] || "Assigned"
  return {
    id: clean(raw.id) || clean(raw.recordId) || uid("TRN"),
    companyId: raw.companyId || companyId,
    driverMasterId: raw.driverMasterId || "",
    companyDriverRelationshipId: raw.companyDriverRelationshipId,
    courseId: mapped?.courseId,
    courseVersion: raw.courseVersion || mapped?.version,
    courseTitle: title,
    legacyCourseTitle: mapped ? raw.legacyCourseTitle : (raw.legacyCourseTitle || title),
    courseMappingState: raw.courseMappingState || (mapped ? "CANONICAL" : "UNMAPPED"),
    trainingType: mappedTrainingType || "OTHER",
    legacyTrainingType: mappedTrainingType ? (raw.legacyTrainingType || (raw.trainingType && raw.trainingType !== mappedTrainingType ? raw.trainingType : undefined)) : rawTrainingType || undefined,
    trainingTypeMappingState: mappedTrainingType ? "CANONICAL" : (rawTrainingType ? "UNMAPPED" : undefined),
    provider: raw.provider || "",
    assignedDate: raw.assignedDate,
    startDate: raw.startDate,
    completionDate: raw.completionDate,
    expiryDate: raw.expiryDate || raw.expirationDate,
    status,
    applicability: raw.applicability,
    requirementState: raw.requirementState || raw.requiredState,
    assignmentState: raw.assignmentState || raw.assignedState,
    progressState: raw.progressState || (status === "Completed" ? "Completed" : status === "In Progress" ? "In Progress" : status === "Scheduled" ? "Scheduled" : status === "Cancelled" ? "Cancelled" : status === "Waived" ? "Waived" : status === "Exempted" ? "Exempted" : status === "Assigned" ? "Not Started" : undefined),
    currencyState: raw.currencyState || (raw.expiryDate || raw.expirationDate ? (new Date(raw.expiryDate || raw.expirationDate) < new Date() ? "Expired" : "Current") : (raw.completionDate ? "No Expiry" : "Not Established")),
    verificationState: raw.verificationState,
    scoreOrResult: raw.scoreOrResult || raw.assessmentResult,
    certificateNumber: raw.certificateNumber,
    waiveReason: raw.waiveReason,
    waivedBy: raw.waivedBy,
    waivedDate: raw.waivedDate,
    evidenceIds: Array.isArray(raw.evidenceIds) ? raw.evidenceIds : [],
    remedialOrRoutine: raw.remedialOrRoutine || (String(raw.trainingType || "").toLowerCase().includes("remedial") ? "Remedial" : "Unknown"),
    previousTrainingRecordId: raw.previousTrainingRecordId,
    relatedEventIds: Array.isArray(raw.relatedEventIds) ? raw.relatedEventIds : [],
    relatedHosRecordIds: Array.isArray(raw.relatedHosRecordIds) ? raw.relatedHosRecordIds : [],
    relatedCitationIds: Array.isArray(raw.relatedCitationIds) ? raw.relatedCitationIds : [],
    relatedCompanyActionIds: Array.isArray(raw.relatedCompanyActionIds) ? raw.relatedCompanyActionIds : [],
    provenance: raw.provenance || { sourceType: "SOURCE_FACT", source: "Training record" },
    notes: raw.notes,
    isArchived: Boolean(raw.isArchived),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    recordId: raw.recordId,
    recordStatus: raw.recordStatus,
    assessmentResult: raw.assessmentResult,
    dueDate: raw.dueDate,
    issueDate: raw.issueDate,
    nextDueDate: raw.nextDueDate,
    deliveryMethod: raw.deliveryMethod,
    duration: raw.duration,
  }
}

function migrateTrainingRequirement(raw: any, companyId: string): TrainingRequirement {
  const applicability = raw.applicability as TrainingRequirement["applicability"] | undefined
  const requiredState = raw.requiredState || raw.requirementState as TrainingRequirement["requiredState"] | undefined
  const assignmentState = raw.assignmentState || raw.assignedState as TrainingRequirement["assignmentState"] | undefined
  const progressState = raw.progressState as TrainingRequirement["progressState"] | undefined
  const currencyState = raw.currencyState as TrainingRequirement["currencyState"] | undefined
  const verificationState = raw.verificationState as TrainingRequirement["verificationState"] | undefined
  return {
    ...raw,
    requirementId: clean(raw.requirementId) || uid("TRQ"),
    companyId: raw.companyId || companyId,
    driverMasterId: raw.driverMasterId || "",
    courseId: clean(raw.courseId),
    applicability,
    requiredState,
    assignmentState: assignmentState || "Not Assigned",
    assignedState: undefined,
    progressState,
    currencyState,
    verificationState,
    currentRequirementState: raw.currentRequirementState,
    provenance: raw.provenance || { sourceType: "SOURCE_FACT", source: "Training requirement" },
    isArchived: Boolean(raw.isArchived),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  }
}

const DETERMINATION_TYPE_MAP: Record<string, NonNullable<CompanyDetermination["determinationType"]>> = {
  "Collision Preventability": "COLLISION_PREVENTABILITY",
  "Complaint Substantiation": "COMPLAINT_SUBSTANTIATION",
  "Investigation Finding": "INVESTIGATION_FINDING",
  "Root Cause Analysis": "ROOT_CAUSE_ANALYSIS",
  "Corrective Action Outcome": "CORRECTIVE_ACTION_OUTCOME",
}
const DETERMINATION_VALUE_MAP: Record<string, NonNullable<CompanyDetermination["determinationValue"]>> = {
  Preventable: "PREVENTABLE",
  "Non-Preventable": "NON_PREVENTABLE",
  Substantiated: "SUBSTANTIATED",
  "Not Substantiated": "NOT_SUBSTANTIATED",
  "Unable to Determine": "UNABLE_TO_DETERMINE",
}
const ACTION_TYPE_MAP: Record<string, CompanyActionRecord["actionType"]> = {
  Coaching: "COACHING", "Coaching Session": "COACHING", "Training Assignment": "TRAINING_ASSIGNMENT",
  "Verbal Warning": "VERBAL_WARNING", "Written Warning": "WRITTEN_WARNING", "Final Warning": "FINAL_WARNING",
  Suspension: "SUSPENSION", "Policy Review": "POLICY_REVIEW", "Monitoring / Telematics Watch": "MONITORING_TELEMATICS",
  "Dispatch Change": "DISPATCH_CHANGE", "Equipment Inspection / Repair": "EQUIPMENT_INSPECTION_REPAIR",
  "Corrective Action Plan": "CORRECTIVE_ACTION_PLAN", "Disciplinary Action": "DISCIPLINARY_ACTION",
  "Safety Warning": "SAFETY_WARNING", "Retraining Mandate": "RETRAINING_MANDATE",
  "Performance Improvement Plan": "PERFORMANCE_IMPROVEMENT_PLAN", Other: "OTHER",
}

function migrateCompanyDetermination(raw: any, companyId: string): CompanyDetermination {
  const legacyType = clean(raw.legacyDeterminationType || raw.determinationType)
  const legacyValue = clean(raw.legacyDeterminationValue || raw.determinationValue)
  return {
    ...raw, id: clean(raw.id) || uid("DET"), companyId, driverMasterId: raw.driverMasterId || "",
    relatedRecordType: raw.relatedRecordType, legacyRelatedRecordType: raw.legacyRelatedRecordType, relatedRecordId: raw.relatedRecordId,
    determinationType: DETERMINATION_TYPE_MAP[legacyType], legacyDeterminationType: DETERMINATION_TYPE_MAP[legacyType] ? legacyType : legacyType || undefined,
    determinationValue: DETERMINATION_VALUE_MAP[legacyValue], legacyDeterminationValue: DETERMINATION_VALUE_MAP[legacyValue] ? legacyValue : legacyValue || undefined,
    preventabilityFinding: raw.preventabilityFinding, legacyPreventabilityFinding: raw.legacyPreventabilityFinding,
    isArchived: Boolean(raw.isArchived), createdAt: raw.createdAt || new Date().toISOString(), updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  }
}

function migrateCompanyAction(raw: any, companyId: string): CompanyActionRecord {
  const legacyType = clean(raw.legacyActionType || raw.actionType)
  return {
    ...raw, id: clean(raw.id) || uid("ACT"), companyId, driverMasterId: raw.driverMasterId || "",
    actionType: ACTION_TYPE_MAP[legacyType] || "OTHER", legacyActionType: ACTION_TYPE_MAP[legacyType] ? legacyType : legacyType || undefined,
    status: raw.status || "Draft", isArchived: Boolean(raw.isArchived), createdAt: raw.createdAt || new Date().toISOString(), updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  }
}

function migrateCompanyStore(raw: any, companyId: string, catalog: TrainingCourseDefinition[]): CompanyDriverStore {
  const base: CompanyDriverStore = {
    version: 2,
    companyId,
    relationships: [],
    applications: [],
    hiringPackages: [],
    taxDocs: [],
    screenings: [],
    trainingRecords: [],
    trainingRequirements: [],
    events: [],
    evidence: [],
    hosRawRecords: [],
    hosDutyEvents: [],
    hosRuleProfiles: [],
    hosPotentialViolations: [],
    hosReviews: [],
    eldEditRequests: [],
    unassignedDriving: [],
    eldDiagnostics: [],
    companyDeterminations: [],
    companyActions: [],
  }
  if (Array.isArray(raw)) return { ...base, relationships: raw.map((r) => normalizeRelationship(r, companyId)) }
  if (!raw || typeof raw !== "object") return base

  const relationships = Array.isArray(raw.relationships) ? raw.relationships.map((r: any) => normalizeRelationship(r, companyId)) : []
  const legacyEvents = Array.isArray(raw.performanceEvents) ? raw.performanceEvents : []
  const events = Array.isArray(raw.events) && raw.events.length ? raw.events : legacyEvents
  const training = Array.isArray(raw.trainingRecords) ? raw.trainingRecords.map((r: any) => migrateTrainingRecord(r, companyId, catalog)) : []
  const trainingRequirements = Array.isArray(raw.trainingRequirements) ? raw.trainingRequirements.map((r: any) => migrateTrainingRequirement(r, companyId)) : []

  return {
    ...base,
    ...raw,
    version: 2,
    companyId,
    relationships,
    applications: Array.isArray(raw.applications) ? raw.applications : [],
    hiringPackages: Array.isArray(raw.hiringPackages) ? raw.hiringPackages : [],
    taxDocs: Array.isArray(raw.taxDocs) ? raw.taxDocs : [],
    screenings: Array.isArray(raw.screenings) ? raw.screenings : [],
    trainingRecords: training,
    trainingRequirements,
    events,
    performanceEvents: events,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    hosRawRecords: Array.isArray(raw.hosRawRecords) ? raw.hosRawRecords : [],
    hosDutyEvents: Array.isArray(raw.hosDutyEvents) ? raw.hosDutyEvents : [],
    hosRuleProfiles: Array.isArray(raw.hosRuleProfiles) ? raw.hosRuleProfiles : [],
    hosPotentialViolations: Array.isArray(raw.hosPotentialViolations) ? raw.hosPotentialViolations : [],
    hosReviews: Array.isArray(raw.hosReviews) ? raw.hosReviews : [],
    eldEditRequests: Array.isArray(raw.eldEditRequests) ? raw.eldEditRequests : [],
    unassignedDriving: Array.isArray(raw.unassignedDriving) ? raw.unassignedDriving : [],
    eldDiagnostics: Array.isArray(raw.eldDiagnostics) ? raw.eldDiagnostics : [],
    companyDeterminations: Array.isArray(raw.companyDeterminations) ? raw.companyDeterminations.map((r: any) => migrateCompanyDetermination(r, companyId)) : [],
    companyActions: Array.isArray(raw.companyActions) ? raw.companyActions.map((r: any) => migrateCompanyAction(r, companyId)) : [],
  }
}

export function getTrainingCourseCatalog(): TrainingCourseDefinition[] {
  return TRAINING_COURSE_CATALOG
}

export const loadDriverMasterStore = (): DriverMasterStore => {
  const raw = read<any>(DRIVER_MASTER_STORAGE_KEY, null)
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.drivers)) return { version: 2, drivers: [] }
  const drivers = raw.drivers.map((driver: any) => normalizeMaster(driver))
  const migrated: DriverMasterStore = { version: 2, drivers }
  if (raw.version !== 2 || drivers.some((d: DriverMaster, i: number) => d.driverMasterId !== raw.drivers[i]?.driverMasterId)) {
    try { write(DRIVER_MASTER_STORAGE_KEY, migrated) } catch { /* SSR or storage failure: return migrated in memory */ }
  }
  return migrated
}

export const saveDriverMasterStore = (store: DriverMasterStore) => write(DRIVER_MASTER_STORAGE_KEY, { ...store, version: 2 })

export const loadCompanyDriverStore = (companyId: string): CompanyDriverStore => {
  const raw = read<any>(companyDriverStorageKey(companyId), null)
  const migrated = migrateCompanyStore(raw, companyId, getTrainingCourseCatalog())
  const shouldPersist = !raw || raw.version !== 2 || !Array.isArray(raw.trainingRecords) || !Array.isArray(raw.relationships) ||
    migrated.trainingRecords.some((record) => !record.id || !record.courseMappingState) ||
    migrated.relationships.some((relationship) => !relationship.companyDriverRecordId)
  if (shouldPersist) {
    try { write(companyDriverStorageKey(companyId), migrated) } catch { /* keep migrated in memory */ }
  }
  return migrated
}

export const saveCompanyDriverStore = (store: CompanyDriverStore) => {
  const catalog = getTrainingCourseCatalog()
  const relationships = store.relationships.map((relationship) => normalizeRelationship(relationship, store.companyId))
  const relationshipByDriver = new Map(relationships.map((relationship) => [relationship.driverMasterId, relationship.id]))
  const trainingRecords = store.trainingRecords.map((record) => migrateTrainingRecord({ ...record, companyDriverRelationshipId: record.companyDriverRelationshipId || relationshipByDriver.get(record.driverMasterId) }, store.companyId, catalog))
  const companyDeterminations = store.companyDeterminations.map((record) => migrateCompanyDetermination(record, store.companyId))
  const companyActions = store.companyActions.map((record) => migrateCompanyAction(record, store.companyId))
  const trainingRequirements = store.trainingRequirements.map((requirement) => migrateTrainingRequirement({ ...requirement, companyDriverRelationshipId: requirement.companyDriverRelationshipId || relationshipByDriver.get(requirement.driverMasterId) }, store.companyId))
  const applications = store.applications.map((record) => ({ ...record, companyDriverRelationshipId: record.companyDriverRelationshipId || relationshipByDriver.get(record.driverMasterId) }))
  const hiringPackages = store.hiringPackages.map((record) => ({ ...record, companyDriverRelationshipId: record.companyDriverRelationshipId || relationshipByDriver.get(record.driverMasterId) }))
  const events = store.events.map((event) => ({
    ...event,
    companyDriverRelationshipId: event.companyDriverRelationshipId || (event.driverMasterId ? relationshipByDriver.get(event.driverMasterId) : undefined),
  }))
  write(companyDriverStorageKey(store.companyId), {
    ...store,
    version: 2,
    relationships,
    applications,
    hiringPackages,
    trainingRecords,
    trainingRequirements,
    companyDeterminations,
    companyActions,
    events,
  })
}

export const readCompanies = () => read<any[]>("tes_companies", []).filter((x) => x && x.id).map((x) => ({ id: String(x.id), name: String(x.name || x.companyName || ""), status: x.status, region: x.region }))
export const getCompany = (id: string) => readCompanies().find((c) => c.id === id) || null
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

function companyToken(companyId: string) {
  const token = companyId.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return (token.slice(-6) || "COMP").padStart(4, "0")
}
function randomMasterId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const part = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
  return `DRV-${part()}-${part()}-${part()}`
}
export function allocateDriverMasterId(drivers: DriverMaster[]) {
  for (let i = 0; i < 100; i++) {
    const candidate = randomMasterId()
    if (!drivers.some((d) => d.id === candidate)) return candidate
  }
  throw new Error("Unable to allocate unique Driver Master ID.")
}
export function allocateCompanyRecordId(companyId: string, relationships: CompanyDriverRelationship[]) {
  const token = companyToken(companyId)
  const used = new Set(relationships.map((r) => r.companyDriverRecordId?.match(/-DRV-(\d+)$/)?.[1]).filter(Boolean).map(Number))
  let n = 1
  while (used.has(n)) n++
  return `${token}-DRV-${String(n).padStart(6, "0")}`
}
export function displayCompanyDriverRecordId(companyId: string, r: CompanyDriverRelationship) {
  return r.companyDriverRecordId || r.id || `${companyToken(companyId)}-DRV-LEGACY`
}
export function allocateSubRecordId(companyId: string, code: string, existing: Array<{ recordId?: string }>) {
  const token = companyToken(companyId)
  const rx = new RegExp(`-${code}-(\\d+)$`)
  const used = new Set(existing.map((r) => r.recordId?.match(rx)?.[1]).filter(Boolean).map(Number))
  let n = 1
  while (used.has(n)) n++
  return `${token}-${code}-${String(n).padStart(6, "0")}`
}

export function validatePostalZip(country: Country, value: string) {
  const v = clean(value).toUpperCase()
  return country === "Canada" ? /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(v) : /^\d{5}(-\d{4})?$/.test(v)
}

export function validateDriverInput(x: DriverInput) {
  const required: Array<[string, string]> = [
    ["Legal First Name", x.legalFirstName], ["Legal Last Name", x.legalLastName], ["Date of Birth", x.dateOfBirth],
    ["Record Type", String(x.recordType || "")], ["Operating Region", String(x.operatingRegion || "")], ["Driver Status", String(x.driverStatus || "")],
    ["Relationship Start Date", x.relationshipStartDate], ["Address", x.addressLine1], ["City", x.city], ["State / Province", x.stateProvince],
    ["Postal / ZIP", x.postalZip], ["Address Effective From", x.addressEffectiveFrom], ["Licence Number", x.licenceNumber],
    ["Licence Jurisdiction", x.licenceJurisdiction], ["Licence Effective From", x.licenceEffectiveFrom],
  ]
  const missing = required.filter(([, value]) => !clean(value)).map(([label]) => label)
  if (missing.length) throw new Error(`Required: ${missing.join(", ")}.`)
  if (!validatePostalZip(x.country, x.postalZip)) throw new Error(x.country === "Canada" ? "Enter a valid Canadian postal code." : "Enter a valid U.S. ZIP or ZIP+4.")
  if (!normalizeLicenceNumber(x.licenceNumber)) throw new Error("Licence number is required.")
}

export type IdentityMatch = { kind: "EXACT_LICENCE" | "STRONG" | "POSSIBLE" | "NONE"; master?: DriverMaster; reasons: string[] }
export function findDriverIdentityMatch(x: Pick<DriverInput, "legalFirstName" | "legalLastName" | "dateOfBirth" | "licenceNumber" | "licenceJurisdiction" | "licenceCountry">, drivers = loadDriverMasterStore().drivers): IdentityMatch {
  const licence = normalizeLicenceNumber(x.licenceNumber)
  const first = person(x.legalFirstName)
  const last = person(x.legalLastName)
  let possible: DriverMaster | undefined
  let reasons: string[] = []
  for (const driver of drivers) {
    const exactLicence = driver.licenceHistory.some((l) => normalizeLicenceNumber(l.licenceNumber || l.licenceNumberRaw || "") === licence && l.jurisdiction === x.licenceJurisdiction && l.country === x.licenceCountry)
    if (licence && exactLicence) return { kind: "EXACT_LICENCE", master: driver, reasons: ["Same licence number and issuing jurisdiction"] }
    const sameName = person(driver.identity.legalFirstName) === first && person(driver.identity.legalLastName) === last
    const sameDob = driver.identity.dateOfBirth === x.dateOfBirth
    if (sameName && sameDob) return { kind: "STRONG", master: driver, reasons: ["Same legal name and date of birth"] }
    if (sameName || sameDob) {
      possible = driver
      reasons = [sameName ? "Same legal name" : "Same date of birth"]
    }
  }
  return possible ? { kind: "POSSIBLE", master: possible, reasons } : { kind: "NONE", reasons: [] }
}

export function createDriver(companyId: string, input: DriverInput, options?: { reuseDriverMasterId?: string }) {
  validateDriverInput(input)
  const beforeMaster = loadDriverMasterStore()
  const beforeCompany = loadCompanyDriverStore(companyId)
  const match = findDriverIdentityMatch(input, beforeMaster.drivers)
  if (match.kind !== "NONE" && !options?.reuseDriverMasterId) throw new Error(`${match.kind === "POSSIBLE" ? "Possible existing Driver match" : "Existing Driver Master found"}: ${match.master?.id}. Review identity before creating a duplicate.`)

  const now = new Date().toISOString()
  let master = options?.reuseDriverMasterId ? beforeMaster.drivers.find((d) => d.id === options.reuseDriverMasterId) : undefined
  if (options?.reuseDriverMasterId && !master) throw new Error("Selected Driver Master was not found.")
  if (!master) {
    const id = allocateDriverMasterId(beforeMaster.drivers)
    master = {
      id,
      driverMasterId: id,
      createdAt: now,
      updatedAt: now,
      identity: {
        legalFirstName: normalizeName(input.legalFirstName), legalMiddleName: normalizeName(input.legalMiddleName) || undefined,
        legalLastName: normalizeName(input.legalLastName), preferredName: normalizeName(input.preferredName) || undefined,
        dateOfBirth: input.dateOfBirth, phone: clean(input.phone) || undefined, email: clean(input.email) || undefined,
      },
      identityReferences: [{ id: uid("IDR"), type: "DRIVER_LICENCE", value: normalizeLicenceNumber(input.licenceNumber), jurisdiction: input.licenceJurisdiction, country: input.licenceCountry, createdAt: now, source: "Driver onboarding" }],
      licenceHistory: [{ id: uid("LIC"), licenceNumber: normalizeLicenceNumber(input.licenceNumber), licenceNumberRaw: input.licenceNumber.trim(), licenceNumberNormalized: normalizeLicenceNumber(input.licenceNumber), jurisdiction: input.licenceJurisdiction, country: input.licenceCountry, class: clean(input.licenceClass) || undefined, endorsements: input.endorsements, airBrakeQualified: input.airBrakeQualified, effectiveFrom: input.licenceEffectiveFrom, effectiveTo: null, status: "Current", source: "Driver onboarding", createdAt: now, verificationState: input.verificationState || "Unverified" }],
      addressHistory: [{ id: uid("ADR"), addressLine1: clean(input.addressLine1), addressLine2: clean(input.addressLine2) || undefined, city: clean(input.city), stateProvince: input.stateProvince, postalZip: input.postalZip.trim().toUpperCase(), country: input.country, effectiveFrom: input.addressEffectiveFrom, effectiveTo: null, status: "Current", source: "Driver onboarding", createdAt: now }],
      identityResolution: { status: input.stateProvince === input.licenceJurisdiction ? "CLEAR" : "REVIEW" },
      jurisdictionReviews: input.stateProvince !== input.licenceJurisdiction ? [{ id: uid("JUR"), status: "OPEN", reason: input.jurisdictionReview?.reason || "Residence and licence jurisdictions differ", explanation: input.jurisdictionReview?.explanation || "", expectedResolutionDate: input.jurisdictionReview?.expectedResolutionDate, createdAt: now }] : [],
      archive: { isArchived: false },
    }
  }

  if (!master) throw new Error("Driver Master could not be established.")
  const masterRecord = master
  if (beforeCompany.relationships.some((r) => r.driverMasterId === masterRecord.id && !r.archive.isArchived)) throw new Error("This Driver already has an active company relationship.")
  const relationship: CompanyDriverRelationship = {
    id: uid("CDR"), companyDriverRecordId: allocateCompanyRecordId(companyId, beforeCompany.relationships), companyId, driverMasterId: masterRecord.id,
    recordType: input.recordType, operatingRegion: input.operatingRegion, driverStatus: input.driverStatus, startDate: input.relationshipStartDate,
    endDate: input.relationshipEndDate || undefined,
    statusHistory: [{ id: uid("STA"), statusValue: input.driverStatus!, effectiveFrom: input.relationshipStartDate, effectiveTo: null, status: "Current", source: "Driver onboarding", createdAt: now, reason: "Initial company Driver relationship" }],
    createdAt: now, updatedAt: now, archive: { isArchived: false },
  }
  const nextMaster: DriverMasterStore = beforeMaster.drivers.some((d) => d.id === masterRecord.id) ? beforeMaster : { version: 2, drivers: [...beforeMaster.drivers, masterRecord] }
  const nextCompany = { ...beforeCompany, relationships: [...beforeCompany.relationships, relationship] }
  try {
    saveDriverMasterStore(nextMaster)
    try { saveCompanyDriverStore(nextCompany) } catch (error) { saveDriverMasterStore(beforeMaster); throw error }
  } catch (error) {
    try { saveCompanyDriverStore(beforeCompany) } catch { /* best effort rollback */ }
    throw error
  }
  auditDriverMutation(companyId, relationship.id, "CREATE", "Created company Driver relationship and preserved/created the linked Driver Master.")
  return { master, relationship }
}

export function updateDriverProfileAtomic(companyId: string, driverId: string, input: { identity: DriverMaster["identity"]; recordType: RecordType; operatingRegion: OperatingRegion; driverStatus: DriverStatus; relationshipStartDate: string; relationshipEndDate?: string; address?: Omit<AddressRecord, "id" | "status" | "source" | "createdAt" | "effectiveTo"> }) {
  const beforeMaster = loadDriverMasterStore()
  const beforeCompany = loadCompanyDriverStore(companyId)
  const driver = beforeMaster.drivers.find((d) => d.id === driverId)
  const relationship = beforeCompany.relationships.find((r) => r.driverMasterId === driverId && !r.archive.isArchived)
  if (!driver || !relationship) throw new Error("Driver record not found.")
  if (!clean(input.identity.legalFirstName) || !clean(input.identity.legalLastName) || !input.identity.dateOfBirth) throw new Error("Legal first name, legal last name and date of birth are required.")
  const now = new Date().toISOString()
  let addresses = driver.addressHistory
  if (input.address) {
    if (!validatePostalZip(input.address.country, input.address.postalZip)) throw new Error("Postal / ZIP format is invalid.")
    const current = currentAddress(driver)
    const changed = !current || [current.addressLine1, current.addressLine2, current.city, current.stateProvince, current.postalZip, current.country].join("|") !== [input.address.addressLine1, input.address.addressLine2, input.address.city, input.address.stateProvince, input.address.postalZip, input.address.country].join("|")
    if (changed) {
      if (current && input.address.effectiveFrom <= current.effectiveFrom) throw new Error("New address effective date must be after the current address effective date.")
      addresses = driver.addressHistory.map((a) => !a.effectiveTo ? { ...a, effectiveTo: input.address!.effectiveFrom, status: "Historical" as const } : a)
      addresses.push({ id: uid("ADR"), ...input.address, effectiveTo: null, status: "Current", source: "Driver Profile", createdAt: now })
    }
  }
  const updatedDriver: DriverMaster = { ...driver, identity: { ...input.identity, legalFirstName: normalizeName(input.identity.legalFirstName), legalMiddleName: normalizeName(input.identity.legalMiddleName || "") || undefined, legalLastName: normalizeName(input.identity.legalLastName), preferredName: normalizeName(input.identity.preferredName || "") || undefined }, addressHistory: addresses, updatedAt: now }
  let statusHistory = relationship.statusHistory
  if (input.driverStatus !== relationship.driverStatus) {
    const last = [...statusHistory].filter((s) => !s.effectiveTo).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    if (last && input.relationshipStartDate <= last.effectiveFrom) throw new Error("Status effective date must be after the current status effective date.")
    statusHistory = statusHistory.map((s) => !s.effectiveTo ? { ...s, effectiveTo: input.relationshipStartDate, status: "Historical" as const } : s)
    statusHistory.push({ id: uid("STA"), statusValue: input.driverStatus, effectiveFrom: input.relationshipStartDate, effectiveTo: null, status: "Current", source: "Driver Profile", createdAt: now, reason: "Company Driver status changed" })
  }
  const updatedRelationship = { ...relationship, recordType: input.recordType, operatingRegion: input.operatingRegion, driverStatus: input.driverStatus, startDate: input.relationshipStartDate, endDate: input.relationshipEndDate, statusHistory, updatedAt: now }
  try {
    saveDriverMasterStore({ version: 2, drivers: beforeMaster.drivers.map((d) => d.id === driverId ? updatedDriver : d) })
    try { saveCompanyDriverStore({ ...beforeCompany, relationships: beforeCompany.relationships.map((r) => r.id === relationship.id ? updatedRelationship : r) }) } catch (error) { saveDriverMasterStore(beforeMaster); throw error }
  } catch (error) {
    try { saveCompanyDriverStore(beforeCompany) } catch { /* best effort rollback */ }
    throw error
  }
  auditDriverMutation(companyId, relationship.id, "UPDATE", "Updated Driver identity and/or company relationship using effective-dated history.")
  return { master: updatedDriver, relationship: updatedRelationship }
}

export function addLicence(companyId: string, driverId: string, input: { licenceNumberRaw: string; jurisdiction: string; country: Country; documentType?: string; class?: string; endorsements?: string[]; restrictions?: string[]; airBrake?: string; airBrakeQualified?: boolean; issueDate?: string; expiryDate?: string; effectiveFrom: string; verificationState?: any; sourceEvidenceId?: string; sourceValue?: string; reviewedValue?: string; reviewReason?: string }) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((d) => d.id === driverId)
  if (!driver) throw new Error("Driver not found.")
  if (!input.effectiveFrom || !input.licenceNumberRaw || !input.jurisdiction) throw new Error("Licence number, jurisdiction and effective date are required.")
  if (input.issueDate && input.expiryDate && input.issueDate > input.expiryDate) throw new Error("Licence issue date cannot be after expiry date.")
  const current = currentLicence(driver)
  if (current && input.effectiveFrom <= current.effectiveFrom) throw new Error("New licence effective date must be after the current licence effective date.")
  const normalized = normalizeLicenceNumber(input.licenceNumberRaw)
  for (const other of store.drivers) {
    if (other.id === driverId) continue
    if (other.licenceHistory.some((licence) => normalizeLicenceNumber(licence.licenceNumber || licence.licenceNumberRaw || "") === normalized && licence.country === input.country && licence.jurisdiction === input.jurisdiction)) throw new Error(`Licence identifier is already linked to Driver Master ${other.id}.`)
  }
  const now = new Date().toISOString()
  const history = driver.licenceHistory.map((licence) => !licence.effectiveTo ? { ...licence, effectiveTo: input.effectiveFrom, status: "Historical" as const } : licence)
  history.push({ id: uid("LIC"), licenceNumber: normalized, licenceNumberRaw: input.licenceNumberRaw.trim(), licenceNumberNormalized: normalized, jurisdiction: input.jurisdiction, country: input.country, documentType: input.documentType, class: input.class, endorsements: input.endorsements, restrictions: input.restrictions, airBrakeQualified: input.airBrakeQualified, issueDate: input.issueDate, expiryDate: input.expiryDate, effectiveFrom: input.effectiveFrom, effectiveTo: null, status: "Current", source: "Qualifications & Licensing", createdAt: now, verificationState: input.verificationState || "Unverified", evidenceIds: input.sourceEvidenceId ? [input.sourceEvidenceId] : undefined, sourceValue: input.sourceValue, reviewedValue: input.reviewedValue, reviewReason: input.reviewReason })
  const updated: DriverMaster = { ...driver, licenceHistory: history, identityReferences: [...driver.identityReferences, { id: uid("IDR"), type: "DRIVER_LICENCE", value: normalized, jurisdiction: input.jurisdiction, country: input.country, createdAt: now, source: "Qualifications & Licensing" }], updatedAt: now }
  saveDriverMasterStore({ version: 2, drivers: store.drivers.map((d) => d.id === driverId ? updated : d) })
  auditDriverMutation(companyId, driverId, "CREATE", "Added a new effective-dated Driver licence history record.")
  return updated
}

export const addDriverLicence = (driverId: string, input: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo" | "licenceNumberNormalized">) => addLicence("", driverId, { licenceNumberRaw: input.licenceNumberRaw || input.licenceNumber || "", jurisdiction: input.jurisdiction, country: input.country, documentType: input.documentType, class: input.class, endorsements: input.endorsements, restrictions: input.restrictions, airBrakeQualified: input.airBrakeQualified, issueDate: input.issueDate, expiryDate: input.expiryDate, effectiveFrom: input.effectiveFrom, verificationState: input.verificationState })

export function updateDriverMasterIdentity(driverId: string, patch: Partial<DriverMaster["identity"]>) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((d) => d.id === driverId)
  if (!driver) throw new Error("Driver not found.")
  const identity = { ...driver.identity, ...patch, legalFirstName: normalizeName(patch.legalFirstName ?? driver.identity.legalFirstName), legalLastName: normalizeName(patch.legalLastName ?? driver.identity.legalLastName) }
  const updated = { ...driver, identity, updatedAt: new Date().toISOString() }
  saveDriverMasterStore({ version: 2, drivers: store.drivers.map((d) => d.id === driverId ? updated : d) })
  auditDriverMutation("", driverId, "UPDATE", "Updated canonical Driver Master identity.")
  return updated
}

export function updateCompanyDriverRelationship(companyId: string, relationshipId: string, patch: Partial<CompanyDriverRelationship>) {
  const store = loadCompanyDriverStore(companyId)
  const current = store.relationships.find((r) => r.id === relationshipId)
  if (!current) throw new Error("Company Driver relationship not found.")
  const updated = { ...current, ...patch, id: current.id, companyDriverRecordId: current.companyDriverRecordId, companyId: current.companyId, driverMasterId: current.driverMasterId, updatedAt: new Date().toISOString() }
  saveCompanyDriverStore({ ...store, relationships: store.relationships.map((r) => r.id === relationshipId ? updated : r) })
  auditDriverMutation(companyId, relationshipId, "UPDATE", "Updated company Driver relationship.")
  return updated
}

export function addDriverAddress(driverId: string, address: Omit<AddressRecord, "id" | "status" | "source" | "createdAt" | "effectiveTo">) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((d) => d.id === driverId)
  if (!driver) throw new Error("Driver not found.")
  if (!validatePostalZip(address.country, address.postalZip)) throw new Error("Postal / ZIP format is invalid.")
  const current = currentAddress(driver)
  if (current && address.effectiveFrom <= current.effectiveFrom) throw new Error("New address effective date must be after the current address effective date.")
  const now = new Date().toISOString()
  const history = driver.addressHistory.map((a) => !a.effectiveTo ? { ...a, effectiveTo: address.effectiveFrom, status: "Historical" as const } : a)
  history.push({ id: uid("ADR"), ...address, effectiveTo: null, status: "Current", source: "Driver Profile", createdAt: now })
  const updated = { ...driver, addressHistory: history, updatedAt: now }
  saveDriverMasterStore({ version: 2, drivers: store.drivers.map((d) => d.id === driverId ? updated : d) })
  auditDriverMutation("", driverId, "CREATE", "Added a new effective-dated Driver address history record.")
  return updated
}

function activeRelationship(store: CompanyDriverStore, driverMasterId: string) {
  return store.relationships.find((r) => r.driverMasterId === driverMasterId && !r.archive.isArchived)
}

export function addScreeningRecord(companyId: string, driverMasterId: string, data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const record: ScreeningRecord = { ...data, id: uid("SCR"), companyId, driverMasterId, evidenceIds: data.evidenceIds || [], isArchived: false, createdAt: now, updatedAt: now }
  saveCompanyDriverStore({ ...store, screenings: [...store.screenings, record] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created Driver screening record.")
  return record
}

export function archiveScreeningRecord(companyId: string, id: string) {
  const store = loadCompanyDriverStore(companyId)
  saveCompanyDriverStore({ ...store, screenings: store.screenings.map((r) => r.id === id ? { ...r, isArchived: true, updatedAt: new Date().toISOString() } : r) })
}

function resolveCourse(title: string, courseId?: string) {
  const catalog = getTrainingCourseCatalog()
  return (courseId && catalog.find((c) => c.courseId === courseId)) || deterministicCourseMapping(title, catalog)
}

export function addTrainingRecord(companyId: string, driverMasterId: string, data: Omit<TrainingRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const mapped = resolveCourse(data.courseTitle, data.courseId)
  const record: TrainingRecord = {
    ...data,
    id: uid("TRN"), companyId, driverMasterId, companyDriverRelationshipId: data.companyDriverRelationshipId || activeRelationship(store, driverMasterId)?.id,
    courseId: mapped?.courseId, courseVersion: data.courseVersion || mapped?.version,
    courseMappingState: mapped ? "CANONICAL" : "REVIEW_REQUIRED",
    evidenceIds: data.evidenceIds || [], isArchived: false, createdAt: now, updatedAt: now,
    provenance: data.provenance || { sourceType: "SOURCE_FACT", source: "Driver Training" },
  }
  saveCompanyDriverStore({ ...store, trainingRecords: [...store.trainingRecords, record] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created Driver training record with canonical course mapping state.")
  return record
}

export function addTrainingRequirement(companyId: string, driverMasterId: string, data: Omit<TrainingRequirement, "requirementId" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const requirement = {
    ...data,
    requirementId: uid("TRQ"),
    companyId,
    driverMasterId,
    companyDriverRelationshipId: data.companyDriverRelationshipId || activeRelationship(store, driverMasterId)?.id,
    createdAt: now,
    updatedAt: now,
    isArchived: false,
  }
  saveCompanyDriverStore({ ...store, trainingRequirements: [...store.trainingRequirements, requirement] })
  auditDriverMutation(companyId, requirement.requirementId, "CREATE", "Created Driver training requirement.")
  return requirement
}

export function updateTrainingRequirement(companyId: string, requirementId: string, patch: Partial<TrainingRequirement>) {
  const store = loadCompanyDriverStore(companyId)
  const current = store.trainingRequirements.find((r) => r.requirementId === requirementId)
  if (!current) throw new Error("Training requirement not found.")
  const updated = {
    ...current,
    ...patch,
    requirementId: current.requirementId,
    companyId: current.companyId,
    driverMasterId: current.driverMasterId,
    updatedAt: new Date().toISOString(),
  }
  saveCompanyDriverStore({ ...store, trainingRequirements: store.trainingRequirements.map((r) => r.requirementId === requirementId ? updated : r) })
  auditDriverMutation(companyId, requirementId, "UPDATE", "Updated Driver training requirement.")
  return updated
}

export function waiveTrainingRecord(companyId: string, id: string, reason: string) {
  const store = loadCompanyDriverStore(companyId)
  const current = store.trainingRecords.find((r) => r.id === id)
  if (!current) throw new Error("Training record not found.")
  const now = new Date().toISOString()
  const updated = { ...current, status: "Waived" as const, waiveReason: reason, waivedDate: now.slice(0, 10), updatedAt: now }
  saveCompanyDriverStore({ ...store, trainingRecords: store.trainingRecords.map((r) => r.id === id ? updated : r) })
  auditDriverMutation(companyId, id, "UPDATE", "Recorded a Driver training waiver without deleting the historical training record.")
  return updated
}

export function addPerformanceEvent(companyId: string, driverMasterId: string, data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const relationshipId = activeRelationship(store, driverMasterId)?.id
  const record: DriverPerformanceEvent = { ...data, id: uid("EVT"), companyId, driverMasterId, companyDriverRelationshipId: relationshipId, linkedRecords: data.linkedRecords || [], evidenceIds: data.evidenceIds || [], chronology: data.chronology || [], provenance: data.provenance || { sourceType: "SOURCE_FACT", source: "Driver event" }, isArchived: false, createdAt: now, updatedAt: now }
  saveCompanyDriverStore({ ...store, events: [...store.events, record] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created canonical company-owned Driver event record.")
  return record
}

export function updatePerformanceEvent(companyId: string, eventId: string, patch: Partial<DriverPerformanceEvent>) {
  const store = loadCompanyDriverStore(companyId)
  const updated = store.events.map((event) => event.id === eventId ? { ...event, ...patch, id: event.id, companyId: event.companyId, driverMasterId: event.driverMasterId, updatedAt: new Date().toISOString() } : event)
  saveCompanyDriverStore({ ...store, events: updated })
  auditDriverMutation(companyId, eventId, "UPDATE", "Updated canonical company-owned Driver event record.")
  return updated.find((event) => event.id === eventId)
}

export function addHOSReview(companyId: string, data: Omit<HOSReview, "id" | "createdAt" | "updatedAt">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const review: HOSReview = { ...data, id: uid("HOSR"), companyId, createdAt: now, updatedAt: now }
  saveCompanyDriverStore({ ...store, hosReviews: [...store.hosReviews, review] })
  auditDriverMutation(companyId, review.id, "CREATE", "Created HOS human/company review record; calculated conditions remain distinct.")
  return review
}

export function addCompanyAction(companyId: string, data: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const action: CompanyActionRecord = { ...data, id: uid("ACT"), companyId, createdAt: now, updatedAt: now, isArchived: false }
  saveCompanyDriverStore({ ...store, companyActions: [...store.companyActions, action] })
  auditDriverMutation(companyId, action.id, "CREATE", "Created company-owned Driver action record.")
  return action
}

export function addCompanyDetermination(companyId: string, data: Omit<CompanyDetermination, "id" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const determination: CompanyDetermination = { ...data, id: uid("DET"), companyId, createdAt: now, updatedAt: now, isArchived: false }
  saveCompanyDriverStore({ ...store, companyDeterminations: [...store.companyDeterminations, determination] })
  auditDriverMutation(companyId, determination.id, "CREATE", "Created company determination record attributed to the company.")
  return determination
}

export function addDriverApplication(companyId: string, driverMasterId: string, data: Omit<DriverApplicationRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt">) {
  const store = loadCompanyDriverStore(companyId)
  const relationshipId = data.companyDriverRelationshipId || activeRelationship(store, driverMasterId)?.id
  const now = new Date().toISOString()
  const record: DriverApplicationRecord = {
    ...data,
    id: uid("APP"),
    companyId,
    driverMasterId,
    companyDriverRelationshipId: relationshipId,
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    createdAt: now,
    updatedAt: now,
  }
  saveCompanyDriverStore({ ...store, applications: [record, ...store.applications] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created a Driver Application record with only explicitly established application facts.")
  return record
}

export function addHiringPackage(companyId: string, driverMasterId: string, data: Omit<HiringPackageRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt">) {
  const store = loadCompanyDriverStore(companyId)
  const relationshipId = data.companyDriverRelationshipId || activeRelationship(store, driverMasterId)?.id
  const now = new Date().toISOString()
  const record: HiringPackageRecord = {
    ...data,
    id: uid("HPK"),
    companyId,
    driverMasterId,
    companyDriverRelationshipId: relationshipId,
    items: Array.isArray(data.items) ? data.items : [],
    evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    createdAt: now,
    updatedAt: now,
  }
  saveCompanyDriverStore({ ...store, hiringPackages: [record, ...store.hiringPackages] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created a Driver Hiring Package with no fabricated completed checklist items.")
  return record
}

export function addDriverTaxDoc(companyId: string, driverMasterId: string, data: Omit<DriverTaxDocRecord, "id" | "companyId" | "driverMasterId" | "createdAt">) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const record: DriverTaxDocRecord = {
    ...data,
    id: uid("TAX"),
    companyId,
    driverMasterId,
    createdAt: now,
  }
  saveCompanyDriverStore({ ...store, taxDocs: [record, ...store.taxDocs] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created a structured Driver tax/onboarding document metadata record.")
  return record
}

export function updateDriverApplicationDetermination(companyId: string, applicationId: string, decision: DriverApplicationRecord["companyDetermination"], reviewer: string, notes?: string) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const updated = store.applications.map((application) => application.id === applicationId ? { ...application, companyDetermination: decision, determinationDate: now.slice(0, 10), reviewedBy: reviewer, reviewedDate: now.slice(0, 10), determinationNotes: notes, updatedAt: now } : application)
  saveCompanyDriverStore({ ...store, applications: updated })
  return updated.find((application) => application.id === applicationId)
}

export function updateHiringPackageItem(companyId: string, packageId: string, itemId: string, signed: boolean, signedBy?: string) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const updated = store.hiringPackages.map((pkg) => pkg.id === packageId ? { ...pkg, items: pkg.items.map((item) => item.id === itemId ? { ...item, signed, signedBy: signed ? signedBy : undefined, signedDate: signed ? now.slice(0, 10) : undefined } : item), updatedAt: now } : pkg)
  saveCompanyDriverStore({ ...store, hiringPackages: updated })
  return updated.find((pkg) => pkg.id === packageId)
}

export function updateCompanyDriverStore(companyId: string, mutator: (store: CompanyDriverStore) => CompanyDriverStore) {
  const before = loadCompanyDriverStore(companyId)
  const next = mutator(clone(before))
  saveCompanyDriverStore(next)
  return next
}

export const makeInternalId = uid
export function createRecord<T extends object>(companyId: string, code: string, collection: Array<{ id?: string; recordId?: string }>, data: T) {
  const now = new Date().toISOString()
  return { id: uid(code), recordId: allocateSubRecordId(companyId, code, collection), ...data, createdAt: now, updatedAt: now }
}
