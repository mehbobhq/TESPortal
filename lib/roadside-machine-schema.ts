import type { StructuredEventFactValue } from "@/types/drivers";
import { JURISDICTIONS } from "@/lib/jurisdictions";

export interface RoadsideMachineEquipmentObservation {
  sourceUnitNumber?: string; equipmentType?: string; vinSerialNumber?: string;
  vinSerialNumberCompleteness?: "FULL" | "PARTIAL_LAST_6" | "PARTIAL" | "UNKNOWN";
  plateNumber?: string; plateJurisdiction?: string; cvsaDecalNumber?: string;
  cvipPmviDecalNumber?: string; cvipPmviDecalJurisdiction?: string;
}
export interface RoadsideMachineFindingObservation {
  sourceUnitNumber?: string; sourceEquipmentReference?: string; defectCategory?: string;
  defectCode?: string; defectDescription?: string; outOfService?: boolean;
  majorDefect?: boolean; charges?: string; comments?: string; sourcePoints?: number;
  inspectionItem?: string; sourceFindingNumber?: string; sourceReferenceNumber?: string;
  sourceResultCode?: string; violationCode?: string; violationDescription?: string;
}
export interface RoadsideMachineSourceRecord {
  sourceEvidenceId: string; sourceDocumentTitle?: string; reportNumber?: string;
  inspectionDate?: string; inspectionTime?: string; inspectionEndDate?: string;
  inspectionEndTime?: string; inspectionLevel?: string; sourceStatus?: string;
  inspectionType?: string; inspectionScope?: string; cvsaResult?: string;
  enforcementDisposition?: string; location?: string; city?: string; stateProvince?: string;
  country?: string; driverName?: string; driverLicenceNumber?: string;
  driverLicenceJurisdiction?: string; driverDateOfBirth?: string; carrierName?: string;
  agency?: string; officerName?: string; officerNumber?: string;
  equipment: RoadsideMachineEquipmentObservation[];
  findings: RoadsideMachineFindingObservation[];
  observations: Array<{ dataPointId: string; value: StructuredEventFactValue; confidence?: number }>;
}

export interface RoadsideCanonicalFacts {
  jurisdiction?: string;
  inspectionRegime?: "US_CVSA" | "CA_NSC_CVSA" | "OTHER";
  inspectionClassification?: string;
  inspectionScope?: "DRIVER" | "VEHICLE" | "BOTH";
  inspectionResult?: "PASS" | "VIOLATIONS_FOUND";
  driverInspectionResult?: "PASS" | "VIOLATIONS_FOUND";
  driverOOSState?: "YES" | "NO" | "UNKNOWN";
  vehicleInspectionResult?: "PASS" | "VIOLATIONS_FOUND";
  vehicleOOSState?: "YES" | "NO" | "UNKNOWN";
  sourceReportedViolationCount?: number;
}

const normalizedWords = (value?: string) => value?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function resolveJurisdiction(value?: string): string | undefined {
  const normalized = normalizedWords(value);
  if (!normalized) return undefined;
  return JURISDICTIONS.find((item) => normalizedWords(item.code) === normalized || normalizedWords(item.label) === normalized)?.code;
}

function isBcNoticeAndOrder(source: RoadsideMachineSourceRecord): boolean {
  const title = normalizedWords(source.sourceDocumentTitle);
  const report = source.reportNumber?.trim().toUpperCase();
  return title === "NOTICE AND ORDER" && Boolean(report?.startsWith("MV510_"));
}

function resolveClassification(value: string | undefined, regime: RoadsideCanonicalFacts["inspectionRegime"]): string | undefined {
  const normalized = normalizedWords(value);
  if (!normalized || !regime) return undefined;
  if (regime === "CA_NSC_CVSA") {
    const match = normalized.match(/^(?:CVSA )?(?:INSPECTION )?TYPE ([1-5])$/);
    return match ? `CA_TYPE_${match[1]}` : undefined;
  }
  if (regime === "US_CVSA") {
    const roman = normalized.match(/^(?:CVSA )?(?:INSPECTION )?LEVEL (I|II|III|IV|V|VI|VII|VIII)$/)?.[1];
    const numeric = normalized.match(/^(?:CVSA )?(?:INSPECTION )?LEVEL ([1-8])$/)?.[1];
    const levels: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI", "7": "VII", "8": "VIII" };
    const level = roman || (numeric ? levels[numeric] : undefined);
    return level ? `US_LEVEL_${level}` : undefined;
  }
  return normalized === "OTHER" ? "OTHER" : undefined;
}

