import { normalizeName } from "@/lib/identifier-normalization"
import { normalizeDriverDate, requireDriverDate } from "@/lib/driver-date"
import { TRAINING_COURSE_CATALOG } from "@/lib/driver-taxonomy"
import { recordAuditEvent } from "@/lib/audit-logger"
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE, PERFORMANCE_CATEGORY_OWNERSHIP, PERFORMANCE_EVENT_SCHEMA_VERSION, resolvePerformanceApplicability } from "@/lib/driver-performance-schema"
import { loadVehicleStore } from "@/lib/vehicle-data"
import { getRoadsideViolationCollection, getRoadsideEquipmentCollection, deriveRoadsideViolationCounts, deriveRoadsideInspectionOutcome, validateRoadsideViolationCollection, validateRoadsideEquipmentCollection, validateRoadsideStatementCollection, validateRoadsideInspectionConsistency, createRoadsideStatementItem, createRoadsideStatementCollection, ROADSIDE_VIOLATION_COLLECTION_ID, type RoadsideStatementInput } from "@/lib/driver-performance-child-facts"
import { eventFactsByKey, getRoadsideOpenActions } from "@/lib/driver-performance-families"
import { resolveNearMissUnsafeCondition, validateNewNearMiss } from "@/lib/performance-near-miss"
import type { UnsafeConditionResolutionOutcome } from "@/lib/performance-near-miss"
import { validateNewCollision } from "@/lib/performance-collision"
import { validateNewCargoIncident } from "@/lib/performance-cargo"
import { validateNewSpillRelease } from "@/lib/performance-spill"

import type {
  AddressRecord,
  CompanyActionRecord,
  CompanyDetermination,
  CanonicalEntityLink,
  CompanyDriverRelationship,
  CompanyDriverStore,
  DriverApplicationRecord,
  DriverEvidenceItem,
  DriverInput,
  DriverMaster,
  DriverMasterStore,
  DriverPerformanceEvent,
  StructuredEventFact,
  PerformanceFactReconciliation,
  PerformanceRelationshipResolution,
  PerformanceFactObservation,
  PerformanceSourceIngestionItem,
  EventStatus,
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
  DriverApplicationFinding,
  DriverApplicationProcessingRecord,} from "@/types/drivers"

export type {
  AddressRecord,
  CompanyDriverRelationship,
  DriverApplicationRecord,
  DriverEvidenceItem,
  DriverInput,
  DriverMaster,
  DriverMasterStore,
  DriverPerformanceEvent,
  StructuredEventFact,
  EventStatus,
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
      dateOfBirth: normalizeDriverDate(identity.dateOfBirth),
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
    startDate: normalizeDriverDate(raw.startDate),
    endDate: normalizeDriverDate(raw.endDate) || undefined,
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

// Resolves a stored enum field. A valid canonical value is preserved unchanged (also when a previous lossy migration parked it
// in the legacy slot); a recognised display label maps to its canonical value; anything else keeps the legacy-preserving fallback.
function resolveStoredEnum<T extends string>(primaryRaw: string | undefined, legacyRaw: string | undefined, map: Record<string, T>, fallback?: T): { canonical: T | undefined; legacy: string | undefined } {
  const own = (key: string) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined)
  const canonicalSet = new Set<string>(Object.values(map))
  const primary = clean(primaryRaw)
  const legacySlot = clean(legacyRaw)
  // The old lossy migration wrote the fallback (OTHER) as the primary and parked the real canonical value in the legacy slot.
  const damagedFallback = fallback !== undefined && primary === fallback && legacySlot !== primary && canonicalSet.has(legacySlot)
  if (canonicalSet.has(primary) && !damagedFallback) return { canonical: primary as T, legacy: legacySlot || undefined }
  if (canonicalSet.has(legacySlot)) return { canonical: legacySlot as T, legacy: legacySlot }
  const candidate = legacySlot || primary
  return { canonical: own(candidate), legacy: candidate || undefined }
}

function migrateCompanyDetermination(raw: any, companyId: string): CompanyDetermination {
  const type = resolveStoredEnum(raw.determinationType, raw.legacyDeterminationType, DETERMINATION_TYPE_MAP)
  const value = resolveStoredEnum(raw.determinationValue, raw.legacyDeterminationValue, DETERMINATION_VALUE_MAP)
  return {
    ...raw, id: clean(raw.id) || uid("DET"), companyId, driverMasterId: raw.driverMasterId || "",
    relatedRecordType: raw.relatedRecordType, legacyRelatedRecordType: raw.legacyRelatedRecordType, relatedRecordId: raw.relatedRecordId,
    determinationType: type.canonical, legacyDeterminationType: type.legacy,
    determinationValue: value.canonical, legacyDeterminationValue: value.legacy,
    preventabilityFinding: raw.preventabilityFinding, legacyPreventabilityFinding: raw.legacyPreventabilityFinding,
    isArchived: Boolean(raw.isArchived), createdAt: raw.createdAt || new Date().toISOString(), updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  }
}

function migrateCompanyAction(raw: any, companyId: string): CompanyActionRecord {
  const type = resolveStoredEnum(raw.actionType, raw.legacyActionType, ACTION_TYPE_MAP, "OTHER")
  return {
    ...raw, id: clean(raw.id) || uid("ACT"), companyId, driverMasterId: raw.driverMasterId || "",
    actionType: type.canonical || "OTHER", legacyActionType: type.legacy,
    status: raw.status || "Draft", isArchived: Boolean(raw.isArchived), createdAt: raw.createdAt || new Date().toISOString(), updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  }
}

function normalizePerformanceEventCompatibility(raw: any): DriverPerformanceEvent {
  const event = { ...raw } as DriverPerformanceEvent;
  if (Array.isArray(event.evidenceIds)) event.evidenceIds = [...new Set(event.evidenceIds.filter(Boolean))];
  if (!event.occurrencePrecision) event.occurrencePrecision = event.eventTime ? "EXACT_DATETIME" : event.eventDate ? "DATE_ONLY" : "UNKNOWN";
  event.factReconciliation = normalizePerformanceReconciliation(event.factReconciliation);
  if (event.factReconciliation && Array.isArray(event.structuredEventFacts)) {
    for (const fact of event.structuredEventFacts) {
      const resolution = event.factReconciliation[fact.dataPointId];
      if (!resolution) continue;
      // structuredEventFacts is canonical current truth; reconciliation metadata is normalized to it.
      resolution.canonicalDataPointId = fact.dataPointId;
      resolution.resolvedValue = fact.value;
      resolution.supportingObservationIds = [...new Set(resolution.supportingObservationIds || resolution.observations.map((observation) => observation.observationId))];
    }
  }
  return event;
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
    performanceInvestigations: [],
    eventRelationships: [],
    performanceIngestionItems: [],
  }
  if (Array.isArray(raw)) return { ...base, relationships: raw.map((r) => normalizeRelationship(r, companyId)) }
  if (!raw || typeof raw !== "object") return base

  const relationships = Array.isArray(raw.relationships) ? raw.relationships.map((r: any) => normalizeRelationship(r, companyId)) : []
  const legacyEvents = Array.isArray(raw.performanceEvents) ? raw.performanceEvents : []
  const events = (Array.isArray(raw.events) && raw.events.length ? raw.events : legacyEvents).map((event: any) => normalizePerformanceEventCompatibility(event))
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
    // Additive Common Performance Investigation Engine collections: stores written before this slice load them as [].
    performanceInvestigations: Array.isArray(raw.performanceInvestigations) ? raw.performanceInvestigations : [],
    eventRelationships: Array.isArray(raw.eventRelationships) ? raw.eventRelationships : [],
    performanceIngestionItems: Array.isArray(raw.performanceIngestionItems) ? raw.performanceIngestionItems : [],
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


function reconcileApplicantSubmissionHandoffs(store: CompanyDriverStore): CompanyDriverStore {
  if (typeof window === "undefined" || store.applications.length === 0) return store

  let changed = false
  const applications = store.applications.map((application) => {
    const pendingKey = `tes_pending_driver_application_handoff_${application.id}`
    const submittedKey = `tes_applicant_application_submitted_${application.id}`
    const raw = localStorage.getItem(pendingKey) || localStorage.getItem(submittedKey)
    if (!raw) return application

    try {
      const snapshot = JSON.parse(raw) as {
        applicationId?: string
        submittedAt?: string
        receiptId?: string
        completedSteps?: string[]
        draft?: unknown
      }
      if (snapshot.applicationId !== application.id || !snapshot.submittedAt) return application

      const existingSnapshot = (application as any).applicantSubmittedSnapshot
      if (existingSnapshot) {
        localStorage.removeItem(pendingKey)
        return application
      }

      const laterStatus = ["Submitted", "Under Review", "Approved", "Rejected", "Superseded"].includes(application.status)
      changed = true
      localStorage.removeItem(pendingKey)

      return {
        ...application,
        status: laterStatus ? application.status : "Submitted",
        submittedAt: application.submittedAt || snapshot.submittedAt,
        updatedAt: snapshot.submittedAt,
        applicantSubmissionReceiptId: (application as any).applicantSubmissionReceiptId || snapshot.receiptId,
        applicantSubmittedSnapshot: snapshot,
        processing: {
          ...(application.processing ?? {}),
          status: application.processing?.status ?? "Not Started",
          fileCompleteness: application.processing?.fileCompleteness ?? "Not Assessed",
          qualificationAssessment: application.processing?.qualificationAssessment ?? "Not Assessed",
          findingIds: application.processing?.findingIds ?? [],
          updatedAt: application.processing?.updatedAt ?? snapshot.submittedAt,
        },
      } as typeof application
    } catch {
      return application
    }
  })

  return changed ? { ...store, applications } : store
}


export type ApplicantSubmissionHandoff = {
  applicationId: string
  submittedAt: string
  receiptId: string
  completedSteps: string[]
  draft: unknown
}

