import { addTrainingRequirement, getTrainingCourseCatalog, loadCompanyDriverStore, persistPerformanceRelationshipResolutions } from "@/lib/driver-data";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE, resolveRelationshipApplicability } from "@/lib/driver-performance-schema";
import { loadVehicleStore } from "@/lib/vehicle-data";
import type { VehicleStore } from "@/lib/vehicle-data";
import type {
  DriverPerformanceEvent,
  TrainingCourseDefinition,
  PerformanceRelationshipResolution,
  CitationRecord,
  CompanyDriverStore,
} from "@/types/drivers";

const asFacts = (event: DriverPerformanceEvent): Record<string, unknown> => {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[event.eventType];
  const facts: Record<string, unknown> = {};
  for (const fact of event.structuredEventFacts || []) {
    const field = definition?.fields.find((item) => item.dataPointId === fact.dataPointId);
    if (field) facts[field.key] = fact.value;
  }
  return facts;
};

const factValue = (event: DriverPerformanceEvent, key: string) => {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[event.eventType];
  const field = definition?.fields.find((item) => item.key === key);
  return field ? event.structuredEventFacts?.find((fact) => fact.dataPointId === field.dataPointId)?.value : undefined;
};

const sameDate = (a?: string, b?: string) => Boolean(a && b && a.slice(0, 10) === b.slice(0, 10));

export interface PerformanceRelationshipResolutionContext {
  vehicleStore?: VehicleStore;
  citations?: CitationRecord[];
}

function resolution(
  event: DriverPerformanceEvent,
  relationshipKey: string,
  targetEntityType: string,
  state: PerformanceRelationshipResolution["state"],
  candidateIds: string[],
  reason: string,
  resolvedRecordId?: string,
): PerformanceRelationshipResolution {
  return {
    id: `PRR-${event.id}-${relationshipKey}`,
    eventId: event.id,
    relationshipKey,
    targetEntityType,
    resolvedRecordId,
    state,
    candidateIds,
    deterministicMatchingReason: reason,
    evaluatedAt: new Date().toISOString(),
  };
}

function resolveVehicle(event: DriverPerformanceEvent, relationshipKey: string): PerformanceRelationshipResolution {
  const id = event.vehicleId || event.canonicalLinks?.find((link) => link.entityType === "Vehicle")?.recordId;
  if (id) return resolution(event, relationshipKey, "Vehicle", "AUTO_RESOLVED", [id], "Canonical Vehicle ID is already attached to the Performance event.", id);
  return resolution(event, relationshipKey, "Vehicle", "UNRESOLVED", [], "No deterministic canonical Vehicle identifier is available from the Performance event.");
}

function resolveHOS(event: DriverPerformanceEvent, store: CompanyDriverStore, relationshipKey: string): PerformanceRelationshipResolution {
  const direct = event.hosRecordIds?.filter(Boolean) || [];
  if (direct.length === 1) return resolution(event, relationshipKey, "HOS", "AUTO_RESOLVED", direct, "A single canonical HOS record ID is already present on the event.", direct[0]);

  const ruleJurisdiction = factValue(event, "ruleJurisdiction");
  const violationType = factValue(event, "violationType");
  const logDate = String(factValue(event, "logDate") || event.eventDate);
  const sourceRecordId = event.provenance?.sourceRecordId;

  const potentials = store.hosPotentialViolations.filter((candidate) => {
    if (candidate.driverMasterId !== event.driverMasterId) return false;
    if (sourceRecordId && candidate.sourceRecordId === sourceRecordId) return true;
    if (!sameDate(candidate.logDate, logDate)) return false;
    if (ruleJurisdiction && candidate.ruleProfileId && String(ruleJurisdiction).length > 0) {
      // Rule profile IDs are authoritative references but jurisdiction matching is performed by the owning HOS module.
      // Do not reject a candidate merely because the HOS potential violation does not duplicate the Performance field.
    }
    if (violationType && candidate.violationType !== violationType) return false;
    return true;
  });

  if (potentials.length === 1) return resolution(event, relationshipKey, "HOS", "AUTO_RESOLVED", [potentials[0].id], sourceRecordId ? "Exact Driver and source-record identifier match to one HOS potential violation." : "Exact Driver and HOS log date matched one candidate HOS potential violation.", potentials[0].id);
  if (potentials.length > 1) return resolution(event, relationshipKey, "HOS", "REVIEW_REQUIRED", potentials.map((candidate) => candidate.id), "Multiple HOS candidates match the applicable deterministic Driver/date criteria; no silent selection was made.");

  const raw = store.hosRawRecords.filter((candidate) => candidate.driverMasterId === event.driverMasterId && (sourceRecordId ? candidate.sourceRecordId === sourceRecordId : sameDate(candidate.capturedAt, logDate)));
  if (raw.length === 1) return resolution(event, relationshipKey, "HOS", "AUTO_RESOLVED", [raw[0].id], sourceRecordId ? "Exact Driver and source-record identifier match to one canonical HOS source record." : "Exact Driver and HOS source date matched one canonical HOS source record.", raw[0].id);
  if (raw.length > 1) return resolution(event, relationshipKey, "HOS", "REVIEW_REQUIRED", raw.map((candidate) => candidate.id), "Multiple canonical HOS source records match the applicable deterministic criteria; no silent selection was made.");
  return resolution(event, relationshipKey, "HOS", "PENDING_SOURCE_DATA", [], "No canonical HOS source record is available yet for this relationship.");
}

