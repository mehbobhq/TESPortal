"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Link2, X } from "lucide-react";
import type {
  CompanyDriverRelationship,
  DriverEvidenceItem,
  DriverPerformanceEvent,
  StructuredEventFact,
  TrainingRecord,
} from "@/types/drivers";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE, RECORDABLE_PERFORMANCE_CATEGORIES, PERFORMANCE_DISPUTE_STATES, PERFORMANCE_VERIFICATION_STATES, PERFORMANCE_EVENT_SCHEMA_VERSION, resolvePerformanceApplicability, resolvePerformanceRelationshipState, resolveRelationshipApplicability, resolvePerformanceSourcePolicy, resolvePerformanceSteps } from "@/lib/driver-performance-schema";
import { JURISDICTIONS, getJurisdictionLabel, resolveCountryForJurisdiction } from "@/lib/jurisdictions";
import { createRoadsideViolationItem, createRoadsideViolationCollection, createRoadsideEquipmentItem, createRoadsideEquipmentCollection, createRoadsideStatementItem, createRoadsideStatementCollection, validateRoadsideViolationCollection, validateRoadsideInspectionConsistency, deriveRoadsideInspectionOutcome, type RoadsideViolationSubjectType, type RoadsideViolationOOSState } from "@/lib/driver-performance-child-facts";
import { resolveCanonicalVehicleByIdentifiers } from "@/lib/vehicle-data";
import { resolveRoadsideCanonicalFacts, resolveRoadsideCanonicalOccurrence, type RoadsideMachineSourceRecord } from "@/lib/roadside-machine-schema";

interface Props {
  relationship: CompanyDriverRelationship;
  trainings: TrainingRecord[];
  evidence: DriverEvidenceItem[];
  onRequestEvidenceUpload?: () => void;
  machineAcquisitionDraft?: RoadsideMachineSourceRecord | null;
  initialMachineAcquisitionDraft?: RoadsideMachineSourceRecord | null;
  isProcessingOCR?: boolean;
  ocrError?: string | null;
  companyRegJurisdiction?: string;
  initialEntryMode?: "DOCUMENT" | "MANUAL";
  evidenceCreatedId?: string | null;
  pendingPerformanceSources?: import("@/types/drivers").PerformanceSourceIngestionItem[];
  onClearEvidenceCreatedId?: () => void;
  onClose: () => void;
  onSave: (data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => void;
}

type Primitive = string | number | boolean | null;
type MeasurementInput = { value: number | null; unit: string };
type FactValue = Primitive | MeasurementInput;
type EntryMode = "DOCUMENT" | "MANUAL";
type StepKey = "CATEGORY" | "OCCURRENCE" | "FACTS" | "RELATIONSHIPS" | "EVIDENCE" | "REVIEW";

const inputClass = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";
const hasMeaningfulViolation = (item: { ruleRegulationCode: string; description: string; regulatoryCategory: string }) => Boolean(item.ruleRegulationCode.trim() || item.description.trim() || item.regulatoryCategory.trim());

function FieldInput({ field, value, facts, onChange }: { field: { key: string; label: string; kind: string; required?: boolean; options?: readonly { value: string; label: string }[]; placeholder?: string; helpText?: string; unit?: string; unitOptions?: readonly string[]; unitInput?: boolean; optionsWhen?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>; visibleWhen?: Readonly<Record<string, readonly string[]>>; applicability?: readonly { state: string; when?: Readonly<Record<string, readonly string[]>> }[]; }; value: FactValue; facts: Record<string, FactValue>; onChange: (value: FactValue) => void }) {
  const applicability = resolvePerformanceApplicability(field.applicability as never, facts);
  const visibility = applicability !== "HIDDEN" && applicability !== "NOT_APPLICABLE" && (field.visibleWhen ? Object.entries(field.visibleWhen).every(([key, values]) => values.includes(String(facts[key] ?? ""))) : true);
  if (!visibility) return null;
  const isRequired = applicability === "REQUIRED" || (applicability === "CONDITIONAL" && Boolean(field.required)) || (field.required && !field.applicability);
  const applicableOptions = field.optionsWhen ? (field.options || []).filter((option) => Object.entries(field.optionsWhen!).every(([key, byValue]) => { const dependencyValue = String(facts[key] ?? ""); const allowed = byValue[dependencyValue]; return allowed ? allowed.includes(option.value) : false; })) : field.options || [];
  const label = <label className="text-xs font-semibold text-foreground">{field.label}{isRequired ? <span className="text-destructive"> *</span> : null}</label>;
  if (field.kind === "boolean") return <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-primary" />{label}</label>;
  if (field.kind === "select") return <div>{label}<select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass}><option value="">Select...</option>{applicableOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.helpText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helpText}</p> : null}</div>;
  const type = field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "time" ? "time" : "text";
  const measurement = typeof value === "object" && value !== null && "value" in value ? value as MeasurementInput : null;
  const numericValue = measurement ? (measurement.value === null ? "" : String(measurement.value)) : typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const setNumeric = (raw: string) => {
    if (field.kind !== "number") return onChange(raw);
    const numeric = raw === "" ? null : Number(raw);
    if (field.unitOptions?.length) onChange({ value: numeric, unit: measurement?.unit || "" }); else onChange(numeric);
  };
  return <div>{label}<div className="flex gap-2"><input type={type} value={numericValue} required={isRequired} placeholder={field.placeholder} onChange={(e) => setNumeric(e.target.value)} className={inputClass} />{field.unitOptions?.length ? <select aria-label={`${field.label} unit`} value={measurement?.unit || ""} onChange={(e) => onChange({ value: measurement?.value ?? null, unit: e.target.value })} className={`${inputClass} mt-1 w-28`}><option value="">Unit</option>{field.unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select> : field.unitInput ? <input aria-label={`${field.label} unit`} value={measurement?.unit || ""} onChange={(e) => onChange({ value: measurement?.value ?? null, unit: e.target.value.trim() })} placeholder="Unit" className={`${inputClass} mt-1 w-28`} /> : field.unit ? <span className="mt-1 inline-flex items-center text-[10px] text-muted-foreground">{field.unit}</span> : null}</div>{field.helpText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helpText}</p> : null}</div>;
}

function RecordRow({ label, value }: { label: string; value: Primitive | MeasurementInput }) {
  if (value === null || value === undefined || value === "" || value === false) return null;
  const display = typeof value === "object" && value !== null && "value" in value ? `${value.value ?? ""}${value.unit ? ` ${value.unit}` : ""}` : value === true ? "Yes" : String(value);
  if (!display) return null;
  return <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5 break-words text-xs text-foreground">{display}</div></div>;
}
function displayRoadsideReviewValue(field: { options?: readonly { value: string; label: string }[] }, value: FactValue): Primitive {
  if (typeof value === "string" && field.options) return field.options.find((option) => option.value === value)?.label || value;
  return value;
}

// Maps a machine-acquired document to the correct event category so the
// user never has to pick one manually when OCR already knows the document
// type. Returns null (never guess) when nothing matches — the category
// picker then behaves exactly as it does for manual entry.
function getCategoryFromDraft(draft: RoadsideMachineSourceRecord): DriverPerformanceEvent["eventType"] | null {
  const title = (draft.sourceDocumentTitle || "").toLowerCase();
  const status = (draft.sourceStatus || "").toLowerCase();

  if (
    title.includes("inspection report") ||
    title.includes("notice and order") ||
    title.includes("commercial vehicle inspection") ||
    status.includes("pass inspection") ||
    status.includes("required attention") ||
    status.includes("out of service")
  ) {
    // "Roadside Inspection" is the exact `.value` used throughout this file
    // (see category === "Roadside Inspection" checks) and the exact
    // DriverPerformanceEvent["eventType"] union member — not the schema's
    // internal "ROADSIDE_INSPECTION" `.code`.
    return "Roadside Inspection";
  }

  return null;
}

