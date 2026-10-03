import type { PerformanceChildCollection, PerformanceChildFactItem, PerformanceFactObservation, ProvenanceMetadata, StructuredEventFactValue } from "@/types/drivers";

export const ROADSIDE_VIOLATION_COLLECTION_ID = "DRV.PERF.ROADSIDE_INSPECTION.VIOLATIONS";
export const ROADSIDE_VIOLATION_COLLECTION_VERSION = "1.0";
export const ROADSIDE_VIOLATION_DATA_POINTS = {
  RULE_CODE: "DRV.PERF.ROADSIDE.VIOLATION.RULE_CODE",
  DESCRIPTION: "DRV.PERF.ROADSIDE.VIOLATION.DESCRIPTION",
  REGULATORY_CATEGORY: "DRV.PERF.ROADSIDE.VIOLATION.REGULATORY_CATEGORY",
  SUBJECT_TYPE: "DRV.PERF.ROADSIDE.VIOLATION.SUBJECT_TYPE",
  SUBJECT_EQUIPMENT_ID: "DRV.PERF.ROADSIDE.VIOLATION.SUBJECT_EQUIPMENT_ID",
  COMPONENT_SYSTEM: "DRV.PERF.ROADSIDE.VIOLATION.COMPONENT_SYSTEM",
  OOS_STATE: "DRV.PERF.ROADSIDE.VIOLATION.OOS_STATE",
  REGULATOR_SEVERITY_WEIGHT: "DRV.PERF.ROADSIDE.VIOLATION.REGULATOR_SEVERITY_WEIGHT",
  DEMERIT_POINTS: "DRV.PERF.ROADSIDE.VIOLATION.DEMERIT_POINTS",
  OUTCOME: "DRV.PERF.ROADSIDE.VIOLATION.OUTCOME",
  APPLICABLE_TO: "DRV.PERF.ROADSIDE.VIOLATION.APPLICABLE_TO",
} as const;

/**
 * TES-normalized Roadside outcome scale (presentation/logic, not source wording).
 * Ordered lowest -> highest; the highest value present wins (deterministic precedence).
 */
export const ROADSIDE_OUTCOME_PRECEDENCE = ["PASS", "WARNING", "REQUIRES_ATTENTION", "OUT_OF_SERVICE"] as const;
export type RoadsideOutcome = (typeof ROADSIDE_OUTCOME_PRECEDENCE)[number];
export type RoadsideFindingOutcome = Exclude<RoadsideOutcome, "PASS">;
export const ROADSIDE_OUTCOME_LABELS: Readonly<Record<RoadsideOutcome, string>> = { PASS: "Pass", WARNING: "Warning", REQUIRES_ATTENTION: "Requires Attention", OUT_OF_SERVICE: "Out of Service" };
export type RoadsideApplicableTo = "DRIVER" | "VEHICLE" | "BOTH";
export const ROADSIDE_APPLICABLE_TO_LABELS: Readonly<Record<RoadsideApplicableTo, string>> = { DRIVER: "Driver", VEHICLE: "Vehicle", BOTH: "Both" };

export const isRoadsideOutcome = (value: unknown): value is RoadsideOutcome => (ROADSIDE_OUTCOME_PRECEDENCE as readonly unknown[]).includes(value);
export const isRoadsideApplicableTo = (value: unknown): value is RoadsideApplicableTo => value === "DRIVER" || value === "VEHICLE" || value === "BOTH";

export type RoadsideViolationSubjectType = "DRIVER" | "OPERATING_CARRIER" | "POWER_UNIT" | "TOWED_UNIT" | "OTHER";
export type RoadsideViolationAttribution = RoadsideViolationSubjectType;
export type RoadsideViolationOOSState = "YES" | "NO" | "UNKNOWN";
export type RoadsideViolationCollectionCompleteness = "COMPLETE" | "PARTIAL" | "NOT_PROVIDED";