function resolveCitation(event: DriverPerformanceEvent, store: CompanyDriverStore, relationshipKey: string, context?: PerformanceRelationshipResolutionContext): PerformanceRelationshipResolution {
  const direct = event.citationIds?.filter(Boolean) || [];
  if (direct.length === 1) return resolution(event, relationshipKey, "Citation", "AUTO_RESOLVED", direct, "A single canonical Citation ID is already attached to the event.", direct[0]);
  const citationNumber = factValue(event, "citationNumber");
  const sourceRecordId = event.provenance?.sourceRecordId;
  const candidates = context?.citations || (() => {
    if (typeof window === "undefined") return [] as CitationRecord[];
    try {
      const raw = window.localStorage.getItem(`tes_company_citations_${event.companyId}`);
      const parsed = raw ? JSON.parse(raw) as { citations?: CitationRecord[] } : {};
      return Array.isArray(parsed.citations) ? parsed.citations : [];
    } catch {
      return [];
    }
  })();
  const matches = candidates.filter((candidate) => {
    if (candidate.driverMasterId && candidate.driverMasterId !== event.driverMasterId) return false;
    if (sourceRecordId && candidate.reportNumber === sourceRecordId) return true;
    if (citationNumber && candidate.reportNumber === citationNumber) return true;
    if (!sameDate(candidate.eventDate, event.eventDate)) return false;
    if (event.stateProvince && candidate.jurisdictionCode && candidate.jurisdictionCode !== event.stateProvince) return false;
    return true;
  });
  if (matches.length === 1) return resolution(event, relationshipKey, "Citation", "AUTO_RESOLVED", [matches[0].id], citationNumber || sourceRecordId ? "Exact citation/report identifier matched one canonical Citation record." : "Driver, occurrence date, and jurisdiction matched one canonical Citation record.", matches[0].id);
  if (matches.length > 1) return resolution(event, relationshipKey, "Citation", "REVIEW_REQUIRED", matches.map((candidate) => candidate.id), "Multiple Citation records satisfy the deterministic matching criteria.");
  return resolution(event, relationshipKey, "Citation", "PENDING_SOURCE_DATA", [], "No canonical Citation record is available yet for this relationship.");
}

function resolveMaintenance(event: DriverPerformanceEvent, relationshipKey: string, context?: PerformanceRelationshipResolutionContext): PerformanceRelationshipResolution {
  let vehicleStore = context?.vehicleStore;
  try { if (!vehicleStore) vehicleStore = loadVehicleStore(event.companyId); } catch { return resolution(event, relationshipKey, "Maintenance", "PENDING_SOURCE_DATA", [], "Vehicle/Maintenance store is not available in the current runtime."); }
  const reference = factValue(event, "maintenanceReference") || event.provenance?.sourceRecordId;
  const candidates = vehicleStore.maintenanceRecords.filter((candidate) => {
    if (candidate.archived) return false;
    if (event.vehicleId && candidate.vehicleId !== event.vehicleId) return false;
    if (reference && [candidate.id, candidate.workOrderInvoiceNumber, candidate.workOrderNumber, candidate.invoiceNumber].filter(Boolean).includes(String(reference))) return true;
    return Boolean(event.vehicleId && sameDate(candidate.serviceDate, event.eventDate));
  });
  if (candidates.length === 1) return resolution(event, relationshipKey, "Maintenance", "AUTO_RESOLVED", [candidates[0].id], reference ? "Maintenance reference matched one active canonical Maintenance record." : "Vehicle and service date matched one active canonical Maintenance record.", candidates[0].id);
  if (candidates.length > 1) return resolution(event, relationshipKey, "Maintenance", "REVIEW_REQUIRED", candidates.map((candidate) => candidate.id), "Multiple Maintenance records satisfy the deterministic matching criteria.");
  return resolution(event, relationshipKey, "Maintenance", "PENDING_SOURCE_DATA", [], "No canonical Maintenance record is available yet for this relationship.");
}