const draftId = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`;

function roadsideSubjectFromFinding(finding: RoadsideMachineSourceRecord["findings"][number]): RoadsideViolationSubjectType {
  const item = (finding.inspectionItem || finding.defectCategory || "").trim().toUpperCase();
  const reference = (finding.sourceEquipmentReference || finding.sourceUnitNumber || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  if (item === "DRIVER" || item.includes("HOURS")) return "DRIVER";
  if (reference === "PU" || reference.startsWith("PU ") || reference === "POWER UNIT") return "POWER_UNIT";
  if (/^T\s*\d+$/.test(reference) || reference.includes("TRAILER")) return "TOWED_UNIT";
  return "OTHER";
}

function roadsideEquipmentIdForFinding(
  finding: RoadsideMachineSourceRecord["findings"][number],
  equipment: Array<{ itemId: string; role: "POWER_UNIT" | "TOWED_UNIT" }>
): string {
  const reference = (finding.sourceEquipmentReference || finding.sourceUnitNumber || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  if (reference === "PU" || reference.startsWith("PU ") || reference === "POWER UNIT") {
    return equipment.find((item) => item.role === "POWER_UNIT")?.itemId || "";
  }
  const trailerMatch = reference.match(/^T\s*(\d+)$/);
  if (trailerMatch) {
    const trailerIndex = Number(trailerMatch[1]) - 1;
    return equipment.filter((item) => item.role === "TOWED_UNIT")[trailerIndex]?.itemId || "";
  }
  return "";
}

function inferredRoadsideEquipmentType(role: "POWER_UNIT" | "TOWED_UNIT", sourceType?: string): string {
  if (sourceType?.trim()) return sourceType.trim();
  return role === "POWER_UNIT" ? "Tractor" : "";
}

function roadsideFindingDescription(finding: RoadsideMachineSourceRecord["findings"][number]): string {
  const code = (finding.sourceResultCode || "").trim().toUpperCase();
  const codeLabel = code === "X" ? "Violation Present" : code === "O" ? "Out of Service" : code === "N" ? "Inspection Note" : "";
  const text = finding.violationDescription || finding.defectDescription || finding.comments || "";
  return [codeLabel ? `Source result ${code}: ${codeLabel}.` : "", text || (code === "N" ? "No defect indicated by source inspection row." : "")].filter(Boolean).join(" ");
}

function roadsideViolationRowsFromDraft(
  draft: RoadsideMachineSourceRecord,
  equipment: Array<{ itemId: string; role: "POWER_UNIT" | "TOWED_UNIT" }>
): Array<{ itemId: string; ruleRegulationCode: string; description: string; regulatoryCategory: string; subjectType: RoadsideViolationSubjectType; subjectEquipmentId: string; componentSystem: string; oosState: RoadsideViolationOOSState; regulatorSeverityWeight: string; demeritPoints: string }> {
  return draft.findings
    .filter((finding) => {
      const code = (finding.sourceResultCode || "").trim().toUpperCase();
      return code === "X" || code === "O" || code === "N" || finding.outOfService === true || finding.majorDefect === true;
    })
    .map((finding) => {
      const subjectType = roadsideSubjectFromFinding(finding);
      const resultCode = (finding.sourceResultCode || "").trim().toUpperCase();
      return {
        itemId: draftId("RVI-DRAFT"),
        ruleRegulationCode: finding.violationCode || finding.sourceReferenceNumber || finding.defectCode || "",
        description: roadsideFindingDescription(finding),
        regulatoryCategory: finding.inspectionItem || finding.defectCategory || (resultCode === "N" ? "Inspection Note" : ""),
        subjectType,
        subjectEquipmentId: ["POWER_UNIT", "TOWED_UNIT"].includes(subjectType) ? roadsideEquipmentIdForFinding(finding, equipment) : "",
        componentSystem: ["POWER_UNIT", "TOWED_UNIT"].includes(subjectType) ? "" : finding.sourceEquipmentReference || "",
        oosState: resultCode === "O" || finding.outOfService === true ? "YES" : "NO",
        regulatorSeverityWeight: finding.sourcePoints === undefined ? "" : String(finding.sourcePoints),
        demeritPoints: "",
      };
    });
}


export function DriverPerformanceEventWorkflow({ relationship, companyRegJurisdiction, evidence, onRequestEvidenceUpload, machineAcquisitionDraft, initialMachineAcquisitionDraft, isProcessingOCR = false, ocrError = null, evidenceCreatedId, onClearEvidenceCreatedId, initialEntryMode, pendingPerformanceSources = [], onClose, onSave }: Props) {
  console.log("[WORKFLOW] machineAcquisitionDraft prop received:", machineAcquisitionDraft);
  const appliedDraftRef = useRef(false);
  const appliedFieldsRef = useRef(false);
  const [step, setStep] = useState(0);
  const [entryMode, setEntryMode] = useState<EntryMode | null>(initialEntryMode || null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [category, setCategory] = useState<DriverPerformanceEvent["eventType"] | null>(null);
  const [common, setCommon] = useState({ eventDate: "", eventTime: "", reportedDate: "", sourceType: "", sourceRecordId: "", reportedBy: "", location: "", city: "", stateProvince: "", country: "", summary: "", description: "" });
  const [facts, setFacts] = useState<Record<string, FactValue>>({});
  const [trailerRef, setTrailerRef] = useState("");
  const [tripRef, setTripRef] = useState("");
  const [loadRef, setLoadRef] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [customerSiteRef, setCustomerSiteRef] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [originatingSourceEvidenceIds, setOriginatingSourceEvidenceIds] = useState<string[]>([]);
  const effectiveEvidenceIds = useMemo(() => [...new Set([...evidenceIds, ...originatingSourceEvidenceIds])], [evidenceIds, originatingSourceEvidenceIds]);
  const [showExistingEventEvidence, setShowExistingEventEvidence] = useState(false);
  const [verificationState, setVerificationState] = useState<(typeof PERFORMANCE_VERIFICATION_STATES)[number]>("Unverified");
  const [disputeState, setDisputeState] = useState<(typeof PERFORMANCE_DISPUTE_STATES)[number]>("Not Disputed");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDueDate, setFollowUpDueDate] = useState("");
  const [followUpSummary, setFollowUpSummary] = useState("");
  const [roadsideEquipment, setRoadsideEquipment] = useState<Array<{ itemId: string; role: "POWER_UNIT" | "TOWED_UNIT"; equipmentType: string; sourceVin: string; sourcePlate: string; plateJurisdiction: string; sourceUnitNumber: string }>>([]);
  const [roadsideViolations, setRoadsideViolations] = useState<Array<{ itemId: string; ruleRegulationCode: string; description: string; regulatoryCategory: string; subjectType: RoadsideViolationSubjectType; subjectEquipmentId: string; componentSystem: string; oosState: RoadsideViolationOOSState; regulatorSeverityWeight: string; demeritPoints: string }>>([]);
  const [driverStatement, setDriverStatement] = useState<{ itemId: string; status: "OBTAINED" | "REQUESTED" | "DECLINED" | "UNABLE_TO_OBTAIN" | "NOT_APPLICABLE"; date: string; time: string; method: "WRITTEN" | "RECORDED" | "INTERVIEW" | "UPLOADED_DOCUMENT" | "OTHER" | ""; content: string }>({ itemId: `RST-DRAFT-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`, status: "NOT_APPLICABLE", date: "", time: "", method: "", content: "" });

  React.useEffect(() => {
    if (category !== "Roadside Inspection") return;
    const jurisdiction = typeof facts.jurisdiction === "string" ? facts.jurisdiction : "";
    const country = jurisdiction ? resolveCountryForJurisdiction(jurisdiction) : undefined;
    const expectedRegime = country === "Canada" ? "CA_NSC_CVSA" : country === "United States" ? "US_CVSA" : undefined;
    if (expectedRegime && facts.inspectionRegime !== expectedRegime) {
      setFacts((current) => ({
        ...current,
        inspectionRegime: expectedRegime,
        inspectionClassification: null,
      }));
      setValidationError(null);
    }
  }, [category, facts.jurisdiction, facts.inspectionRegime]);

  React.useEffect(() => {
    if (category === "Roadside Inspection") {
      const regime = facts.inspectionRegime;
      const classification = facts.inspectionClassification;
      const us = ["US_LEVEL_I","US_LEVEL_II","US_LEVEL_III","US_LEVEL_IV","US_LEVEL_V","US_LEVEL_VI","US_LEVEL_VII","US_LEVEL_VIII"];
      const ca = ["CA_TYPE_1","CA_TYPE_2","CA_TYPE_3","CA_TYPE_4","CA_TYPE_5"];
      const valid = regime === "US_CVSA" ? us : regime === "CA_NSC_CVSA" ? ca : regime === "OTHER" ? ["OTHER"] : [];
      if (typeof classification === "string" && classification && !valid.includes(classification)) setFacts((current) => ({ ...current, inspectionClassification: null }));
    }
  }, [category, facts.inspectionRegime, facts.inspectionClassification]);


  React.useEffect(() => {
    if (category !== "Out-of-Service Order") return;
    const code = typeof facts.jurisdiction === "string" ? facts.jurisdiction : "";
    if (!code) return;
    const country = resolveCountryForJurisdiction(code);
    setCommon((current) => ({ ...current, stateProvince: code, country: country || current.country }));
  }, [category, facts.jurisdiction]);

  React.useEffect(() => {
    const code = common.stateProvince.trim();
    if (!code) return;
    const country = resolveCountryForJurisdiction(code);
    if (country && common.country !== country) setCommon((current) => ({ ...current, country }));
  }, [common.stateProvince, common.country]);

  React.useEffect(() => {
    if (!evidenceCreatedId) return;
    setOriginatingSourceEvidenceIds((current) => current.includes(evidenceCreatedId) ? current : [...current, evidenceCreatedId]);
    setEvidenceIds((current) => current.includes(evidenceCreatedId) ? current : [...current, evidenceCreatedId]);
    setEntryMode("DOCUMENT");
    onClearEvidenceCreatedId?.();
  }, [evidenceCreatedId]);

  const definition = category ? DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[category] : null;
  const sourcePolicy = useMemo(() => definition ? resolvePerformanceSourcePolicy(definition) : { allowedOrigins: ["MANUAL_ENTRY"], defaultOrigin: "MANUAL_ENTRY", authoritativeSourceTypes: [], reporterApplicability: [] }, [definition]);
  const sourceOptions = sourcePolicy.authoritativeSourceTypes;
  const recordableDefinitions = useMemo(() => RECORDABLE_PERFORMANCE_CATEGORIES.map((value) => DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[value]), []);
  const categoryFields = useMemo(() => definition ? definition.fields.filter((field) => field.key !== "sourceType" && field.key !== "sourceRecordId" && !(category === "Roadside Inspection" && ["jurisdiction","driverStatementStatus","driverStatementDate","driverStatementTime","driverStatementMethod","driverStatementContent"].includes(field.key))) : [], [definition, category]);
  const applicableRelationships = useMemo(() => definition ? resolveRelationshipApplicability(definition, facts) : [], [definition, facts]);
  const visibleSteps = useMemo(() => definition ? resolvePerformanceSteps(definition, facts) as Array<{ key: StepKey; label: string }> : [{ key: "CATEGORY" as StepKey, label: "Category" }], [definition, facts]);
  const currentStep = visibleSteps[step] || visibleSteps[0];
  const lifecycle = definition?.temporalBehavior === "Lifecycle";
  const roadsidePreviewStructuredCount = category === "Roadside Inspection"
    ? roadsideViolations.filter((item) => Boolean(item.ruleRegulationCode.trim() || item.description.trim() || item.regulatoryCategory.trim())).length
    : 0;
  const roadsidePreviewReportedTotal = category === "Roadside Inspection" && typeof facts.sourceReportedViolationCount === "number"
    ? facts.sourceReportedViolationCount
    : undefined;
  const roadsidePreviewReconciliationConflict = category === "Roadside Inspection"
    && facts.inspectionResult === "VIOLATIONS_FOUND"
    && roadsidePreviewReportedTotal !== undefined
    && roadsidePreviewStructuredCount > roadsidePreviewReportedTotal;
  const roadsidePreviewCompleteness = category === "Roadside Inspection" && facts.inspectionResult === "VIOLATIONS_FOUND" ? (() => {
    if (roadsidePreviewReportedTotal === undefined) return "NOT_PROVIDED" as const;
    if (roadsidePreviewReconciliationConflict) return "PARTIAL" as const;
    return roadsidePreviewStructuredCount < roadsidePreviewReportedTotal ? "PARTIAL" as const : "COMPLETE" as const;
  })() : undefined;
  const roadsideResolvedEquipment = useMemo(() => category === "Roadside Inspection" ? roadsideEquipment.map((item) => {
    const normalizedVin = item.sourceVin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    const vinMatchMode = item.role === "POWER_UNIT" && normalizedVin.length >= 6 && normalizedVin.length !== 17 ? "LAST_6" as const : "FULL" as const;
    return { item, resolution: resolveCanonicalVehicleByIdentifiers(relationship.companyId, { vin: item.sourceVin, vinMatchMode, plate: item.sourcePlate, plateJurisdiction: item.plateJurisdiction, unitNumber: item.sourceUnitNumber }, common.eventDate || undefined) };
  }) : [], [category, roadsideEquipment, relationship.companyId, common.eventDate]);
  const powerUnitResolution = roadsideResolvedEquipment.find((entry) => entry.item.role === "POWER_UNIT")?.resolution;
  const powerUnitVehicleId = powerUnitResolution?.state === "AUTO_RESOLVED" ? powerUnitResolution.canonicalVehicle?.id : undefined;
  const roadsidePreviewViolationCollection = category === "Roadside Inspection" ? createRoadsideViolationCollection(roadsideViolations.map((item) => createRoadsideViolationItem({ itemId: item.itemId, ruleRegulationCode: item.ruleRegulationCode || undefined, description: item.description || undefined, regulatoryCategory: item.regulatoryCategory || undefined, subjectType: item.subjectType, subjectEquipmentId: item.subjectEquipmentId || undefined, componentSystem: item.componentSystem || undefined, oosState: item.oosState, regulatorSeverityWeight: item.regulatorSeverityWeight === "" ? undefined : Number(item.regulatorSeverityWeight), demeritPoints: item.demeritPoints === "" ? undefined : Number(item.demeritPoints), effectiveEvidenceIds, ingestionOrigin: entryMode === "DOCUMENT" ? "MANUAL_FALLBACK" : "MANUAL_ENTRY" })), roadsidePreviewCompleteness || "NOT_PROVIDED") : undefined;
  const roadsidePreviewEquipmentCollection = category === "Roadside Inspection" ? createRoadsideEquipmentCollection(roadsideEquipment.map((item) => {
    const resolved = roadsideResolvedEquipment.find((entry) => entry.item.itemId === item.itemId)?.resolution;
    const child = createRoadsideEquipmentItem({ itemId: item.itemId, role: item.role, equipmentType: item.equipmentType || undefined, sourceVin: item.sourceVin || undefined, sourcePlate: item.sourcePlate || undefined, plateJurisdiction: item.plateJurisdiction || undefined, sourceUnitNumber: item.sourceUnitNumber || undefined, effectiveEvidenceIds });
    return {
      ...child,
      relationships: resolved ? [{
        id: `REL-${item.itemId}-VEHICLE`,
        eventId: "PENDING_EVENT",
        relationshipKey: `equipment:${item.itemId}`,
        relationshipRole: item.role === "POWER_UNIT" ? "Inspected Power Unit" : "Inspected Towed Unit",
        relationshipType: "ASSOCIATED_WITH" as const,
        targetEntityType: "Vehicle",
        toEntityId: resolved.canonicalVehicle?.id,
        resolvedRecordId: resolved.canonicalVehicle?.id,
        state: resolved.state === "AUTO_RESOLVED" ? "AUTO_RESOLVED" as const : resolved.state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" as const : resolved.state === "PENDING_SOURCE_DATA" ? "PENDING_SOURCE_DATA" as const : "UNRESOLVED" as const,
        candidateIds: resolved.candidateVehicleIds,
        deterministicMatchingReason: resolved.reason,
        resolutionMethod: resolved.method,
        resolvedEntitySummary: resolved.canonicalVehicle ? `${resolved.canonicalVehicle.year} ${resolved.canonicalVehicle.make} ${resolved.canonicalVehicle.model} - Unit ${resolved.canonicalVehicle.unitNumber} - VIN ${resolved.canonicalVehicle.vin}` : undefined,
        resolvedEntityCompanyId: resolved.canonicalCompanyId,
        conflictCodes: resolved.conflicts,
        identifierDiscrepancies: resolved.identifierDiscrepancies,
        resolutionSource: "DETERMINISTIC_RESOLVER" as const,
        evidenceIds: effectiveEvidenceIds,
        evaluatedAt: resolved.evaluatedAt,
        resolvedAt: resolved.state === "AUTO_RESOLVED" ? resolved.evaluatedAt : undefined,
      }] : undefined,
    };
  }), roadsideEquipment.length ? "COMPLETE" : "NOT_PROVIDED") : undefined;
  const roadsidePreviewStatementCollection = category === "Roadside Inspection" && driverStatement.status !== "NOT_APPLICABLE" ? createRoadsideStatementCollection([createRoadsideStatementItem({ itemId: driverStatement.itemId, status: driverStatement.status, date: driverStatement.date || undefined, time: driverStatement.time || undefined, method: driverStatement.method || undefined, content: driverStatement.content || undefined, evidenceIds: effectiveEvidenceIds })], "COMPLETE") : undefined;
  const roadsideDerivedOutcome = category === "Roadside Inspection" ? (facts.inspectionResult === "PASS" ? "PASS" : deriveRoadsideInspectionOutcome(facts, roadsidePreviewViolationCollection)) : undefined;

  React.useEffect(() => {
    if (category !== "Roadside Inspection") return;
    setFacts((current) => {
      const next = { ...current };
      if (next.inspectionResult === "PASS") {
        ["sourceReportedViolationCount", "driverInspectionResult", "driverOOSState", "driverDemeritPoints", "vehicleInspectionResult", "vehicleOOSState", "vehicleDemeritPoints", "hazmatInspected"].forEach((key) => delete next[key]);
      } else {
        if (next.inspectionScope === "VEHICLE") ["driverInspectionResult", "driverOOSState", "driverDemeritPoints"].forEach((key) => delete next[key]);
        if (next.inspectionScope === "DRIVER") ["vehicleInspectionResult", "vehicleOOSState", "vehicleDemeritPoints", "hazmatInspected"].forEach((key) => delete next[key]);
        if (next.driverInspectionResult === "PASS") { delete next.driverOOSState; delete next.driverDemeritPoints; }
        if (next.vehicleInspectionResult === "PASS") { delete next.vehicleOOSState; delete next.vehicleDemeritPoints; }
      }
      return next;
    });
    if (facts.inspectionResult === "PASS" && roadsideViolations.length) setRoadsideViolations([]);
  }, [category, facts.inspectionResult, facts.inspectionScope, facts.driverInspectionResult, facts.vehicleInspectionResult, roadsideViolations.length]);

  React.useEffect(() => {
    if (category !== "Roadside Inspection") return;
    if (roadsideEquipment.some((item) => item.role === "POWER_UNIT")) return;
    setRoadsideEquipment([{ itemId: `RIE-DRAFT-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`, role: "POWER_UNIT", equipmentType: "", sourceVin: "", sourcePlate: "", plateJurisdiction: companyRegJurisdiction ?? "", sourceUnitNumber: "" }]);
  }, [category, roadsideEquipment]);

  React.useEffect(() => {
    if (step >= visibleSteps.length) setStep(Math.max(visibleSteps.length - 1, 0));
  }, [step, visibleSteps.length]);

  React.useEffect(() => {
    if (!definition) return;
    const derivedSource = sourcePolicy.deriveAuthoritativeSource;
    if (derivedSource && common.sourceType !== derivedSource) {
      setCommon((current) => ({ ...current, sourceType: derivedSource }));
    }
  }, [sourcePolicy.deriveAuthoritativeSource, entryMode, common.sourceType]);

  const setFact = (key: string, value: FactValue) => { setValidationError(null); setFacts((current) => ({ ...current, [key]: value })); };

  // Pre-fill Roadside fields once Document AI has processed the evidence
  // selected via the real DocumentSourcePicker flow in DriverWorkspace,
  // which maps the raw result to RoadsideMachineSourceRecord and passes it
  // down as `machineAcquisitionDraft` (or, if this component instance
  // remounted before the draft arrived, via the module-level pending-draft
  // store in lib/roadside-machine-client.ts, which survives Fast Refresh
  // and remounts since it lives outside React state entirely).
  // Category auto-selection — runs once per draft (guarded by
  // appliedDraftRef in the polling effect below). Sets category, then
  // advances past the CATEGORY step directly via setStep (bypassing next()
  // /validateCurrentStep(), which also requires entryMode/evidence — not
  // relevant here since we already know the document type from OCR).
  // Category must be set before the step advances so `visibleSteps`
  // (derived from `definition`, which is derived from `category`) reflects
  // the new category's steps by the time step 1 renders.
  const applyDraft = useCallback((draft: RoadsideMachineSourceRecord) => {
    const mappedCategory = getCategoryFromDraft(draft);
    if (mappedCategory) {
      console.log("[PREFILL] Auto-detected category:", mappedCategory);
      setCategory(mappedCategory);
      setStep(1);
    } else {
      console.log("[PREFILL] No category mapping found for this draft — leaving category picker for manual selection.");
    }
  }, []);

  // Field-level pre-fill — separate from category selection so it can be
  // triggered either immediately (draft already resolvable at mount) or
  // once `category` actually changes (see the useEffect below), without
  // ever re-selecting the category itself.
  const applyFieldsFromDraft = useCallback((draft: RoadsideMachineSourceRecord) => {
    console.log("[PREFILL] Applying draft:", draft.reportNumber);

    // Event date — resolveRoadsideCanonicalOccurrence prefers
    // inspectionEndDate/Time over inspectionDate/Time, same derivation
    // buildRoadsideMachineDraft uses. Setter: setCommon (common.eventDate).
    const occurrence = resolveRoadsideCanonicalOccurrence(draft);
    if (occurrence.eventDate) {
      setCommon((current) => ({
        ...current,
        eventDate: occurrence.eventDate || current.eventDate,
        eventTime: occurrence.eventTime || current.eventTime,
        sourceRecordId: draft.reportNumber || current.sourceRecordId,
        location: draft.location || current.location,
        city: draft.city || current.city,
        stateProvince: draft.stateProvince || current.stateProvince,
        country: draft.country || current.country,
        summary: current.summary || `Roadside Inspection${draft.reportNumber ? ` — ${draft.reportNumber}` : ""}`,
        description: current.description || [
          draft.sourceDocumentTitle ? `Source document: ${draft.sourceDocumentTitle}.` : "",
          draft.enforcementDisposition ? `Enforcement disposition: ${draft.enforcementDisposition}.` : "",
          draft.findings.some((finding) => (finding.sourceResultCode || "").trim().toUpperCase() === "N") ? "Source inspection notes were extracted and preserved in machine observations; review them against the source document before saving." : "",
        ].filter(Boolean).join(" "),
      }));
      console.log("[PREFILL] set eventDate:", occurrence.eventDate);
    }

    // Canonical Roadside fields share the exact same conservative resolver
    // as unattended auto-save. Values that cannot be established from the
    // source remain blank for human review.
    const canonicalFacts = resolveRoadsideCanonicalFacts(draft);
    setOriginatingSourceEvidenceIds((current) => current.includes(draft.sourceEvidenceId) ? current : [...current, draft.sourceEvidenceId]);
    setEvidenceIds((current) => current.includes(draft.sourceEvidenceId) ? current : [...current, draft.sourceEvidenceId]);
    const sourceJurisdiction = canonicalFacts.jurisdiction || draft.stateProvince || companyRegJurisdiction || "";
    if (sourceJurisdiction) {
      setCommon((current) => ({
        ...current,
        stateProvince: current.stateProvince || sourceJurisdiction,
        country: current.country || resolveCountryForJurisdiction(sourceJurisdiction) || "",
      }));
    }
    for (const [key, value] of Object.entries(canonicalFacts)) {
      if (value && key !== "jurisdiction") setFact(key, value);
    }

    // Report / citation / record number. The Roadside Inspection category
    // schema (lib/driver-performance-schema.ts) defines a dedicated
    // text("inspectionReportNumber", "Inspection / Report Number", ...)
    // fact field — a closer semantic match to draft.reportNumber than the
    // generic common.sourceRecordId ("External Reference") or the
    // base-spread facts.sourceRecordId ("Source Record ID"). Setter: setFact.
    if (draft.reportNumber) {
      setFact("inspectionReportNumber", draft.reportNumber);
      console.log("[PREFILL] set reportNumber:", draft.reportNumber);
    }

    // Agency. Setter: setFact (facts.agency) — confirmed field key on the
    // Roadside Inspection schema (text("agency", "Enforcement Agency", ...)).
    if (draft.agency) {
      setFact("agency", draft.agency);
      console.log("[PREFILL] set agency:", draft.agency);
    }

    // TODO: Officer name (draft.officerName) — no field or state exists
    // anywhere in this file for an officer/inspector name. Searched useState
    // declarations and the Roadside Inspection category field list
    // (lib/driver-performance-schema.ts); neither defines one.
    // Left unmapped rather than guessing a new field.
    console.log("[PREFILL] officerName (no setter exists, not set):", draft.officerName);

    // TODO: Officer number/badge (draft.officerNumber) — same as above, no
    // corresponding field or state exists in this file.
    console.log("[PREFILL] officerNumber (no setter exists, not set):", draft.officerNumber);

    // TODO: Driver name (draft.driverName) — this component only has the
    // Driver Master's identity (via `relationship`), not an editable
    // "driver name" field of its own; no setter exists.
    console.log("[PREFILL] driverName (no setter exists, not set):", draft.driverName);

    // TODO: Driver licence number/jurisdiction/DOB
    // (driverLicenceNumber/driverLicenceJurisdiction/driverDateOfBirth) —
    // licence data belongs to the Driver's Qualifications tab, not this
    // event workflow; no corresponding field or state exists here.
    console.log("[PREFILL] driverLicenceNumber (no setter exists, not set):", draft.driverLicenceNumber);
    console.log("[PREFILL] driverLicenceJurisdiction (no setter exists, not set):", draft.driverLicenceJurisdiction);
    console.log("[PREFILL] driverDateOfBirth (no setter exists, not set):", draft.driverDateOfBirth);

    // TODO: Carrier name (draft.carrierName) — no field or state for a
    // carrier name exists in this file (company identity comes from
    // `relationship`, not a user-editable form field here).
    console.log("[PREFILL] carrierName (no setter exists, not set):", draft.carrierName);

    // TODO: Source document title (draft.sourceDocumentTitle) and
    // sourceEvidenceId — no corresponding field or state exists in this
    // file to display or store either value.
    console.log("[PREFILL] sourceDocumentTitle (no setter exists, not set):", draft.sourceDocumentTitle);
    console.log("[PREFILL] sourceEvidenceId (no setter exists, not set):", draft.sourceEvidenceId);

    // Equipment — only pre-fill when the current list is empty or every row
    // is still blank/default (ignoring plateJurisdiction, since the
    // category-selection/safety-net effects already default that from
    // companyRegJurisdiction on an otherwise-untouched row). Never overwrite
    // rows the user has already filled in. Setter: setRoadsideEquipment.
    const equipmentIsBlank = roadsideEquipment.every(
      (item) => !item.sourceVin && !item.sourcePlate && !item.sourceUnitNumber && !item.equipmentType
    );
    const draftEquipmentRows = draft.equipment
      .filter((item) => Boolean(item.vinSerialNumber || item.plateNumber || item.sourceUnitNumber))
      .map((item, index) => {
        const role = index === 0 ? "POWER_UNIT" as const : "TOWED_UNIT" as const;
        return {
        itemId: draftId("RIE-DRAFT"),
        role,
        equipmentType: inferredRoadsideEquipmentType(role, item.equipmentType),
        sourceVin: item.vinSerialNumber || "",
        sourcePlate: item.plateNumber || "",
        plateJurisdiction: item.plateJurisdiction || sourceJurisdiction,
        sourceUnitNumber: item.sourceUnitNumber || "",
      };
      });
    if ((roadsideEquipment.length === 0 || equipmentIsBlank) && draft.equipment.length) {
      setRoadsideEquipment(draftEquipmentRows);
      console.log("[PREFILL] set equipment:", draft.equipment);
    }

    const violationRows = roadsideViolationRowsFromDraft(draft, draftEquipmentRows.length ? draftEquipmentRows : roadsideEquipment);
    if (violationRows.length) {
      setRoadsideViolations((current) => current.some(hasMeaningfulViolation) ? current : violationRows);
      setFact("sourceReportedViolationCount", Math.max(Number(canonicalFacts.sourceReportedViolationCount || 0), violationRows.length));
      console.log("[PREFILL] set violation findings:", violationRows);
    }
    const noteCount = draft.findings.filter((finding) => (finding.sourceResultCode || "").trim().toUpperCase() === "N").length;
    if (noteCount) console.log("[PREFILL] inspection notes preserved in source observations, not counted as violations:", noteCount);
  }, [companyRegJurisdiction, roadsideEquipment]);

  // Poll the module-level pending-draft store (lib/roadside-machine-client.ts)
  // instead of relying solely on machineAcquisitionDraft/initialMachineAcquisitionDraft
  // props, since a Fast Refresh remount mid-upload can reset this component
  // instance before those props ever reflect the draft. The module store
  // lives outside React entirely, so polling it here picks up the draft
  // whichever instance (pre- or post-remount) is mounted when it arrives.
  useEffect(() => {
    console.log("[PREFILL] Polling useEffect mounted");
    if (appliedDraftRef.current) return;

    const tryApply = async () => {
      console.log("[PREFILL] tryApply called, appliedRef:", appliedDraftRef.current);
      const { peekPendingRoadsideDraft, consumePendingRoadsideDraft } = await import("@/lib/roadside-machine-client");

      const draft = machineAcquisitionDraft ?? initialMachineAcquisitionDraft ?? peekPendingRoadsideDraft();

      console.log("[PREFILL] tryApply - draft found:", !!draft);

      if (!draft || appliedDraftRef.current) return;
      appliedDraftRef.current = true;
      consumePendingRoadsideDraft();

      applyDraft(draft);
      if (!appliedFieldsRef.current) {
        appliedFieldsRef.current = true;
        applyFieldsFromDraft(draft);
      }
    };

    // Try immediately on mount
    tryApply();

    // Also poll every 500ms for up to 30 seconds in case the OCR result
    // arrives after mount
    const interval = setInterval(tryApply, 500);
    const timeout = setTimeout(() => clearInterval(interval), 30000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []); // empty deps — intentional, runs once on mount

  // Second pre-fill trigger: if category was auto-detected asynchronously
  // (e.g. the polling effect above resolved the draft from the module
  // store on a Fast-Refresh remount, after this instance's own initial
  // mount pass), re-run field pre-fill once `category` actually lands —
  // not category re-selection, just the field values. Guarded separately
  // from appliedDraftRef so category selection and field pre-fill can
  // each only ever happen once, independent of which trigger fires first.
  useEffect(() => {
    if (!machineAcquisitionDraft) return
    if (!category) return // wait for category
    if (appliedFieldsRef.current) return // only once

    appliedFieldsRef.current = true
    applyFieldsFromDraft(machineAcquisitionDraft)
  }, [category, machineAcquisitionDraft, applyFieldsFromDraft])

  const validateCurrentStep = (): string | null => {
    const key = currentStep?.key;
    if (key === "CATEGORY") {
      if (!category) return "Select an event category.";
      if (!entryMode) return "Choose Use Evidence + Manual Fallback or Enter Manually before continuing.";
      if (entryMode === "DOCUMENT" && effectiveEvidenceIds.length === 0) return "Document mode requires successfully created or selected Event evidence. Upload a document first or choose Enter Manually.";
    }
    if (key === "OCCURRENCE") {
      if (!common.eventDate) return "Event date is required.";
      if (!common.sourceType) return "Select the authoritative source for this event.";
      if (!common.summary.trim()) return "Event summary is required.";
      if (!sourcePolicy.authoritativeSourceTypes.some((item) => item.value === common.sourceType)) return "Select an authoritative source applicable to this category.";
      const derivedOrigin = entryMode === "DOCUMENT" ? (effectiveEvidenceIds.length > 0 ? "MANUAL_FALLBACK" : "") : "MANUAL_ENTRY";
      if (!sourcePolicy.allowedOrigins.includes(derivedOrigin)) return "The record origin could not be derived from the selected ingestion pathway.";
      if (category !== "Roadside Inspection" && common.stateProvince && !resolveCountryForJurisdiction(common.stateProvince)) return "Select a valid canonical state / province.";
    }
    if (key === "FACTS") {
      const missing = categoryFields.find((field) => {
        const state = resolvePerformanceApplicability(field.applicability, facts);
        const required = state === "REQUIRED" || (state === "CONDITIONAL" && Boolean(field.required)) || (field.required && !field.applicability);
        return required && (facts[field.key] === undefined || facts[field.key] === null || facts[field.key] === "");
      });
      if (missing) return `${missing.label} is required.`;
      const missingUnit = categoryFields.find((field) => field.kind === "number" && (field.unitOptions?.length || field.unitInput) && (() => { const value = facts[field.key]; return value !== undefined && value !== null && typeof value === "object" && "value" in value && value.value !== null && !value.unit; })());
      if (missingUnit) return `${missingUnit.label} requires an explicit unit.`;
      if (category === "Roadside Inspection") {
        const regime = facts.inspectionRegime; const classification = facts.inspectionClassification;
        const us = ["US_LEVEL_I","US_LEVEL_II","US_LEVEL_III","US_LEVEL_IV","US_LEVEL_V","US_LEVEL_VI","US_LEVEL_VII","US_LEVEL_VIII"];
        const ca = ["CA_TYPE_1","CA_TYPE_2","CA_TYPE_3","CA_TYPE_4","CA_TYPE_5"];
        if (regime === "US_CVSA" && typeof classification === "string" && !us.includes(classification)) return "U.S. CVSA requires a U.S. inspection classification.";
        if (regime === "CA_NSC_CVSA" && typeof classification === "string" && !ca.includes(classification)) return "Canadian NSC/CVSA requires a Canadian inspection classification.";
        if (regime === "OTHER" && classification !== "OTHER") return "Other inspection regime requires Other / Review classification.";
        const jurisdictionCountry = typeof facts.jurisdiction === "string" ? resolveCountryForJurisdiction(facts.jurisdiction) : undefined;
        if (jurisdictionCountry === "Canada" && regime === "US_CVSA") return "Review required: U.S. inspection regime conflicts with Canadian jurisdiction.";
        if (jurisdictionCountry === "United States" && regime === "CA_NSC_CVSA") return "Review required: Canadian inspection regime conflicts with U.S. jurisdiction.";
      }
      if (category === "Roadside Inspection") {
        if (!roadsideEquipment.some((item) => item.role === "POWER_UNIT")) return "A Power Unit is required for every Roadside Inspection.";
        if (!powerUnitResolution || powerUnitResolution.state === "PENDING_SOURCE_DATA") return "Power Unit must include a VIN, Plate + Jurisdiction, or Unit # so TES can connect the Roadside Inspection to the company Vehicle.";
        if (powerUnitResolution.state === "REVIEW_REQUIRED") return `Power Unit identity conflict requires review before saving: ${powerUnitResolution.conflicts.join(" ") || powerUnitResolution.reason}`;
        if (powerUnitResolution.state !== "AUTO_RESOLVED" || !powerUnitVehicleId) return "Power Unit must match one canonical company Vehicle before saving this Roadside Inspection. Check the source VIN, plate jurisdiction, or Vehicle record.";
        if (facts.inspectionResult === "VIOLATIONS_FOUND" && typeof facts.sourceReportedViolationCount !== "number") return "Source-Reported Total Violations is required when the overall result is Violations Found.";
        if (facts.inspectionResult === "VIOLATIONS_FOUND" && typeof facts.sourceReportedViolationCount === "number" && roadsidePreviewStructuredCount > facts.sourceReportedViolationCount) return `Reconciliation conflict: ${roadsidePreviewStructuredCount} structured violations exceed the source-reported total of ${facts.sourceReportedViolationCount}. Review before saving.`;
        if (roadsideViolations.some((item) => (["POWER_UNIT","TOWED_UNIT"].includes(item.subjectType) && !item.subjectEquipmentId))) return "Each equipment-specific finding must identify the inspected-equipment child it concerns.";
        if (driverStatement.status === "OBTAINED" && !driverStatement.content.trim()) return "Driver Statement content is required when Statement Status is Obtained.";
        if (driverStatement.status === "OBTAINED" && !driverStatement.method) return "Statement Method is required when Statement Status is Obtained.";
        if (driverStatement.status === "OBTAINED" && driverStatement.method === "UPLOADED_DOCUMENT" && effectiveEvidenceIds.length === 0) return "An Uploaded Document Driver Statement requires supporting evidence.";
      }
      if (category === "Out-of-Service Order" && facts.oosScope === "OTHER" && !String(facts.otherScopeExplanation || "").trim()) return "Explain the OOS scope when Other is selected.";
    }
    if (key === "RELATIONSHIPS") {
      // Relationship creation is intentionally independent from Performance record creation.
      // The domain resolver evaluates applicable relationships after the canonical event exists.
    }
    if (key === "EVIDENCE" && definition?.evidenceRequired && effectiveEvidenceIds.length === 0) return "Evidence is required. Upload a source document or link existing Event evidence before saving.";
    return null;
  };

  const next = () => {
    const error = validateCurrentStep();
    setValidationError(error);
    if (error) return;
    setStep((current) => Math.min(current + 1, visibleSteps.length - 1));
  };



  const normalizeMeasurement = (value: number, unit?: string): { value: number; unit?: string; normalizedValue?: number; normalizedUnit?: string } => {
    if (!unit) return { value };
    switch (unit) {
      case "MPH": return { value, unit, normalizedValue: value * 1.609344, normalizedUnit: "KMH" };
      case "KMH": return { value, unit, normalizedValue: value, normalizedUnit: "KMH" };
      case "MI": return { value, unit, normalizedValue: value * 1.609344, normalizedUnit: "KM" };
      case "KM": return { value, unit, normalizedValue: value, normalizedUnit: "KM" };
      case "FTPS2": return { value, unit, normalizedValue: value * 0.3048, normalizedUnit: "MPS2" };
      case "G": return { value, unit, normalizedValue: value * 9.80665, normalizedUnit: "MPS2" };
      case "MPS2": return { value, unit, normalizedValue: value, normalizedUnit: "MPS2" };
      case "SECONDS": return { value, unit, normalizedValue: value, normalizedUnit: "SECONDS" };
      case "MINUTES": return { value, unit, normalizedValue: value * 60, normalizedUnit: "SECONDS" };
      case "HOURS": return { value, unit, normalizedValue: value * 3600, normalizedUnit: "SECONDS" };
      default: return { value, unit };
    }
  };

  const buildStructuredEventFacts = (): StructuredEventFact[] => {
    const resolvedFacts = { ...facts };
    if (category === "Roadside Inspection") {
      if (resolvedFacts.inspectionResult === "PASS") {
        ["sourceReportedViolationCount", "driverInspectionResult", "driverOOSState", "driverDemeritPoints", "vehicleInspectionResult", "vehicleOOSState", "vehicleDemeritPoints", "hazmatInspected"].forEach((key) => delete resolvedFacts[key]);
      } else {
        
      }
    }
    return categoryFields.flatMap((field) => {
      const applicability = resolvePerformanceApplicability(field.applicability as never, resolvedFacts);
      if (applicability === "HIDDEN" || applicability === "NOT_APPLICABLE") return [];
      const raw = resolvedFacts[field.key];
      if (raw === undefined || raw === null || raw === "") return [];
      if (field.kind === "number" && typeof raw === "object" && raw !== null && "value" in raw) {
        const measurement = raw as MeasurementInput;
        if (measurement.value === null) return [];
        const normalized = normalizeMeasurement(measurement.value, measurement.unit || undefined);
        return [{ dataPointId: field.dataPointId, value: normalized.value, valueType: field.valueType, unit: normalized.unit, normalizedValue: normalized.normalizedValue, normalizedUnit: normalized.normalizedUnit, source: common.sourceType || undefined }];
      }
      return [{ dataPointId: field.dataPointId, value: raw as Primitive, valueType: field.valueType, unit: field.unit, source: common.sourceType || undefined }];
    });
  };

  const eventSpecificEvidence = useMemo(() => {
    const linkedToEvent = evidence.filter((item) => !item.isArchived && item.linkedRecordType === "Event" && item.linkedRecordId === common.sourceRecordId);
    const effective = evidence.filter((item) => !item.isArchived && effectiveEvidenceIds.includes(item.id));
    return [...new Map([...linkedToEvent, ...effective].map((item) => [item.id, item])).values()];
  }, [evidence, effectiveEvidenceIds, common.sourceRecordId]);
  const pendingSourceEvidenceIds = useMemo(() => new Set(pendingPerformanceSources.map((item) => item.evidenceId)), [pendingPerformanceSources]);
  const eligibleExistingEventEvidence = useMemo(() => evidence.filter((item) => !item.isArchived && (item.linkedRecordType === "Event" || pendingSourceEvidenceIds.has(item.id))), [evidence, pendingSourceEvidenceIds]);
  const displayedEventEvidence = showExistingEventEvidence ? [...new Map([...eventSpecificEvidence, ...eligibleExistingEventEvidence].map((item) => [item.id, item])).values()] : eventSpecificEvidence;


  const derivedVerificationState = useMemo<(typeof PERFORMANCE_VERIFICATION_STATES)[number]>(() => {
    if (effectiveEvidenceIds.length === 0) return "Unverified";
    const linked = evidence.filter((item) => effectiveEvidenceIds.includes(item.id) && !item.isArchived);
    if (linked.length === 0) return "Unverified";
    if (linked.some((item) => item.verificationState === "superseded")) return "Unable to Verify";
    if (linked.every((item) => ["verified", "Source Matched", "Externally Verified"].includes(String(item.verificationState)))) return "Verified";
    return "Unverified";
  }, [evidence, effectiveEvidenceIds]);

  React.useEffect(() => {
    if (verificationState !== derivedVerificationState) setVerificationState(derivedVerificationState);
  }, [derivedVerificationState, verificationState]);

  const buildPayload = (): Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> => {
    if (!category || !definition) throw new Error("Performance event category is required.");
    const now = new Date().toISOString();
    const chronology = [{ id: `CHRON-${Date.now().toString(36)}`, timestamp: now, action: "EVENT_LOGGED", actor: null, details: `Initial ${definition?.label || "Select Event Category"} commercial performance event recorded from ${common.sourceType}.` }];
    const structuredEventFacts = buildStructuredEventFacts();

    const canonicalEvidenceIds = [...new Set([...evidenceIds, ...originatingSourceEvidenceIds])];

    const payload: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> = {
      eventType: category,
      eventDate: common.eventDate,
      eventTime: common.eventTime || undefined,
      occurrencePrecision: common.eventTime ? "EXACT_DATETIME" : "DATE_ONLY",
      reportedDate: common.reportedDate || undefined,
      location: common.location || undefined,
      city: common.city || undefined,
      stateProvince: common.stateProvince || undefined,
      country: common.country || undefined,
      severity: "Not Applicable",
      status: lifecycle ? (followUpRequired ? "Follow-up Required" : "Open") : "Not Applicable",
      summary: common.summary.trim(),
      description: common.description.trim() || `${definition?.label || "Select Event Category"} recorded from ${common.sourceType}.`,
      descriptionOrigin: common.description.trim() ? "SOURCE_NARRATIVE" : "SYSTEM_GENERATED",
      structuredEventFacts,
      schemaVersion: PERFORMANCE_EVENT_SCHEMA_VERSION,
      recordProcessingState: derivedVerificationState === "Verified" ? "VERIFIED" : "RECEIVED",
      workflowState: followUpRequired ? "OPEN" : "NOT_REQUIRED",
      followUpActionRequired: followUpRequired,
      followUpDueDate: followUpDueDate || undefined,
      followUpActionSummary: followUpSummary || undefined,
      vehicleId: category === "Roadside Inspection" ? powerUnitVehicleId : undefined,
      linkedRecords: [],
      canonicalLinks: [],
      evidenceIds: canonicalEvidenceIds,
      chronology,
      verificationState: derivedVerificationState,
      provenance: {
        sourceType: "SOURCE_FACT",
        source: common.sourceType,
        reportedBy: common.reportedBy || undefined,
        sourceRecordId: common.sourceRecordId || undefined,
        capturedAt: now,
        sourceTimestamp: common.eventDate ? `${common.eventDate}${common.eventTime ? `T${common.eventTime}:00` : ""}` : undefined,
        ingestionTimestamp: now,
        sourceConfidence: "UNKNOWN",
        dataQuality: "UNKNOWN",
        rawPayloadReference: common.sourceRecordId || undefined,
        sourceEvidenceIds: canonicalEvidenceIds.length ? [...canonicalEvidenceIds] : undefined,
        extractionState: entryMode === "DOCUMENT" ? "NOT_APPLICABLE" : "NOT_APPLICABLE",
        extractionConfidence: undefined,
      },
      dispute: { state: disputeState === "Not Disputed" ? "None" : disputeState === "Resolved" ? "Resolved" : "Open" },
    };


    if (category === "Roadside Inspection") {
      const scopedViolations = roadsideViolations.filter((item) => facts.inspectionScope !== "DRIVER" || !["POWER_UNIT", "TOWED_UNIT"].includes(item.subjectType));
      const meaningfulViolations = scopedViolations.filter((item) => Boolean(item.ruleRegulationCode.trim() || item.description.trim() || item.regulatoryCategory.trim()));
      const collection = createRoadsideViolationCollection(meaningfulViolations.map((item) => createRoadsideViolationItem({
        itemId: item.itemId,
        ruleRegulationCode: item.ruleRegulationCode || undefined,
        description: item.description || undefined,
        regulatoryCategory: item.regulatoryCategory || undefined,
        subjectType: item.subjectType,
        subjectEquipmentId: item.subjectEquipmentId || undefined,
        componentSystem: item.componentSystem || undefined,
        oosState: item.oosState,
        regulatorSeverityWeight: item.regulatorSeverityWeight === "" ? undefined : Number(item.regulatorSeverityWeight),
        demeritPoints: item.demeritPoints === "" ? undefined : Number(item.demeritPoints),
        canonicalEvidenceIds,
        ingestionOrigin: entryMode === "DOCUMENT" ? "MANUAL_FALLBACK" : "MANUAL_ENTRY",
      })), roadsidePreviewCompleteness || "NOT_PROVIDED");
      const collectionErrors = validateRoadsideViolationCollection(collection);
      const consistencyErrors = validateRoadsideInspectionConsistency(facts, collection);
      if (collectionErrors.length) throw new Error(collectionErrors[0]);
      if (consistencyErrors.length) throw new Error(consistencyErrors[0]);
      payload.childCollections = [];
      if (facts.inspectionResult === "VIOLATIONS_FOUND") payload.childCollections.push(collection);
      if (roadsidePreviewEquipmentCollection) payload.childCollections.push(roadsidePreviewEquipmentCollection);
      if (roadsidePreviewStatementCollection) payload.childCollections.push(roadsidePreviewStatementCollection);
      // Driver/Vehicle OOS facts are authoritative for Roadside Inspection.
      // Do not duplicate them into the generic event-level subjectState.
      payload.subjectState = undefined;
    }
    if (category === "HOS Violation") {
      payload.hosDetails = {
        ruleJurisdiction: String(facts.ruleJurisdiction || "US_FMCSA") as never,
        ruleProfileId: typeof facts.ruleProfileId === "string" ? facts.ruleProfileId : undefined,
        violationType: String(facts.violationType || "") as never,
        logDate: String(facts.logDate || common.eventDate),
        source: String(facts.detectionSource || "Internal Audit") as never,
        hoursExceeded: typeof facts.hoursExceeded === "number" ? facts.hoursExceeded : undefined,
        eldProvider: typeof facts.eldProvider === "string" ? facts.eldProvider : undefined,
        reviewStatus: typeof facts.reviewStatus === "string" ? facts.reviewStatus as never : undefined,
        reviewNotes: typeof facts.reviewNotes === "string" ? facts.reviewNotes : undefined,
      };
    }
    if (category === "Traffic Citation") {
      payload.citationDetails = {
        citationNumber: typeof facts.citationNumber === "string" ? facts.citationNumber : undefined,
        violationCode: typeof facts.violationCode === "string" ? facts.violationCode : undefined,
        fineAmount: typeof facts.fineAmount === "number" ? facts.fineAmount : undefined,
        pointsAssessed: typeof facts.pointsAssessed === "number" ? facts.pointsAssessed : undefined,
        courtJurisdiction: typeof facts.courtJurisdiction === "string" ? facts.courtJurisdiction : undefined,
        courtDate: typeof facts.courtDate === "string" ? facts.courtDate : undefined,
        disposition: typeof facts.disposition === "string" ? facts.disposition as never : undefined,
      };
    }
    if (category === "Customer Complaint") {
      payload.complaintDetails = {
        customerName: String(facts.customerName || ""),
        loadNumber: typeof facts.loadNumber === "string" ? facts.loadNumber : undefined,
        category: String(facts.complaintCategory || "Other") as never,
        substantiationStatus: String(facts.substantiationStatus || "Unreviewed") as never,
        reviewNotes: typeof facts.reviewNotes === "string" ? facts.reviewNotes : undefined,
      };
    }
    if (category === "Customer Commendation" || category === "Positive Safety Observation") {
      payload.commendationDetails = {
        category: category === "Positive Safety Observation" ? "Safe Driving Milestone" : String(facts.commendationType || "Customer Commendation") as never,
        customerName: typeof facts.customerName === "string" ? facts.customerName : undefined,
        recognizedBy: typeof facts.recognizedBy === "string" ? facts.recognizedBy : typeof facts.observer === "string" ? facts.observer : undefined,
        description: typeof facts.recognitionNarrative === "string" ? facts.recognitionNarrative : typeof facts.observationNarrative === "string" ? facts.observationNarrative : undefined,
      };
    }
    return payload;
  };

  const commit = () => {
    const error = validateCurrentStep();
    setValidationError(error);
    if (error) return;
    onSave(buildPayload());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="shrink-0 border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Step {step + 1} of {visibleSteps.length}</span><span className="text-[10px] text-muted-foreground">Commercial Performance Event</span></div>
              <h3 className="mt-1 truncate text-sm font-bold text-foreground">{definition?.label || "Select Event Category"}</h3>
              <p className="text-xs text-muted-foreground">{definition?.description || "Select an event category to begin."}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="size-5" /></button>
          </div>
          <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(visibleSteps.length, 1)}, minmax(0, 1fr))` }}>{visibleSteps.map((item, index) => <div key={item.key} className={`h-1 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`} />)}</div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6">{validationError ? <div role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{validationError}</div> : null}
          {currentStep?.key === "CATEGORY" && <section className="space-y-4"><div><h4 className="text-sm font-bold text-foreground">Select Event Category</h4><p className="mt-1 text-xs text-muted-foreground">Choose the occurrence family. The selected category controls the structured capture schema.</p></div><div className="grid gap-2 sm:grid-cols-2"><div className={`rounded-xl border p-3 text-left ${entryMode === "DOCUMENT" ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}><div className="text-xs font-bold text-foreground">Source Evidence / Manual Fallback</div><p className="mt-1 text-[10px] text-muted-foreground">Source documents enter through the separate machine-ingestion path. If extraction is unavailable, the originating evidence can be preserved on a manual fallback record.</p></div><button type="button" onClick={() => setEntryMode("MANUAL")} className={`rounded-xl border p-3 text-left ${entryMode === "MANUAL" ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/20"}`}><div className="text-xs font-bold text-foreground">Enter Manually</div><p className="mt-1 text-[10px] text-muted-foreground">Manual acquisition path using the same canonical Performance Event schema.</p></button></div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{recordableDefinitions.map((item) => <button key={item.value} type="button" onClick={() => { setCategory(item.value); setFacts({}); setRoadsideViolations([]); setValidationError(null); setStep(0); setCommon((current) => ({ ...current, sourceType: "", sourceRecordId: "", reportedBy: "" })); setRoadsideEquipment(item.value === "Roadside Inspection" ? [{ itemId: `RIE-DRAFT-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`, role: "POWER_UNIT", equipmentType: "", sourceVin: "", sourcePlate: "", plateJurisdiction: companyRegJurisdiction ?? "", sourceUnitNumber: "" }] : []); }} className={`rounded-xl border p-3 text-left transition ${category === item.value ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-background hover:border-primary/40 hover:bg-muted/20"}`}><div className="flex items-start justify-between gap-2"><span className="text-xs font-bold text-foreground">{item.label}</span>{category === item.value ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}</div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{item.description}</p><span className="mt-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.group}</span></button>)}</div><div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground"><strong className="text-foreground">Company Actions remain separate.</strong> Coaching, discipline, CAPs, suspension, and corrective actions are not owned by this occurrence record.</div></section>}

          {currentStep?.key === "OCCURRENCE" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Occurrence & Source</h4><p className="mt-1 text-xs text-muted-foreground">Record what occurred and where the source came from. No universal severity is imposed.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><label className="text-xs font-semibold">Event Date *</label><input type="date" required value={common.eventDate} onChange={(e) => setCommon({ ...common, eventDate: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Event Time</label><input type="time" value={common.eventTime} onChange={(e) => setCommon({ ...common, eventTime: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Reported / Detected Date</label><input type="date" value={common.reportedDate} onChange={(e) => setCommon({ ...common, reportedDate: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Authoritative Source *</label>{sourcePolicy.deriveAuthoritativeSource ? <div className="mt-1 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold">{sourceOptions.find((item) => item.value === sourcePolicy.deriveAuthoritativeSource)?.label || sourcePolicy.deriveAuthoritativeSource}</div> : <select required value={common.sourceType} onChange={(e) => setCommon({ ...common, sourceType: e.target.value })} className={inputClass}><option value="">Select...</option>{sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}<p className="mt-1 text-[10px] text-muted-foreground">{sourcePolicy.deriveAuthoritativeSource ? "Derived from the selected event category." : "Category-specific source policy. Select the authoritative source that establishes the facts."}</p></div><div><label className="text-xs font-semibold">External Reference</label><input value={common.sourceRecordId} onChange={(e) => setCommon({ ...common, sourceRecordId: e.target.value })} className={inputClass} placeholder="External report / reference number" /><p className="mt-1 text-[10px] text-muted-foreground">Do not enter an internal TES record ID.</p></div><div><label className="text-xs font-semibold">Reported / Submitted By</label><select value={common.reportedBy} onChange={(e) => setCommon({ ...common, reportedBy: e.target.value })} className={inputClass}><option value="">Not applicable / not provided</option>{(sourcePolicy.reporterApplicability || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div><div className="grid gap-3 sm:grid-cols-2"><div><label className="text-xs font-semibold">Event Summary *</label><input required value={common.summary} onChange={(e) => setCommon({ ...common, summary: e.target.value })} className={inputClass} placeholder="Concise factual summary" /></div><div><label className="text-xs font-semibold">Narrative / Description</label><textarea rows={2} value={common.description} onChange={(e) => setCommon({ ...common, description: e.target.value })} className={inputClass} placeholder="Contextual narrative; structured facts belong to the category schema." /></div></div>{category !== "Roadside Inspection" ? <div><div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Location Context</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input value={common.location} onChange={(e) => setCommon({ ...common, location: e.target.value })} className={inputClass} placeholder="Location" /><input value={common.city} onChange={(e) => setCommon({ ...common, city: e.target.value })} className={inputClass} placeholder="City" /><select value={common.stateProvince} onChange={(e) => setCommon({ ...common, stateProvince: e.target.value, country: resolveCountryForJurisdiction(e.target.value) || "" })} className={inputClass}><option value="">State / Province</option>{JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}</select><input value={common.country} readOnly className={inputClass} placeholder="Country (derived)" /></div></div> : null}</section>}

          {currentStep?.key === "FACTS" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">{definition?.label || "Select Event Category"} Facts</h4><p className="mt-1 text-xs text-muted-foreground">These fields are generated from the category schema; only fields applicable to this category appear.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categoryFields.map((field) => <FieldInput key={field.key} field={field} facts={facts} value={facts[field.key] ?? null} onChange={(value) => setFact(field.key, value)} />)}</div>{category === "Roadside Inspection" ? <div className="space-y-4">
  <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
    <div className="flex items-center justify-between gap-3"><div><h5 className="text-xs font-bold text-foreground">Inspected Equipment</h5><p className="text-[10px] text-muted-foreground">Source identifiers remain unchanged. TES resolves VIN globally, Plate + jurisdiction globally/effectively, and Unit only inside the operating-company context.</p></div><button type="button" onClick={() => setRoadsideEquipment((items) => [...items, { itemId: `RIE-DRAFT-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`, role: items.some((x) => x.role === "POWER_UNIT") ? "TOWED_UNIT" : "POWER_UNIT", equipmentType: "", sourceVin: "", sourcePlate: "", plateJurisdiction: companyRegJurisdiction ?? "", sourceUnitNumber: "" }])} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-muted">Add Equipment</button></div>
    {roadsideEquipment.length === 0 ? <p className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">No equipment identifiers supplied yet. A Power Unit is required for every Roadside Inspection; add Towed Equipment when present in the source.</p> : <div className="space-y-3">{roadsideEquipment.map((item, index) => { const resolved = roadsideResolvedEquipment[index]?.resolution; return <div key={item.itemId} className="rounded-lg border border-border bg-background p-3 space-y-3"><div className="flex items-center justify-between"><div className="text-xs font-bold">{item.role === "POWER_UNIT" ? "Power Unit" : `Towed Unit ${roadsideEquipment.slice(0, index + 1).filter((x) => x.role === "TOWED_UNIT").length}`}</div>{item.role === "TOWED_UNIT" ? <button type="button" onClick={() => setRoadsideEquipment((items) => items.filter((x) => x.itemId !== item.itemId))} className="text-[10px] font-bold text-destructive hover:underline">Remove</button> : null}</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><select value={item.role} onChange={(e) => setRoadsideEquipment((items) => items.map((v,i)=>i===index?{...v,role:e.target.value as "POWER_UNIT"|"TOWED_UNIT"}:v))} className={inputClass}><option value="POWER_UNIT">Power Unit</option><option value="TOWED_UNIT">Towed Unit</option></select><select value={item.equipmentType} onChange={(e) => setRoadsideEquipment((items) => items.map((v,i)=>i===index?{...v,equipmentType:e.target.value}:v))} className={inputClass}><option value="">Equipment Type</option>{(item.role === "POWER_UNIT" ? ["Tractor","Straight Truck","Service Vehicle","Other Equipment"] : ["Trailer - Dry Van","Trailer - Reefer","Trailer - Flatbed","Trailer - Step Deck / Lowboy","Trailer - Intermodal Chassis","Converter Dolly","Other Equipment"]).map((option) => <option key={option} value={option}>{option}</option>)}</select><input value={item.sourceVin} onChange={(e) => setRoadsideEquipment((items) => items.map((v,i)=>i===index?{...v,sourceVin:e.target.value}:v))} placeholder="Source VIN" className={inputClass}/><input value={item.sourcePlate} onChange={(e) => setRoadsideEquipment((items) => items.map((v,i)=>i===index?{...v,sourcePlate:e.target.value}:v))} placeholder="Source Plate" className={inputClass}/><select value={item.plateJurisdiction} onChange={(e) => setRoadsideEquipment((items) => items.map((v,i)=>i===index?{...v,plateJurisdiction:e.target.value}:v))} className={inputClass}><option value="">Plate Jurisdiction</option>{JURISDICTIONS.map((j) => <option key={j.code} value={j.code}>{j.label}</option>)}</select><input value={item.sourceUnitNumber} onChange={(e) => setRoadsideEquipment((items) => items.map((v,i)=>i===index?{...v,sourceUnitNumber:e.target.value}:v))} placeholder="Source Unit / Equipment #" className={inputClass}/></div>{resolved ? <div className={`rounded-lg border p-3 ${resolved.state === "AUTO_RESOLVED" ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20" : resolved.state === "REVIEW_REQUIRED" ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20" : "border-border bg-muted/20"}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-wider">{resolved.state === "AUTO_RESOLVED" ? "Matched" : resolved.state === "REVIEW_REQUIRED" ? "Conflict / Review Required" : "External / No Canonical Match"}</span><span className="text-[10px] text-muted-foreground">{resolved.method === "VIN_GLOBAL" ? "Resolved by VIN" : resolved.method === "VIN_SUFFIX_COMPANY_SCOPED" ? "Resolved by company VIN last six" : resolved.method === "PLATE_JURISDICTION" ? "Resolved by Plate + Jurisdiction" : resolved.method === "UNIT_COMPANY_SCOPED" ? "Resolved by company Unit #" : resolved.method === "MULTI_IDENTIFIER_AGREEMENT" ? "Multiple identifiers agree" : "Pending"}</span></div>{resolved.canonicalVehicle ? <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs"><RecordRow label="TES Unit" value={resolved.canonicalVehicle.unitNumber}/><RecordRow label="Vehicle" value={`${resolved.canonicalVehicle.year} ${resolved.canonicalVehicle.make} ${resolved.canonicalVehicle.model}`}/><RecordRow label="VIN" value={resolved.canonicalVehicle.vin}/><RecordRow label="Plate" value={`${resolved.canonicalVehicle.registration?.plateNumber || "Not recorded"}${resolved.canonicalVehicle.registration?.jurisdiction ? ` · ${getJurisdictionLabel(resolved.canonicalVehicle.registration.jurisdiction)}` : ""}`}/></div> : null}<p className="mt-2 text-[10px] text-muted-foreground">{resolved.reason}</p>{resolved.identifierDiscrepancies?.length ? <p className="mt-1 text-[10px] font-semibold text-muted-foreground">Identifier Note: {resolved.identifierDiscrepancies.join(" ")}</p> : null}{resolved.conflicts.length ? <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">{resolved.conflicts.join(" ")}</p> : null}</div> : null}</div>})}</div>}
  </div>
  {facts.inspectionResult === "VIOLATIONS_FOUND" ? <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3"><div className="flex items-center justify-between"><div><h5 className="text-xs font-bold text-foreground">Violations / Findings</h5><p className="text-[10px] text-muted-foreground">A Pass inspection may still contain non-OOS violations. Each finding identifies a specific subject.</p></div><button type="button" disabled={roadsideViolations.length > 0 && !hasMeaningfulViolation(roadsideViolations[roadsideViolations.length - 1])} onClick={() => setRoadsideViolations((items) => [...items, { itemId: `RVI-DRAFT-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`, ruleRegulationCode: "", description: "", regulatoryCategory: "", subjectType: "DRIVER", subjectEquipmentId: "", componentSystem: "", oosState: "UNKNOWN", regulatorSeverityWeight: "", demeritPoints: "" }])} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">Add Violation</button></div>{roadsideViolations.length === 0 ? <p className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">No child violations entered. This is known zero only when the applicable violation finding state(s) establish No Violations.</p> : <div className="space-y-3">{roadsideViolations.map((item,index)=><div key={item.itemId} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 rounded-lg border border-border bg-background p-3"><input value={item.ruleRegulationCode} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,ruleRegulationCode:e.target.value}:v))} placeholder="Rule / regulation code" className={inputClass}/><input value={item.description} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,description:e.target.value}:v))} placeholder="Description" className={inputClass}/><input value={item.regulatoryCategory} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,regulatoryCategory:e.target.value}:v))} placeholder="Regulatory category / BASIC" className={inputClass}/><select value={item.subjectType} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,subjectType:e.target.value as RoadsideViolationSubjectType,subjectEquipmentId:["POWER_UNIT","TOWED_UNIT"].includes(e.target.value)?v.subjectEquipmentId:""}:v))} className={inputClass}><option value="DRIVER">Driver</option><option value="OPERATING_CARRIER">Operating Carrier</option><option value="POWER_UNIT">Power Unit</option><option value="TOWED_UNIT">Specific Towed Unit</option><option value="OTHER">Other</option></select>{["POWER_UNIT","TOWED_UNIT"].includes(item.subjectType) ? <select value={item.subjectEquipmentId} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,subjectEquipmentId:e.target.value}:v))} className={inputClass}><option value="">Select equipment</option>{roadsideEquipment.map((eq)=>eq.role === (item.subjectType === "POWER_UNIT" ? "POWER_UNIT" : "TOWED_UNIT") ? <option key={eq.itemId} value={eq.itemId}>{eq.role === "POWER_UNIT" ? "Power Unit" : "Towed Unit"} · {eq.sourceUnitNumber || eq.sourceVin || eq.itemId}</option> : null)}</select> : <input value={item.componentSystem} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,componentSystem:e.target.value}:v))} placeholder="Component / system" className={inputClass}/>}<select value={item.oosState} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,oosState:e.target.value as RoadsideViolationOOSState}:v))} className={inputClass}><option value="YES">OOS: Yes</option><option value="NO">OOS: No</option><option value="UNKNOWN">OOS: Unknown</option></select><input type="number" value={item.regulatorSeverityWeight} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,regulatorSeverityWeight:e.target.value}:v))} placeholder="Regulator weight" className={inputClass}/><input type="number" value={item.demeritPoints} onChange={(e)=>setRoadsideViolations((items)=>items.map((v,i)=>i===index?{...v,demeritPoints:e.target.value}:v))} placeholder="Demerit / points" className={inputClass}/><div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="button" onClick={()=>setRoadsideViolations((items)=>items.filter((v)=>v.itemId!==item.itemId))} className="text-[10px] font-bold text-destructive hover:underline">Remove violation</button></div></div>)}</div>}</div> : null}
  <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3"><div><h5 className="text-xs font-bold text-foreground">Driver Statement / Account</h5><p className="text-[10px] text-muted-foreground">First-class source account, separate from Investigation Narrative.</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><select value={driverStatement.status} onChange={(e)=>setDriverStatement((v)=>({...v,status:e.target.value as typeof v.status}))} className={inputClass}><option value="OBTAINED">Obtained</option><option value="REQUESTED">Requested</option><option value="DECLINED">Declined</option><option value="UNABLE_TO_OBTAIN">Unable to Obtain</option><option value="NOT_APPLICABLE">Not Applicable</option></select><input type="date" value={driverStatement.date} onChange={(e)=>setDriverStatement((v)=>({...v,date:e.target.value}))} className={inputClass}/><input type="time" value={driverStatement.time} onChange={(e)=>setDriverStatement((v)=>({...v,time:e.target.value}))} className={inputClass}/><select value={driverStatement.method} onChange={(e)=>setDriverStatement((v)=>({...v,method:e.target.value as typeof v.method}))} className={inputClass}><option value="">Statement Method</option><option value="WRITTEN">Written</option><option value="RECORDED">Recorded</option><option value="INTERVIEW">Interview</option><option value="UPLOADED_DOCUMENT">Uploaded Document</option><option value="OTHER">Other</option></select><textarea value={driverStatement.content} onChange={(e)=>setDriverStatement((v)=>({...v,content:e.target.value}))} rows={4} placeholder="Driver's actual account / statement" className={`${inputClass} sm:col-span-2 lg:col-span-3`}/></div></div>
  <div className="rounded-xl border border-border bg-background p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Derived Overall Inspection Outcome</div><div className="mt-1 text-xs font-bold text-foreground">{roadsideDerivedOutcome === "PASS" ? "Pass" : roadsideDerivedOutcome === "VIOLATIONS_FOUND" ? "Violations Found" : roadsideDerivedOutcome === "OUT_OF_SERVICE" ? "Out of Service" : "Unknown / Not Provided"}</div><p className="mt-1 text-[10px] text-muted-foreground">Derived from scope, component inspection results, violation finding states, OOS states, and child findings. It does not imply responsibility.</p></div>