export const ROADSIDE_EQUIPMENT_COLLECTION_ID = "DRV.PERF.ROADSIDE_INSPECTION.INSPECTED_EQUIPMENT";
export const ROADSIDE_EQUIPMENT_COLLECTION_VERSION = "1.0";
export const ROADSIDE_EQUIPMENT_DATA_POINTS = {
  ROLE: "DRV.PERF.ROADSIDE.EQUIPMENT.ROLE",
  EQUIPMENT_TYPE: "DRV.PERF.ROADSIDE.EQUIPMENT.TYPE",
  SOURCE_VIN: "DRV.PERF.ROADSIDE.EQUIPMENT.SOURCE_VIN",
  SOURCE_PLATE: "DRV.PERF.ROADSIDE.EQUIPMENT.SOURCE_PLATE",
  PLATE_JURISDICTION: "DRV.PERF.ROADSIDE.EQUIPMENT.PLATE_JURISDICTION",
  SOURCE_UNIT_NUMBER: "DRV.PERF.ROADSIDE.EQUIPMENT.SOURCE_UNIT_NUMBER",
} as const;

export const ROADSIDE_STATEMENT_COLLECTION_ID = "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS";
export const ROADSIDE_STATEMENT_COLLECTION_VERSION = "1.0";
export const ROADSIDE_STATEMENT_DATA_POINTS = {
  STATUS: "DRV.PERF.ROADSIDE.STATEMENT.STATUS",
  DATE: "DRV.PERF.ROADSIDE.STATEMENT.DATE",
  TIME: "DRV.PERF.ROADSIDE.STATEMENT.TIME",
  METHOD: "DRV.PERF.ROADSIDE.STATEMENT.METHOD",
  CONTENT: "DRV.PERF.ROADSIDE.STATEMENT.CONTENT",
} as const;

export type RoadsideStatementStatus = "OBTAINED" | "REQUESTED" | "DECLINED" | "UNABLE_TO_OBTAIN" | "NOT_APPLICABLE";
export type RoadsideStatementMethod = "WRITTEN" | "RECORDED" | "INTERVIEW" | "UPLOADED_DOCUMENT" | "OTHER";

export interface RoadsideEquipmentInput {
  itemId?: string;
  role: "POWER_UNIT" | "TOWED_UNIT";
  equipmentType?: string;
  sourceVin?: string;
  sourcePlate?: string;
  plateJurisdiction?: string;
  sourceUnitNumber?: string;
  evidenceIds?: string[];
  provenance?: ProvenanceMetadata;
}

export interface RoadsideStatementInput {
  itemId?: string;
  status: RoadsideStatementStatus;
  date?: string;
  time?: string;
  method?: RoadsideStatementMethod;
  content?: string;
  evidenceIds?: string[];
  provenance?: ProvenanceMetadata;
}

