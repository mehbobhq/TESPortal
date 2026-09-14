import type { MachineObservation, TESMachineDocumentResult } from "@/lib/machine-acquisition";
import { resolveRoadsideCanonicalOccurrence, type RoadsideMachineEquipmentObservation, type RoadsideMachineFindingObservation, type RoadsideMachineSourceRecord } from "@/lib/roadside-machine-schema";
import type { StructuredEventFactValue } from "@/types/drivers";

const text = (value: StructuredEventFactValue | undefined): string | undefined => value === null || value === undefined ? undefined : String(value).trim() || undefined;
const numberValue = (value: StructuredEventFactValue | undefined): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
const booleanValue = (value: StructuredEventFactValue | undefined): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (["YES", "Y", "TRUE", "1", "O", "OUT OF SERVICE"].includes(normalized)) return true;
  if (["NO", "N", "FALSE", "0"].includes(normalized)) return false;
  return undefined;
};
const observationValue = (observation: MachineObservation): StructuredEventFactValue => observation.normalizedValue === undefined ? observation.rawValue : observation.normalizedValue;
const first = (result: TESMachineDocumentResult, id: string) => result.observations.find((item) => item.dataPointId === id);
const firstText = (result: TESMachineDocumentResult, ...ids: string[]): string | undefined => {
  for (const id of ids) {
    const observation = first(result, id);
    const value = observation ? text(observationValue(observation)) : undefined;
    if (value) return value;
  }
  return undefined;
};

function groups(result: TESMachineDocumentResult, prefix: string): MachineObservation[][] {
  const grouped = new Map<string, MachineObservation[]>();
  let fallback = 0;
  for (const observation of result.observations.filter((item) => item.dataPointId.startsWith(prefix))) {
    const key = observation.providerEntityId || `ungrouped-${fallback++}`;
    const items = grouped.get(key) || [];
    items.push(observation);
    grouped.set(key, items);
  }
  return [...grouped.values()];
}

function sequentialGroups(result: TESMachineDocumentResult, prefix: string): MachineObservation[][] {
  const rows: MachineObservation[][] = [];
  let current: MachineObservation[] = [];
  const observations = result.observations.filter((item) => item.dataPointId.startsWith(prefix));

  for (const observation of observations) {
    const alreadySeenInCurrentRow = current.some((item) => item.dataPointId === observation.dataPointId);
    if (current.length && alreadySeenInCurrentRow) {
      rows.push(current);
      current = [];
    }
    current.push(observation);
  }

  if (current.length) rows.push(current);
  return rows;
}

const childValue = (items: MachineObservation[], id: string) => {
  const observation = items.find((item) => item.dataPointId === id);
  return observation ? observationValue(observation) : undefined;
};

const vinCompleteness = (value?: string): RoadsideMachineEquipmentObservation["vinSerialNumberCompleteness"] => {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length === 17) return "FULL";
  if (/^[A-Z0-9]{6}$/.test(normalized)) return "PARTIAL_LAST_6";
  return "PARTIAL";
};

function equipmentFrom(result: TESMachineDocumentResult): RoadsideMachineEquipmentObservation[] {
  return groups(result, "roadside.equipment.").map((items) => {
    const vinSerialNumber = text(childValue(items, "roadside.equipment.vin_serial_number"));
    return {
    sourceUnitNumber: text(childValue(items, "roadside.equipment.source_unit_number")),
    equipmentType: text(childValue(items, "roadside.equipment.equipment_type")),
    vinSerialNumber,
    vinSerialNumberCompleteness: vinCompleteness(vinSerialNumber),
    plateNumber: text(childValue(items, "roadside.equipment.plate_number")),
    plateJurisdiction: text(childValue(items, "roadside.equipment.plate_jurisdiction")),
    cvsaDecalNumber: text(childValue(items, "roadside.equipment.cvsa_decal_number")),
    cvipPmviDecalNumber: text(childValue(items, "roadside.equipment.cvip_pmvi_decal_number")),
    cvipPmviDecalJurisdiction: text(childValue(items, "roadside.equipment.cvip_pmvi_decal_jurisdiction")),
    };
  }).filter((item) => Object.values(item).some((value) => value !== undefined && value !== ""));
}