function resolveScope(value?: string): RoadsideCanonicalFacts["inspectionScope"] {
  const normalized = normalizedWords(value);
  if (!normalized) return undefined;
  if (["BOTH", "DRIVER AND VEHICLE", "DRIVER VEHICLE"].includes(normalized)) return "BOTH";
  if (["DRIVER", "DRIVER ONLY"].includes(normalized)) return "DRIVER";
  if (["VEHICLE", "VEHICLE ONLY"].includes(normalized)) return "VEHICLE";
  return undefined;
}

function resolveResult(...values: Array<string | undefined>): RoadsideCanonicalFacts["inspectionResult"] {
  for (const value of values) {
    const normalized = normalizedWords(value);
    if (!normalized) continue;
    if (["PASS", "PASSED", "NO VIOLATIONS", "NO VIOLATIONS FOUND", "SATISFACTORY"].includes(normalized)) return "PASS";
    if (["VIOLATIONS FOUND", "VIOLATION FOUND", "DEFECTS FOUND", "DEFECT FOUND"].includes(normalized)) return "VIOLATIONS_FOUND";
  }
  return undefined;
}

const normalizedResultCode = (value?: string) => normalizedWords(value);

function isViolationFinding(finding: RoadsideMachineFindingObservation): boolean {
  const code = normalizedResultCode(finding.sourceResultCode);
  return code === "X" || code === "O" || finding.outOfService === true || finding.majorDefect === true;
}

function isSourceInspectionRow(finding: RoadsideMachineFindingObservation): boolean {
  const code = normalizedResultCode(finding.sourceResultCode);
  return code === "X" || code === "O" || code === "N" || isViolationFinding(finding);
}

function isOosFinding(finding: RoadsideMachineFindingObservation): boolean {
  return normalizedResultCode(finding.sourceResultCode) === "O" || finding.outOfService === true;
}

function isDriverFinding(finding: RoadsideMachineFindingObservation): boolean {
  const item = normalizedWords(finding.inspectionItem || finding.defectCategory);
  return item === "DRIVER" || item === "DRIVER CREDENTIAL" || item === "HOURS OF SERVICE";
}

function isVehicleFinding(finding: RoadsideMachineFindingObservation): boolean {
  const reference = normalizedWords(finding.sourceEquipmentReference || finding.sourceUnitNumber);
  const item = normalizedWords(finding.inspectionItem || finding.defectCategory);
  return Boolean(reference && reference !== "DRIVER") || ["POWER UNIT", "TRAILER", "LIGHTING DEVICES", "BRAKES", "TIRES", "WHEELS"].some((value) => item?.includes(value));
}

