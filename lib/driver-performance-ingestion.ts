import {
  addManualPerformanceEvent,
  addPerformanceEvent,
  loadCompanyDriverStore,
  loadDriverMasterStore,
  createPendingPerformanceIngestion,
  normalizeLicenceNumber,
  reconcilePerformanceEventFacts,
} from "@/lib/driver-data";
import {
  DRIVER_PERFORMANCE_CATEGORY_BY_VALUE,
  PERFORMANCE_CATEGORY_OWNERSHIP,
  PERFORMANCE_EVENT_SCHEMA_VERSION,
} from "@/lib/driver-performance-schema";
import { reevaluatePerformanceRelationships } from "@/lib/driver-performance-relationship-resolution";
import type {
  DriverPerformanceEvent,
  PerformanceFactObservation,
  PerformanceFactReconciliation,
  PerformanceIngestionMetadata,
  PerformanceIngestionOrigin,
  StructuredEventFact,
} from "@/types/drivers";

export interface PerformanceDriverIdentityInput {
  driverMasterId?: string;
  companyDriverRelationshipId?: string;
  driverLicenceNumber?: string;
  driverName?: string;
  dateOfBirth?: string;
}

export interface PerformanceDriverIdentityResolution {
  state: "RESOLVED" | "REVIEW_REQUIRED" | "UNRESOLVED";
  driverMasterId?: string;
  companyDriverRelationshipId?: string;
  candidateDriverMasterIds: string[];
  reason: string;
}

export interface PerformanceExtractionFactInput {
  dataPointId: string;
  value: StructuredEventFact["value"];
  valueType: StructuredEventFact["valueType"];
  unit?: string;
  normalizedValue?: number;
  normalizedUnit?: string;
  confidence?: number;
  provider?: string;
  sourceEvidenceIds?: string[];
  documentType?: string;
  extractedAt?: string;
  rawValue?: string | number | boolean | null;
}

export interface PerformanceIngestionInput {
  companyId: string;
  eventType: DriverPerformanceEvent["eventType"];
  identity: PerformanceDriverIdentityInput;
  origin: PerformanceIngestionOrigin;
  sourceType: string;
  sourceRecordId?: string;
  sourceEvidenceIds?: string[];
  receivedAt?: string;
  processedAt?: string;
  processorVersion?: string;
  extractorVersion?: string;
  extractedFacts: PerformanceExtractionFactInput[];
  eventDate: string;
  eventTime?: string;
  reportedDate?: string;
  location?: string;
  city?: string;
  stateProvince?: string;
  country?: string;
  severity?: DriverPerformanceEvent["severity"];
  summary: string;
  description?: string;
  followUpActionRequired?: boolean;
  followUpDueDate?: string;
  followUpActionSummary?: string;
  vehicleId?: string;
  trailerId?: string;
  tripId?: string;
  loadId?: string;
  customerId?: string;
  customerSiteId?: string;
  reportedBy?: string;
}

export interface PreparedPerformanceIngestion {
  identity: PerformanceDriverIdentityResolution;
  duplicateEventId?: string;
  duplicate: boolean;
  conflict: boolean;
  payload?: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">;
  ingestion: PerformanceIngestionMetadata;
  reconciliation?: Record<string, PerformanceFactReconciliation>;
}

const valuesEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function resolveDriverIdentity(companyId: string, identity: PerformanceDriverIdentityInput): PerformanceDriverIdentityResolution {
  const masterStore = loadDriverMasterStore();
  const companyStore = loadCompanyDriverStore(companyId);
  const activeRelationships = companyStore.relationships.filter((item) => !item.archive.isArchived);

  if (identity.companyDriverRelationshipId) {
    const relationship = activeRelationships.find((item) => item.id === identity.companyDriverRelationshipId);
    if (!relationship) return { state: "UNRESOLVED", candidateDriverMasterIds: [], reason: "Company Driver relationship does not resolve to an active relationship." };
    if (identity.driverMasterId && identity.driverMasterId !== relationship.driverMasterId) return { state: "REVIEW_REQUIRED", candidateDriverMasterIds: [relationship.driverMasterId], reason: "Driver Master ID conflicts with the supplied Company Driver relationship." };
    return { state: "RESOLVED", driverMasterId: relationship.driverMasterId, companyDriverRelationshipId: relationship.id, candidateDriverMasterIds: [relationship.driverMasterId], reason: "Exact active Company Driver relationship match." };
  }

  if (identity.driverMasterId) {
    const relationship = activeRelationships.find((item) => item.driverMasterId === identity.driverMasterId);
    const driver = masterStore.drivers.find((item) => item.id === identity.driverMasterId && !item.archive.isArchived);
    if (!driver || !relationship) return { state: "UNRESOLVED", candidateDriverMasterIds: [], reason: "Driver Master ID does not resolve to an active Driver relationship for this company." };
    return { state: "RESOLVED", driverMasterId: driver.id, companyDriverRelationshipId: relationship.id, candidateDriverMasterIds: [driver.id], reason: "Exact Driver Master ID and active Company Driver relationship match." };
  }

  const licence = identity.driverLicenceNumber ? normalizeLicenceNumber(identity.driverLicenceNumber) : "";
  if (licence) {
    const candidates = activeRelationships
      .filter((relationship) => {
        const driver = masterStore.drivers.find((item) => item.id === relationship.driverMasterId);
        return Boolean(driver?.licenceHistory.some((record) => normalizeLicenceNumber(record.licenceNumber) === licence));
      })
      .map((relationship) => relationship.driverMasterId);
    if (candidates.length === 1) {
      const relationship = activeRelationships.find((item) => item.driverMasterId === candidates[0]);
      return { state: "RESOLVED", driverMasterId: candidates[0], companyDriverRelationshipId: relationship?.id, candidateDriverMasterIds: candidates, reason: "Exact normalized licence identifier matched one active Driver relationship." };
    }
    if (candidates.length > 1) return { state: "REVIEW_REQUIRED", candidateDriverMasterIds: candidates, reason: "Licence identifier matched multiple active Driver relationships." };
  }

  const name = identity.driverName?.trim().toLowerCase();
  if (name && identity.dateOfBirth) {
    const candidates = activeRelationships.filter((relationship) => {
      const driver = masterStore.drivers.find((item) => item.id === relationship.driverMasterId);
      if (!driver) return false;
      const fullName = [driver.identity.legalFirstName, driver.identity.legalMiddleName, driver.identity.legalLastName].filter(Boolean).join(" ").trim().toLowerCase();
      return fullName === name && driver.identity.dateOfBirth === identity.dateOfBirth;
    }).map((relationship) => relationship.driverMasterId);
    if (candidates.length === 1) {
      const relationship = activeRelationships.find((item) => item.driverMasterId === candidates[0]);
      return { state: "RESOLVED", driverMasterId: candidates[0], companyDriverRelationshipId: relationship?.id, candidateDriverMasterIds: candidates, reason: "Exact legal name and date-of-birth match to one active Driver relationship." };
    }
    if (candidates.length > 1) return { state: "REVIEW_REQUIRED", candidateDriverMasterIds: candidates, reason: "Legal name and date-of-birth matched multiple active Driver relationships." };
  }

  return { state: "UNRESOLVED", candidateDriverMasterIds: [], reason: "No deterministic Driver identity match was supplied or found." };
}

function buildReconciliation(
  existing: StructuredEventFact | undefined,
  existingEvent: DriverPerformanceEvent | undefined,
  incoming: PerformanceExtractionFactInput,
  ingestion: PerformanceIngestionMetadata,
): PerformanceFactReconciliation {
  const now = incoming.extractedAt || ingestion.processedAt || ingestion.receivedAt;
  const existingObservation: PerformanceFactObservation | null = existing ? {
    value: existing.value,
    valueType: existing.valueType,
    source: existingEvent?.provenance?.source || existing.source,
    sourceRecordId: existingEvent?.provenance?.sourceRecordId,
    sourceEvidenceIds: existingEvent?.evidenceIds || existingEvent?.provenance?.sourceEvidenceIds || (existing.extraction?.documentId ? [existing.extraction.documentId] : []),
    observedAt: now,
  } : null;
  const incomingObservation: PerformanceFactObservation = {
    value: incoming.value,
    valueType: incoming.valueType,
    source: ingestion.sourceType,
    sourceRecordId: ingestion.sourceRecordId,
    sourceEvidenceIds: incoming.sourceEvidenceIds || ingestion.sourceEvidenceIds,
    confidence: incoming.confidence,
    observedAt: now,
  };
  const observations = existingObservation ? [existingObservation, incomingObservation] : [incomingObservation];
  return {
    state: existing && !valuesEqual(existing.value, incoming.value) ? "CONFLICT" : "CLEAN",
    observations,
  };
}