</div> : null}</section>}

          {currentStep?.key === "RELATIONSHIPS" && category !== "Roadside Inspection" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Context & Relationships</h4><p className="mt-1 text-xs text-muted-foreground">TES evaluates applicable relationships after the canonical Performance event exists. Relationship creation is independent from event creation.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{applicableRelationships.map((relationship) => { const state = resolvePerformanceRelationshipState(relationship, facts); const required = state === "REQUIRED"; return <div key={relationship.key} className="rounded-xl border border-border bg-muted/10 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{relationship.label}</span>{required ? <span className="text-[9px] font-bold uppercase tracking-wider text-primary">Required</span> : <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Applicable</span>}</div><div className="mt-2 rounded-lg border border-border bg-background px-2.5 py-2 text-[10px] font-semibold text-foreground">{relationship.key === "hos" || relationship.key === "citation" || relationship.key === "maintenance" ? "PENDING_SOURCE_DATA" : "PENDING_SOURCE_DATA"}</div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">The resolver will auto-link a unique deterministic canonical record, retain candidates for review when ambiguous, or remain pending when the downstream source has not arrived.</p></div>; })}</div></section>}

          {currentStep?.key === "EVIDENCE" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Evidence, Verification & Follow-up</h4><p className="mt-1 text-xs text-muted-foreground">Verification and dispute are separate semantic states. Follow-up is workflow state, not evidence.</p></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><div><span className="text-xs font-bold">Evidence</span><span className="ml-2 text-[10px] text-muted-foreground">{definition?.evidenceRequired ? "Required" : "Optional"}</span></div>{definition?.evidenceRequired ? <div className="flex flex-col items-end gap-1"><button type="button" onClick={() => onRequestEvidenceUpload?.()} disabled={!onRequestEvidenceUpload} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">Upload / Add Document</button>{isProcessingOCR ? <p className="mt-1 text-[11px] text-muted-foreground animate-pulse">Processing document with AI...</p> : null}{ocrError ? <p className="mt-1 text-[11px] text-destructive">{ocrError}</p> : null}{machineAcquisitionDraft ? <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-300">Document processed — fields pre-filled from OCR. Review all extracted values before saving.</div> : null}</div> : null}</div><div className="mt-3"><div className="mb-2 flex items-center justify-between gap-2"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Event Evidence</div>{eligibleExistingEventEvidence.length ? <button type="button" onClick={() => setShowExistingEventEvidence((value) => !value)} className="text-[10px] font-semibold text-primary hover:underline">{showExistingEventEvidence ? "Hide existing Event evidence" : "Link existing Event evidence"}</button> : null}</div><div className="space-y-2">{displayedEventEvidence.length === 0 ? <div className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">No evidence is linked to this event yet. Use Upload / Add Document to attach source/event evidence.</div> : displayedEventEvidence.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-xs"><input type="checkbox" checked={evidenceIds.includes(item.id)} onChange={(e) => setEvidenceIds((current) => e.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="size-3.5 accent-primary" /><FileText className="size-3.5 text-primary" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{item.documentType || "Event Evidence"} · {item.fileName}</span><span className="block truncate text-[10px] text-muted-foreground">{common.sourceType || "Source not recorded"} · {common.eventDate || "Date not recorded"}{common.sourceRecordId ? ` · Report ${common.sourceRecordId}` : ""}{facts.agency ? ` · ${String(facts.agency)}` : ""}</span></span><span className="text-[9px] text-muted-foreground">{item.id}</span></label>)}</div></div></div><div className="rounded-xl border border-border p-4 space-y-3"><div><label className="text-xs font-semibold">Verification State</label><div className="mt-1 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold">{derivedVerificationState}</div><p className="mt-1 text-[10px] text-muted-foreground">Derived from linked evidence/review state. Verification is not manually selected during event creation.</p></div><div><label className="text-xs font-semibold">Dispute State</label><select value={disputeState} onChange={(e) => setDisputeState(e.target.value as typeof disputeState)} className={inputClass}>{PERFORMANCE_DISPUTE_STATES.map((item) => <option key={item}>{item}</option>)}</select></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={followUpRequired} onChange={(e) => setFollowUpRequired(e.target.checked)} className="size-3.5 accent-primary" />Follow-up Required</label>{followUpRequired ? <><div><label className="text-xs font-semibold">Follow-up Due Date</label><input type="date" value={followUpDueDate} onChange={(e) => setFollowUpDueDate(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Follow-up Description</label><textarea value={followUpSummary} onChange={(e) => setFollowUpSummary(e.target.value)} rows={3} className={inputClass} /></div></> : null}{lifecycle ? <div><label className="text-xs font-semibold">Lifecycle State</label><div className="mt-1 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold">{followUpRequired ? "Follow-up Required" : "Open"}</div><p className="mt-1 text-[10px] text-muted-foreground">Derived from follow-up workflow; not manually selected.</p></div> : null}</div></div></section>}

          {currentStep?.key === "REVIEW" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Review Before Save</h4><p className="mt-1 text-xs text-muted-foreground">Confirm the actual structured record before it is committed to CompanyDriverStore.events.</p></div><div className="space-y-4"><div className="rounded-xl border border-border p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><RecordRow label="Category" value={definition?.label || "Select Event Category"} /><RecordRow label="Event Date" value={common.eventDate} /><RecordRow label="Source" value={common.sourceType} /><RecordRow label="Source Record" value={common.sourceRecordId} /><RecordRow label="Location" value={[common.location, common.city, common.stateProvince].filter(Boolean).join(", ")} /><RecordRow label="Verification" value={derivedVerificationState} /><RecordRow label="Dispute" value={disputeState} /><RecordRow label="Lifecycle" value={lifecycle ? (followUpRequired ? "Follow-up Required" : "Open") : "Not applicable"} /><RecordRow label="Evidence" value={`${effectiveEvidenceIds.length} linked`} />{category === "Roadside Inspection" && roadsidePreviewReconciliationConflict ? <RecordRow label="Reconciliation" value="Conflict / Review Required" /> : null}{category === "Roadside Inspection" ? <RecordRow label="Derived Inspection Outcome" value={roadsideDerivedOutcome === "PASS" ? "Pass" : roadsideDerivedOutcome === "VIOLATIONS_FOUND" ? "Violations Found" : roadsideDerivedOutcome === "OUT_OF_SERVICE" ? "Out of Service" : "Unknown / Not Provided"} /> : null}</div></div><div className="rounded-xl border border-border p-4"><div className="mb-3 flex items-center gap-2"><Link2 className="size-4 text-primary" /><span className="text-xs font-bold">Category-Specific Facts</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categoryFields.map((field) => <RecordRow key={field.key} label={field.label} value={category === "Roadside Inspection" ? displayRoadsideReviewValue(field, facts[field.key] ?? null) : facts[field.key] ?? null} />)}</div></div>{category === "Roadside Inspection" ? <div className="rounded-xl border border-border p-4 space-y-3"><div className="text-xs font-bold">Inspected Equipment & Driver Statement</div><div className="space-y-2">{roadsideEquipment.map((item) => { const resolved = roadsideResolvedEquipment.find((entry) => entry.item.itemId === item.itemId)?.resolution; return <div key={item.itemId} className="rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs"><div className="font-semibold">{item.role === "POWER_UNIT" ? "Power Unit" : "Towed Unit"}</div><div className="mt-1 text-[10px] text-muted-foreground">Source VIN: {item.sourceVin || "—"} · Plate: {item.sourcePlate || "—"} · Unit: {item.sourceUnitNumber || "—"}</div><div className="mt-1 text-[10px] text-muted-foreground">Resolution: {resolved?.state === "AUTO_RESOLVED" ? "Matched" : resolved?.state === "REVIEW_REQUIRED" ? "Conflict / Review Required" : resolved?.state === "PENDING_SOURCE_DATA" ? "Pending Source Data" : "Unresolved / External"}{resolved?.method ? ` · ${resolved.method === "VIN_GLOBAL" ? "VIN" : resolved.method === "VIN_SUFFIX_COMPANY_SCOPED" ? "Company VIN last six" : resolved.method === "PLATE_JURISDICTION" ? "Plate + Jurisdiction" : resolved.method === "UNIT_COMPANY_SCOPED" ? "Company Unit #" : "Multiple identifiers"}` : ""}{resolved?.identifierDiscrepancies?.length ? ` · Identifier note: ${resolved.identifierDiscrepancies.join(" ")}` : ""}</div></div>})}</div>{driverStatement.status !== "NOT_APPLICABLE" ? <div className="rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs"><div className="font-semibold">Driver Statement: {driverStatement.status === "OBTAINED" ? "Obtained" : driverStatement.status === "REQUESTED" ? "Requested" : driverStatement.status === "DECLINED" ? "Declined" : "Unable to Obtain"}</div><div className="mt-1 text-[10px] text-muted-foreground">{driverStatement.date || "Date not recorded"}{driverStatement.time ? ` · ${driverStatement.time}` : ""}{driverStatement.method ? ` · ${driverStatement.method === "UPLOADED_DOCUMENT" ? "Uploaded Document" : driverStatement.method}` : ""}</div></div> : null}</div> : null}
{category !== "Roadside Inspection" ? <div className="rounded-xl border border-border p-4"><div className="mb-3 text-xs font-bold">Related Records & Evidence</div><div className="space-y-2">{applicableRelationships.length === 0 ? <p className="text-[11px] text-muted-foreground">No applicable relationships.</p> : applicableRelationships.map((item) => <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs"><span className="font-semibold">{item.label}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">PENDING_SOURCE_DATA</span></div>)}</div></div> : null}</div></section>}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
          <button type="button" onClick={step === 0 ? onClose : () => { setValidationError(null); setStep((current) => Math.max(current - 1, 0)); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-muted">{step === 0 ? <X className="size-3.5" /> : <ArrowLeft className="size-3.5" />}{step === 0 ? "Cancel" : "Back"}</button>
          {step < visibleSteps.length - 1 ? <button type="button" onClick={next} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">Next Step<ArrowRight className="size-3.5" /></button> : <button type="button" onClick={commit} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"><CheckCircle2 className="size-4" />Save Performance Event</button>}
        </footer>
      </div>
    </div>
  );
}