export function ingestApplicantSubmissionSnapshot(
  companyId: string,
  snapshot: ApplicantSubmissionHandoff,
): { applied: boolean; store: CompanyDriverStore } {
  const store = loadCompanyDriverStore(companyId)
  const index = store.applications.findIndex((application) => application.id === snapshot.applicationId)
  if (index < 0) return { applied: false, store }

  const application = store.applications[index]
  const existingSnapshot = (application as any).applicantSubmittedSnapshot
  if (existingSnapshot) return { applied: false, store }

  const laterStatus = ["Submitted", "Under Review", "Approved", "Rejected", "Superseded"].includes(application.status)
  const updatedApplication = {
    ...application,
    status: laterStatus ? application.status : "Submitted",
    submittedAt: application.submittedAt || snapshot.submittedAt,
    updatedAt: snapshot.submittedAt,
    applicantSubmissionReceiptId: (application as any).applicantSubmissionReceiptId || snapshot.receiptId,
    applicantSubmittedSnapshot: snapshot,
    processing: {
      ...(application.processing ?? {}),
      status: application.processing?.status ?? "Not Started",
      fileCompleteness: application.processing?.fileCompleteness ?? "Not Assessed",
      qualificationAssessment: application.processing?.qualificationAssessment ?? "Not Assessed",
      findingIds: application.processing?.findingIds ?? [],
      updatedAt: application.processing?.updatedAt ?? snapshot.submittedAt,
    },
  } as typeof application

  const applications = [...store.applications]
  applications[index] = updatedApplication
  const nextStore = { ...store, applications }
  saveCompanyDriverStore(nextStore)
  return { applied: true, store: nextStore }
}

export const loadCompanyDriverStore = (companyId: string): CompanyDriverStore => {
  const raw = read<any>(companyDriverStorageKey(companyId), null)
  const migrated = migrateCompanyStore(raw, companyId, getTrainingCourseCatalog())
  const reconciled = reconcileApplicantSubmissionHandoffs(migrated)
  const shouldPersist = reconciled !== migrated || !raw || raw.version !== 2 || !Array.isArray(raw.trainingRecords) || !Array.isArray(raw.relationships) ||
    reconciled.trainingRecords.some((record) => !record.id || !record.courseMappingState) ||
    reconciled.relationships.some((relationship) => !relationship.companyDriverRecordId)
  if (shouldPersist) {
    try { write(companyDriverStorageKey(companyId), reconciled) } catch { /* keep reconciled in memory */ }
  }
  return reconciled
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
    evidenceIds: [...new Set((event.evidenceIds || []).filter(Boolean))],
    factReconciliation: normalizePerformanceReconciliation(event.factReconciliation),
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
    performanceEvents: events,
    performanceRelationshipResolutions: store.performanceRelationshipResolutions || [],
    performanceIngestionItems: store.performanceIngestionItems || [],
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
  requireDriverDate(x.dateOfBirth, "Date of Birth")
  requireDriverDate(x.relationshipStartDate, "Relationship Start Date")
  if (x.relationshipEndDate) requireDriverDate(x.relationshipEndDate, "Relationship End Date")
  requireDriverDate(x.addressEffectiveFrom, "Address Effective From")
  requireDriverDate(x.licenceEffectiveFrom, "Licence Effective From")
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
        dateOfBirth: requireDriverDate(input.dateOfBirth, "Date of Birth"), phone: clean(input.phone) || undefined, email: clean(input.email) || undefined,
      },
      identityReferences: [{ id: uid("IDR"), type: "DRIVER_LICENCE", value: normalizeLicenceNumber(input.licenceNumber), jurisdiction: input.licenceJurisdiction, country: input.licenceCountry, createdAt: now, source: "Driver onboarding" }],
      licenceHistory: [{ id: uid("LIC"), licenceNumber: normalizeLicenceNumber(input.licenceNumber), licenceNumberRaw: input.licenceNumber.trim(), licenceNumberNormalized: normalizeLicenceNumber(input.licenceNumber), jurisdiction: input.licenceJurisdiction, country: input.licenceCountry, class: clean(input.licenceClass) || undefined, endorsements: input.endorsements, airBrakeQualified: input.airBrakeQualified, effectiveFrom: requireDriverDate(input.licenceEffectiveFrom, "Licence Effective From"), effectiveTo: null, status: "Current", source: "Driver onboarding", createdAt: now, verificationState: input.verificationState || "Unverified" }],
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
  input = {
    ...input,
    effectiveFrom: requireDriverDate(input.effectiveFrom, "Licence Effective From"),
    issueDate: input.issueDate ? requireDriverDate(input.issueDate, "Licence Issue Date") : undefined,
    expiryDate: input.expiryDate ? requireDriverDate(input.expiryDate, "Licence Expiry Date") : undefined,
  }
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
  const identity = {
    ...driver.identity,
    ...patch,
    legalFirstName: normalizeName(patch.legalFirstName ?? driver.identity.legalFirstName),
    legalLastName: normalizeName(patch.legalLastName ?? driver.identity.legalLastName),
    dateOfBirth: patch.dateOfBirth !== undefined
      ? requireDriverDate(patch.dateOfBirth, "Date of Birth")
      : normalizeDriverDate(driver.identity.dateOfBirth),
    email: patch.email !== undefined ? clean(patch.email).toLowerCase() || undefined : driver.identity.email,
  }
  const updated = { ...driver, identity, updatedAt: new Date().toISOString() }
  saveDriverMasterStore({ version: 2, drivers: store.drivers.map((d) => d.id === driverId ? updated : d) })
  auditDriverMutation("", driverId, "UPDATE", "Updated canonical Driver Master identity.")
  return updated
}

export function updateCompanyDriverRelationship(companyId: string, relationshipId: string, patch: Partial<CompanyDriverRelationship>) {
  const store = loadCompanyDriverStore(companyId)
  const current = store.relationships.find((r) => r.id === relationshipId)
  if (!current) throw new Error("Company Driver relationship not found.")
  const updated = {
    ...current,
    ...patch,
    startDate: patch.startDate !== undefined ? requireDriverDate(patch.startDate, "Relationship Start Date") : current.startDate,
    endDate: patch.endDate !== undefined ? (patch.endDate ? requireDriverDate(patch.endDate, "Relationship End Date") : undefined) : current.endDate,
    id: current.id,
    companyDriverRecordId: current.companyDriverRecordId,
    companyId: current.companyId,
    driverMasterId: current.driverMasterId,
    updatedAt: new Date().toISOString(),
  }
  saveCompanyDriverStore({ ...store, relationships: store.relationships.map((r) => r.id === relationshipId ? updated : r) })
  auditDriverMutation(companyId, relationshipId, "UPDATE", "Updated company Driver relationship.")
  return updated
}

export function addDriverAddress(driverId: string, address: Omit<AddressRecord, "id" | "status" | "source" | "createdAt" | "effectiveTo">) {
  const store = loadDriverMasterStore()
  const driver = store.drivers.find((d) => d.id === driverId)
  if (!driver) throw new Error("Driver not found.")
  if (!validatePostalZip(address.country, address.postalZip)) throw new Error("Postal / ZIP format is invalid.")
  const effectiveFrom = requireDriverDate(address.effectiveFrom, "Address Effective From")
  address = { ...address, effectiveFrom }
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

export function addDriverEvidence(companyId: string, driverMasterId: string, input: { fileName: string; mimeType?: string; dataUrl: string; documentType?: string }) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const evidence: DriverEvidenceItem = {
    id: uid("EVD"),
    companyId,
    driverMasterId,
    fileName: input.fileName,
    fileType: input.mimeType || "application/octet-stream",
    mimeType: input.mimeType,
    documentType: input.documentType || "Performance Event Evidence",
    uploadedAt: now,
    source: "upload",
    dataUrl: input.dataUrl,
    verificationState: "unverified",
    evidenceVersion: 1,
    isArchived: false,
  }
  saveCompanyDriverStore({ ...store, evidence: [...store.evidence, evidence] })
  auditDriverMutation(companyId, evidence.id, "CREATE", "Created canonical Driver evidence record for later relational linking.")
  return evidence
}