export function preparePerformanceIngestion(input: PerformanceIngestionInput): PreparedPerformanceIngestion {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[input.eventType];
  if (!definition) throw new Error(`Unsupported Performance Event category: ${input.eventType}`);
  if (PERFORMANCE_CATEGORY_OWNERSHIP[input.eventType] !== "RECORDABLE_EVENT") throw new Error(`Performance category ${input.eventType} is not owned by the canonical Performance event store.`);
  if (!input.summary.trim()) throw new Error("Performance ingestion requires a factual summary.");
  if (!input.eventDate) throw new Error("Performance ingestion requires an event date.");
  if (["DOCUMENT_OCR", "API_INTEGRATION", "TELEMATICS_INGESTION", "ELD_INGESTION"].includes(input.origin) && input.origin === "DOCUMENT_OCR" && !(input.sourceEvidenceIds || []).length) {
    throw new Error("Document-originated Performance ingestion requires canonical evidence before event creation.");
  }

  const identity = resolveDriverIdentity(input.companyId, input.identity);
  if (identity.state !== "RESOLVED" || !identity.driverMasterId) return {
    identity,
    duplicate: false,
    conflict: false,
    ingestion: {
      origin: input.origin,
      sourceType: input.sourceType,
      sourceRecordId: input.sourceRecordId,
      sourceEvidenceIds: [...(input.sourceEvidenceIds || [])],
      receivedAt: input.receivedAt || new Date().toISOString(),
      processedAt: input.processedAt || new Date().toISOString(),
      processorVersion: input.processorVersion,
      extractorVersion: input.extractorVersion,
    },
  };

  const ingestion: PerformanceIngestionMetadata = {
    origin: input.origin,
    sourceType: input.sourceType,
    sourceRecordId: input.sourceRecordId,
    sourceEvidenceIds: [...(input.sourceEvidenceIds || [])],
    receivedAt: input.receivedAt || new Date().toISOString(),
    processedAt: input.processedAt || new Date().toISOString(),
    processorVersion: input.processorVersion,
    extractorVersion: input.extractorVersion,
  };

  const existingEvents = loadCompanyDriverStore(input.companyId).events.filter((event) => !event.isArchived && event.driverMasterId === identity.driverMasterId);
  const duplicateBySource = input.sourceRecordId ? existingEvents.find((event) => event.ingestion?.sourceRecordId === input.sourceRecordId || event.provenance?.sourceRecordId === input.sourceRecordId) : undefined;
  const duplicateByEvidence = !duplicateBySource && ingestion.sourceEvidenceIds.length ? existingEvents.find((event) => event.eventType === input.eventType && event.eventDate === input.eventDate && event.evidenceIds?.some((id) => ingestion.sourceEvidenceIds.includes(id))) : undefined;
  const duplicate = duplicateBySource || duplicateByEvidence;

  const allowed = new Map(definition.fields.map((field) => [field.dataPointId, field]));
  const structuredEventFacts: StructuredEventFact[] = [];
  const reconciliation: Record<string, PerformanceFactReconciliation> = {};
  for (const extracted of input.extractedFacts) {
    const field = allowed.get(extracted.dataPointId);
    if (!field) throw new Error(`Data Point ${extracted.dataPointId} is not allowed for ${input.eventType}.`);
    if (field.kind === "select" && typeof extracted.value === "string" && field.options && !field.options.some((option) => option.value === extracted.value)) throw new Error(`Invalid controlled value for ${extracted.dataPointId}.`);
    if (field.unitOptions?.length && (!extracted.unit || !field.unitOptions.includes(extracted.unit))) throw new Error(`Explicit unit required for ${extracted.dataPointId}.`);
    const existing = duplicate?.structuredEventFacts?.find((fact) => fact.dataPointId === extracted.dataPointId);
    const fact: StructuredEventFact = {
      dataPointId: extracted.dataPointId,
      value: extracted.value,
      valueType: extracted.valueType,
      unit: extracted.unit,
      normalizedValue: extracted.normalizedValue,
      normalizedUnit: extracted.normalizedUnit,
      source: input.sourceType,
      extraction: {
        rawValue: extracted.rawValue ?? extracted.value,
        confidence: extracted.confidence,
        provider: extracted.provider || input.extractorVersion,
        documentId: extracted.sourceEvidenceIds?.[0] || ingestion.sourceEvidenceIds[0],
        documentType: extracted.documentType,
        extractedAt: extracted.extractedAt || ingestion.processedAt,
        reviewState: "PENDING_REVIEW",
      },
    };
    structuredEventFacts.push(fact);
    if (existing && !valuesEqual(existing.value, extracted.value)) reconciliation[extracted.dataPointId] = buildReconciliation(existing, duplicate, extracted, ingestion);
  }

  if (duplicate && Object.keys(reconciliation).length === 0) {
    return { identity, duplicateEventId: duplicate.id, duplicate: true, conflict: false, ingestion, reconciliation: undefined };
  }
  if (duplicate && Object.keys(reconciliation).length > 0) {
    return { identity, duplicateEventId: duplicate.id, duplicate: true, conflict: true, ingestion, reconciliation };
  }

  const now = ingestion.processedAt || new Date().toISOString();
  const chronology = [{ id: `CHRON-${Date.now().toString(36)}`, timestamp: now, action: "EVENT_INGESTED", actor: null, details: `Machine-ingested ${definition.label} from ${input.sourceType}.` }];
  const payload: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> = {
    eventType: input.eventType,
    eventDate: input.eventDate,
    eventTime: input.eventTime,
    reportedDate: input.reportedDate || input.eventDate,
    location: input.location,
    city: input.city,
    stateProvince: input.stateProvince,
    country: input.country,
    severity: input.severity || "Not Applicable",
    status: input.followUpActionRequired ? "Follow-up Required" : "Open",
    summary: input.summary.trim(),
    description: input.description?.trim() || `${definition.label} ingested from ${input.sourceType}.`,
    structuredEventFacts,
    schemaVersion: PERFORMANCE_EVENT_SCHEMA_VERSION,
    followUpActionRequired: input.followUpActionRequired,
    followUpDueDate: input.followUpDueDate,
    followUpActionSummary: input.followUpActionSummary,
    linkedRecords: [],
    canonicalLinks: input.vehicleId ? [{ entityType: "Vehicle", recordId: input.vehicleId, label: input.vehicleId, source: "CANONICAL_STORE" as const }] : [],
    evidenceIds: ingestion.sourceEvidenceIds,
    chronology,
    verificationState: "Unverified",
    provenance: {
      sourceType: "SOURCE_FACT",
      source: input.sourceType,
      ingestionOrigin: input.origin,
      reportedBy: input.reportedBy,
      sourceRecordId: input.sourceRecordId,
      capturedAt: ingestion.receivedAt,
      sourceTimestamp: input.eventDate ? `${input.eventDate}${input.eventTime ? `T${input.eventTime}:00` : "T00:00:00"}` : undefined,
      ingestionTimestamp: ingestion.receivedAt,
      sourceConfidence: "UNKNOWN",
      dataQuality: "UNKNOWN",
      rawPayloadReference: input.sourceRecordId,
      sourceEvidenceIds: ingestion.sourceEvidenceIds,
      extractionState: input.origin === "DOCUMENT_OCR" ? "EXTRACTION_COMPLETE" : "EXTRACTION_COMPLETE",
      extractionProvider: input.extractorVersion,
      extractionDocumentType: input.sourceType,
      extractionConfidence: structuredEventFacts.map((fact) => fact.extraction?.confidence).filter((value): value is number => typeof value === "number").reduce((min, value) => Math.min(min, value), 1),
    },
    ingestion,
    factReconciliation: Object.keys(reconciliation).length ? reconciliation : undefined,
  };
  return { identity, duplicate: false, conflict: false, payload, ingestion };
}

