"use client";

import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Link2, X } from "lucide-react";
import type {
  CompanyDriverRelationship,
  DriverEvidenceItem,
  DriverPerformanceEvent,
  EventStatus,
  StructuredEventFact,
  LinkedRecordRef,
  TrainingRecord,
} from "@/types/drivers";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE, RECORDABLE_PERFORMANCE_CATEGORIES, PERFORMANCE_DISPUTE_STATES, PERFORMANCE_VERIFICATION_STATES } from "@/lib/driver-performance-schema";
import { loadVehicleStore } from "@/lib/vehicle-data";

interface Props {
  relationship: CompanyDriverRelationship;
  trainings: TrainingRecord[];
  evidence: DriverEvidenceItem[];
  onRequestEvidenceUpload?: () => void;
  evidenceCreatedId?: string | null;
  onClearEvidenceCreatedId?: () => void;
  onClose: () => void;
  onSave: (data: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => void;
}

type Primitive = string | number | boolean | null;
type MeasurementInput = { value: number | null; unit: string };
type FactValue = Primitive | MeasurementInput;
type Step = 1 | 2 | 3 | 4 | 5 | 6;

const LIFECYCLE_STATUSES: EventStatus[] = ["Open", "Under Review", "Awaiting Information", "Follow-up Required", "Closed"];

const inputClass = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

function FieldInput({ field, value, onChange }: { field: { key: string; label: string; kind: string; required?: boolean; options?: readonly { value: string; label: string }[]; placeholder?: string; helpText?: string; unit?: string; unitOptions?: readonly string[] }; value: FactValue; onChange: (value: FactValue) => void }) {
  const label = <label className="text-xs font-semibold text-foreground">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</label>;
  if (field.kind === "boolean") return <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-primary" />{label}</label>;
  if (field.kind === "select") return <div>{label}<select value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass}><option value="">Select...</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{field.helpText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helpText}</p> : null}</div>;
  const type = field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "time" ? "time" : "text";
  const measurement = typeof value === "object" && value !== null && "value" in value ? value as MeasurementInput : null;
  const numericValue = measurement ? (measurement.value === null ? "" : String(measurement.value)) : typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const setNumeric = (raw: string) => {
    if (field.kind !== "number") return onChange(raw);
    const numeric = raw === "" ? null : Number(raw);
    if (field.unitOptions?.length) onChange({ value: numeric, unit: measurement?.unit || "" }); else onChange(numeric);
  };
  return <div>{label}<div className="flex gap-2"><input type={type} required={field.required} value={numericValue} placeholder={field.placeholder} onChange={(e) => setNumeric(e.target.value)} className={inputClass} />{field.unitOptions?.length ? <select aria-label={`${field.label} unit`} value={measurement?.unit || ""} onChange={(e) => onChange({ value: measurement?.value ?? null, unit: e.target.value })} className={`${inputClass} mt-1 w-28`}><option value="">Unit</option>{field.unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select> : field.unit ? <span className="mt-1 inline-flex items-center text-[10px] text-muted-foreground">{field.unit}</span> : null}</div>{field.helpText ? <p className="mt-1 text-[10px] text-muted-foreground">{field.helpText}</p> : null}</div>;
}

function RecordRow({ label, value }: { label: string; value: Primitive }) {
  if (value === null || value === undefined || value === "" || value === false) return null;
  return <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5 break-words text-xs text-foreground">{value === true ? "Yes" : String(value)}</div></div>;
}