function resolveTrainingRequirement(event: DriverPerformanceEvent, store: CompanyDriverStore, relationshipKey: string, allowCreate = false): PerformanceRelationshipResolution {
  const requirements = store.trainingRequirements.filter((requirement) =>
    requirement.driverMasterId === event.driverMasterId &&
    !requirement.isArchived &&
    requirement.requiredState === "Required"
  );
  const outstanding = requirements.filter((requirement) =>
    !["Completed", "Waived", "Exempted", "Cancelled"].includes(requirement.progressState || "")
  );

  const mappedCourse = resolveDeterministicTrainingCourse(event);

  // When a canonical outstanding requirement already exists, resolve/link it without creating another requirement.
  if (mappedCourse) {
    const matching = outstanding.filter((requirement) => requirement.courseId === mappedCourse.courseId);
    if (matching.length === 1) {
      return resolution(event, relationshipKey, "Training Requirement", "AUTO_RESOLVED", [matching[0].requirementId], "Deterministic Performance training-course mapping matched one outstanding canonical Training Requirement; no duplicate requirement was created.", matching[0].requirementId);
    }
    if (matching.length > 1) {
      return resolution(event, relationshipKey, "Training Requirement", "REVIEW_REQUIRED", matching.map((candidate) => candidate.requirementId), "Multiple outstanding Training Requirements match the same deterministic canonical course; no duplicate or silent selection was made.");
    }

    if (allowCreate) {
      const requirement = addTrainingRequirement(event.companyId, event.driverMasterId, {
        courseId: mappedCourse.courseId,
        applicability: "Applicable",
        requiredState: "Required",
        assignmentState: "Not Assigned",
        requirementSource: "Other",
        requirementReason: `Created from Performance event ${event.id} after deterministic mapping to canonical course ${mappedCourse.courseId}.`,
        effectiveFrom: event.eventDate,
        provenance: {
          sourceType: "SOURCE_FACT",
          source: "Driver Performance",
          sourceRecordId: event.id,
          sourceEvidenceIds: event.evidenceIds || [],
          ingestionOrigin: event.ingestion?.origin || event.provenance?.ingestionOrigin,
          ingestionTimestamp: event.createdAt,
          reportedBy: event.provenance?.reportedBy,
        },
      });
      return resolution(event, relationshipKey, "Training Requirement", "AUTO_RESOLVED", [requirement.requirementId], "Training Required was YES and the Performance event deterministically identified exactly one canonical Training course; TES created one outstanding canonical Training Requirement through the existing requirement architecture. No Training Record was created.", requirement.requirementId);
    }

    return resolution(event, relationshipKey, "Training Requirement", "CANDIDATE_MATCH", [], "A deterministic canonical Training course was identified, but requirement creation is deferred until the persistence/re-evaluation boundary.");
  }

  if (outstanding.length > 0) {
    return resolution(
      event,
      relationshipKey,
      "Training Requirement",
      "REVIEW_REQUIRED",
      outstanding.map((candidate) => candidate.requirementId),
      "Training is required, but no deterministic canonical Training course mapping is available. Existing outstanding Training Requirements are candidates only; TES will not silently select or link one."
    );
  }

  return resolution(
    event,
    relationshipKey,
    "Training Requirement",
    "REVIEW_REQUIRED",
    [],
    "Training is required, but no deterministic canonical Training course/requirement mapping is available. TES will not invent a course, create an unsupported requirement, or create a Training Record."
  );
}