export function createRoadsideEquipmentItem(input: RoadsideEquipmentInput): PerformanceChildFactItem {
  const itemId = input.itemId || `RIE-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
  const observedAt = new Date().toISOString();
  const evidenceIds = unique(input.evidenceIds);
  const observations: PerformanceFactObservation[] = [];
  const add = (dataPointId: string, value: string | null) => {
    if (!value) return;
    observations.push({ observationId: `RIO-${itemId}-${dataPointId}`, dataPointId, value, rawValue: value, valueType: "string", sourceEvidenceIds: evidenceIds, observedAt, ingestedAt: observedAt, provenance: { sourceType: "SOURCE_FACT", source: "Roadside Inspection", sourceEvidenceIds: evidenceIds, ingestionTimestamp: observedAt } });
  };
  add(ROADSIDE_EQUIPMENT_DATA_POINTS.ROLE, input.role);
  add(ROADSIDE_EQUIPMENT_DATA_POINTS.EQUIPMENT_TYPE, input.equipmentType || null);
  add(ROADSIDE_EQUIPMENT_DATA_POINTS.SOURCE_VIN, input.sourceVin || null);
  add(ROADSIDE_EQUIPMENT_DATA_POINTS.SOURCE_PLATE, input.sourcePlate || null);
  add(ROADSIDE_EQUIPMENT_DATA_POINTS.PLATE_JURISDICTION, input.plateJurisdiction || null);
  add(ROADSIDE_EQUIPMENT_DATA_POINTS.SOURCE_UNIT_NUMBER, input.sourceUnitNumber || null);
  return { itemId, facts: { role: input.role, equipmentType: input.equipmentType || null, sourceVin: input.sourceVin || null, sourcePlate: input.sourcePlate || null, plateJurisdiction: input.plateJurisdiction || null, sourceUnitNumber: input.sourceUnitNumber || null }, observations, evidenceIds, provenance: input.provenance || { sourceType: "SOURCE_FACT", source: "Roadside Inspection", sourceEvidenceIds: evidenceIds, ingestionTimestamp: observedAt } };
}

export function createRoadsideEquipmentCollection(items: PerformanceChildFactItem[], completeness: RoadsideViolationCollectionCompleteness = "COMPLETE"): PerformanceChildCollection {
  return { collectionId: ROADSIDE_EQUIPMENT_COLLECTION_ID, collectionVersion: ROADSIDE_EQUIPMENT_COLLECTION_VERSION, itemType: "ROADSIDE_INSPECTED_EQUIPMENT", completeness, items };
}

export function getRoadsideEquipmentCollection(event: { childCollections?: PerformanceChildCollection[] }): PerformanceChildCollection | undefined {
  return event.childCollections?.find((collection) => collection.collectionId === ROADSIDE_EQUIPMENT_COLLECTION_ID);
}

export function validateRoadsideEquipmentCollection(collection: PerformanceChildCollection, scope?: string): string[] {
  const errors: string[] = [];
  if (collection.collectionId !== ROADSIDE_EQUIPMENT_COLLECTION_ID) errors.push("Unexpected Roadside inspected-equipment collection ID.");
  if (collection.collectionVersion !== ROADSIDE_EQUIPMENT_COLLECTION_VERSION) errors.push("Unsupported Roadside inspected-equipment collection version.");
  const powerUnits = collection.items.filter((item) => item.facts.role === "POWER_UNIT");
  if (powerUnits.length > 1) errors.push("Roadside Inspection may contain only one Power Unit.");
  if (powerUnits.length !== 1) errors.push("Every Roadside Inspection requires exactly one Power Unit inspected-equipment member.");
  if (collection.completeness === "NOT_PROVIDED" && collection.items.length > 0) errors.push("NOT_PROVIDED inspected-equipment collection cannot contain child items.");
  const ids = new Set<string>();
  for (const item of collection.items) {
    if (!item.itemId || ids.has(item.itemId)) errors.push("Inspected-equipment child IDs must be present and unique.");
    ids.add(item.itemId);
    if (!["POWER_UNIT", "TOWED_UNIT"].includes(String(item.facts.role))) errors.push(`Invalid inspected-equipment role on ${item.itemId}.`);
  }
  return errors;
}

export function getRoadsideStatementCollection(event: { childCollections?: PerformanceChildCollection[] }): PerformanceChildCollection | undefined {
  return event.childCollections?.find((collection) => collection.collectionId === ROADSIDE_STATEMENT_COLLECTION_ID);
}

export function createRoadsideStatementItem(input: RoadsideStatementInput): PerformanceChildFactItem {
  const itemId = input.itemId || `RST-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
  const observedAt = new Date().toISOString();
  const evidenceIds = unique(input.evidenceIds);
  const facts = { status: input.status, date: input.date || null, time: input.time || null, method: input.method || null, content: input.content || null };
  return { itemId, facts, evidenceIds, observations: Object.entries(facts).filter(([, value]) => value !== null && value !== "").map(([key, value]) => ({ observationId: `RSO-${itemId}-${key}`, dataPointId: key === "status" ? ROADSIDE_STATEMENT_DATA_POINTS.STATUS : key === "date" ? ROADSIDE_STATEMENT_DATA_POINTS.DATE : key === "time" ? ROADSIDE_STATEMENT_DATA_POINTS.TIME : key === "method" ? ROADSIDE_STATEMENT_DATA_POINTS.METHOD : ROADSIDE_STATEMENT_DATA_POINTS.CONTENT, value: value as string, rawValue: value as string, valueType: "string", sourceEvidenceIds: evidenceIds, observedAt, ingestedAt: observedAt, provenance: { sourceType: "SOURCE_FACT", source: "Driver", sourceEvidenceIds: evidenceIds, ingestionTimestamp: observedAt } })), provenance: input.provenance || { sourceType: "SOURCE_FACT", source: "Driver", sourceEvidenceIds: evidenceIds, ingestionTimestamp: observedAt } };
}

export function createRoadsideStatementCollection(items: PerformanceChildFactItem[], completeness: RoadsideViolationCollectionCompleteness = "COMPLETE"): PerformanceChildCollection {
  return { collectionId: ROADSIDE_STATEMENT_COLLECTION_ID, collectionVersion: ROADSIDE_STATEMENT_COLLECTION_VERSION, itemType: "DRIVER_STATEMENT", completeness, items };
}