export function DriverPerformanceEventWorkflow({ relationship, trainings, evidence, onRequestEvidenceUpload, evidenceCreatedId, onClearEvidenceCreatedId, onClose, onSave }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [category, setCategory] = useState<DriverPerformanceEvent["eventType"]>(RECORDABLE_PERFORMANCE_CATEGORIES[0]);
  const [common, setCommon] = useState({ eventDate: "", eventTime: "", reportedDate: "", sourceType: "", sourceRecordId: "", location: "", city: "", stateProvince: "", country: "", summary: "", description: "" });
  const [facts, setFacts] = useState<Record<string, FactValue>>({});
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleLabel, setVehicleLabel] = useState("");
  const [trailerRef, setTrailerRef] = useState("");
  const [tripRef, setTripRef] = useState("");
  const [loadRef, setLoadRef] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [customerSiteRef, setCustomerSiteRef] = useState("");
  const [trainingId, setTrainingId] = useState("");
  const [citationId, setCitationId] = useState("");
  const [maintenanceId, setMaintenanceId] = useState("");
  const [hosId, setHosId] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [verificationState, setVerificationState] = useState<(typeof PERFORMANCE_VERIFICATION_STATES)[number]>("Unverified");
  const [disputeState, setDisputeState] = useState<(typeof PERFORMANCE_DISPUTE_STATES)[number]>("Not Disputed");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpDueDate, setFollowUpDueDate] = useState("");
  const [followUpSummary, setFollowUpSummary] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState<EventStatus>("Open");

  React.useEffect(() => {
    if (evidenceCreatedId && !evidenceIds.includes(evidenceCreatedId)) {
      setEvidenceIds((current) => [...current, evidenceCreatedId]);
      onClearEvidenceCreatedId?.();
    }
  }, [evidenceCreatedId]);

  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[category];
  const sourceOptions = useMemo(() => definition.sources.map((label) => ({ value: label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_"), label })), [definition]);
  const recordableDefinitions = useMemo(() => RECORDABLE_PERFORMANCE_CATEGORIES.map((value) => DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[value]), []);
  const categoryFields = useMemo(() => definition.fields.filter((field) => field.key !== "sourceType" && field.key !== "sourceRecordId"), [definition]);
  const lifecycle = definition.temporalBehavior === "Lifecycle";

  const vehicles = useMemo(() => {
    try {
      return loadVehicleStore(relationship.companyId).vehicles;
    } catch {
      return [];
    }
  }, [relationship.companyId]);

  const setFact = (key: string, value: FactValue) => setFacts((current) => ({ ...current, [key]: value }));

  const validateStep = (): string | null => {
    if (step === 1 && !category) return "Select an event category.";
    if (step === 2) {
      if (!common.eventDate) return "Event date is required.";
      if (!common.sourceType) return "Source is required.";
      if (!common.summary.trim()) return "Event summary is required.";
    }
    if (step === 3) {
      const missing = categoryFields.find((field) => field.required && (facts[field.key] === undefined || facts[field.key] === null || facts[field.key] === ""));
      if (missing) return `${missing.label} is required.`;
      const missingUnit = categoryFields.find((field) => field.kind === "number" && field.unitOptions?.length && (() => { const value = facts[field.key]; return value !== undefined && value !== null && typeof value === "object" && "value" in value && value.value !== null && !value.unit; })());
      if (missingUnit) return `${missingUnit.label} requires an explicit unit.`;
    }
    if (step === 5 && definition.evidenceRequired && evidenceIds.length === 0) return "This category requires at least one linked evidence record before it can be saved.";
    return null;
  };

  const next = () => {
    const error = validateStep();
    if (error) {
      window.alert(error);
      return;
    }
    setStep((current) => (current < 6 ? (current + 1) as Step : current));
  };

  const buildLinkedRecords = (): LinkedRecordRef[] => {
    const linked: LinkedRecordRef[] = [];
    if (vehicleId) linked.push({ entityType: "Vehicle", id: vehicleId, label: vehicleLabel || vehicleId });
    if (trailerRef.trim()) linked.push({ entityType: "Trailer", id: trailerRef.trim(), label: trailerRef.trim(), secondaryText: "Operational reference; canonical trailer store not present in current repository." });
    if (tripRef.trim()) linked.push({ entityType: "Trip", id: tripRef.trim(), label: tripRef.trim() });
    if (loadRef.trim()) linked.push({ entityType: "Load", id: loadRef.trim(), label: loadRef.trim() });
    if (customerRef.trim()) linked.push({ entityType: "Customer", id: customerRef.trim(), label: customerRef.trim() });
    if (customerSiteRef.trim()) linked.push({ entityType: "Customer Site", id: customerSiteRef.trim(), label: customerSiteRef.trim() });
    if (trainingId) {
      const training = trainings.find((record) => record.id === trainingId);
      linked.push({ entityType: "Training", id: trainingId, label: training?.courseTitle || trainingId });
    }
    if (citationId.trim()) linked.push({ entityType: "Citation", id: citationId.trim(), label: citationId.trim() });
    if (maintenanceId.trim()) linked.push({ entityType: "Maintenance", id: maintenanceId.trim(), label: maintenanceId.trim() });
    if (hosId.trim()) linked.push({ entityType: "HOS", id: hosId.trim(), label: hosId.trim() });
    evidenceIds.forEach((id) => linked.push({ entityType: "Evidence", id, label: evidence.find((item) => item.id === id)?.fileName || id }));
    return linked;
  };

  const buildPayload = (): Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> => {
    const now = new Date().toISOString();
    const chronology = [{ id: `CHRON-${Date.now().toString(36)}`, timestamp: now, action: "EVENT_LOGGED", actor: null, details: `Initial ${definition.label} commercial performance event recorded from ${common.sourceType}.` }];
    const structuredEventFacts = buildStructuredEventFacts();
    const linkedRecords = buildLinkedRecords();

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
      status: lifecycle ? lifecycleStatus : "Not Applicable",
      summary: common.summary.trim(),
      description: common.description.trim() || `${definition.label} recorded from ${common.sourceType}.`,
      structuredEventFacts,
      schemaVersion: "1.1",
      followUpActionRequired: followUpRequired,
      followUpDueDate: followUpDueDate || undefined,
      followUpActionSummary: followUpSummary || undefined,
      linkedRecords,
      evidenceIds,
      chronology,
      verificationState,
      provenance: {
        sourceType: "SOURCE_FACT",
        source: common.sourceType,
        sourceRecordId: common.sourceRecordId || undefined,
        capturedAt: now,
        sourceTimestamp: common.eventDate ? `${common.eventDate}${common.eventTime ? `T${common.eventTime}:00` : "T00:00:00"}` : undefined,
        ingestionTimestamp: now,
        sourceConfidence: "UNKNOWN",
        dataQuality: "UNKNOWN",
        rawPayloadReference: common.sourceRecordId || undefined,
      },
      dispute: { state: disputeState === "Not Disputed" ? "None" : disputeState === "Resolved" ? "Resolved" : "Open" },
      operationalReferences: [
        ...(trailerRef.trim() ? [{ referenceType: "TRAILER", referenceValue: trailerRef.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
        ...(tripRef.trim() ? [{ referenceType: "TRIP", referenceValue: tripRef.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
        ...(loadRef.trim() ? [{ referenceType: "LOAD", referenceValue: loadRef.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
        ...(customerRef.trim() ? [{ referenceType: "CUSTOMER", referenceValue: customerRef.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
        ...(customerSiteRef.trim() ? [{ referenceType: "CUSTOMER_SITE", referenceValue: customerSiteRef.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
        ...(maintenanceId.trim() ? [{ referenceType: "MAINTENANCE", referenceValue: maintenanceId.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
        ...(hosId.trim() ? [{ referenceType: "HOS", referenceValue: hosId.trim(), source: "USER_ENTERED_REFERENCE" }] : []),
      ],
    };

    if (vehicleId) payload.vehicleId = vehicleId;
    if (tripRef.trim()) payload.tripId = tripRef.trim();
    if (loadRef.trim()) payload.loadId = loadRef.trim();
    if (customerRef.trim()) payload.customerId = customerRef.trim();
    if (customerSiteRef.trim()) payload.customerSiteId = customerSiteRef.trim();
    if (trainingId) payload.trainingRecordIds = [trainingId];
    if (citationId.trim()) payload.citationIds = [citationId.trim()];
    if (maintenanceId.trim()) payload.maintenanceRecordIds = [maintenanceId.trim()];
    if (hosId.trim()) payload.hosRecordIds = [hosId.trim()];

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
        linkedRepairRecordId: typeof facts.linkedRepairRecordId === "string" ? facts.linkedRepairRecordId : undefined,
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
    const error = validateStep();
    if (error) {
      window.alert(error);
      return;
    }
    onSave(buildPayload());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="shrink-0 border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Step {step} of 6</span><span className="text-[10px] text-muted-foreground">Commercial Performance Event</span></div>
              <h3 className="mt-1 truncate text-sm font-bold text-foreground">{definition.label}</h3>
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="size-5" /></button>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-1.5">{[1,2,3,4,5,6].map((item) => <div key={item} className={`h-1 rounded-full ${item <= step ? "bg-primary" : "bg-border"}`} />)}</div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          {step === 1 && <section className="space-y-4"><div><h4 className="text-sm font-bold text-foreground">Select Event Category</h4><p className="mt-1 text-xs text-muted-foreground">Choose the occurrence family. The selected category controls the structured capture schema.</p></div><div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{recordableDefinitions.map((item) => <button key={item.value} type="button" onClick={() => { setCategory(item.value); setFacts({}); }} className={`rounded-xl border p-3 text-left transition ${category === item.value ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-background hover:border-primary/40 hover:bg-muted/20"}`}><div className="flex items-start justify-between gap-2"><span className="text-xs font-bold text-foreground">{item.label}</span>{category === item.value ? <CheckCircle2 className="size-4 shrink-0 text-primary" /> : null}</div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{item.description}</p><span className="mt-2 inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.group}</span></button>)}</div><div className="rounded-xl border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground"><strong className="text-foreground">Company Actions remain separate.</strong> Coaching, discipline, CAPs, suspension, and corrective actions are not owned by this occurrence record.</div></section>}

          {step === 2 && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Occurrence & Source</h4><p className="mt-1 text-xs text-muted-foreground">Record what occurred and where the source came from. No universal severity is imposed.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><label className="text-xs font-semibold">Event Date *</label><input type="date" required value={common.eventDate} onChange={(e) => setCommon({ ...common, eventDate: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Event Time</label><input type="time" value={common.eventTime} onChange={(e) => setCommon({ ...common, eventTime: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Reported / Detected Date</label><input type="date" value={common.reportedDate} onChange={(e) => setCommon({ ...common, reportedDate: e.target.value })} className={inputClass} /></div><div><label className="text-xs font-semibold">Source *</label><select required value={common.sourceType} onChange={(e) => setCommon({ ...common, sourceType: e.target.value })} className={inputClass}><option value="">Select...</option>{sourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div><label className="text-xs font-semibold">Source Record ID</label><input value={common.sourceRecordId} onChange={(e) => setCommon({ ...common, sourceRecordId: e.target.value })} className={inputClass} placeholder="Authoritative source ID" /></div></div><div className="grid gap-3 sm:grid-cols-2"><div><label className="text-xs font-semibold">Event Summary *</label><input required value={common.summary} onChange={(e) => setCommon({ ...common, summary: e.target.value })} className={inputClass} placeholder="Concise factual summary" /></div><div><label className="text-xs font-semibold">Narrative / Description</label><textarea rows={2} value={common.description} onChange={(e) => setCommon({ ...common, description: e.target.value })} className={inputClass} placeholder="Contextual narrative; structured facts belong to the category schema." /></div></div><div><div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Location Context</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input value={common.location} onChange={(e) => setCommon({ ...common, location: e.target.value })} className={inputClass} placeholder="Location" /><input value={common.city} onChange={(e) => setCommon({ ...common, city: e.target.value })} className={inputClass} placeholder="City" /><input value={common.stateProvince} onChange={(e) => setCommon({ ...common, stateProvince: e.target.value })} className={inputClass} placeholder="State / Province" /><select value={common.country} onChange={(e) => setCommon({ ...common, country: e.target.value })} className={inputClass}><option value="">Country</option><option>Canada</option><option>United States</option></select></div></div></section>}

          {step === 3 && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">{definition.label} Facts</h4><p className="mt-1 text-xs text-muted-foreground">These fields are generated from the category schema; only fields applicable to this category appear.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categoryFields.map((field) => <FieldInput key={field.key} field={field} value={facts[field.key] ?? null} onChange={(value) => setFact(field.key, value)} />)}</div></section>}

          {step === 4 && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Context & Relationships</h4><p className="mt-1 text-xs text-muted-foreground">Use canonical relationships when this repository provides them. Operational references are explicitly labeled when no canonical store exists.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><label className="text-xs font-semibold">Vehicle</label><select value={vehicleId} onChange={(e) => { const id = e.target.value; const record = vehicles.find((item) => item.id === id); setVehicleId(id); setVehicleLabel(record ? record.unitNumber : ""); }} className={inputClass}><option value="">No vehicle linked</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.unitNumber} — {item.vin || "VIN unavailable"}</option>)}</select></div><div><label className="text-xs font-semibold">Trailer Reference</label><input value={trailerRef} onChange={(e) => setTrailerRef(e.target.value)} className={inputClass} placeholder="Canonical trailer ID if known" /></div><div><label className="text-xs font-semibold">Trip Reference</label><input value={tripRef} onChange={(e) => setTripRef(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Load Reference</label><input value={loadRef} onChange={(e) => setLoadRef(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Customer Reference</label><input value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Customer Site Reference</label><input value={customerSiteRef} onChange={(e) => setCustomerSiteRef(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Training Record</label><select value={trainingId} onChange={(e) => setTrainingId(e.target.value)} className={inputClass}><option value="">No training linked</option>{trainings.map((record) => <option key={record.id} value={record.id}>{record.courseTitle || record.id}</option>)}</select></div><div><label className="text-xs font-semibold">Canonical Citation ID</label><input value={citationId} onChange={(e) => setCitationId(e.target.value)} className={inputClass} placeholder="Citation record ID" /></div><div><label className="text-xs font-semibold">Maintenance Record ID</label><input value={maintenanceId} onChange={(e) => setMaintenanceId(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">HOS Record ID</label><input value={hosId} onChange={(e) => setHosId(e.target.value)} className={inputClass} /></div></div></section>}

          {step === 5 && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Evidence, Verification & Follow-up</h4><p className="mt-1 text-xs text-muted-foreground">Verification and dispute are separate semantic states. Follow-up is workflow state, not evidence.</p></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><div><span className="text-xs font-bold">Evidence</span><span className="ml-2 text-[10px] text-muted-foreground">{definition.evidenceRequired ? "Required" : "Optional"}</span></div>{onRequestEvidenceUpload ? <button type="button" onClick={onRequestEvidenceUpload} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] font-bold text-primary hover:bg-muted">Upload / Attach Evidence</button> : null}</div><div className="mt-3 space-y-2">{evidence.length === 0 ? <div className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground">No canonical Driver evidence is currently available to link.</div> : evidence.filter((item) => !item.isArchived).map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5 text-xs"><input type="checkbox" checked={evidenceIds.includes(item.id)} onChange={(e) => setEvidenceIds((current) => e.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="size-3.5 accent-primary" /><FileText className="size-3.5 text-primary" /><span className="min-w-0 flex-1 truncate">{item.fileName}</span><span className="text-[10px] text-muted-foreground">{item.verificationState || "unverified"}</span></label>)}</div></div><div className="rounded-xl border border-border p-4 space-y-3"><div><label className="text-xs font-semibold">Verification State</label><select value={verificationState} onChange={(e) => setVerificationState(e.target.value as typeof verificationState)} className={inputClass}>{PERFORMANCE_VERIFICATION_STATES.map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="text-xs font-semibold">Dispute State</label><select value={disputeState} onChange={(e) => setDisputeState(e.target.value as typeof disputeState)} className={inputClass}>{PERFORMANCE_DISPUTE_STATES.map((item) => <option key={item}>{item}</option>)}</select></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={followUpRequired} onChange={(e) => setFollowUpRequired(e.target.checked)} className="size-3.5 accent-primary" />Follow-up Required</label>{followUpRequired ? <><div><label className="text-xs font-semibold">Follow-up Due Date</label><input type="date" value={followUpDueDate} onChange={(e) => setFollowUpDueDate(e.target.value)} className={inputClass} /></div><div><label className="text-xs font-semibold">Follow-up Description</label><textarea value={followUpSummary} onChange={(e) => setFollowUpSummary(e.target.value)} rows={3} className={inputClass} /></div></> : null}{lifecycle ? <div><label className="text-xs font-semibold">Lifecycle State</label><select value={lifecycleStatus} onChange={(e) => setLifecycleStatus(e.target.value as EventStatus)} className={inputClass}>{LIFECYCLE_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></div> : null}</div></div></section>}

          {step === 6 && <section className="space-y-5"><div><h4 className="text-sm font-bold text-foreground">Review Before Save</h4><p className="mt-1 text-xs text-muted-foreground">Confirm the actual structured record before it is committed to CompanyDriverStore.events.</p></div><div className="space-y-4"><div className="rounded-xl border border-border p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><RecordRow label="Category" value={definition.label} /><RecordRow label="Event Date" value={common.eventDate} /><RecordRow label="Source" value={common.sourceType} /><RecordRow label="Source Record" value={common.sourceRecordId} /><RecordRow label="Location" value={[common.location, common.city, common.stateProvince].filter(Boolean).join(", ")} /><RecordRow label="Vehicle" value={vehicleLabel} /><RecordRow label="Training" value={trainings.find((item) => item.id === trainingId)?.courseTitle || trainingId} /><RecordRow label="Verification" value={verificationState} /><RecordRow label="Dispute" value={disputeState} /><RecordRow label="Lifecycle" value={lifecycle ? lifecycleStatus : "Not applicable"} /><RecordRow label="Evidence" value={`${evidenceIds.length} linked`} /></div></div><div className="rounded-xl border border-border p-4"><div className="mb-3 flex items-center gap-2"><Link2 className="size-4 text-primary" /><span className="text-xs font-bold">Category-Specific Facts</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{categoryFields.map((field) => <RecordRow key={field.key} label={field.label} value={facts[field.key] ?? null} />)}</div></div><div className="rounded-xl border border-border p-4"><div className="mb-3 text-xs font-bold">Related Records & Evidence</div><div className="space-y-2">{buildLinkedRecords().length === 0 ? <p className="text-[11px] text-muted-foreground">No related records linked.</p> : buildLinkedRecords().map((record) => <div key={`${record.entityType}-${record.id}`} className="flex items-center gap-2 text-xs"><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">{record.entityType}</span><span className="text-foreground">{record.label}</span></div>)}</div></div></div></section>}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
          <button type="button" onClick={step === 1 ? onClose : () => setStep((current) => (current - 1) as Step)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-muted">{step === 1 ? <X className="size-3.5" /> : <ArrowLeft className="size-3.5" />}{step === 1 ? "Cancel" : "Back"}</button>
          {step < 6 ? <button type="button" onClick={next} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90">Next Step<ArrowRight className="size-3.5" /></button> : <button type="button" onClick={commit} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"><CheckCircle2 className="size-4" />Save Performance Event</button>}
        </footer>
      </div>
    </div>
  );
}