export function ingestPerformanceSource(input: PerformanceIngestionInput) {
  const prepared = preparePerformanceIngestion(input);
  if (prepared.identity.state !== "RESOLVED" || !prepared.identity.driverMasterId) {
    throw new Error(`Performance source requires deterministic Driver identity resolution: ${prepared.identity.reason}`);
  }
  if (prepared.duplicateEventId) {
    if (prepared.conflict && prepared.reconciliation) reconcilePerformanceEventFacts(input.companyId, prepared.duplicateEventId, prepared.reconciliation, null);
    return { event: loadCompanyDriverStore(input.companyId).events.find((event) => event.id === prepared.duplicateEventId), duplicate: true, conflict: prepared.conflict, ingestion: prepared.ingestion };
  }
  if (!prepared.payload) throw new Error("Performance ingestion did not produce a canonical payload.");
  const event = addPerformanceEvent(input.companyId, prepared.identity.driverMasterId, prepared.payload);
  const resolved = event ? reevaluatePerformanceRelationships(input.companyId, event.id)[0] : event;
  return { event: resolved || event, duplicate: false, conflict: false, ingestion: prepared.ingestion };
}

export function receivePerformanceSourceForMachineProcessing(companyId: string, driverMasterId: string | undefined, evidence: import("@/types/drivers").DriverEvidenceItem) {
  return createPendingPerformanceIngestion(companyId, driverMasterId, evidence);
}

export function createManualPerformanceFallback(companyId: string, driverMasterId: string, data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) {
  return addManualPerformanceEvent(companyId, driverMasterId, data);
}
