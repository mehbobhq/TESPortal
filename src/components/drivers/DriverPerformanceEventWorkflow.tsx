"use client";

import React, { useMemo, useState } from "react";
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

interface Props {
  relationship: CompanyDriverRelationship;
  trainings: TrainingRecord[];
  evidence: DriverEvidenceItem[];
  onRequestEvidenceUpload?: () => void;
  initialEntryMode?: "DOCUMENT" | "MANUAL";
  evidenceCreatedId?: string | null;
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

export function DriverPerformanceEventWorkflow({ relationship, evidence, onRequestEvidenceUpload, evidenceCreatedId, onClearEvidenceCreatedId, initialEntryMode, onClose, onSave }: Props) {
  const [step, setStep] = useState(0);
  const [entryMode, setEntryMode] = useState<EntryMode | null>(initialEntryMode || null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [category, setCategory] = useState<DriverPerformanceEvent["eventType"]>(RECORDABLE_PERFORMANCE_CATEGORIES[0]);
  const [common, setCommon] = useState({ eventDate: "", eventTime: "", reportedDate: "", sourceType: "", sourceRecordId: "", reportedBy: "", location: "", city: "", stateProvince: "", country: "", summary: "", description: "" });
  const [facts, setFacts] = useState<Record<string, FactValue>>({});
  const [trailerRef, setTrailerRef] = useState("");
  const [tripRef, setTripRef] = useState("");
  const [loadRef, setLoadRef] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [customerSiteRef, setCustomerSiteRef] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [verificationState, setVerificationState] = useState<(typeof PERFORMANCE_VERIFICATION_STATES)[number]>("Unverified");
  const [disputeState, setDisputeState] = useState<(typeof PERFORMANCE_DISPUTE_STATES)[number]>("Not Disputed");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDueDate, setFollowUpDueDate] = useState("");
  const [followUpSummary, setFollowUpSummary] = useState("");

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
    if (!evidenceIds.includes(evidenceCreatedId)) {
      setEvidenceIds((current) => [...current, evidenceCreatedId]);
      setEntryMode("DOCUMENT");
    }
    onClearEvidenceCreatedId?.();
  }, [evidenceCreatedId]);

  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[category];
  const sourcePolicy = useMemo(() => resolvePerformanceSourcePolicy(definition), [definition]);
  const sourceOptions = sourcePolicy.authoritativeSourceTypes;
  const recordableDefinitions = useMemo(() => RECORDABLE_PERFORMANCE_CATEGORIES.map((value) => DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[value]), []);
  const categoryFields = useMemo(() => definition.fields.filter((field) => field.key !== "sourceType" && field.key !== "sourceRecordId"), [definition]);
  const applicableRelationships = useMemo(() => resolveRelationshipApplicability(definition, facts), [definition, facts]);
  const visibleSteps = useMemo(() => resolvePerformanceSteps(definition, facts) as Array<{ key: StepKey; label: string }>, [definition, facts]);
  const currentStep = visibleSteps[step] || visibleSteps[0];
  const lifecycle = definition.temporalBehavior === "Lifecycle";


  React.useEffect(() => {
    if (step >= visibleSteps.length) setStep(Math.max(visibleSteps.length - 1, 0));
  }, [step, visibleSteps.length]);

  React.useEffect(() => {
    const derivedSource = sourcePolicy.deriveAuthoritativeSource;
    if (derivedSource && common.sourceType !== derivedSource) {
      setCommon((current) => ({ ...current, sourceType: derivedSource }));
    }
  }, [sourcePolicy.deriveAuthoritativeSource, entryMode, common.sourceType]);

  const setFact = (key: string, value: FactValue) => { setValidationError(null); setFacts((current) => ({ ...current, [key]: value })); };

  const validateCurrentStep = (): string | null => {
    const key = currentStep?.key;
    if (key === "CATEGORY") {
      if (!category) return "Select an event category.";
      if (!entryMode) return "Choose Upload / Ingest Document or Enter Manually before continuing.";
      if (entryMode === "DOCUMENT" && evidenceIds.length === 0) return "Document mode requires successfully created or selected Driver evidence. Upload a document first or choose Enter Manually.";
    }
    if (key === "OCCURRENCE") {
      if (!common.eventDate) return "Event date is required.";
      if (!common.sourceType) return "Select the authoritative source for this event.";
      if (!common.summary.trim()) return "Event summary is required.";
      if (!sourcePolicy.authoritativeSourceTypes.some((item) => item.value === common.sourceType)) return "Select an authoritative source applicable to this category.";
      const derivedOrigin = entryMode === "DOCUMENT" ? (evidenceIds.length > 0 ? "DOCUMENT_OCR" : "") : "MANUAL_ENTRY";
      if (!sourcePolicy.allowedOrigins.includes(derivedOrigin)) return "The record origin could not be derived from the selected ingestion pathway.";
      if (common.stateProvince && !resolveCountryForJurisdiction(common.stateProvince)) return "Select a valid canonical state / province.";
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
        if (facts.jurisdiction === "US" && regime === "CA_NSC_CVSA") return "Review required: Canadian inspection regime conflicts with U.S. jurisdiction.";
        if (facts.jurisdiction === "CA" && regime === "US_CVSA") return "Review required: U.S. inspection regime conflicts with Canadian jurisdiction.";
      }
      if (category === "Out-of-Service Order" && facts.oosScope === "OTHER" && !String(facts.otherScopeExplanation || "").trim()) return "Explain the OOS scope when Other is selected.";
    }
    if (key === "RELATIONSHIPS") {
      // Relationship creation is intentionally independent from Performance record creation.
      // The domain resolver evaluates applicable relationships after the canonical event exists.
    }
    if (key === "EVIDENCE" && definition.evidenceRequired && evidenceIds.length === 0) return "Evidence is required. Upload a source document or select existing Driver evidence before saving.";
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
    return categoryFields.flatMap((field) => {
      const raw = facts[field.key];
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

  const derivedVerificationState = useMemo<(typeof PERFORMANCE_VERIFICATION_STATES)[number]>(() => {
    if (evidenceIds.length === 0) return "Unverified";
    const linked = evidence.filter((item) => evidenceIds.includes(item.id) && !item.isArchived);
    if (linked.length === 0) return "Unverified";
    if (linked.some((item) => item.verificationState === "superseded")) return "Unable to Verify";
    if (linked.every((item) => ["verified", "Source Matched", "Externally Verified"].includes(String(item.verificationState)))) return "Verified";
    return "Partially Verified";
  }, [evidence, evidenceIds]);

  React.useEffect(() => {
    if (verificationState !== derivedVerificationState) setVerificationState(derivedVerificationState);
  }, [derivedVerificationState, verificationState]);

  const buildPayload = (): Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> => {
    const now = new Date().toISOString();
    const chronology = [{ id: `CHRON-${Date.now().toString(36)}`, timestamp: now, action: "EVENT_LOGGED", actor: null, details: `Initial ${definition.label} commercial performance event recorded from ${common.sourceType}.` }];
    const structuredEventFacts = buildStructuredEventFacts();

    const payload: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> = {
      eventType: category,
      eventDate: common.eventDate,
      eventTime: common.eventTime || undefined,
      reportedDate: common.reportedDate || common.eventDate,
      location: common.location || undefined,
      city: common.city || undefined,
      stateProvince: common.stateProvince || undefined,
      country: common.country || undefined,
      severity: "Not Applicable",
      status: lifecycle ? (followUpRequired ? "Follow-up Required" : "Open") : "Not Applicable",
      summary: common.summary.trim(),
      description: common.description.trim() || `${definition.label} recorded from ${common.sourceType}.`,
      structuredEventFacts,
      schemaVersion: PERFORMANCE_EVENT_SCHEMA_VERSION,
      followUpActionRequired: followUpRequired,
      followUpDueDate: followUpDueDate || undefined,
      followUpActionSummary: followUpSummary || undefined,
      linkedRecords: [],
      canonicalLinks: [],
      evidenceIds,
      chronology,
      verificationState: derivedVerificationState,
      provenance: {
        sourceType: "SOURCE_FACT",
        source: common.sourceType,
        reportedBy: common.reportedBy || undefined,
        sourceRecordId: common.sourceRecordId || undefined,
        capturedAt: now,
        sourceTimestamp: common.eventDate ? `${common.eventDate}${common.eventTime ? `T${common.eventTime}:00` : "T00:00:00"}` : undefined,
        ingestionTimestamp: now,
        sourceConfidence: "UNKNOWN",
        dataQuality: "UNKNOWN",
        rawPayloadReference: common.sourceRecordId || undefined,
        sourceEvidenceIds: evidenceIds.length ? [...evidenceIds] : undefined,
        extractionState: evidenceIds.length === 0 ? "NOT_APPLICABLE" : (evidence.filter((item) => evidenceIds.includes(item.id) && !item.isArchived).every((item) => typeof item.ocrConfidence === "number") ? "EXTRACTION_COMPLETE" : "PENDING_EXTRACTION"),
        extractionConfidence: (() => { const confidences = evidence.filter((item) => evidenceIds.includes(item.id) && !item.isArchived).map((item) => item.ocrConfidence).filter((value): value is number => typeof value === "number"); return confidences.length ? Math.min(...confidences) : undefined; })(),
      },
      dispute: { state: disputeState === "Not Disputed" ? "None" : disputeState === "Resolved" ? "Resolved" : "Open" },
    };


    if (category === "Collision") {
      payload.collisionDetails = {
        collisionType: String(facts.collisionType || "Other") as never,
        driverMovement: typeof facts.driverMovement === "string" ? facts.driverMovement : undefined,
        weather: String(facts.weather || "Unknown") as never,
        roadCondition: String(facts.roadCondition || "Unknown") as never,
        lightCondition: String(facts.lightCondition || "Unknown") as never,
        towRequired: Boolean(facts.towRequired),
        policeAttended: Boolean(facts.policeAttended),
        policeReportNumber: typeof facts.policeReportNumber === "string" ? facts.policeReportNumber : undefined,
        injuriesCount: Number(facts.injuriesCount || 0),
        fatalitiesCount: Number(facts.fatalitiesCount || 0),
        estimatedCost: typeof facts.estimatedCost === "string" ? facts.estimatedCost : undefined,
        driverStatement: typeof facts.driverStatement === "string" ? facts.driverStatement : undefined,
      };
    }
    if (category === "Roadside Inspection") {
      payload.inspectionDetails = {
        inspectionLevel: String(facts.inspectionLevel || "Level I - Full Inspection") as never,
        reportNumber: typeof facts.inspectionReportNumber === "string" ? facts.inspectionReportNumber : undefined,
        agency: typeof facts.agency === "string" ? facts.agency : "",
        result: String(facts.inspectionResult || "Passed") as never,
        driverViolationsCount: Number(facts.driverViolationsCount || 0),
        vehicleViolationsCount: Number(facts.vehicleViolationsCount || 0),
        hosViolationsCount: Number(facts.hosViolationsCount || 0),
        driverOOS: Boolean(facts.driverOOS),
        vehicleOOS: Boolean(facts.vehicleOOS),
        hazmatInspected: Boolean(facts.hazmatInspected),
      };
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
              <h3 className="mt-1 truncate text-sm font-bold text-foreground">{definition.label}</h3>
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="size-5" /></button>
          </div>
          <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(visibleSteps.length, 1)}, minmax(0, 1fr))` }}>{visibleSteps.map((item, index) => <div key={item.key} className={`h-1 rounded-full ${index <= step ? "bg-primary" : "bg-border"}`} />)}</div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6">{validationError ? <div role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{validationError}</div> : null}
          {currentStep?.key === "CATEGORY" && <section className="space-y-4"><div><h4 className="text-sm font-bold text-foreground">Select Event Category</h4><p className="mt-1 text-xs text-muted-foreground">Choose the occurrence family. The selected category controls the structured capture schema.</p></div><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { if (onRequestEvidenceUpload) onRequestEvidenceUpload(); else setValidationError("Document upload is unavailable. Enter the event manually or retry when document ingestion is available."); }} className={`rounded-xl border p-3 text-left ${entryMode === "DOCUMENT" ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/20"}`}><div className="text-xs font-bold text-foreground">Upload / Ingest Document</div><p className="mt-1 text-[10px] text-muted-foreground">Primary path. The document becomes canonical Driver evidence and stays attached to this event draft.</p></button><button type="button" onClick={() => setEntryMode("MANUAL")} className={`rounded-xl border p-3 text-left ${entryMode === "MANUAL" ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/20"}`}><div className="text-xs font-bold text-foreground">Enter Manually</div><p className="mt-1 text-[10px] text-muted-foreground">Fallback path using the same canonical Performance Event schema.</p></button></div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{recordableDefinitions.map((item) => <button key={item.value} type="button" onClick={() => { setCategory(item.value); setFacts({}); setValidationError(null); setStep(0); setCommon((current) => ({ ...current, sourceType: "", sourceRecordId: "", reportedBy: "" })); }} className={`rounded-xl border p-3 text-left transition ${category === item.value ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-background hover:border-primary/40 hover:bg-muted/20"}`}><div className="flex items-start justify-between gap-2"><span className="text-xs font-bold text-foreground">{item.label}</span>{category === item.value ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}</div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{item.description}</p><span className="mt-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.group}</span></button>)}</div><div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground"><strong className="text-foreground">Company Actions remain separate.</strong> Coaching, discipline, CAPs, suspension, and corrective actions are not owned by this occurrence record.</div></section>}

          {currentStep?.key === "OCCURRENCE" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Occurrence & Source</h4><p className="mt-1 text-xs text-muted-foreground">Record what occurred and where the source came from. No universal severity is imposed.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><label className="text-xs font-semibold">Event Date *</label><input type="date" required value={common.eventDate} onChange={(e) => setCommon({ ...common, eventDate: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Event Time</label><input type="time" value={common.eventTime} onChange={(e) => setCommon({ ...common, eventTime: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Reported / Detected Date</label><input type="date" value={common.reportedDate} onChange={(e) => setCommon({ ...common, reportedDate: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Authoritative Source *</label>{sourcePolicy.deriveAuthoritativeSource ? <div className="mt-1 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold">{sourceOptions.find((item) => item.value === sourcePolicy.deriveAuthoritativeSource)?.label || sourcePolicy.deriveAuthoritativeSource}</div> : <select required value={common.sourceType} onChange={(e) => setCommon({ ...common, sourceType: e.target.value })} className={inputClass}><option value="">Select...</option>{sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}<p className="mt-1 text-[10px] text-muted-foreground">{sourcePolicy.deriveAuthoritativeSource ? "Derived from the selected event category." : "Category-specific source policy. Select the authoritative source that establishes the facts."}</p></div><div><label className="text-xs font-semibold">External Reference</label><input value={common.sourceRecordId} onChange={(e) => setCommon({ ...common, sourceRecordId: e.target.value })} className={inputClass} placeholder="External report / reference number" /><p className="mt-1 text-[10px] text-muted-foreground">Do not enter an internal TES record ID.</p></div><div><label className="text-xs font-semibold">Reported / Submitted By</label><select value={common.reportedBy} onChange={(e) => setCommon({ ...common, reportedBy: e.target.value })} className={inputClass}><option value="">Not applicable / not provided</option>{(sourcePolicy.reporterApplicability || []).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></div><div className="grid gap-3 sm:grid-cols-2"><div><label className="text-xs font-semibold">Event Summary *</label><input required value={common.summary} onChange={(e) => setCommon({ ...common, summary: e.target.value })} className={inputClass} placeholder="Concise factual summary" /></div><div><label className="text-xs font-semibold">Narrative / Description</label><textarea rows={2} value={common.description} onChange={(e) => setCommon({ ...common, description: e.target.value })} className={inputClass} placeholder="Contextual narrative; structured facts belong to the category schema." /></div></div><div><div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Location Context</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input value={common.location} onChange={(e) => setCommon({ ...common, location: e.target.value })} className={inputClass} placeholder="Location" /><input value={common.city} onChange={(e) => setCommon({ ...common, city: e.target.value })} className={inputClass} placeholder="City" /><select value={common.stateProvince} onChange={(e) => setCommon({ ...common, stateProvince: e.target.value, country: resolveCountryForJurisdiction(e.target.value) || "" })} className={inputClass}><option value="">State / Province</option>{JURISDICTIONS.map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}</select><input value={common.country} readOnly className={inputClass} placeholder="Country (derived)" /></div></div></section>}

          {currentStep?.key === "FACTS" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">{definition.label} Facts</h4><p className="mt-1 text-xs text-muted-foreground">These fields are generated from the category schema; only fields applicable to this category appear.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categoryFields.map((field) => <FieldInput key={field.key} field={field} facts={facts} value={facts[field.key] ?? null} onChange={(value) => setFact(field.key, value)} />)}</div></section>}

          {currentStep?.key === "RELATIONSHIPS" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Context & Relationships</h4><p className="mt-1 text-xs text-muted-foreground">TES evaluates applicable relationships after the canonical Performance event exists. Relationship creation is independent from event creation.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{applicableRelationships.map((relationship) => { const state = resolvePerformanceRelationshipState(relationship, facts); const required = state === "REQUIRED"; return <div key={relationship.key} className="rounded-xl border border-border bg-muted/10 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{relationship.label}</span>{required ? <span className="text-[9px] font-bold uppercase tracking-wider text-primary">Required</span> : <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Applicable</span>}</div><div className="mt-2 rounded-lg border border-border bg-background px-2.5 py-2 text-[10px] font-semibold text-foreground">{relationship.key === "hos" || relationship.key === "citation" || relationship.key === "maintenance" ? "PENDING_SOURCE_DATA" : "PENDING_SOURCE_DATA"}</div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">The resolver will auto-link a unique deterministic canonical record, retain candidates for review when ambiguous, or remain pending when the downstream source has not arrived.</p></div>; })}</div></section>}

          {currentStep?.key === "EVIDENCE" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Evidence, Verification & Follow-up</h4><p className="mt-1 text-xs text-muted-foreground">Verification and dispute are separate semantic states. Follow-up is workflow state, not evidence.</p></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><div><span className="text-xs font-bold">Evidence</span><span className="ml-2 text-[10px] text-muted-foreground">{definition.evidenceRequired ? "Required" : "Optional"}</span></div>{definition.evidenceRequired && onRequestEvidenceUpload ? <button type="button" onClick={onRequestEvidenceUpload} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-muted">Upload / Add Document</button> : null}</div><div className="mt-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Select Existing Evidence</div><div className="space-y-2">{evidence.length === 0 ? <div className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">No Driver evidence is linked yet. Use Upload / Add Document to create canonical evidence, or add existing evidence below when available.</div> : evidence.filter((item) => !item.isArchived).map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-xs"><input type="checkbox" checked={evidenceIds.includes(item.id)} onChange={(e) => setEvidenceIds((current) => e.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="size-3.5 accent-primary" /><FileText className="size-3.5 text-primary" /><span className="min-w-0 flex-1 truncate">{item.fileName}</span><span className="text-[10px] text-muted-foreground">{item.verificationState || "unverified"}</span></label>)}</div></div></div><div className="rounded-xl border border-border p-4 space-y-3"><div><label className="text-xs font-semibold">Verification State</label><div className="mt-1 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold">{derivedVerificationState}</div><p className="mt-1 text-[10px] text-muted-foreground">Derived from linked evidence/review state. Verification is not manually selected during event creation.</p></div><div><label className="text-xs font-semibold">Dispute State</label><select value={disputeState} onChange={(e) => setDisputeState(e.target.value as typeof disputeState)} className={inputClass}>{PERFORMANCE_DISPUTE_STATES.map((item) => <option key={item}>{item}</option>)}</select></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={followUpRequired} onChange={(e) => setFollowUpRequired(e.target.checked)} className="size-3.5 accent-primary" />Follow-up Required</label>{followUpRequired ? <><div><label className="text-xs font-semibold">Follow-up Due Date</label><input type="date" value={followUpDueDate} onChange={(e) => setFollowUpDueDate(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Follow-up Description</label><textarea value={followUpSummary} onChange={(e) => setFollowUpSummary(e.target.value)} rows={3} className={inputClass} /></div></> : null}{lifecycle ? <div><label className="text-xs font-semibold">Lifecycle State</label><div className="mt-1 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs font-semibold">{followUpRequired ? "Follow-up Required" : "Open"}</div><p className="mt-1 text-[10px] text-muted-foreground">Derived from follow-up workflow; not manually selected.</p></div> : null}</div></div></section>}

          {currentStep?.key === "REVIEW" && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Review Before Save</h4><p className="mt-1 text-xs text-muted-foreground">Confirm the actual structured record before it is committed to CompanyDriverStore.events.</p></div><div className="space-y-4"><div className="rounded-xl border border-border p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><RecordRow label="Category" value={definition.label} /><RecordRow label="Event Date" value={common.eventDate} /><RecordRow label="Source" value={common.sourceType} /><RecordRow label="Source Record" value={common.sourceRecordId} /><RecordRow label="Location" value={[common.location, common.city, common.stateProvince].filter(Boolean).join(", ")} /><RecordRow label="Verification" value={derivedVerificationState} /><RecordRow label="Dispute" value={disputeState} /><RecordRow label="Lifecycle" value={lifecycle ? (followUpRequired ? "Follow-up Required" : "Open") : "Not applicable"} /><RecordRow label="Evidence" value={`${evidenceIds.length} linked`} /></div></div><div className="rounded-xl border border-border p-4"><div className="mb-3 flex items-center gap-2"><Link2 className="size-4 text-primary" /><span className="text-xs font-bold">Category-Specific Facts</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categoryFields.map((field) => <RecordRow key={field.key} label={field.label} value={facts[field.key] ?? null} />)}</div></div><div className="rounded-xl border border-border p-4"><div className="mb-3 text-xs font-bold">Related Records & Evidence</div><div className="space-y-2">{applicableRelationships.length === 0 ? <p className="text-[11px] text-muted-foreground">No applicable relationships.</p> : applicableRelationships.map((item) => <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/10 px-3 py-2 text-xs"><span className="font-semibold">{item.label}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">PENDING_SOURCE_DATA</span></div>)}</div></div></div></section>}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
          <button type="button" onClick={step === 0 ? onClose : () => { setValidationError(null); setStep((current) => Math.max(current - 1, 0)); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-muted">{step === 0 ? <X className="size-3.5" /> : <ArrowLeft className="size-3.5" />}{step === 0 ? "Cancel" : "Back"}</button>
          {step < visibleSteps.length - 1 ? <button type="button" onClick={next} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">Next Step<ArrowRight className="size-3.5" /></button> : <button type="button" onClick={commit} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"><CheckCircle2 className="size-4" />Save Performance Event</button>}
        </footer>
      </div>
    </div>
  );
}