function findingsFrom(result: TESMachineDocumentResult): RoadsideMachineFindingObservation[] {
  const grouped = groups(result, "roadside.finding.");
  const sourceGroups = grouped.every((items) => items.length === 1) ? sequentialGroups(result, "roadside.finding.") : grouped;
  return sourceGroups.map((items) => ({
    sourceUnitNumber: text(childValue(items, "roadside.finding.source_unit_number")),
    sourceEquipmentReference: text(childValue(items, "roadside.finding.source_equipment_reference")),
    defectCategory: text(childValue(items, "roadside.finding.defect_category")),
    defectCode: text(childValue(items, "roadside.finding.defect_code")),
    defectDescription: text(childValue(items, "roadside.finding.defect_description")),
    outOfService: booleanValue(childValue(items, "roadside.finding.out_of_service")),
    majorDefect: booleanValue(childValue(items, "roadside.finding.major_defect")),
    charges: text(childValue(items, "roadside.finding.charges")),
    comments: text(childValue(items, "roadside.finding.comments")),
    sourcePoints: numberValue(childValue(items, "roadside.finding.source_points")),
    inspectionItem: text(childValue(items, "roadside.finding.inspection_item")),
    sourceFindingNumber: text(childValue(items, "roadside.finding.source_finding_number")),
    sourceReferenceNumber: text(childValue(items, "roadside.finding.source_reference_number")),
    sourceResultCode: text(childValue(items, "roadside.finding.source_result_code")),
    violationCode: text(childValue(items, "roadside.finding.violation_code")),
    violationDescription: text(childValue(items, "roadside.finding.violation_description")),
  })).filter((item) => Object.values(item).some((value) => value !== undefined && value !== ""));
}

export function mapMachineResultToRoadsideSource(result: TESMachineDocumentResult): RoadsideMachineSourceRecord {
  return {
    sourceEvidenceId: result.sourceEvidenceId,
    sourceDocumentTitle: firstText(result, "roadside.source_document_title"),
    reportNumber: firstText(result, "roadside.report_number"),
    inspectionDate: firstText(result, "roadside.inspection_date"),
    inspectionTime: firstText(result, "roadside.inspection_time"),
    inspectionEndDate: firstText(result, "roadside.inspection_end_date"),
    inspectionEndTime: firstText(result, "roadside.inspection_end_time"),
    inspectionLevel: firstText(result, "roadside.inspection_level"),
    sourceStatus: firstText(result, "roadside.source_status"),
    inspectionType: firstText(result, "roadside.inspection_type"),
    inspectionScope: firstText(result, "roadside.inspection_scope"),
    cvsaResult: firstText(result, "roadside.cvsa_result"),
    enforcementDisposition: firstText(result, "roadside.enforcement_disposition"),
    location: firstText(result, "roadside.inspection_location", "roadside.location"),
    city: firstText(result, "roadside.inspection_city", "roadside.city"),
    stateProvince: firstText(result, "roadside.inspection_state_province", "roadside.state_province"),
    country: firstText(result, "roadside.country"),
    driverName: firstText(result, "roadside.driver_name"),
    driverLicenceNumber: firstText(result, "roadside.driver_licence_number"),
    driverLicenceJurisdiction: firstText(result, "roadside.driver_licence_jurisdiction"),
    driverDateOfBirth: firstText(result, "roadside.driver_date_of_birth"),
    carrierName: firstText(result, "roadside.carrier_name"),
    agency: firstText(result, "roadside.enforcement_agency", "roadside.agency"),
    officerName: firstText(result, "roadside.officer_name"),
    officerNumber: firstText(result, "roadside.officer_number"),
    equipment: equipmentFrom(result),
    findings: findingsFrom(result),
    observations: result.observations.map((observation) => ({ dataPointId: observation.dataPointId, value: observationValue(observation), confidence: observation.confidence })),
  };
}

export function buildRoadsideMachineDraft(result: TESMachineDocumentResult) {
  const source = mapMachineResultToRoadsideSource(result);
  const occurrence = resolveRoadsideCanonicalOccurrence(source);
  return { classification: result.classification, source, eventDate: occurrence.eventDate, eventTime: occurrence.eventTime, evidenceIds: [result.sourceEvidenceId], requiresInternalReview: !result.classification.autoRouteEligible, warnings: result.warnings, providerMetadata: result.providerMetadata };
}