export function resolveRoadsideCanonicalFacts(source: RoadsideMachineSourceRecord): RoadsideCanonicalFacts {
  const jurisdiction = resolveJurisdiction(source.stateProvince) || (isBcNoticeAndOrder(source) ? "BC" : undefined);
  const jurisdictionDefinition = JURISDICTIONS.find((item) => item.code === jurisdiction);
  const inspectionRegime = jurisdictionDefinition?.country === "Canada"
    ? "CA_NSC_CVSA"
    : jurisdictionDefinition?.country === "United States"
      ? "US_CVSA"
      : undefined;
  const inspectionClassification = resolveClassification(source.inspectionLevel || source.inspectionType, inspectionRegime);
  let inspectionScope = resolveScope(source.inspectionScope || source.inspectionType);
  // Only classifications whose repository labels explicitly state their
  // scope are used as a fallback. Special/jurisdiction-specific types remain unresolved.
  if (!inspectionScope && inspectionClassification === "US_LEVEL_III") inspectionScope = "DRIVER";
  if (!inspectionScope && inspectionClassification === "US_LEVEL_V") inspectionScope = "VEHICLE";
  if (!inspectionScope && ["US_LEVEL_I", "US_LEVEL_II"].includes(inspectionClassification || "")) inspectionScope = "BOTH";
  if (!inspectionScope) {
    const driverSeen = source.findings.some(isDriverFinding) || Boolean(source.driverName || source.driverLicenceNumber);
    const vehicleSeen = source.findings.some(isVehicleFinding) || source.equipment.some((item) => Boolean(item.vinSerialNumber || item.plateNumber || item.sourceUnitNumber));
    if (driverSeen && vehicleSeen) inspectionScope = "BOTH";
    else if (driverSeen) inspectionScope = "DRIVER";
    else if (vehicleSeen) inspectionScope = "VEHICLE";
  }
  const sourceInspectionRows = source.findings.filter(isSourceInspectionRow);
  const violationFindings = source.findings.filter(isViolationFinding);
  const inspectionResult = resolveResult(source.cvsaResult, source.sourceStatus) || (violationFindings.length ? "VIOLATIONS_FOUND" : undefined);
  const driverViolation = violationFindings.some(isDriverFinding);
  const vehicleViolation = violationFindings.some(isVehicleFinding);
  const driverOos = violationFindings.some((finding) => isDriverFinding(finding) && isOosFinding(finding));
  const vehicleOos = violationFindings.some((finding) => isVehicleFinding(finding) && isOosFinding(finding));
  return {
    jurisdiction,
    inspectionRegime,
    inspectionClassification,
    inspectionScope,
    inspectionResult,
    driverInspectionResult: inspectionResult === "VIOLATIONS_FOUND" && (inspectionScope === "DRIVER" || inspectionScope === "BOTH")
      ? driverViolation ? "VIOLATIONS_FOUND" : "PASS"
      : undefined,
    driverOOSState: inspectionResult === "VIOLATIONS_FOUND" && (inspectionScope === "DRIVER" || inspectionScope === "BOTH")
      ? driverOos ? "YES" : driverViolation ? "NO" : undefined
      : undefined,
    vehicleInspectionResult: inspectionResult === "VIOLATIONS_FOUND" && (inspectionScope === "VEHICLE" || inspectionScope === "BOTH")
      ? vehicleViolation ? "VIOLATIONS_FOUND" : "PASS"
      : undefined,
    vehicleOOSState: inspectionResult === "VIOLATIONS_FOUND" && (inspectionScope === "VEHICLE" || inspectionScope === "BOTH")
      ? vehicleOos ? "YES" : vehicleViolation ? "NO" : undefined
      : undefined,
    sourceReportedViolationCount: inspectionResult === "VIOLATIONS_FOUND" ? sourceInspectionRows.length || violationFindings.length || undefined : undefined,
  };
}
export function resolveRoadsideCanonicalOccurrence(source: RoadsideMachineSourceRecord): { eventDate?: string; eventTime?: string } {
  // Primary: use explicit date fields
  let eventDate = source.inspectionEndDate || source.inspectionDate;

  // Fallback: some document formats (e.g. BC Notice and Order) don't get
  // inspectionDate/inspectionEndDate populated by OCR because the date only
  // appears as prose text — but the report number embeds it, e.g.
  // "MV510_20260113_1002" -> 2026-01-13. Pattern: XXXXX_YYYYMMDD_NNNN.
  if (!eventDate && source.reportNumber) {
    const match = source.reportNumber.match(/_(\d{4})(\d{2})(\d{2})_/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (year >= 1000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
        eventDate = `${match[1]}-${match[2]}-${match[3]}`;
      }
    }
  }

  let eventTime = source.inspectionEndTime || source.inspectionTime;
  if (!eventTime && source.reportNumber) {
    const match = source.reportNumber.match(/_\d{8}_(\d{2})(\d{2})(?:_|$)/);
    if (match) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        eventTime = `${match[1]}:${match[2]}`;
      }
    }
  }

  return { eventDate, eventTime };
}