export function validateRoadsideStatementCollection(collection: PerformanceChildCollection): string[] {
  const errors: string[] = [];
  if (collection.collectionId !== ROADSIDE_STATEMENT_COLLECTION_ID) errors.push("Unexpected Roadside Driver Statement collection ID.");
  const ids = new Set<string>();
  for (const item of collection.items) {
    if (!item.itemId || ids.has(item.itemId)) errors.push("Driver Statement IDs must be present and unique.");
    ids.add(item.itemId);
    if (item.facts.status === "OBTAINED") {
      if (!String(item.facts.content || "").trim()) errors.push(`Obtained Driver Statement ${item.itemId} requires statement content.`);
      if (!String(item.facts.method || "").trim()) errors.push(`Obtained Driver Statement ${item.itemId} requires a statement method.`);
      if (item.facts.method === "UPLOADED_DOCUMENT" && !item.evidenceIds.length) errors.push(`Uploaded-document Driver Statement ${item.itemId} requires supporting evidence.`);
    }
  }
  return errors;
}

export interface RoadsideInspectionViolationInput {
  itemId?: string;
  ruleRegulationCode?: string;
  description?: string;
  regulatoryCategory?: string;
  subjectType: RoadsideViolationSubjectType;
  subjectEquipmentId?: string;
  componentSystem?: string;
  oosState: RoadsideViolationOOSState;
  regulatorSeverityWeight?: number;
  demeritPoints?: number;
  /** TES-normalized finding outcome. Optional: legacy findings carry only oosState. */
  outcome?: RoadsideFindingOutcome;
  /** Presentation attribution (Driver / Vehicle / Both). subjectType remains the canonical equipment-aware subject. */
  applicableTo?: RoadsideApplicableTo;
  evidenceIds?: string[];
  sourceObservation?: PerformanceFactObservation;
  ingestionOrigin?: string;
}

const unique = (values: string[] | undefined) => [...new Set((values || []).filter(Boolean))];