export function createPendingPerformanceIngestion(companyId: string, driverMasterId: string | undefined, evidence: DriverEvidenceItem) {
  const store = loadCompanyDriverStore(companyId);
  const now = new Date().toISOString();
  const item: PerformanceSourceIngestionItem = {
    id: `PIN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    companyId,
    driverMasterId,
    evidenceId: evidence.id,
    receivedAt: now,
    sourceFileName: evidence.fileName,
    sourceMimeType: evidence.mimeType || evidence.fileType,
    sourceType: evidence.documentType || evidence.mimeType || evidence.fileType,
    origin: "DOCUMENT_UPLOAD",
    state: "AWAITING_EXTRACTION",
    processingReviewState: "PENDING",
  };
  saveCompanyDriverStore({ ...store, performanceIngestionItems: [...(store.performanceIngestionItems || []), item] });
  auditDriverMutation(companyId, item.id, "CREATE", "Created Performance source ingestion item awaiting machine extraction; no Performance category or structured facts were fabricated.");
  return item;
}

function makePerformanceObservation(eventId: string, fact: StructuredEventFact, source: string | undefined, sourceRecordId: string | undefined, evidenceIds: string[], observedAt: string, origin?: string): PerformanceFactObservation {
  const extractionOccurred = Boolean(fact.extraction?.provider || fact.extraction?.extractedAt || fact.extraction?.reviewState || fact.extraction?.rawValue !== undefined);
  const rawValue = fact.extraction?.rawValue !== undefined ? fact.extraction.rawValue : fact.value;
  return {
    observationId: uid("PO"),
    dataPointId: fact.dataPointId,
    value: fact.value,
    valueType: fact.valueType,
    rawValue,
    normalizedValue: fact.normalizedValue,
    normalizedUnit: fact.normalizedUnit,
    unit: fact.unit,
    source,
    sourceRecordId,
    sourceEvidenceIds: [...new Set(evidenceIds)],
    confidence: fact.extraction?.confidence,
    confidenceType: extractionOccurred ? "EXTRACTION" : undefined,
    observedAt,
    ingestedAt: observedAt,
    extraction: extractionOccurred ? {
      occurred: true,
      provider: fact.extraction?.provider,
      version: undefined,
      extractedAt: fact.extraction?.extractedAt,
      confidence: fact.extraction?.confidence,
    } : { occurred: false },
    provenance: {
      sourceType: origin === "MANUAL_FALLBACK" || origin === "MANUAL_ENTRY" ? "SOURCE_FACT" : origin === "DOCUMENT_OCR" ? "SOURCE_FACT" : "SOURCE_FACT",
      source,
      sourceRecordId,
      ingestionOrigin: origin,
      ingestionTimestamp: observedAt,
      sourceEvidenceIds: evidenceIds.length ? [...new Set(evidenceIds)] : undefined,
    },
    reviewState: origin === "MANUAL_FALLBACK" || origin === "MANUAL_ENTRY" ? "PENDING_REVIEW" : (fact.extraction?.reviewState === "VERIFIED" ? "VERIFIED" : "PENDING_REVIEW"),
  };
}

function buildInitialPerformanceReconciliation(eventId: string, facts: StructuredEventFact[], source: string | undefined, sourceRecordId: string | undefined, evidenceIds: string[], observedAt: string, origin?: string): Record<string, PerformanceFactReconciliation> {
  return Object.fromEntries(facts.map((fact) => {
    const observation = makePerformanceObservation(eventId, fact, source, sourceRecordId, evidenceIds, observedAt, origin);
    return [fact.dataPointId, {
      canonicalDataPointId: fact.dataPointId,
      resolvedValue: fact.value,
      supportingObservationIds: [observation.observationId],
      state: "CLEAN",
      observations: [observation],
      resolutionMethod: "INITIAL_SOURCE_OBSERVATION",
      resolvedAt: observedAt,
    } satisfies PerformanceFactReconciliation];
  }));
}

function normalizePerformanceReconciliation(reconciliation: Record<string, PerformanceFactReconciliation> | undefined): Record<string, PerformanceFactReconciliation> | undefined {
  if (!reconciliation) return undefined;
  return Object.fromEntries(Object.entries(reconciliation).map(([dataPointId, item]) => [dataPointId, {
    ...item,
    observations: (item.observations || []).map((observation, index) => ({
      ...observation,
      observationId: observation.observationId || `PO-LEGACY-${dataPointId}-${index}`,
      dataPointId: observation.dataPointId || dataPointId,
      sourceEvidenceIds: [...new Set(observation.sourceEvidenceIds || [])],
    })),
    canonicalDataPointId: item.canonicalDataPointId || dataPointId,
    resolvedValue: item.resolvedValue,
    supportingObservationIds: [...new Set(item.supportingObservationIds || item.observations?.map((observation) => observation.observationId) || [])],
  }]));
}

export function addPerformanceEvent(companyId: string, driverMasterId: string, data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  const store = loadCompanyDriverStore(companyId)
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[data.eventType]
  if (!definition) throw new Error(`Unsupported Performance Event category: ${data.eventType}`)
  if (PERFORMANCE_CATEGORY_OWNERSHIP[data.eventType] !== "RECORDABLE_EVENT") {
    throw new Error(`Performance Event category ${data.eventType} is owned by ${PERFORMANCE_CATEGORY_OWNERSHIP[data.eventType]} and cannot be created as a new Performance Event.`)
  }
  if (!data.structuredEventFacts) {
    throw new Error("New Performance Event writes require structuredEventFacts; structuredFacts remains read-only compatibility storage.");
  }
  if (data.structuredFacts && data.structuredEventFacts?.length) {
    throw new Error("New Performance Events may not write both structuredFacts and structuredEventFacts.")
  }
  if (data.linkedRecords?.length) {
    throw new Error("New Performance Events must use canonicalLinks, evidenceIds, or operationalReferences; legacy linkedRecords cannot be written by the new creation path.")
  }
  if (data.eventType === "Roadside Inspection") {
    const roadsideEquipmentCollection = (data.childCollections || []).find((collection) => collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.INSPECTED_EQUIPMENT");
    if (!roadsideEquipmentCollection) throw new Error("Every Roadside Inspection requires an inspected-equipment collection.");
    const roadsideFactValues = Object.fromEntries((data.structuredEventFacts || []).map((fact) => [definition.fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value]));
    const equipmentErrors = validateRoadsideEquipmentCollection(roadsideEquipmentCollection, roadsideFactValues.inspectionScope as string | undefined);
    if (equipmentErrors.length) throw new Error(equipmentErrors[0]);
    for (const collection of data.childCollections || []) {
      if (collection.collectionId === ROADSIDE_VIOLATION_COLLECTION_ID) {
        const errors = validateRoadsideViolationCollection(collection);
        if (errors.length) throw new Error(errors[0]);
      }
      if (collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.INSPECTED_EQUIPMENT") {
        const errors = validateRoadsideEquipmentCollection(collection, Object.fromEntries((data.structuredEventFacts || []).map((fact) => [definition.fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value])).inspectionScope as string | undefined);
        if (errors.length) throw new Error(errors[0]);
      }
      if (collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS") {
        const errors = validateRoadsideStatementCollection(collection);
        if (errors.length) throw new Error(errors[0]);
      }
    }
  }
  for (const link of data.canonicalLinks || []) {
    if (link.source !== "CANONICAL_STORE") throw new Error("Canonical entity links must declare CANONICAL_STORE provenance.")
  }
  if (data.eventType === "Near Miss" || data.eventType === "Collision" || data.eventType === "Cargo Incident" || data.eventType === "Spill or Release") {
    const candidate = { ...data, id: "PENDING_EVENT", driverMasterId }
    const familyErrors = data.eventType === "Near Miss" ? validateNewNearMiss(candidate) : data.eventType === "Collision" ? validateNewCollision(candidate) : data.eventType === "Spill or Release" ? validateNewSpillRelease(candidate) : validateNewCargoIncident(candidate)
    if (familyErrors.length) throw new Error(familyErrors[0])
    // Canonical relationship targets must exist in the company vehicle store.
    const knownVehicles = new Set(loadVehicleStore(companyId).vehicles.map((vehicle) => vehicle.id))
    const linkedVehicleIds = [data.vehicleId, ...(data.canonicalLinks || []).filter((link) => link.entityType === "Vehicle" || link.entityType === "Trailer").map((link) => link.recordId)].filter((id): id is string => Boolean(id))
    const missingVehicle = linkedVehicleIds.find((id) => !knownVehicles.has(id))
    if (missingVehicle) throw new Error(`${data.eventType} relationship target does not exist in the company Vehicle store: ${missingVehicle}.`)
  }
  if (data.structuredEventFacts) {
    const factValues = Object.fromEntries(data.structuredEventFacts.map((fact) => {
      const field = definition.fields.find((candidate) => candidate.dataPointId === fact.dataPointId);
      return [field?.key || fact.dataPointId, fact.value];
    }));
    const missingRequired = definition.fields.filter((field) => {
      const state = resolvePerformanceApplicability(field.applicability, factValues);
      const required = state === "REQUIRED" || (state === "CONDITIONAL" && Boolean(field.required)) || (field.required && !field.applicability);
      return field.key !== "sourceType" && field.key !== "sourceRecordId" && required && (factValues[field.key] === undefined || factValues[field.key] === null || factValues[field.key] === "");
    });
    if (missingRequired.length) throw new Error(`Performance Event is missing required data point(s): ${missingRequired.map((field) => field.dataPointId).join(", ")}`);
    const seen = new Set<string>()
    for (const fact of data.structuredEventFacts) {
      if (seen.has(fact.dataPointId)) throw new Error(`Duplicate Performance Data Point: ${fact.dataPointId}`)
      seen.add(fact.dataPointId)
      const field = definition.fields.find((candidate) => candidate.dataPointId === fact.dataPointId)
      if (!field) throw new Error(`Unknown Performance Data Point for ${data.eventType}: ${fact.dataPointId}`)
      if (field.kind === "select" && typeof fact.value === "string" && field.options && !field.options.some((option) => option.value === fact.value)) {
        throw new Error(`Invalid controlled value for ${fact.dataPointId}.`)
      }
      if (field.unitOptions?.length && (!fact.unit || !field.unitOptions.includes(fact.unit))) {
        throw new Error(`Explicit unit required for ${fact.dataPointId}.`)
      }
    }
  }
  const now = new Date().toISOString()
  const relationshipId = activeRelationship(store, driverMasterId)?.id
  const eventId = uid("EVT")
  const evidenceIds = [...new Set((data.evidenceIds || []).filter(Boolean))]
  const facts = data.structuredEventFacts || []
  const origin = data.ingestion?.origin || data.provenance?.ingestionOrigin
  const reconciliation: Record<string, PerformanceFactReconciliation> = normalizePerformanceReconciliation(data.factReconciliation) || (facts.length ? buildInitialPerformanceReconciliation(eventId, facts, data.provenance?.source, data.provenance?.sourceRecordId, evidenceIds, now, origin) : {})
  if (data.eventType === "Roadside Inspection" && reconciliation) {
    const reported = facts.find((fact) => fact.dataPointId === DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Roadside Inspection"].fields.find((field) => field.key === "sourceReportedViolationCount")?.dataPointId);
    const collection = getRoadsideViolationCollection(data);
    if (reported && typeof reported.value === "number" && collection) {
      const derived = deriveRoadsideViolationCounts(collection).total;
      if (collection.completeness === "COMPLETE" && reported.value !== derived) {
        reconciliation[reported.dataPointId] = {
          ...(reconciliation[reported.dataPointId] || { observations: [] }),
          canonicalDataPointId: reported.dataPointId,
          resolvedValue: reported.value,
          supportingObservationIds: reconciliation[reported.dataPointId]?.supportingObservationIds || reconciliation[reported.dataPointId]?.observations?.map((observation) => observation.observationId) || [],
          state: "REVIEW_REQUIRED",
          resolutionMethod: "SOURCE_TOTAL_VS_STRUCTURED_CHILD_RECONCILIATION",
          resolutionReason: `Complete structured child count (${derived}) differs from source-reported violation total (${reported.value}).`,
        };
      } else if (collection.completeness === "PARTIAL") {
        reconciliation[reported.dataPointId] = {
          ...(reconciliation[reported.dataPointId] || { observations: [] }),
          canonicalDataPointId: reported.dataPointId,
          resolvedValue: reported.value,
          supportingObservationIds: reconciliation[reported.dataPointId]?.supportingObservationIds || reconciliation[reported.dataPointId]?.observations?.map((observation) => observation.observationId) || [],
          state: "REVIEW_REQUIRED",
          resolutionMethod: "SOURCE_TOTAL_VS_PARTIAL_CHILD_RECONCILIATION",
          resolutionReason: `Source-reported violation total (${reported.value}) is preserved while only ${derived} structured child violation(s) are itemized; child collection is PARTIAL.`,
        };
      }
    }
  }
  if (data.eventType === "Roadside Inspection") {
    const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Roadside Inspection"];
    const factsByKey = Object.fromEntries(facts.map((fact) => [definition.fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value]));
    const roadsideCollection = getRoadsideViolationCollection(data);
    if (roadsideCollection) {
      const collectionErrors = validateRoadsideViolationCollection(roadsideCollection);
      if (collectionErrors.length) throw new Error(collectionErrors[0]);
    }
    const consistencyErrors = validateRoadsideInspectionConsistency(factsByKey, roadsideCollection);
    if (consistencyErrors.length) throw new Error(consistencyErrors[0]);
    const derivedOutcome = deriveRoadsideInspectionOutcome(factsByKey, roadsideCollection);
    const sourceOutcomeField = definition.fields.find((field) => field.key === "inspectionResult");
    const sourceOutcome = sourceOutcomeField ? facts.find((fact) => fact.dataPointId === sourceOutcomeField.dataPointId)?.value : undefined;
    if (sourceOutcome && derivedOutcome !== "UNKNOWN" && sourceOutcome !== derivedOutcome && sourceOutcomeField) {
      reconciliation[sourceOutcomeField.dataPointId] = {
        ...(reconciliation[sourceOutcomeField.dataPointId] || { observations: [] }),
        canonicalDataPointId: sourceOutcomeField.dataPointId,
        resolvedValue: sourceOutcome,
        supportingObservationIds: reconciliation[sourceOutcomeField.dataPointId]?.supportingObservationIds || reconciliation[sourceOutcomeField.dataPointId]?.observations?.map((observation) => observation.observationId) || [],
        state: "REVIEW_REQUIRED",
        resolutionMethod: "SOURCE_OVERALL_OUTCOME_VS_DERIVED_RECONCILIATION",
        resolutionReason: `Source-reported overall outcome (${sourceOutcome}) differs from deterministic component outcome (${derivedOutcome}).`,
      };
    }
  }

  // NOTE: PerformanceEventRecord (this record) is the sole canonical record
  // for Roadside Inspection events — see lib/driver-performance-relationship-resolution.ts,
  // which already resolves Power Unit + every Towed Unit to canonical Vehicle
  // identity via resolveCanonicalVehicleByIdentifiers and persists the result
  // on relationshipResolutions[]. Vehicle-side surfaces read/reference this
  // event (see getRoadsideEventsForVehicle) rather than copying it into a
  // second VehicleInspectionRecord.

  const record: DriverPerformanceEvent = {
    ...data,
    id: eventId,
    companyId,
    driverMasterId,
    companyDriverRelationshipId: relationshipId,
    schemaVersion: data.schemaVersion || PERFORMANCE_EVENT_SCHEMA_VERSION,
    evidenceIds,
    chronology: data.chronology || [],
    provenance: data.provenance || { sourceType: "SOURCE_FACT", source: "Driver event" },
    factReconciliation: reconciliation,
    recordProcessingState: data.recordProcessingState || "RECEIVED",
    workflowState: data.workflowState || (data.followUpActionRequired ? "OPEN" : "NOT_REQUIRED"),
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  }
  saveCompanyDriverStore({ ...store, events: [...store.events, record] })
  auditDriverMutation(companyId, record.id, "CREATE", "Created canonical company-owned Driver event record.")
  return record
}

function derivedManualProcessingState(data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">, evidenceIds: string[]): "RECEIVED" | "VERIFIED" {
  if (data.recordProcessingState === "VERIFIED") return "VERIFIED";
  return evidenceIds.length && data.verificationState === "Verified" ? "VERIFIED" : "RECEIVED";
}

export function addManualPerformanceEvent(companyId: string, driverMasterId: string, data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  const now = new Date().toISOString();
  const evidenceIds = [...new Set((data.evidenceIds || []).filter(Boolean))];
  const provenance = {
    ...(data.provenance || { sourceType: "SOURCE_FACT" as const, source: "Manual Driver Performance Entry" }),
    sourceType: "SOURCE_FACT" as const,
    ingestionOrigin: evidenceIds.length ? "MANUAL_FALLBACK" : "MANUAL_ENTRY",
    sourceEvidenceIds: evidenceIds.length ? evidenceIds : undefined,
    extractionState: "NOT_APPLICABLE" as const,
    extractionConfidence: undefined,
  };
  return addPerformanceEvent(companyId, driverMasterId, { ...data, evidenceIds, recordProcessingState: derivedManualProcessingState(data, evidenceIds), provenance, ingestion: {
    origin: "MANUAL_ENTRY",
    sourceType: provenance.source || "Manual Driver Performance Entry",
    sourceRecordId: provenance.sourceRecordId,
    sourceEvidenceIds: evidenceIds,
    receivedAt: provenance.ingestionTimestamp || now,
    processedAt: now,
  } });
}

export function reconcilePerformanceEventFacts(companyId: string, eventId: string, reconciliation: Record<string, PerformanceFactReconciliation>, actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  const invalid = Object.values(reconciliation).some((item) => !["CLEAN", "CONFLICT", "REVIEW_REQUIRED", "RESOLVED"].includes(item.state));
  if (invalid) throw new Error("Invalid Performance fact reconciliation state.");
  const now = new Date().toISOString();
  const updated = store.events.map((event) => event.id === eventId ? {
    ...event,
    factReconciliation: reconciliation,
    updatedAt: now,
    chronology: appendEventChronology(event, "FACT_RECONCILIATION_UPDATED", `Updated reconciliation for ${Object.keys(reconciliation).length} Data Point(s).`, actor),
  } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  auditDriverMutation(companyId, eventId, "UPDATE", `Updated Performance fact reconciliation for ${Object.keys(reconciliation).length} Data Point(s).`);
  return updated.find((event) => event.id === eventId);
}

export function persistPerformanceRelationshipResolutions(companyId: string, eventId: string, resolutions: PerformanceRelationshipResolution[]) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  const previous = current.relationshipResolutions || [];
  const previousByKey = new Map(previous.map((item) => [item.relationshipKey, item]));
  const effectiveResolutions = resolutions.map((next) => {
    const prior = previousByKey.get(next.relationshipKey);
    if (prior?.state === "CONFIRMED" && prior.resolvedRecordId && canonicalRelationshipExists(companyId, current, prior.targetEntityType, prior.resolvedRecordId)) {
      return { ...prior, evaluatedAt: next.evaluatedAt };
    }
    return next;
  });

  const semanticEqual = (a: PerformanceRelationshipResolution | undefined, b: PerformanceRelationshipResolution | undefined) => {
    if (!a || !b) return false;
    return a.targetEntityType === b.targetEntityType && a.state === b.state && a.resolvedRecordId === b.resolvedRecordId &&
      JSON.stringify([...a.candidateIds].sort()) === JSON.stringify([...b.candidateIds].sort());
  };
  const changed = effectiveResolutions.some((item) => !semanticEqual(previousByKey.get(item.relationshipKey), item)) || previous.some((item) => !effectiveResolutions.some((next) => next.relationshipKey === item.relationshipKey));

  const eventLinks = [...(current.canonicalLinks || [])];
  const confirmedLinks = effectiveResolutions.filter((item) => item.state === "CONFIRMED" && item.resolvedRecordId);
  for (const prior of previous) {
    if (prior.state !== "AUTO_RESOLVED" || !prior.resolvedRecordId) continue;
    const next = effectiveResolutions.find((item) => item.relationshipKey === prior.relationshipKey);
    if (next?.resolvedRecordId === prior.resolvedRecordId) continue;
    const targetType = prior.targetEntityType as CanonicalEntityLink["entityType"];
    const protectedLink = confirmedLinks.some((item) => item.targetEntityType === prior.targetEntityType && item.resolvedRecordId === prior.resolvedRecordId);
    if (!protectedLink) {
      for (let i = eventLinks.length - 1; i >= 0; i -= 1) {
        if (eventLinks[i].entityType === targetType && eventLinks[i].recordId === prior.resolvedRecordId && (!eventLinks[i].relationshipKey || eventLinks[i].relationshipKey === prior.relationshipKey)) eventLinks.splice(i, 1);
      }
    }
  }
  for (const resolution of effectiveResolutions) {
    if (resolution.state === "AUTO_RESOLVED" && resolution.resolvedRecordId) {
      const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[current.eventType];
      const relationship = definition?.relationships?.find((item) => item.key === resolution.relationshipKey);
      const entityType = resolution.targetEntityType as CanonicalEntityLink["entityType"];
      // Replace stale AUTO-resolved links only for the same typed relationship target.
      for (let i = eventLinks.length - 1; i >= 0; i -= 1) {
        if (eventLinks[i].entityType === entityType && relationship && relationship.key === resolution.relationshipKey && eventLinks[i].recordId !== resolution.resolvedRecordId) eventLinks.splice(i, 1);
      }
      if (!eventLinks.some((item) => item.entityType === entityType && item.recordId === resolution.resolvedRecordId)) {
        eventLinks.push({ entityType, recordId: resolution.resolvedRecordId, label: resolution.resolvedRecordId, relationshipKey: resolution.relationshipKey, source: "CANONICAL_STORE" });
      }
    }
  }
  for (const resolution of effectiveResolutions.filter((item) => item.state === "CONFIRMED" && item.resolvedRecordId)) {
    const entityType = resolution.targetEntityType as CanonicalEntityLink["entityType"];
    if (!eventLinks.some((item) => item.entityType === entityType && item.recordId === resolution.resolvedRecordId)) {
      eventLinks.push({ entityType, recordId: resolution.resolvedRecordId!, label: resolution.resolvedRecordId, source: "CANONICAL_STORE" });
    }
  }
  const now = new Date().toISOString();
  const updatedEvents = store.events.map((event) => {
    if (event.id !== eventId) return event;
    const nextEvent = { ...event, canonicalLinks: eventLinks, relationshipResolutions: effectiveResolutions, updatedAt: now };
    if (nextEvent.eventType === "Roadside Inspection" && nextEvent.childCollections?.length) {
      nextEvent.childCollections = nextEvent.childCollections.map((collection) => collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.INSPECTED_EQUIPMENT"
        ? { ...collection, items: collection.items.map((item) => ({ ...item, relationships: effectiveResolutions.filter((resolution) => resolution.relationshipKey === `equipment:${item.itemId}`) })) }
        : collection);
    }
    if (changed) nextEvent.chronology = appendEventChronology(event, "RELATIONSHIPS_REEVALUATED", `Relationship resolution changed: ${effectiveResolutions.map((item) => `${item.relationshipKey}=${item.state}`).join(", ")}.`, null);
    return nextEvent;
  });
  saveCompanyDriverStore({ ...store, events: updatedEvents, performanceRelationshipResolutions: [...(store.performanceRelationshipResolutions || []).filter((item) => item.eventId !== eventId), ...effectiveResolutions] });
  if (changed) auditDriverMutation(companyId, eventId, "UPDATE", `Performance relationships reevaluated: ${effectiveResolutions.map((item) => `${item.relationshipKey}=${item.state}`).join(", ")}.`);
  return updatedEvents.find((event) => event.id === eventId);
}

export interface RoadsideEventForVehicle {
  event: DriverPerformanceEvent;
  /** Which physical unit this vehicle played in the event — a vehicle can appear as the Power Unit in one event and a Towed Unit in another. */
  matchedRole: "POWER_UNIT" | "TOWED_UNIT";
  resolution: PerformanceRelationshipResolution;
}

/**
 * Read-only cross-reference from a canonical Vehicle to the Roadside
 * Inspection Performance Events it actually participated in. This does NOT
 * copy or duplicate the event — PerformanceEventRecord (EVT-*) remains the
 * sole canonical record for Roadside/CVSA inspections; this only reads the
 * identity resolution that lib/driver-performance-relationship-resolution.ts
 * already computes and persists on event.relationshipResolutions[]
 * (relationshipKey "equipment:<itemId>", resolvedRecordId = canonical
 * Vehicle id). A vehicle that did not participate in any event correctly
 * returns an empty array — nothing propagates company-wide.
 */
export function getRoadsideEventsForVehicle(companyId: string, vehicleId: string): RoadsideEventForVehicle[] {
  const store = loadCompanyDriverStore(companyId);
  const results: RoadsideEventForVehicle[] = [];
  for (const event of store.events) {
    if (event.isArchived || event.eventType !== "Roadside Inspection") continue;
    const equipmentCollection = getRoadsideEquipmentCollection(event);
    for (const resolution of event.relationshipResolutions || []) {
      if (!resolution.relationshipKey.startsWith("equipment:")) continue;
      if (resolution.targetEntityType !== "Vehicle") continue;
      if (resolution.resolvedRecordId !== vehicleId) continue;
      const itemId = resolution.relationshipKey.slice("equipment:".length);
      const item = equipmentCollection?.items.find((candidate) => candidate.itemId === itemId);
      const role = item?.facts.role === "TOWED_UNIT" ? "TOWED_UNIT" : "POWER_UNIT";
      results.push({ event, matchedRole: role, resolution });
    }
  }
  return results.sort((a, b) => b.event.eventDate.localeCompare(a.event.eventDate));
}

export type PerformanceEventFactCorrection = {
  dataPointId: string;
  previousValue: StructuredEventFact["value"] | undefined;
  newValue: StructuredEventFact["value"];
  reason: string;
  actor?: string | null;
  provenance?: string;
};

export type PerformanceEventWorkflowUpdate = {
  status?: EventStatus;
  followUpActionRequired?: boolean;
  followUpDueDate?: string;
  followUpActionSummary?: string;
  verificationState?: DriverPerformanceEvent["verificationState"];
  dispute?: DriverPerformanceEvent["dispute"];
};

const appendEventChronology = (event: DriverPerformanceEvent, action: string, details: string, actor: string | null = null): DriverPerformanceEvent["chronology"] => [
  ...(event.chronology || []),
  { id: `CHRON-${Date.now().toString(36)}`, timestamp: new Date().toISOString(), action, actor, details },
];

export function correctPerformanceEventFacts(companyId: string, eventId: string, corrections: PerformanceEventFactCorrection[]) {
  if (!corrections.length) throw new Error("At least one factual correction is required.");
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  const facts = [...(current.structuredEventFacts || [])];
  const now = new Date().toISOString();
  for (const correction of corrections) {
    if (!correction.reason.trim()) throw new Error(`Correction reason is required for ${correction.dataPointId}.`);
    const index = facts.findIndex((fact) => fact.dataPointId === correction.dataPointId);
    const previous = index >= 0 ? facts[index].value : undefined;
    if (correction.previousValue !== previous) throw new Error(`Previous value mismatch for ${correction.dataPointId}; reload the event before correcting it.`);
    const previousFact = index >= 0 ? facts[index] : undefined;
    const reconciliation = current.factReconciliation?.[correction.dataPointId];
    if (previousFact) {
      const existingObservations = [...(reconciliation?.observations || [])];
      const priorObservation = existingObservations.length ? undefined : makePerformanceObservation(current.id, previousFact, previousFact.source, current.provenance?.sourceRecordId, current.evidenceIds || [], now, current.ingestion?.origin || current.provenance?.ingestionOrigin);
      const nextObservation = makePerformanceObservation(current.id, { ...previousFact, value: correction.newValue, extraction: undefined }, correction.provenance || "Manual correction", current.provenance?.sourceRecordId, current.evidenceIds || [], now, "MANUAL_ENTRY");
      const observations = [...existingObservations, ...(priorObservation ? [priorObservation] : []), nextObservation];
      const uniqueObservations = observations.filter((observation, index, list) => list.findIndex((candidate) => candidate.observationId === observation.observationId) === index);
      current.factReconciliation = {
        ...(current.factReconciliation || {}),
        [correction.dataPointId]: {
          ...(reconciliation || { state: "CLEAN", observations: [] }),
          canonicalDataPointId: correction.dataPointId,
          resolvedValue: correction.newValue,
          supportingObservationIds: uniqueObservations.map((observation) => observation.observationId),
          state: "RESOLVED",
          observations: uniqueObservations,
          resolutionMethod: "HUMAN_CORRECTION",
          resolvedBy: correction.actor || undefined,
          resolvedAt: now,
          resolutionReason: correction.reason,
        },
      };
      facts[index] = { ...previousFact, value: correction.newValue, source: correction.provenance || previousFact.source };
    } else {
      const newFact: StructuredEventFact = { dataPointId: correction.dataPointId, value: correction.newValue, valueType: typeof correction.newValue === "number" ? "number" : typeof correction.newValue === "boolean" ? "boolean" : "string", source: correction.provenance };
      facts.push(newFact);
      const observation = makePerformanceObservation(current.id, newFact, correction.provenance || "Manual correction", current.provenance?.sourceRecordId, current.evidenceIds || [], now, "MANUAL_ENTRY");
      current.factReconciliation = { ...(current.factReconciliation || {}), [correction.dataPointId]: { canonicalDataPointId: correction.dataPointId, resolvedValue: correction.newValue, supportingObservationIds: [observation.observationId], state: "RESOLVED", observations: [observation], resolutionMethod: "HUMAN_CORRECTION", resolvedBy: correction.actor || undefined, resolvedAt: now, resolutionReason: correction.reason } };
    }
    current.chronology = appendEventChronology(current, "FACT_CORRECTED", `Data Point ${correction.dataPointId} corrected. Previous value: ${JSON.stringify(previous)}; new value: ${JSON.stringify(correction.newValue)}. Reason: ${correction.reason}.`, correction.actor || null);
    auditDriverMutation(companyId, eventId, "UPDATE", `Factual correction ${correction.dataPointId}; previous=${JSON.stringify(previous)}; new=${JSON.stringify(correction.newValue)}; reason=${correction.reason}; actor=${correction.actor || "system"}.`);
  }
  const updated = store.events.map((event) => event.id === eventId ? { ...current, structuredEventFacts: facts, updatedAt: now } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  return updated.find((event) => event.id === eventId);
}

/** Runs one common-engine writer (investigation, determination, requirement, closure ...) against the stored company state and persists the result. */
export function applyPerformanceEngineWrite(companyId: string, eventId: string, description: string, writer: (store: CompanyDriverStore) => { state: CompanyDriverStore }) {
  const next = updateCompanyDriverStore(companyId, (store) => writer(store).state);
  auditDriverMutation(companyId, eventId, "UPDATE", description);
  return next;
}

/** Append-only resolution / clarification of a Near Miss unsafe condition. The occurrence fact the reporter recorded is never edited. */
export function resolveNearMissUnsafeConditionForEvent(companyId: string, eventId: string, input: { outcome?: UnsafeConditionResolutionOutcome; resolvedBy: string; note?: string }) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current || current.eventType !== "Near Miss") throw new Error("Near Miss event not found.");
  const next = { ...resolveNearMissUnsafeCondition(current, input), updatedAt: new Date().toISOString() };
  saveCompanyDriverStore({ ...store, events: store.events.map((event) => event.id === eventId ? next : event) });
  auditDriverMutation(companyId, eventId, "UPDATE", "Recorded Near Miss unsafe-condition resolution (append-only).");
  return next;
}

export function updatePerformanceEventWorkflow(companyId: string, eventId: string, update: PerformanceEventWorkflowUpdate, actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  if (current.eventType === "Roadside Inspection" && update.status === "Closed") {
    // Closure only when every required action is resolved. Citations have their own lifecycle and never gate this.
    const openActions = getRoadsideOpenActions(current, eventFactsByKey(current, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Roadside Inspection"].fields));
    if (openActions.length) throw new Error(`Roadside Inspection cannot be closed while required actions remain: ${openActions.map((action) => action.label).join("; ")}.`);
  }
  const now = new Date().toISOString();
  const changed = Object.keys(update).filter((key) => (update as Record<string, unknown>)[key] !== undefined);
  const updated = store.events.map((event) => event.id === eventId ? { ...event, ...update, structuredEventFacts: event.structuredEventFacts, updatedAt: now, chronology: appendEventChronology(event, "EVENT_WORKFLOW_UPDATED", `Workflow/lifecycle fields updated: ${changed.join(", ")}.`, actor) } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  auditDriverMutation(companyId, eventId, "UPDATE", `Updated Performance Event workflow state only: ${changed.join(", ")}.`);
  return updated.find((event) => event.id === eventId);
}

export function linkPerformanceEventEvidence(companyId: string, eventId: string, evidenceIds: string[], actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  const validEvidence = new Set(store.evidence.filter((item) => !item.isArchived).map((item) => item.id));
  if (evidenceIds.some((id) => !validEvidence.has(id))) throw new Error("Every evidence ID must resolve to a current canonical Driver evidence record.");
  const now = new Date().toISOString();
  const updated = store.events.map((event) => event.id === eventId ? { ...event, evidenceIds: [...new Set(evidenceIds)], updatedAt: now, chronology: appendEventChronology(event, "EVIDENCE_LINKED", `Linked ${evidenceIds.length} canonical evidence record(s).`, actor) } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  auditDriverMutation(companyId, eventId, "UPDATE", `Linked ${evidenceIds.length} canonical evidence record(s).`);
  return updated.find((event) => event.id === eventId);
}

export function linkPerformanceEventDetermination(companyId: string, eventId: string, determinationId: string, actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  if (!store.companyDeterminations.some((item) => item.id === determinationId && item.driverMasterId === current.driverMasterId)) throw new Error("Company Determination does not resolve to this Driver.");
  const now = new Date().toISOString();
  const updated = store.events.map((event) => event.id === eventId ? { ...event, companyDeterminationId: determinationId, updatedAt: now, chronology: appendEventChronology(event, "DETERMINATION_LINKED", `Company Determination ${determinationId} linked; source facts were not changed.`, actor) } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  auditDriverMutation(companyId, eventId, "UPDATE", `Linked Company Determination ${determinationId}; no source fact mutation.`);
  return updated.find((event) => event.id === eventId);
}

export function linkPerformanceEventRecord(companyId: string, eventId: string, link: CanonicalEntityLink, actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  const links = [...(current.canonicalLinks || []).filter((item) => !(item.entityType === link.entityType && item.recordId === link.recordId)), link];
  const now = new Date().toISOString();
  const updated = store.events.map((event) => event.id === eventId ? { ...event, canonicalLinks: links, updatedAt: now, chronology: appendEventChronology(event, "CANONICAL_RECORD_LINKED", `${link.entityType} ${link.recordId} linked from canonical store.`, actor) } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  auditDriverMutation(companyId, eventId, "UPDATE", `Linked canonical ${link.entityType} record ${link.recordId}.`);
  return updated.find((event) => event.id === eventId);
}

function canonicalRelationshipExists(companyId: string, event: DriverPerformanceEvent, entityType: string, recordId: string) {
  const store = loadCompanyDriverStore(companyId);
  if (entityType === "Vehicle") {
    try {
      if (loadVehicleStore(companyId).vehicles.some((item) => item.id === recordId && item.status !== "Archived" && item.status !== "Inactive")) return true;
      if (typeof window !== "undefined") {
        const rawCompanies = window.localStorage.getItem("tes_companies");
        const companies = rawCompanies ? JSON.parse(rawCompanies) : [];
        if (Array.isArray(companies)) {
          return companies.some((company) => { try { return loadVehicleStore(String(company.id)).vehicles.some((item) => item.id === recordId && item.status !== "Archived" && item.status !== "Inactive"); } catch { return false; } });
        }
      }
      return false;
    } catch { return false; }
  }
  if (entityType === "Maintenance") {
    try { return loadVehicleStore(companyId).maintenanceRecords.some((item) => item.id === recordId && !item.archived); } catch { return false; }
  }
  if (entityType === "Training") return store.trainingRecords.some((item) => item.id === recordId && item.driverMasterId === event.driverMasterId && !item.isArchived);
  if (entityType === "Training Requirement") return store.trainingRequirements.some((item) => item.requirementId === recordId && item.driverMasterId === event.driverMasterId && !item.isArchived);
  if (entityType === "HOS") return store.hosRawRecords.some((item) => item.id === recordId) || store.hosDutyEvents.some((item) => item.id === recordId) || store.hosPotentialViolations.some((item) => item.id === recordId) || store.hosReviews.some((item) => item.id === recordId);
  if (entityType === "Citation") {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem(`tes_company_citations_${companyId}`);
      const parsed = raw ? JSON.parse(raw) as { citations?: Array<{ id: string }> } : {};
      return Boolean(parsed.citations?.some((item) => item.id === recordId));
    } catch { return false; }
  }
  return false;
}

export function confirmPerformanceRelationshipResolution(companyId: string, eventId: string, relationshipKey: string, targetEntityType: string, targetRecordId: string, reason: string, actor: string | null = null) {
  if (!reason.trim()) throw new Error("A relationship confirmation reason is required.");
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  if (!canonicalRelationshipExists(companyId, current, targetEntityType, targetRecordId)) throw new Error(`Canonical ${targetEntityType} record ${targetRecordId} does not resolve in its owning store.`);
  const existing = (store.performanceRelationshipResolutions || []).filter((item) => !(item.eventId === eventId && item.relationshipKey === relationshipKey));
  const now = new Date().toISOString();
  const relationshipType = relationshipKey === "training" ? "GENERATED_REQUIREMENT" : relationshipKey === "hos" ? "DETECTED_DURING" : relationshipKey === "evidence" ? "SUPPORTING_EVIDENCE" : "ASSOCIATED_WITH";
  const resolution: PerformanceRelationshipResolution = {
    id: `PRR-${eventId}-${relationshipKey}`,
    relationshipId: `PRR-${eventId}-${relationshipKey}`,
    eventId,
    fromEntityType: "DriverPerformanceEvent",
    fromEntityId: eventId,
    relationshipKey,
    relationshipRole: relationshipKey,
    relationshipType,
    targetEntityType,
    toEntityId: targetRecordId,
    resolvedRecordId: targetRecordId,
    state: "CONFIRMED",
    candidateIds: [targetRecordId],
    deterministicMatchingReason: "Human exception review confirmed the selected canonical relationship.",
    resolutionSource: "HUMAN_REVIEW",
    evidenceIds: [...new Set(current.evidenceIds || [])],
    provenance: { sourceType: "SYSTEM_DERIVED", source: "Human relationship review", sourceRecordId: eventId, sourceEvidenceIds: current.evidenceIds || [], ingestionTimestamp: now },
    createdAt: now,
    evaluatedAt: now,
    resolutionReason: reason.trim(),
    resolvedAt: now,
    resolvedBy: actor || undefined,
  };
  const links = [...(current.canonicalLinks || []).filter((item) => !(item.entityType === targetEntityType && item.recordId !== targetRecordId)), { entityType: targetEntityType as CanonicalEntityLink["entityType"], recordId: targetRecordId, label: targetRecordId, source: "CANONICAL_STORE" as const }];
  const updatedEvents = store.events.map((event) => event.id === eventId ? { ...event, canonicalLinks: links, relationshipResolutions: [...(event.relationshipResolutions || []).filter((item) => item.relationshipKey !== relationshipKey), resolution], updatedAt: now, chronology: appendEventChronology(event, "RELATIONSHIP_CONFIRMED", `${relationshipKey} confirmed to ${targetEntityType} ${targetRecordId}. Reason: ${reason.trim()}.`, actor) } : event);
  saveCompanyDriverStore({ ...store, events: updatedEvents, performanceRelationshipResolutions: [...existing, resolution] });
  auditDriverMutation(companyId, eventId, "UPDATE", `Confirmed Performance relationship ${relationshipKey} to ${targetEntityType} ${targetRecordId}.`);
  return updatedEvents.find((event) => event.id === eventId);
}

export function archivePerformanceEvent(companyId: string, eventId: string) {
  const store = loadCompanyDriverStore(companyId)
  const current = store.events.find((event) => event.id === eventId)
  if (!current) throw new Error("Performance event not found.")
  if (current.isArchived) return current

  const now = new Date().toISOString()
  const archived = store.events.map((event) => event.id === eventId ? {
    ...event,
    isArchived: true,
    updatedAt: now,
    chronology: [
      ...(event.chronology || []),
      { id: `CHRON-${Date.now().toString(36)}`, timestamp: now, action: "EVENT_ARCHIVED", actor: null, details: "Performance event archived. Historical record retained; no deletion performed." },
    ],
  } : event)
  saveCompanyDriverStore({ ...store, events: archived })
  auditDriverMutation(companyId, eventId, "ARCHIVE", "Archived canonical company-owned Driver event record; historical data retained.")
  return archived.find((event) => event.id === eventId)
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
// =========================================================
// DRIVER HIRING WORKFLOW ASSESSMENT
// =========================================================

export function updateDriverApplication(
  companyId: string,
  applicationId: string,
  patch: Partial<DriverApplicationRecord>
) {
  const store = loadCompanyDriverStore(companyId)
  const now = new Date().toISOString()
  const applications = store.applications.map((application) =>
    application.id === applicationId
      ? { ...application, ...patch, id: application.id, companyId: application.companyId, driverMasterId: application.driverMasterId, updatedAt: now }
      : application
  )
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(companyId, applicationId, "UPDATE", "Updated Driver Application workflow state without rewriting source evidence.")
  return applications.find((application) => application.id === applicationId)
}


type DriverApplicationComparisonInput = {
  subject: DriverApplicationFinding["subject"]
  label: string
  applicantStatement?: string
  evidenceStatement?: string
  evidenceIds?: string[]
  normalize?: (value: string) => string
  required?: boolean
}

const normalizeComparisonText = (value: string) =>
  clean(value).toLowerCase().replace(/\s+/g, " ")

const normalizeComparisonIdentifier = (value: string) =>
  clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "")

const normalizeComparisonDate = (value: string) => {
  const raw = clean(value)
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : raw
}

/**
 * Creates a factual comparison result without changing either source.
 * This is deliberately source-neutral: applicant claim and evidence remain separate.
 */
export function compareDriverApplicationFact(input: DriverApplicationComparisonInput) {
  const normalize = input.normalize || normalizeComparisonText
  const applicantRaw = clean(input.applicantStatement)
  const evidenceRaw = clean(input.evidenceStatement)

  if (!applicantRaw && !evidenceRaw) {
    return input.required
      ? {
          type: "MISSING_INFORMATION" as const,
          status: "Open" as const,
          subject: input.subject,
          label: input.label,
          applicantStatement: undefined,
          evidenceStatement: undefined,
          evidenceIds: input.evidenceIds || [],
          notes: "Required information is not available from either source.",
        }
      : null
  }

  if (!applicantRaw) {
    return {
      type: "MISSING_INFORMATION" as const,
      status: "Open" as const,
      subject: input.subject,
      label: input.label,
      applicantStatement: undefined,
      evidenceStatement: evidenceRaw || undefined,
      evidenceIds: input.evidenceIds || [],
      notes: "Supporting information exists, but the submitted application does not contain the corresponding fact.",
    }
  }

  if (!evidenceRaw) {
    return {
      type: "UNABLE_TO_VERIFY" as const,
      status: "Open" as const,
      subject: input.subject,
      label: input.label,
      applicantStatement: applicantRaw,
      evidenceStatement: undefined,
      evidenceIds: input.evidenceIds || [],
      notes: "The submitted fact is present, but no supporting extracted fact is currently available for comparison.",
    }
  }

  if (normalize(applicantRaw) === normalize(evidenceRaw)) {
    return {
      type: "MATCH" as const,
      status: "Resolved" as const,
      subject: input.subject,
      label: input.label,
      applicantStatement: applicantRaw,
      evidenceStatement: evidenceRaw,
      evidenceIds: input.evidenceIds || [],
      notes: "Applicant statement and supporting extracted fact agree after normalization.",
    }
  }

  return {
    type: "MISMATCH" as const,
    status: "Open" as const,
    subject: input.subject,
    label: input.label,
    applicantStatement: applicantRaw,
    evidenceStatement: evidenceRaw,
    evidenceIds: input.evidenceIds || [],
    notes: "The submitted application and supporting extracted fact contain different values.",
  }
}

export type DriverApplicationEvidenceFacts = {
  evidenceIds?: string[]
  legalFirstName?: string
  legalLastName?: string
  dateOfBirth?: string
  licenceNumber?: string
  licenceJurisdiction?: string
  licenceClass?: string
  licenceExpiryDate?: string
}

/**
 * Phase 9 reconciliation boundary.
 * OCR/classification providers should map their output into DriverApplicationEvidenceFacts first.
 * This function never reads provider-specific OCR payloads and never overwrites application claims.
 */
export function reconcileDriverApplicationEvidence(
  companyId: string,
  applicationId: string,
  evidenceFacts: DriverApplicationEvidenceFacts
) {
  const store = loadCompanyDriverStore(companyId)
  const application = store.applications.find((item) => item.id === applicationId)
  if (!application) throw new Error("Driver Application not found.")
  if (!["Submitted", "Under Review", "Additional Information Requested"].includes(application.status)) {
    throw new Error("Only an immutable submitted application can be reconciled against evidence.")
  }

  const claimed = application.claimed || {}
  const claimedLicence = claimed.licences?.[0]
  const comparisons = [
    compareDriverApplicationFact({
      subject: "Identity",
      label: "Legal first name",
      applicantStatement: claimed.personal?.firstName,
      evidenceStatement: evidenceFacts.legalFirstName,
      evidenceIds: evidenceFacts.evidenceIds,
      required: true,
    }),
    compareDriverApplicationFact({
      subject: "Identity",
      label: "Legal last name",
      applicantStatement: claimed.personal?.lastName,
      evidenceStatement: evidenceFacts.legalLastName,
      evidenceIds: evidenceFacts.evidenceIds,
      required: true,
    }),
    compareDriverApplicationFact({
      subject: "Identity",
      label: "Date of birth",
      applicantStatement: claimed.personal?.dateOfBirth,
      evidenceStatement: evidenceFacts.dateOfBirth,
      evidenceIds: evidenceFacts.evidenceIds,
      normalize: normalizeComparisonDate,
      required: true,
    }),
    compareDriverApplicationFact({
      subject: "Licence",
      label: "Driver licence number",
      applicantStatement: claimedLicence?.licenceNumber,
      evidenceStatement: evidenceFacts.licenceNumber,
      evidenceIds: evidenceFacts.evidenceIds,
      normalize: normalizeComparisonIdentifier,
      required: true,
    }),
    compareDriverApplicationFact({
      subject: "Licence",
      label: "Licence jurisdiction",
      applicantStatement: claimedLicence?.jurisdiction,
      evidenceStatement: evidenceFacts.licenceJurisdiction,
      evidenceIds: evidenceFacts.evidenceIds,
      required: true,
    }),
    compareDriverApplicationFact({
      subject: "Licence",
      label: "Licence class",
      applicantStatement: claimedLicence?.class,
      evidenceStatement: evidenceFacts.licenceClass,
      evidenceIds: evidenceFacts.evidenceIds,
      required: true,
    }),
    compareDriverApplicationFact({
      subject: "Licence",
      label: "Licence expiry date",
      applicantStatement: claimedLicence?.expiryDate,
      evidenceStatement: evidenceFacts.licenceExpiryDate,
      evidenceIds: evidenceFacts.evidenceIds,
      normalize: normalizeComparisonDate,
      required: true,
    }),
  ].filter(Boolean) as Array<Omit<DriverApplicationFinding, "id" | "createdAt" | "updatedAt">>

  const now = new Date().toISOString()
  const existing = application.findings || []

  // Replace only prior automated findings for the same subject+label+evidence set.
  // Human-entered findings and unrelated findings are preserved.
  const evidenceKey = (evidenceFacts.evidenceIds || []).slice().sort().join("|")
  const comparisonKeys = new Set(comparisons.map((item) => `${item.subject}::${item.label}`))
  const retained = existing.filter((item) => {
    const sameComparison = comparisonKeys.has(`${item.subject}::${item.label}`)
    const sameEvidence = (item.evidenceIds || []).slice().sort().join("|") === evidenceKey
    return !(sameComparison && sameEvidence && item.notes?.startsWith("[AUTO]"))
  })

  const generated: DriverApplicationFinding[] = comparisons.map((item) => ({
    ...item,
    id: uid("APPF"),
    notes: `[AUTO] ${item.notes || ""}`.trim(),
    createdAt: now,
    updatedAt: now,
    resolvedAt: item.status === "Resolved" ? now : undefined,
  }))

  const findings = [...retained, ...generated]
  const reviewRequired = generated.some((item) => item.type !== "MATCH")
  const processing: DriverApplicationProcessingRecord = {
    ...(application.processing || {
      status: "Processing",
      findingIds: [],
      fileCompleteness: "Not Assessed",
      qualificationAssessment: "Not Assessed",
      updatedAt: now,
    }),
    status: reviewRequired ? "Review Required" : "Processed",
    findingIds: findings.map((item) => item.id),
    fileCompleteness: reviewRequired ? "Review Required" : "Complete",
    updatedAt: now,
    completedAt: reviewRequired ? application.processing?.completedAt : now,
  }

  const applications = store.applications.map((item) =>
    item.id === applicationId
      ? { ...item, status: "Under Review" as const, findings, processing, updatedAt: now }
      : item
  )
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(
    companyId,
    applicationId,
    "UPDATE",
    "Compared immutable submitted Driver Application claims with normalized evidence facts; source values were preserved."
  )

  return {
    applicationId,
    generatedFindings: generated,
    reviewRequired,
    processing,
  }
}

export function queueDriverApplicationProcessing(companyId: string, applicationId: string) {
  const store = loadCompanyDriverStore(companyId)
  const application = store.applications.find((item) => item.id === applicationId)
  if (!application) throw new Error("Driver Application not found.")
  if (!["Submitted", "Under Review"].includes(application.status)) {
    throw new Error("Only a submitted application can enter TES processing.")
  }

  const now = new Date().toISOString()
  const processing: DriverApplicationProcessingRecord = {
    status: "Queued",
    queuedAt: application.processing?.queuedAt || now,
    findingIds: application.findings?.map((finding) => finding.id) || [],
    fileCompleteness: application.processing?.fileCompleteness || "Not Assessed",
    qualificationAssessment: application.processing?.qualificationAssessment || "Not Assessed",
    updatedAt: now,
  }

  const applications = store.applications.map((item) =>
    item.id === applicationId
      ? { ...item, status: "Under Review" as const, processing, updatedAt: now }
      : item
  )
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(companyId, applicationId, "UPDATE", "Queued immutable submitted Driver Application for TES processing.")
  return applications.find((item) => item.id === applicationId)
}

export function updateDriverApplicationProcessing(
  companyId: string,
  applicationId: string,
  patch: Partial<DriverApplicationProcessingRecord>
) {
  const store = loadCompanyDriverStore(companyId)
  const application = store.applications.find((item) => item.id === applicationId)
  if (!application) throw new Error("Driver Application not found.")
  if (!["Submitted", "Under Review", "Additional Information Requested"].includes(application.status)) {
    throw new Error("TES processing can only update a submitted application workflow.")
  }

  const now = new Date().toISOString()
  const current: DriverApplicationProcessingRecord = application.processing || {
    status: "Not Started",
    findingIds: [],
    fileCompleteness: "Not Assessed",
    qualificationAssessment: "Not Assessed",
    updatedAt: now,
  }
  const processing: DriverApplicationProcessingRecord = {
    ...current,
    ...patch,
    findingIds: Array.isArray(patch.findingIds) ? patch.findingIds : current.findingIds,
    updatedAt: now,
  }

  const applications = store.applications.map((item) =>
    item.id === applicationId ? { ...item, processing, updatedAt: now } : item
  )
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(companyId, applicationId, "UPDATE", "Updated TES processing state without rewriting submitted applicant claims.")
  return applications.find((item) => item.id === applicationId)
}

export function addDriverApplicationFinding(
  companyId: string,
  applicationId: string,
  finding: Omit<DriverApplicationFinding, "id" | "createdAt" | "updatedAt">
) {
  const store = loadCompanyDriverStore(companyId)
  const application = store.applications.find((item) => item.id === applicationId)
  if (!application) throw new Error("Driver Application not found.")
  if (!["Submitted", "Under Review", "Additional Information Requested"].includes(application.status)) {
    throw new Error("Findings can only be attached to a submitted application.")
  }

  const now = new Date().toISOString()
  const record: DriverApplicationFinding = {
    ...finding,
    id: uid("APPF"),
    evidenceIds: Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [],
    createdAt: now,
    updatedAt: now,
  }
  const findings = [...(application.findings || []), record]
  const processing: DriverApplicationProcessingRecord = {
    ...(application.processing || {
      status: "Not Started",
      findingIds: [],
      fileCompleteness: "Not Assessed",
      qualificationAssessment: "Not Assessed",
      updatedAt: now,
    }),
    status: record.type === "MATCH" ? (application.processing?.status || "Processing") : "Review Required",
    findingIds: findings.map((item) => item.id),
    fileCompleteness:
      record.type === "MATCH"
        ? (application.processing?.fileCompleteness || "Not Assessed")
        : "Review Required",
    updatedAt: now,
  }

  const applications = store.applications.map((item) =>
    item.id === applicationId ? { ...item, status: "Under Review" as const, findings, processing, updatedAt: now } : item
  )
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(companyId, record.id, "CREATE", "Recorded a factual Driver Application reconciliation finding without changing source claims.")
  return record
}

export function resolveDriverApplicationFinding(
  companyId: string,
  applicationId: string,
  findingId: string,
  resolution: {
    status: "Resolved" | "Clarification Requested" | "New Application Required"
    resolvedBy?: string
    notes?: string
  }
) {
  const store = loadCompanyDriverStore(companyId)
  const application = store.applications.find((item) => item.id === applicationId)
  if (!application) throw new Error("Driver Application not found.")
  const existing = application.findings?.find((item) => item.id === findingId)
  if (!existing) throw new Error("Driver Application finding not found.")

  const now = new Date().toISOString()
  const findings = (application.findings || []).map((item) =>
    item.id === findingId
      ? {
          ...item,
          status: resolution.status,
          notes: resolution.notes ?? item.notes,
          resolvedAt: resolution.status === "Resolved" ? now : item.resolvedAt,
          resolvedBy: resolution.resolvedBy ?? item.resolvedBy,
          updatedAt: now,
        }
      : item
  )
  const hasOpenReview = findings.some((item) => item.type !== "MATCH" && item.status !== "Resolved")
  const status =
    resolution.status === "Clarification Requested"
      ? "Additional Information Requested" as const
      : "Under Review" as const
  const processing: DriverApplicationProcessingRecord = {
    ...(application.processing || {
      status: "Processing",
      findingIds: [],
      fileCompleteness: "Not Assessed",
      qualificationAssessment: "Not Assessed",
      updatedAt: now,
    }),
    status: hasOpenReview ? "Review Required" : "Processing",
    findingIds: findings.map((item) => item.id),
    fileCompleteness: hasOpenReview ? "Review Required" : application.processing?.fileCompleteness || "Not Assessed",
    updatedAt: now,
  }

  const applications = store.applications.map((item) =>
    item.id === applicationId ? { ...item, status, findings, processing, updatedAt: now } : item
  )
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(companyId, findingId, "UPDATE", "Updated factual reconciliation finding status without changing the submitted application.")
  return findings.find((item) => item.id === findingId)
}

export function createReplacementDriverApplication(
  companyId: string,
  applicationId: string,
  reason?: string
) {
  const store = loadCompanyDriverStore(companyId)
  const original = store.applications.find((item) => item.id === applicationId)
  if (!original) throw new Error("Driver Application not found.")
  if (!["Submitted", "Under Review", "Additional Information Requested"].includes(original.status)) {
    throw new Error("A replacement can only be created from an immutable submitted application.")
  }
  if (original.supersededByApplicationId) {
    return store.applications.find((item) => item.id === original.supersededByApplicationId)
  }

  const now = new Date().toISOString()
  const replacementId = uid("APP")
  const replacement: DriverApplicationRecord = {
    id: replacementId,
    companyId: original.companyId,
    companyDriverRelationshipId: original.companyDriverRelationshipId,
    driverMasterId: original.driverMasterId,
    applicationContext: original.applicationContext,
    tesServiceStartDateAtCreation: original.tesServiceStartDateAtCreation,
    employmentStartDateAtCreation: original.employmentStartDateAtCreation,
    replacesApplicationId: original.id,
    source: "TES Workflow",
    applicationType: original.applicationType,
    status: "Invitation Ready",
    operatingRegion: original.operatingRegion,
    createdDate: now.slice(0, 10),
    companyDetermination: "Pending",
    determinationNotes: reason,
    evidenceIds: [],
    createdAt: now,
    updatedAt: now,
  }

  const applications = [
    replacement,
    ...store.applications.map((item) =>
      item.id === original.id
        ? { ...item, status: "Superseded" as const, supersededByApplicationId: replacementId, updatedAt: now }
        : item
    ),
  ]
  saveCompanyDriverStore({ ...store, applications })
  auditDriverMutation(companyId, replacement.id, "CREATE", "Created a new replacement Driver Application while preserving the original submitted application unchanged.")
  return replacement
}


export function assessDriverHiringFile(
  companyId: string,
  driverMasterId: string,
  company?: { startDate?: string },
) {
  const store = loadCompanyDriverStore(companyId)
  const relationship = activeRelationship(store, driverMasterId)
  const applications = store.applications.filter((item) => item.driverMasterId === driverMasterId)
  const packages = store.hiringPackages.filter((item) => item.driverMasterId === driverMasterId)
  const screenings = store.screenings.filter((item) => item.driverMasterId === driverMasterId && !item.isArchived)

  const latestApplication = applications[0]
  const latestPackage = packages[0]
  const serviceStartDate = company?.startDate || undefined
  const employmentStartDate = relationship?.startDate || undefined
  const isInheritedDriver = Boolean(serviceStartDate && employmentStartDate && employmentStartDate < serviceStartDate)

  const applicationSatisfied = Boolean(
    latestApplication &&
      (latestApplication.status === "Submitted" || latestApplication.status === "Under Review" || latestApplication.status === "Approved")
  )
  const applicationPending = Boolean(latestApplication && !applicationSatisfied)

  const referenceRecords = screenings.filter((item) => item.category === "Previous Employer Verification")
  const referenceSatisfied = referenceRecords.length > 0 && referenceRecords.every((item) =>
    item.status === "Passed" || item.status === "Qualified" ||
    item.employerVerificationDetails?.verificationOutcome === "Verified as Claimed" ||
    item.employerVerificationDetails?.verificationOutcome === "No Record / Unable to Verify"
  )

  const packageRequiredItems = latestPackage?.items.filter((item) => item.required) || []
  const packageSatisfied = Boolean(
    latestPackage &&
      (latestPackage.status === "Completed" ||
        (packageRequiredItems.length > 0 && packageRequiredItems.every((item) => item.signed)))
  )

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

// ---------------------------------------------------------------------------
// Roadside Inspection: Driver Statement (post-save) and Tickets / Citations linkage
// ---------------------------------------------------------------------------

/**
 * Records a Driver Statement against an existing Roadside Inspection. Existing statements are preserved
 * (the new one is appended). Recording a statement never changes workflow Status: the inspection closes
 * only through updatePerformanceEventWorkflow once every required action is resolved.
 */
export function recordRoadsideDriverStatement(companyId: string, eventId: string, input: RoadsideStatementInput, actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const current = store.events.find((event) => event.id === eventId);
  if (!current) throw new Error("Performance event not found.");
  if (current.eventType !== "Roadside Inspection") throw new Error("Driver Statements are recorded against Roadside Inspections only.");
  const item = createRoadsideStatementItem(input);
  const existing = (current.childCollections || []).find((collection) => collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS");
  const nextCollection = createRoadsideStatementCollection([...(existing?.items || []), item]);
  const errors = validateRoadsideStatementCollection(nextCollection);
  if (errors.length) throw new Error(errors[0]);
  const now = new Date().toISOString();
  const childCollections = [...(current.childCollections || []).filter((collection) => collection.collectionId !== nextCollection.collectionId), nextCollection];
  const updated = store.events.map((event) => event.id === eventId ? { ...event, childCollections, updatedAt: now, chronology: appendEventChronology(event, "DRIVER_STATEMENT_RECORDED", `Driver Statement recorded with status ${input.status}.`, actor) } : event);
  saveCompanyDriverStore({ ...store, events: updated });
  auditDriverMutation(companyId, eventId, "UPDATE", `Recorded Roadside Driver Statement (${input.status}).`);
  return updated.find((event) => event.id === eventId);
}

export interface RoadsideLinkedCitation {
  id: string;
  label: string;
  citationType?: string;
  adjudicationStatus?: string;
  /** Citation lifecycle only (independent of the Roadside Inspection's Open/Closed status). */
  closed: boolean;
  /** The event links to a citation id that no longer exists in the Citations store. */
  missing?: boolean;
}

type StoredCitation = { id: string; reportNumber?: string; citationType?: string; adjudicationStatus?: string; resolvedDate?: string; originatingPerformanceEventId?: string; originatingDriverMasterId?: string; [key: string]: unknown };

const citationStoreKey = (companyId: string) => `tes_company_citations_${companyId}`;

function readCitationStoreRaw(companyId: string): { raw: string | null; parsed: { citations?: StoredCitation[]; [key: string]: unknown } } {
  if (typeof window === "undefined") return { raw: null, parsed: {} };
  const raw = window.localStorage.getItem(citationStoreKey(companyId));
  try { return { raw, parsed: raw ? JSON.parse(raw) : {} }; } catch { return { raw, parsed: {} }; }
}

const CITATION_CLOSED_STATUSES = ["Paid in Full", "Dismissed", "No Fine Assessed"];
const isCitationClosed = (citation: StoredCitation) => Boolean(citation.resolvedDate) || CITATION_CLOSED_STATUSES.includes(String(citation.adjudicationStatus));
const citationSummary = (citation: StoredCitation): RoadsideLinkedCitation => ({ id: citation.id, label: String(citation.reportNumber || citation.id), citationType: citation.citationType, adjudicationStatus: citation.adjudicationStatus, closed: isCitationClosed(citation) });

/** Citations linked to a Roadside Inspection: forward links on the event plus the reverse link stored on the Citation. */
export function getRoadsideLinkedCitations(companyId: string, event: Pick<DriverPerformanceEvent, "id" | "canonicalLinks">): RoadsideLinkedCitation[] {
  const citations = readCitationStoreRaw(companyId).parsed.citations || [];
  const linkedIds = new Set<string>((event.canonicalLinks || []).filter((link) => link.entityType === "Citation").map((link) => link.recordId));
  for (const citation of citations) if (citation.originatingPerformanceEventId === event.id) linkedIds.add(citation.id);
  return [...linkedIds].map((id) => {
    const citation = citations.find((item) => item.id === id);
    return citation ? citationSummary(citation) : { id, label: id, closed: false, missing: true };
  });
}

/** Citations that could still be linked: not already tied to a different Roadside Inspection. Roadside-inspection-type records are excluded (they are inspections, not tickets). */
export function getLinkableCitationsForRoadside(companyId: string, event: Pick<DriverPerformanceEvent, "id" | "canonicalLinks">): RoadsideLinkedCitation[] {
  const already = new Set(getRoadsideLinkedCitations(companyId, event).map((item) => item.id));
  return (readCitationStoreRaw(companyId).parsed.citations || [])
    .filter((citation) => citation.citationType !== "ROADSIDE_INSPECTION" && !already.has(citation.id) && (!citation.originatingPerformanceEventId || citation.originatingPerformanceEventId === event.id))
    .map(citationSummary);
}

/**
 * Creates the permanent two-way link: Roadside Inspection -> Citation (canonicalLinks) and
 * Citation -> originating Roadside Inspection (originatingPerformanceEventId on the Citation record).
 * Neither record's lifecycle or content is otherwise changed, and a Citation does not need a Roadside parent.
 */
export function linkRoadsideInspectionCitation(companyId: string, eventId: string, citationId: string, actor: string | null = null) {
  const store = loadCompanyDriverStore(companyId);
  const event = store.events.find((item) => item.id === eventId);
  if (!event) throw new Error("Performance event not found.");
  if (event.eventType !== "Roadside Inspection") throw new Error("Citations are linked from Roadside Inspections only.");
  const { raw, parsed } = readCitationStoreRaw(companyId);
  const citation = (parsed.citations || []).find((item) => item.id === citationId);
  if (!citation) throw new Error("Citation was not found in this company's Tickets / Citations.");
  if (citation.originatingPerformanceEventId && citation.originatingPerformanceEventId !== eventId) throw new Error("This Citation is already linked to a different Roadside Inspection.");
  const nextCitations = (parsed.citations || []).map((item) => item.id === citationId ? { ...item, originatingPerformanceEventId: eventId, originatingDriverMasterId: event.driverMasterId } : item);
  window.localStorage.setItem(citationStoreKey(companyId), JSON.stringify({ ...parsed, citations: nextCitations }));
  try {
    return linkPerformanceEventRecord(companyId, eventId, { entityType: "Citation", recordId: citationId, label: String(citation.reportNumber || citationId), source: "CANONICAL_STORE" }, actor);
  } catch (error) {
    if (raw === null) window.localStorage.removeItem(citationStoreKey(companyId)); else window.localStorage.setItem(citationStoreKey(companyId), raw);
    throw error;
  }
}