function resolveDeterministicTrainingCourse(event: DriverPerformanceEvent): TrainingCourseDefinition | undefined {
  const catalog = getTrainingCourseCatalog().filter((course) => course.state === "ACTIVE");
  const references = event.operationalReferences || [];
  const courseId = factValue(event, "trainingCourseId") || references.find((reference) => ["Training Course ID", "Course ID", "trainingCourseId"].includes(reference.referenceType))?.referenceValue;
  if (courseId) {
    const matches = catalog.filter((course) => course.courseId === String(courseId));
    return matches.length === 1 ? matches[0] : undefined;
  }

  const courseCode = factValue(event, "trainingCourseCode") || references.find((reference) => ["Training Course Code", "Course Code", "trainingCourseCode"].includes(reference.referenceType))?.referenceValue;
  if (courseCode) {
    const matches = catalog.filter((course) => course.courseCode === String(courseCode));
    return matches.length === 1 ? matches[0] : undefined;
  }

  const courseTitle = factValue(event, "trainingCourseTitle") || references.find((reference) => ["Training Course Title", "Course Title", "trainingCourseTitle"].includes(reference.referenceType))?.referenceValue;
  if (courseTitle) {
    const normalized = String(courseTitle).trim().toLowerCase();
    const matches = catalog.filter((course) => course.title.trim().toLowerCase() === normalized);
    return matches.length === 1 ? matches[0] : undefined;
  }

  const categoryId = factValue(event, "trainingCategoryId") || references.find((reference) => ["Training Category ID", "Course Category ID", "trainingCategoryId"].includes(reference.referenceType))?.referenceValue;
  if (categoryId) {
    const matches = catalog.filter((course) => course.categoryId === String(categoryId));
    return matches.length === 1 ? matches[0] : undefined;
  }

  return undefined;
}

function resolveRelationship(event: DriverPerformanceEvent, store: CompanyDriverStore, relationship: { key: string; entityType: string; canonical?: boolean }, context?: PerformanceRelationshipResolutionContext) {
  switch (relationship.key) {
    case "vehicle": return resolveVehicle(event, relationship.key);
    case "hos": return resolveHOS(event, store, relationship.key);
    case "citation": return resolveCitation(event, store, relationship.key, context);
    case "maintenance": return resolveMaintenance(event, relationship.key, context);
    case "training": return resolveTrainingRequirement(event, store, relationship.key, false);
    default: return resolution(event, relationship.key, relationship.entityType, "UNRESOLVED", [], "No Layer-1 deterministic resolver exists for this relationship type.");
  }
}

export function resolvePerformanceRelationshipsForEvent(store: CompanyDriverStore, event: DriverPerformanceEvent, context?: PerformanceRelationshipResolutionContext): PerformanceRelationshipResolution[] {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[event.eventType];
  if (!definition) return [];
  const facts = asFacts(event);
  const applicable = resolveRelationshipApplicability(definition, facts);
  return applicable.map((relationship) => resolveRelationship(event, store, relationship, context));
}

export function reevaluatePerformanceRelationships(companyId: string, eventId?: string) {
  const store = loadCompanyDriverStore(companyId);
  const events = store.events.filter((event) => !event.isArchived && (!eventId || event.id === eventId));
  if (eventId && events.length === 0) throw new Error("Performance event not found.");
  let vehicleStore: VehicleStore | undefined;
  try { vehicleStore = loadVehicleStore(companyId); } catch { vehicleStore = undefined; }
  let citations: CitationRecord[] | undefined;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`tes_company_citations_${companyId}`);
      const parsed = raw ? JSON.parse(raw) as { citations?: CitationRecord[] } : {};
      citations = Array.isArray(parsed.citations) ? parsed.citations : [];
    } catch { citations = undefined; }
  }
  const context = { vehicleStore, citations };
  return events.map((event) => {
    const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[event.eventType];
    const facts = asFacts(event);
    const applicable = definition ? resolveRelationshipApplicability(definition, facts) : [];
    const resolutions = applicable.map((relationship) =>
      relationship.key === "training"
        ? resolveTrainingRequirement(event, store, relationship.key, true)
        : resolveRelationship(event, store, relationship, context)
    );
    return persistPerformanceRelationshipResolutions(companyId, event.id, resolutions);
  });
}

export function reevaluatePerformanceRelationshipsAfterSourceMutation(companyId: string, changedEntity: "PERFORMANCE" | "HOS" | "CITATION" | "MAINTENANCE" | "VEHICLE" | "TRAINING" | "EVIDENCE", eventId?: string) {
  void changedEntity;
  // Layer 1 is intentionally synchronous. The operation is domain-level and does not depend on React/UI execution,
  // so a future worker/event system can call the same function after a backend mutation.
  return reevaluatePerformanceRelationships(companyId, eventId);
}

// Pure scenario helper used by deterministic validation/tests without browser persistence.
export function evaluatePerformanceRelationshipScenario(store: CompanyDriverStore, event: DriverPerformanceEvent) {
  return resolvePerformanceRelationshipsForEvent(store, event);
}