export function createRoadsideViolationItem(input: RoadsideInspectionViolationInput, index = 0): PerformanceChildFactItem {
  const itemId = input.itemId || `RVI-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const observedAt = new Date().toISOString();
  const observations: PerformanceFactObservation[] = [];
  const addObservation = (dataPointId: string, value: StructuredEventFactValue, valueType: "string" | "number") => {
    if (value === undefined || value === null || value === "") return;
    observations.push({
      observationId: `RVO-${itemId}-${dataPointId}`,
      dataPointId,
      value,
      rawValue: value,
      valueType,
      sourceEvidenceIds: unique(input.evidenceIds),
      observedAt,
      ingestedAt: observedAt,
      provenance: { sourceType: "SOURCE_FACT", source: "Roadside Inspection", ingestionOrigin: input.ingestionOrigin || input.sourceObservation?.provenance?.ingestionOrigin, sourceEvidenceIds: unique(input.evidenceIds), ingestionTimestamp: observedAt },
      reviewState: "PENDING_REVIEW",
    });
  };
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.RULE_CODE, input.ruleRegulationCode || null, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.DESCRIPTION, input.description || null, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.REGULATORY_CATEGORY, input.regulatoryCategory || null, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.SUBJECT_TYPE, input.subjectType, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.SUBJECT_EQUIPMENT_ID, input.subjectEquipmentId || null, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.COMPONENT_SYSTEM, input.componentSystem || null, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.OOS_STATE, input.oosState, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.REGULATOR_SEVERITY_WEIGHT, input.regulatorSeverityWeight ?? null, "number");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.DEMERIT_POINTS, input.demeritPoints ?? null, "number");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.OUTCOME, input.outcome || null, "string");
  addObservation(ROADSIDE_VIOLATION_DATA_POINTS.APPLICABLE_TO, input.applicableTo || null, "string");
  if (input.sourceObservation) observations.push(input.sourceObservation);
  return {
    itemId,
    facts: {
      ruleRegulationCode: input.ruleRegulationCode || null,
      description: input.description || null,
      regulatoryCategory: input.regulatoryCategory || null,
      subjectType: input.subjectType,
      subjectEquipmentId: input.subjectEquipmentId || null,
      componentSystem: input.componentSystem || null,
      oosState: input.oosState,
      regulatorSeverityWeight: input.regulatorSeverityWeight ?? null,
      demeritPoints: input.demeritPoints ?? null,
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.applicableTo ? { applicableTo: input.applicableTo } : {}),
    },
    observations,
    evidenceIds: unique(input.evidenceIds),
    provenance: { sourceType: "SOURCE_FACT", source: "Roadside Inspection", ingestionOrigin: input.ingestionOrigin || input.sourceObservation?.provenance?.ingestionOrigin, sourceEvidenceIds: unique(input.evidenceIds), ingestionTimestamp: observedAt },
  };
}

export function createRoadsideViolationCollection(items: PerformanceChildFactItem[], completeness: RoadsideViolationCollectionCompleteness = "COMPLETE"): PerformanceChildCollection {
  return {
    collectionId: ROADSIDE_VIOLATION_COLLECTION_ID,
    collectionVersion: ROADSIDE_VIOLATION_COLLECTION_VERSION,
    itemType: "ROADSIDE_INSPECTION_VIOLATION",
    completeness,
    items,
    derivedAggregateDefinitions: {
      totalCount: { expression: "items.length", valueType: "number" },
      driverCount: { expression: "items.filter(subjectType === DRIVER).length", valueType: "number" },
      vehicleCount: { expression: "items.filter(subjectType in [POWER_UNIT,TOWED_UNIT]).length", valueType: "number" },
      carrierCount: { expression: "items.filter(subjectType === OPERATING_CARRIER).length", valueType: "number" },
      oosCount: { expression: "items.filter(oosState === YES).length", valueType: "number" },
    },
  };
}

export function getRoadsideViolationCollection(event: { childCollections?: PerformanceChildCollection[] }): PerformanceChildCollection | undefined {
  const collection = event.childCollections?.find((item) => item.collectionId === ROADSIDE_VIOLATION_COLLECTION_ID);
  if (!collection) return undefined;
  // Read-only legacy normalization. It does not rewrite persisted history or generate IDs.
  return {
    ...collection,
    completeness: collection.completeness || "NOT_PROVIDED",
    items: collection.items.map((item) => item.facts.subjectType ? item : ({ ...item, facts: { ...item.facts, subjectType: item.facts.attribution || "OTHER" } })),
  };
}

export function deriveRoadsideViolationCounts(collection: PerformanceChildCollection | undefined) {
  const items = collection?.items || [];
  // An explicit Applicable To (Driver / Vehicle / Both) takes precedence; legacy findings use subjectType.
  const touchesDriver = (item: PerformanceChildFactItem) => isRoadsideApplicableTo(item.facts.applicableTo) ? item.facts.applicableTo !== "VEHICLE" : item.facts.subjectType === "DRIVER";
  const touchesVehicle = (item: PerformanceChildFactItem) => isRoadsideApplicableTo(item.facts.applicableTo) ? item.facts.applicableTo !== "DRIVER" : (item.facts.subjectType === "POWER_UNIT" || item.facts.subjectType === "TOWED_UNIT");
  return {
    total: items.length,
    driver: items.filter(touchesDriver).length,
    vehicle: items.filter(touchesVehicle).length,
    carrier: items.filter((item) => item.facts.subjectType === "OPERATING_CARRIER").length,
    other: items.filter((item) => item.facts.subjectType === "OTHER").length,
    oos: items.filter((item) => item.facts.oosState === "YES").length,
  };
}

export function validateRoadsideViolationCollection(collection: PerformanceChildCollection): string[] {
  const errors: string[] = [];
  if (collection.collectionId !== ROADSIDE_VIOLATION_COLLECTION_ID) errors.push("Unexpected Roadside violation collection ID.");
  if (collection.collectionVersion !== ROADSIDE_VIOLATION_COLLECTION_VERSION) errors.push("Unsupported Roadside violation collection version.");
  if (!["COMPLETE", "PARTIAL", "NOT_PROVIDED"].includes(collection.completeness)) errors.push("Roadside violation collection completeness must be COMPLETE, PARTIAL, or NOT_PROVIDED.");
  if (collection.completeness === "NOT_PROVIDED" && collection.items.length > 0) errors.push("A NOT_PROVIDED Roadside violation collection cannot contain child items.");
  const ids = new Set<string>();
  for (const item of collection.items) {
    if (!item.itemId || ids.has(item.itemId)) errors.push("Roadside violation item IDs must be present and unique.");
    ids.add(item.itemId);
    if (!["DRIVER", "OPERATING_CARRIER", "POWER_UNIT", "TOWED_UNIT", "OTHER"].includes(String(item.facts.subjectType))) errors.push(`Invalid violation subject on ${item.itemId}.`);
    if (["POWER_UNIT", "TOWED_UNIT"].includes(String(item.facts.subjectType)) && !String(item.facts.subjectEquipmentId || "").trim()) errors.push(`Equipment-specific violation ${item.itemId} requires a stable inspected-equipment subject ID.`);
    if (!["POWER_UNIT", "TOWED_UNIT"].includes(String(item.facts.subjectType)) && item.facts.subjectEquipmentId) errors.push(`Non-equipment violation ${item.itemId} must not carry an equipment subject ID.`);
    if (!["YES", "NO", "UNKNOWN"].includes(String(item.facts.oosState))) errors.push(`Invalid violation OOS state on ${item.itemId}.`);
    if (item.facts.outcome !== undefined && item.facts.outcome !== null && (!isRoadsideOutcome(item.facts.outcome) || item.facts.outcome === "PASS")) errors.push(`Invalid finding outcome on ${item.itemId}.`);
    if (item.facts.applicableTo !== undefined && item.facts.applicableTo !== null && !isRoadsideApplicableTo(item.facts.applicableTo)) errors.push(`Invalid Applicable To on ${item.itemId}.`);
    if (item.facts.outcome === "OUT_OF_SERVICE" && item.facts.oosState === "NO") errors.push(`Finding ${item.itemId} has outcome Out of Service but OOS state No.`);
  }
  return errors;
}

export function validateRoadsideInspectionConsistency(facts: Record<string, unknown>, collection: PerformanceChildCollection | undefined): string[] {
  const errors: string[] = [];
  const scope = facts.inspectionScope;
  if (!["DRIVER", "VEHICLE", "BOTH"].includes(String(scope))) errors.push("Inspection Scope is required and must be Driver, Vehicle, or Driver & Vehicle.");
  const driverApplicable = scope === "DRIVER" || scope === "BOTH";
  const vehicleApplicable = scope === "VEHICLE" || scope === "BOTH";
  const driverResult = facts.driverInspectionResult === "CLEAN" ? "PASS" : facts.driverInspectionResult;
  const vehicleResult = facts.vehicleInspectionResult === "CLEAN" ? "PASS" : facts.vehicleInspectionResult;
  const sourceResult = facts.inspectionResult === "CLEAN" ? "PASS" : facts.inspectionResult;
  const driverOOS = facts.driverOOSState;
  const vehicleOOS = facts.vehicleOOSState;
  if (!driverApplicable && ["driverInspectionResult","driverOOSState","driverDemeritPoints"].some((key) => facts[key] !== undefined)) errors.push("Driver-specific facts are not applicable to the selected Inspection Scope.");
  if (!vehicleApplicable && ["vehicleInspectionResult","vehicleOOSState","vehicleDemeritPoints","hazmatInspected"].some((key) => facts[key] !== undefined)) errors.push("Vehicle-specific facts are not applicable to the selected Inspection Scope.");
  if (driverApplicable && driverResult === "PASS" && driverOOS === "YES") errors.push("Driver inspection result cannot be Pass while Driver OOS is Yes.");
  if (vehicleApplicable && vehicleResult === "PASS" && vehicleOOS === "YES") errors.push("Vehicle inspection result cannot be Pass while Vehicle OOS is Yes.");
  if (collection) {
    const childCount = collection.items.length;
    const sourceTotal = typeof facts.sourceReportedViolationCount === "number" ? facts.sourceReportedViolationCount : undefined;
    if (sourceTotal !== undefined && childCount > sourceTotal) errors.push(`Structured violation count (${childCount}) exceeds source-reported total (${sourceTotal}); reconciliation conflict requires review.`);
    if (collection.completeness === "COMPLETE" && sourceTotal !== undefined && sourceTotal !== childCount) errors.push(`Complete violation collection count (${childCount}) conflicts with source-reported total (${sourceTotal}).`);
    if (collection.completeness === "NOT_PROVIDED" && childCount !== 0) errors.push("NOT_PROVIDED violation collection must not contain child items.");
    if (sourceResult === "PASS" && childCount > 0) errors.push("Source-reported Pass conflicts with structured violations.");
    if (sourceResult === "PASS" && collection.completeness === "COMPLETE" && childCount > 0 && (collection.items.some((item) => item.facts.oosState === "YES"))) errors.push("Source-reported Pass conflicts with an OOS violation finding.");
  }
  return errors;
}

export function deriveRoadsideInspectionOutcome(facts: Record<string, unknown>, collection: PerformanceChildCollection | undefined): "PASS" | "VIOLATIONS_FOUND" | "OUT_OF_SERVICE" | "UNKNOWN" {
  const scope = facts.inspectionScope;
  if (scope !== "DRIVER" && scope !== "VEHICLE" && scope !== "BOTH") return "UNKNOWN";
  const driverApplicable = scope === "DRIVER" || scope === "BOTH";
  const vehicleApplicable = scope === "VEHICLE" || scope === "BOTH";
  const driverResult = facts.driverInspectionResult === "CLEAN" ? "PASS" : facts.driverInspectionResult;
  const vehicleResult = facts.vehicleInspectionResult === "CLEAN" ? "PASS" : facts.vehicleInspectionResult;
  if ((driverApplicable && (facts.driverOOSState === "YES" || driverResult === "OUT_OF_SERVICE")) ||
      (vehicleApplicable && (facts.vehicleOOSState === "YES" || vehicleResult === "OUT_OF_SERVICE")) ||
      Boolean(collection?.items.some((item) => item.facts.oosState === "YES"))) return "OUT_OF_SERVICE";
  if ((driverApplicable && driverResult === "VIOLATIONS_FOUND") || (vehicleApplicable && vehicleResult === "VIOLATIONS_FOUND") || Boolean(collection?.items.length)) return "VIOLATIONS_FOUND";
  if (collection?.completeness === "PARTIAL" || collection?.completeness === "NOT_PROVIDED") return "UNKNOWN";
  if ((driverApplicable && driverResult !== "PASS") || (vehicleApplicable && vehicleResult !== "PASS")) return "UNKNOWN";
  return "PASS";
}

/** Finding outcome: explicit TES outcome when recorded; otherwise derived from the legacy oosState (a recorded finding is at least Requires Attention). */
export function roadsideFindingOutcome(item: PerformanceChildFactItem): RoadsideFindingOutcome {
  const explicit = item.facts.outcome;
  if (isRoadsideOutcome(explicit) && explicit !== "PASS") return explicit;
  return item.facts.oosState === "YES" ? "OUT_OF_SERVICE" : "REQUIRES_ATTENTION";
}

/** Applicable To: explicit when recorded; otherwise derived from subjectType where that is unambiguous; otherwise undefined (never guessed). */
export function roadsideFindingApplicableTo(item: PerformanceChildFactItem): RoadsideApplicableTo | undefined {
  if (isRoadsideApplicableTo(item.facts.applicableTo)) return item.facts.applicableTo;
  if (item.facts.subjectType === "DRIVER") return "DRIVER";
  if (item.facts.subjectType === "POWER_UNIT" || item.facts.subjectType === "TOWED_UNIT") return "VEHICLE";
  return undefined;
}

export function maxRoadsideOutcome(values: Array<RoadsideOutcome | undefined>): RoadsideOutcome | undefined {
  let best: RoadsideOutcome | undefined;
  for (const value of values) if (value && (!best || ROADSIDE_OUTCOME_PRECEDENCE.indexOf(value) > ROADSIDE_OUTCOME_PRECEDENCE.indexOf(best))) best = value;
  return best;
}

/**
 * Overall Outcome (TES-normalized). Precedence: Out of Service > Requires Attention > Warning > Pass.
 * Inputs: the recorded Overall Outcome fact (when present), every finding's outcome, and the existing
 * OOS derivation. Legacy records (no overallOutcome fact) resolve from the existing derivation without any rewrite.
 * Source-reported wording (inspectionResult) is never modified.
 */
export function deriveRoadsideOverallOutcome(facts: Record<string, unknown>, collection: PerformanceChildCollection | undefined): RoadsideOutcome | "UNKNOWN" {
  const base = deriveRoadsideInspectionOutcome(facts, collection);
  const selected = isRoadsideOutcome(facts.overallOutcome) ? facts.overallOutcome : undefined;
  const findingMax = maxRoadsideOutcome((collection?.items || []).map(roadsideFindingOutcome));
  const resolved = maxRoadsideOutcome([selected, findingMax, base === "OUT_OF_SERVICE" ? "OUT_OF_SERVICE" : undefined]);
  if (resolved) return resolved;
  if (base === "VIOLATIONS_FOUND") return "REQUIRES_ATTENTION";
  if (base === "PASS") return "PASS";
  return "UNKNOWN";
}
