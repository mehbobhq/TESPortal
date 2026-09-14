import React, { useEffect, useState, useMemo } from "react";
import {
  AlertTriangle,
  FileText,
  Truck,
  ShieldAlert,
  Award,
  BookOpen,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Calendar,
  X,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Building2,
  AlertCircle,
  HelpCircle,
  FileCheck2,
  Activity,
  Layers,
  CheckSquare,
  Sparkles,
  ArrowRight,
  UserCheck,
  Car,
  Scale,
  MessageSquare,
  User,
  ShieldX,
  Flame,
  Radio,
} from "lucide-react";
import {
  DriverMaster,
  CompanyDriverRelationship,
  DriverPerformanceEvent,
  TrainingRecord,
  HOSReview,
  CompanyDetermination,
  CompanyActionRecord,
  PerformanceRelationshipResolution,
} from "@/types/drivers";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import { EntityLink } from "../shared/EntityLink";
import { DriverHOSAuditModal } from "./DriverHOSAuditModal";
import { DriverCompanyActionModal } from "./DriverCompanyActionModal";
import { DriverPerformanceEventWorkflow } from "./DriverPerformanceEventWorkflow";
import { getQueryParam, pushHistoryQueryParams } from "@/lib/deep-linking";
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE, PERFORMANCE_VERIFICATION_STATES, PERFORMANCE_CATEGORY_OWNERSHIP } from "@/lib/driver-performance-schema";
import { HOS_VIOLATION_TYPES } from "@/lib/driver-taxonomy";
import { getRoadsideViolationCollection, getRoadsideEquipmentCollection, deriveRoadsideInspectionOutcome, deriveRoadsideViolationCounts } from "@/lib/driver-performance-child-facts";
import { getJurisdictionLabel } from "@/lib/jurisdictions";

export interface DriverPerformanceTabProps {
  master: DriverMaster;
  relationship: CompanyDriverRelationship;
  events: DriverPerformanceEvent[];
  trainings?: TrainingRecord[];
  hosReviews?: HOSReview[];
  companyActions?: CompanyActionRecord[];
  companyDeterminations?: CompanyDetermination[];
  allDriversCohort?: {
    master: DriverMaster;
    relationship: CompanyDriverRelationship;
    events: DriverPerformanceEvent[];
    trainings: TrainingRecord[];
  }[];
  onAddEvent: (eventData: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onUpdateEventWorkflow: (eventId: string, update: { status?: DriverPerformanceEvent["status"]; followUpActionRequired?: boolean; followUpDueDate?: string; followUpActionSummary?: string; verificationState?: DriverPerformanceEvent["verificationState"]; dispute?: DriverPerformanceEvent["dispute"] }) => void;
  onAddHOSReview?: (review: Omit<HOSReview, "id" | "createdAt" | "updatedAt">) => void;
  onAddCompanyAction?: (action: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onAddCompanyDetermination?: (det: Omit<CompanyDetermination, "id" | "createdAt" | "updatedAt" | "isArchived">) => CompanyDetermination | void;
  onLinkCompanyDetermination?: (eventId: string, determinationId: string) => void;
  onOpenDocument?: (docId: string) => void;
  onRequestEvidenceUpload?: () => void;
  machineAcquisitionDraft?: import("@/lib/roadside-machine-schema").RoadsideMachineSourceRecord | null;
  initialMachineAcquisitionDraft?: import("@/lib/roadside-machine-schema").RoadsideMachineSourceRecord | null;
  openAddEventModalSignal?: boolean;
  isProcessingOCR?: boolean;
  ocrError?: string | null;
  companyRegJurisdiction?: string;
  onRequestPerformanceSourceUpload?: () => void;
  pendingPerformanceSources?: import("@/types/drivers").PerformanceSourceIngestionItem[];
  evidenceCreatedId?: string | null;
  evidence?: import("@/types/drivers").DriverEvidenceItem[];
  onArchiveEvent?: (eventId: string) => void;
  onClearEvidenceCreatedId?: () => void;
}

const EVENT_TYPE_DEFINITIONS = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.map((definition) => ({ type: definition.value, label: definition.label, category: definition.group, description: definition.description, ownership: PERFORMANCE_CATEGORY_OWNERSHIP[definition.value] }));
const displayFact = (event: DriverPerformanceEvent, dataPointId: string, value: unknown) => {
  if (event.eventType === "Roadside Inspection" && typeof value === "string") {
    const legacyLabels: Record<string, string> = { CLEAN: "Pass", PASS: "Pass", BOTH: "Driver & Vehicle", YES: "Yes", NO: "No", UNKNOWN: "Unknown / Not Provided", NO_VIOLATIONS: "No Violations", VIOLATIONS_FOUND: "Violations Found", OUT_OF_SERVICE: "Out of Service", DRIVER: "Driver", OPERATING_CARRIER: "Operating Carrier", POWER_UNIT: "Power Unit", TOWED_UNIT: "Specific Towed Unit", OTHER: "Other", US_CVSA: "U.S. CVSA", CA_NSC_CVSA: "Canadian NSC / CVSA", US_LEVEL_I: "Level I — North American Standard Inspection", US_LEVEL_II: "Level II — Walk-Around Driver/Vehicle Inspection", US_LEVEL_III: "Level III — Driver-Only Inspection", US_LEVEL_IV: "Level IV — Special Inspection", US_LEVEL_V: "Level V — Vehicle-Only Inspection", US_LEVEL_VI: "Level VI — Radioactive Materials Inspection", US_LEVEL_VII: "Level VII — Jurisdiction-Specific Inspection", US_LEVEL_VIII: "Level VIII — Electronic Inspection" };
    if (legacyLabels[value]) return legacyLabels[value];
  }
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[event.eventType];
  const field = definition?.fields.find((item) => item.dataPointId === dataPointId);
  if (field?.options && typeof value === "string") return field.options.find((option) => option.value === value)?.label || value;
  return value === true ? "Yes" : value === false ? "No" : String(value ?? "");
};
const getEventFact = (event: DriverPerformanceEvent, key: string): unknown => {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[event.eventType];
  const field = definition?.fields.find((item) => item.key === key);
  if (field) return event.structuredEventFacts?.find((fact) => fact.dataPointId === field.dataPointId)?.value;
  return event.structuredFacts?.[key];
};

export function DriverPerformanceTab({
  master,
  relationship,
  companyRegJurisdiction = "",
  events,
  trainings = [],
  hosReviews = [],
  companyActions = [],
  companyDeterminations = [],
  allDriversCohort = [],
  onAddEvent,
  onUpdateEventWorkflow,
  onAddHOSReview,
  onAddCompanyAction,
  onAddCompanyDetermination,
  onLinkCompanyDetermination,
  onOpenDocument,
  onRequestEvidenceUpload,
  machineAcquisitionDraft = null,
  initialMachineAcquisitionDraft = null,
  openAddEventModalSignal = false,
  isProcessingOCR = false,
  ocrError = null,
  onRequestPerformanceSourceUpload,
  pendingPerformanceSources = [],
  evidenceCreatedId,
  evidence = [],
  onArchiveEvent,
  onClearEvidenceCreatedId,
}: DriverPerformanceTabProps) {
  // Sub-views
  type PerformanceSubview = "overview" | "intelligence" | "register" | "followup" | "hos" | "actions" | "chronology";
  const validSubviews: PerformanceSubview[] = ["overview", "intelligence", "register", "followup", "hos", "actions", "chronology"];
  const getSubviewFromUrl = (): PerformanceSubview => {
    const value = getQueryParam("performanceView");
    return value && validSubviews.includes(value as PerformanceSubview) ? value as PerformanceSubview : "overview";
  };
  const [subView, setSubViewState] = useState<PerformanceSubview>(getSubviewFromUrl);
  const setSubView = (view: PerformanceSubview) => {
    setSubViewState(view);
    pushHistoryQueryParams({ performanceView: view === "overview" ? null : view });
  };
  useEffect(() => {
    const onPopState = () => setSubViewState(getSubviewFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Filters for Event Register
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [verificationFilter, setVerificationFilter] = useState<string>("all");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [registerPage, setRegisterPage] = useState(1);
  const registerPageSize = 20;

  // Selected event for detail view drawer/modal
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Time window for Performance Indicators
  const [metricsWindow, setMetricsWindow] = useState<"30D" | "90D" | "12M" | "YTD" | "ALL">("12M");

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // When the parent (DriverWorkspace) signals that OCR has produced a
  // Roadside draft, open the add-event modal automatically so the draft
  // pre-fills as soon as it mounts.
  useEffect(() => {
    if (openAddEventModalSignal) {
      setIsAddModalOpen(true);
    }
  }, [openAddEventModalSignal]);
  const [isDeterminationModalOpen, setIsDeterminationModalOpen] = useState(false);
  const [isHOSAuditModalOpen, setIsHOSAuditModalOpen] = useState(false);
  const [auditingHOSEvent, setAuditingHOSEvent] = useState<DriverPerformanceEvent | null>(null);
  const [isCompanyActionModalOpen, setIsCompanyActionModalOpen] = useState(false);

  // Determination modal state remains separate from source/event facts.
  const [determinationData, setDeterminationData] = useState<{
    preventability: "Preventable" | "Non-Preventable" | "Undetermined";
    determinedBy: string;
    determinationDate: string;
    source: string;
    notes: string;
  }>({ preventability: "Undetermined", determinedBy: "", determinationDate: "", source: "", notes: "" });

  // Filter Active Events
  const activeEvents = useMemo(() => {
    return events.filter((e) => !e.isArchived);
  }, [events]);

  // Deterministic factual Performance Intelligence. No universal driver score or fleet rank is calculated here.
  const intelligenceMetrics = useMemo(() => {
    const regulatory = activeEvents.filter((event) => ["Roadside Inspection", "Out-of-Service Order", "Traffic Citation", "Violation", "Warning"].includes(event.eventType));
    const safety = activeEvents.filter((event) => ["Collision", "Near Miss", "Speeding", "Harsh Braking", "Harsh Acceleration", "Harsh Cornering", "Following Distance", "Fatigue Indicator", "Lane Departure", "Seatbelt", "Distracted Driving", "Backing", "Stop Sign / Red Light", "Railroad Crossing"].includes(event.eventType));
    const operational = activeEvents.filter((event) => ["Trip Completion / Service Performance", "Idle Time", "Route Deviation", "Customer-Site Behavior"].includes(event.eventType));
    const vehicleInteraction = activeEvents.filter((event) => event.vehicleId || event.canonicalLinks?.some((link) => link.entityType === "Vehicle"));
    const dataIntegrity = activeEvents.filter((event) => event.eventType === "Device / Data Integrity");
    const oos = activeEvents.filter((event) => event.eventType === "Roadside Inspection" && (event.childCollections || []).some((collection) => collection.items.some((item) => item.facts.oosState === "YES")) || (event.eventType === "Roadside Inspection" && ["OOS_ISSUED"].includes(event.subjectState || "")));
    const inspections = activeEvents.filter((event) => event.eventType === "Roadside Inspection");
    const unresolvedRelationships = activeEvents.reduce((count, event) => count + (event.relationshipResolutions || []).filter((resolution) => ["REVIEW_REQUIRED", "UNRESOLVED", "PENDING_SOURCE_DATA", "CANDIDATE_MATCH"].includes(resolution.state)).length, 0);
    return { safety: safety.length, regulatory: regulatory.length, operational: operational.length, vehicleInteraction: vehicleInteraction.length, dataIntegrity: dataIntegrity.length, inspections: inspections.length, oos: oos.length, unresolvedRelationships };
  }, [activeEvents]);


  const selectedEvent = useMemo(() => {
    return activeEvents.find((e) => e.id === selectedEventId) || null;
  }, [activeEvents, selectedEventId]);

  const selectedCompanyDetermination = useMemo(() => {
    if (!selectedEvent) return null;
    return companyDeterminations.find((determination) => determination.relatedRecordId === selectedEvent.id && determination.determinationType === "COLLISION_PREVENTABILITY") || null;
  }, [companyDeterminations, selectedEvent]);

  // Performance Indicators calculations (Deterministic & Traceable, NO fake scores!)
  const filteredByWindow = useMemo(() => {
    const now = new Date().getTime();
    return activeEvents.filter((evt) => {
      if (metricsWindow === "ALL") return true;
      const evtDate = new Date(evt.eventDate).getTime();
      if (isNaN(evtDate)) return true;

      const diffDays = (now - evtDate) / (1000 * 60 * 60 * 24);
      if (metricsWindow === "30D") return diffDays <= 30;
      if (metricsWindow === "90D") return diffDays <= 90;
      if (metricsWindow === "12M") return diffDays <= 365;
      if (metricsWindow === "YTD") {
        const evtYear = new Date(evt.eventDate).getFullYear();
        const curYear = new Date().getFullYear();
        return evtYear === curYear;
      }
      return true;
    });
  }, [activeEvents, metricsWindow]);

  // Window-filtered company actions (for canonical Coaching / CAP metrics)
  const filteredActionsByWindow = useMemo(() => {
    const now = new Date().getTime();
    return companyActions.filter((act) => {
      if (act.isArchived) return false;
      if (metricsWindow === "ALL") return true;
      const actDateStr = act.issueDate || act.effectiveDate || act.createdAt;
      const actDate = actDateStr ? new Date(actDateStr).getTime() : NaN;
      if (isNaN(actDate)) return true;

      const diffDays = (now - actDate) / (1000 * 60 * 60 * 24);
      if (metricsWindow === "30D") return diffDays <= 30;
      if (metricsWindow === "90D") return diffDays <= 90;
      if (metricsWindow === "12M") return diffDays <= 365;
      if (metricsWindow === "YTD") {
        const actYear = new Date(actDateStr).getFullYear();
        const curYear = new Date().getFullYear();
        return actYear === curYear;
      }
      return true;
    });
  }, [companyActions, metricsWindow]);

  const stats = useMemo(() => {
    const collisions = filteredByWindow.filter((e) => e.eventType === "Collision");
    const determinationByEvent = new Map(companyDeterminations.filter((d) => !d.isArchived).map((d) => [d.relatedRecordId, d]));
    const preventableCollisions = collisions.filter((c) => determinationByEvent.get(c.id)?.determinationValue === "PREVENTABLE");
    const nonPreventableCollisions = collisions.filter((c) => determinationByEvent.get(c.id)?.determinationValue === "NON_PREVENTABLE");
    const undeterminedCollisions = collisions.filter((c) => !determinationByEvent.has(c.id) || !["PREVENTABLE", "NON_PREVENTABLE"].includes(String(determinationByEvent.get(c.id)?.determinationValue || "")));

    const inspections = filteredByWindow.filter((e) => e.eventType === "Roadside Inspection");
    const passInspections = inspections.filter((inspection) => deriveRoadsideInspectionOutcome(Object.fromEntries((inspection.structuredEventFacts || []).map((fact) => [DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[inspection.eventType]?.fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value])), getRoadsideViolationCollection(inspection)) === "PASS");
    const driverOOSInspections = inspections.filter((inspection) => { const facts = Object.fromEntries((inspection.structuredEventFacts || []).map((fact) => [DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[inspection.eventType]?.fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value])); return facts.driverOOSState === "YES"; });

    const hosViolations = filteredByWindow.filter((e) => e.eventType === "HOS Violation");
    const citations = filteredByWindow.filter((e) => e.eventType === "Traffic Citation");
    const complaints = filteredByWindow.filter((e) => e.eventType === "Customer Complaint");
    const commendations = filteredByWindow.filter((e) => e.eventType === "Customer Commendation" || e.eventType === "Positive Safety Observation");

    // Canonical Coaching & CAP derivation from companyActions
    const canonicalCoachings = filteredActionsByWindow.filter(
      (a) => a.actionType === "Coaching" || a.actionType === "Coaching Session"
    );
    // Legacy fallback for backward compatibility if any legacy PerformanceEvents exist without duplicating
    const legacyCoachings = filteredByWindow.filter((e) => e.eventType === "Coaching Session");
    const coachingsCount = companyActions.length > 0 ? canonicalCoachings.length : legacyCoachings.length;

    const canonicalOpenCaps = filteredActionsByWindow.filter(
      (a) =>
        (a.actionType === "Corrective Action Plan" || a.actionType === "Performance Improvement Plan") &&
        a.status !== "Completed" &&
        a.status !== "Rescinded"
    );
    const legacyOpenCaps = filteredByWindow.filter((e) => e.eventType === "Corrective Action Plan" && e.status !== "Closed");
    const openCapsCount = companyActions.length > 0 ? canonicalOpenCaps.length : legacyOpenCaps.length;

    return {
      totalEvents: filteredByWindow.length,
      collisionsCount: collisions.length,
      preventableCollisions: preventableCollisions.length,
      nonPreventableCollisions: nonPreventableCollisions.length,
      undeterminedCollisions: undeterminedCollisions.length,
      inspectionsCount: inspections.length,
      passInspections: passInspections.length,
      driverOOSCount: driverOOSInspections.length,
      hosCount: hosViolations.length,
      citationsCount: citations.length,
      complaintsCount: complaints.length,
      commendationsCount: commendations.length,
      coachingsCount,
      openCapsCount,
    };
  }, [filteredByWindow, filteredActionsByWindow, companyActions, companyDeterminations]);

  // Open follow-up items
  const openFollowUpEvents = useMemo(() => {
    return activeEvents.filter((e) => {
      return (
        e.status === "Follow-up Required" ||
        e.status === "Under Review" ||
        e.status === "Awaiting Information" ||
        e.followUpActionRequired ||
        (e.capDetails && e.capDetails.capStatus !== "Closed" && e.capDetails.capStatus !== "Completed")
      );
    });
  }, [activeEvents]);

  // Filtered Register
  const registerEvents = useMemo(() => {
    return activeEvents
      .filter((e) => {
        if (typeFilter !== "all" && e.eventType !== typeFilter) return false;
        if (sourceFilter !== "all" && (e.provenance?.source || "") !== sourceFilter) return false;
        if (verificationFilter !== "all" && (e.verificationState || "Unverified") !== verificationFilter) return false;
        if (dateFromFilter && e.eventDate < dateFromFilter) return false;
        if (dateToFilter && e.eventDate > dateToFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchesSummary = e.summary.toLowerCase().includes(q);
          const matchesDesc = e.description.toLowerCase().includes(q);
          const matchesLoc = (e.location || "").toLowerCase().includes(q);
          const matchesId = e.id.toLowerCase().includes(q);
          return matchesSummary || matchesDesc || matchesLoc || matchesId;
        }
        return true;
      })
      .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
  }, [activeEvents, typeFilter, sourceFilter, verificationFilter, dateFromFilter, dateToFilter, searchTerm]);

  const registerTotalPages = Math.max(1, Math.ceil(registerEvents.length / registerPageSize));
  const paginatedRegisterEvents = registerEvents.slice((registerPage - 1) * registerPageSize, registerPage * registerPageSize);

  useEffect(() => {
    setRegisterPage((page) => Math.min(page, registerTotalPages));
  }, [registerTotalPages]);

  // Event creation is delegated to the schema-driven workflow component.
  const [initialEntryMode, setInitialEntryMode] = useState<"DOCUMENT" | "MANUAL">("MANUAL");
  const handleOpenAddWizard = (mode: "DOCUMENT" | "MANUAL") => { setInitialEntryMode(mode); setIsAddModalOpen(true); };

  const handleRecordDetermination = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || selectedEvent.eventType !== "Collision" || !onAddCompanyDetermination) {
      alert("A Collision event and the canonical Company Determination handler are required.");
      return;
    }
    if (!determinationData.determinedBy.trim() || !determinationData.determinationDate) {
      alert("Please provide the determination actor and date.");
      return;
    }
    const determination = onAddCompanyDetermination({
      companyId: relationship.companyId,
      driverMasterId: master.driverMasterId,
      companyDriverRecordId: relationship.companyDriverRecordId || relationship.id,
      relatedRecordType: "Collision",
      relatedRecordId: selectedEvent.id,
      determinationType: "COLLISION_PREVENTABILITY",
      determinationValue: determinationData.preventability === "Preventable" ? "PREVENTABLE" : determinationData.preventability === "Non-Preventable" ? "NON_PREVENTABLE" : "UNABLE_TO_DETERMINE",
      preventabilityFinding: determinationData.preventability,
      rationale: determinationData.notes || undefined,
      determinedBy: determinationData.determinedBy.trim(),
      determinationDate: determinationData.determinationDate,
      source: determinationData.source.trim() || undefined,
      notes: determinationData.notes.trim() || undefined,
      evidenceIds: selectedEvent.evidenceIds,
    });
    if (determination?.id) onLinkCompanyDetermination?.(selectedEvent.id, determination.id);
    setIsDeterminationModalOpen(false);
  };

  const handleCloseEvent = () => {
    if (!selectedEvent) return;
    onUpdateEventWorkflow(selectedEvent.id, { status: "Closed", followUpActionRequired: false });
  };

  return (
    <div className="space-y-6">
      {/* Subview Navigation Pill Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted/60 p-1">
          <button
            type="button"
            onClick={() => setSubView("overview")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              subView === "overview"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="size-3.5 text-primary" />
            <span>Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView("intelligence")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              subView === "intelligence"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="size-3.5 text-primary" />
            <span>Performance Intelligence</span>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {activeEvents.length} facts
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubView("register")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              subView === "register"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="size-3.5 text-primary" />
            <span>Event Register</span>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] text-primary">
              {activeEvents.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubView("followup")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              subView === "followup"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="size-3.5 text-amber-600" />
            <span>Open Follow-up</span>
            {openFollowUpEvents.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                {openFollowUpEvents.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubView("hos")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              subView === "hos"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Radio className="size-3.5 text-primary" />
            <span>HOS & Telematics</span>
            {hosReviews.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] text-muted-foreground">
                {hosReviews.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSubView("actions")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              subView === "actions"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="size-3.5 text-primary" />
            <span>Company Actions</span>
            {companyActions.length > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] text-primary">
                {companyActions.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCompanyActionModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground shadow-2xs hover:bg-muted transition-colors"
          >
            <Plus className="size-3.5 text-primary" />
            <span>Record Company Action</span>
          </button>

          <button
            type="button"
            onClick={() => onRequestPerformanceSourceUpload?.()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-3.5" />
            <span>Upload / Ingest Source</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenAddWizard("MANUAL")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground shadow-2xs hover:bg-muted transition-colors"
          >
            <span>Enter Manually</span>
          </button>
        </div>
      </div>

      {/* SUBVIEW 1: OVERVIEW */}
      {subView === "overview" && (
        <div className="space-y-6">
          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-muted-foreground">Total Events (12M)</span>
              <p className="mt-1 text-2xl font-bold text-foreground">{stats.totalEvents}</p>
              <span className="text-[10px] text-muted-foreground">Traceable compliance ledger</span>
            </div>

            <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-muted-foreground">Collisions</span>
              <p className="mt-1 text-2xl font-bold text-foreground">{stats.collisionsCount}</p>
              <div className="mt-1 flex items-center gap-1 text-[10px]">
                <span className="font-semibold text-rose-600">{stats.preventableCollisions} Prev</span>
                <span className="text-muted-foreground">•</span>
                <span className="font-semibold text-emerald-600">{stats.nonPreventableCollisions} Non-Prev</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-muted-foreground">Pass Inspections</span>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{stats.passInspections}</p>
              <span className="text-[10px] text-muted-foreground">Out of {stats.inspectionsCount} Total</span>
            </div>

            <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-muted-foreground">Driver OOS</span>
              <p className={`mt-1 text-2xl font-bold ${stats.driverOOSCount > 0 ? "text-rose-600" : "text-foreground"}`}>
                {stats.driverOOSCount}
              </p>
              <span className="text-[10px] text-muted-foreground">Enforcement Orders</span>
            </div>

            <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-muted-foreground">Coaching & Training</span>
              <p className="mt-1 text-2xl font-bold text-foreground">{stats.coachingsCount}</p>
              <span className="text-[10px] text-muted-foreground">Proactive interventions</span>
            </div>

            <div className="rounded-xl border border-border bg-card p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-muted-foreground">Commendations</span>
              <p className="mt-1 text-2xl font-bold text-primary">{stats.commendationsCount}</p>
              <span className="text-[10px] text-muted-foreground">Positive recognitions</span>
            </div>
          </div>

          {/* Active Follow-up Alert Banner */}
          {openFollowUpEvents.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="size-5 text-amber-600 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      {openFollowUpEvents.length} Active Compliance Follow-up Items Require Attention
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Events under review, pending preventability determination, or awaiting corrective action plan completion.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSubView("followup")}
                  className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:underline"
                >
                  <span>Review Items</span>
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Recent Events & Chronology Split */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Recent Events */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Recent Events & Incidents
                </h4>
                <button
                  type="button"
                  onClick={() => setSubView("register")}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  View All ({activeEvents.length})
                </button>
              </div>

              {activeEvents.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No performance events recorded for this driver.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {activeEvents.slice(0, 4).map((evt) => (
                    <div
                      key={evt.id}
                      onClick={() => setSelectedEventId(evt.id)}
                      className="group flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/50 p-3 hover:border-primary/50 hover:bg-muted/40 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-muted px-1.5 py-0.2 font-mono text-[10px] font-bold text-muted-foreground">
                            {evt.id}
                          </span>
                          <span className="text-xs font-bold text-foreground">{evt.eventType}</span>
                          <span
                            className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                              evt.severity === "Critical"
                                ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                : evt.severity === "High"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            }`}
                          >
                            {evt.severity}
                          </span>
                        </div>
                        <p className="text-xs text-foreground line-clamp-1">{evt.summary}</p>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="size-3" />
                            {evt.eventDate}
                          </span>
                          {evt.location && <span>{evt.location}</span>}
                        </div>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground shrink-0 mt-2" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audit & Chronology Snapshot */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Performance Chronology & Audit Log
                </h4>
                <span className="text-xs text-muted-foreground">Append-only compliance trail</span>
              </div>

              <div className="space-y-3">
                {activeEvents
                  .flatMap((e) => (e.chronology || []).map((c) => ({ ...c, eventId: e.id, eventType: e.eventType })))
                  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                  .slice(0, 5)
                  .map((log) => (
                    <div key={log.id} className="flex items-start gap-3 text-xs">
                      <div className="mt-0.5 size-2 rounded-full bg-primary shrink-0" />
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">{log.action}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(log.timestamp).toLocaleDateString()}
                          </span>
                          {log.actor && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.2 rounded text-muted-foreground">
                              {log.actor}
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-[11px]">{log.details}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBVIEW 2: EVENT REGISTER */}
      {subView === "register" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="relative lg:col-span-2"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setRegisterPage(1); }} placeholder="Search event ID, summary, location..." className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs outline-none focus:border-primary" /></div>
              <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setRegisterPage(1); }} className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"><option value="all">All Categories</option>{EVENT_TYPE_DEFINITIONS.filter((item) => item.ownership !== "COMPANY_ACTION").map((item) => <option key={item.type} value={item.type}>{item.label}{item.ownership === "LEGACY_READ_ONLY" || item.ownership === "ALIAS" ? " — Legacy" : ""}</option>)}</select>
              <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setRegisterPage(1); }} className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"><option value="all">All Sources</option>{["Driver Report", "Company Staff", "Roadside Inspection", "ELD / Telematics", "Camera", "Customer", "Citation", "Maintenance", "Training", "Other"].map((item) => <option key={item}>{item}</option>)}</select>
              <select value={verificationFilter} onChange={(e) => { setVerificationFilter(e.target.value); setRegisterPage(1); }} className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"><option value="all">All Verification</option>{[...PERFORMANCE_VERIFICATION_STATES].map((item) => <option key={item}>{item}</option>)}</select>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><input type="date" value={dateFromFilter} onChange={(e) => { setDateFromFilter(e.target.value); setRegisterPage(1); }} className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" aria-label="From date" /><input type="date" value={dateToFilter} onChange={(e) => { setDateToFilter(e.target.value); setRegisterPage(1); }} className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary" aria-label="To date" /><div className="lg:col-span-2 flex items-center justify-end text-[11px] text-muted-foreground">{registerEvents.length} matching record{registerEvents.length === 1 ? "" : "s"}</div></div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-3">Event</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Occurrence / Context</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Verification</th><th className="px-4 py-3">Evidence / Links</th><th className="px-4 py-3 text-right">View</th></tr></thead><tbody className="divide-y divide-border">{paginatedRegisterEvents.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No performance events found matching the selected filters.</td></tr> : paginatedRegisterEvents.map((evt) => { const def = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[evt.eventType]; return <tr key={evt.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedEventId(evt.id)}><td className="px-4 py-3"><span className="block font-mono font-bold text-primary">{evt.id}</span><span className="text-[10px] text-muted-foreground">{evt.eventDate}{evt.eventTime ? ` · ${evt.eventTime}` : ""}</span></td><td className="px-4 py-3"><span className="font-semibold text-foreground">{def?.label || evt.eventType}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{def?.group || "Driver Event"}</span></td><td className="max-w-sm px-4 py-3"><p className="line-clamp-1 font-medium text-foreground">{evt.summary}</p><p className="truncate text-[10px] text-muted-foreground">{[evt.location, evt.city, evt.stateProvince].filter(Boolean).join(", ") || "Context not recorded"}</p></td><td className="px-4 py-3 text-[11px] text-muted-foreground">{evt.provenance?.source || "Not recorded"}</td><td className="px-4 py-3 text-[11px] font-semibold text-foreground">{evt.verificationState || "Unverified"}</td><td className="px-4 py-3 text-[11px] text-muted-foreground">{evt.evidenceIds.length} evidence · {(evt.canonicalLinks?.length || 0) + (evt.operationalReferences?.length || 0)} related</td><td className="px-4 py-3 text-right"><button type="button" onClick={(e) => { e.stopPropagation(); setSelectedEventId(evt.id); }} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-bold text-foreground hover:bg-muted">View</button></td></tr>; })}</tbody></table></div><div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-3"><span className="text-[10px] text-muted-foreground">Page {registerPage} of {registerTotalPages}</span><div className="flex gap-2"><button type="button" disabled={registerPage === 1} onClick={() => setRegisterPage((page) => page - 1)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40">Previous</button><button type="button" disabled={registerPage >= registerTotalPages} onClick={() => setRegisterPage((page) => page + 1)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40">Next</button></div></div></div>
        </div>
      )}

      {/* SUBVIEW 3: OPEN FOLLOW-UP */}
      {subView === "followup" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-foreground">Outstanding Compliance Follow-up Action Items</h3>
            <p className="text-xs text-muted-foreground">
              Direct registry of events with pending human determinations, scheduled coaching check-ins, uncompleted Corrective Action Plans (CAPs), or open enforcement investigations.
            </p>
          </div>

          {openFollowUpEvents.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="size-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-bold text-foreground">All Follow-up Items Completed</p>
              <p>There are currently no open follow-up actions or unresolved reviews for this driver.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {openFollowUpEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="rounded-2xl border border-amber-500/30 bg-card p-5 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-border pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{evt.id}</span>
                        <span className="text-xs font-bold text-foreground">{evt.eventType}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">Logged {evt.eventDate}</span>
                    </div>

                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        evt.status === "Follow-up Required"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      }`}
                    >
                      {evt.status}
                    </span>
                  </div>

                  <p className="text-xs text-foreground font-medium">{evt.summary}</p>

                  {evt.followUpActionSummary && (
                    <div className="rounded-xl bg-muted/40 p-3 text-xs space-y-1">
                      <span className="font-bold text-foreground block text-[11px]">Required Action:</span>
                      <p className="text-muted-foreground">{evt.followUpActionSummary}</p>
                      {evt.followUpDueDate && (
                        <p className="text-[10px] font-mono text-amber-700 dark:text-amber-300">
                          Due Date: {evt.followUpDueDate}
                        </p>
                      )}
                    </div>
                  )}

                  {evt.capDetails && (
                    <div className="rounded-xl bg-blue-50/50 dark:bg-blue-950/30 p-3 text-xs space-y-1">
                      <span className="font-bold text-blue-900 dark:text-blue-300 block text-[11px]">
                        Corrective Action Plan: {evt.capDetails.planId}
                      </span>
                      <p className="text-muted-foreground">{evt.capDetails.requiredAction}</p>
                      <p className="text-[10px] font-mono text-blue-700 dark:text-blue-400">
                        Responsible: {evt.capDetails.responsibleParty} • Target: {evt.capDetails.targetDate}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSelectedEventId(evt.id)}
                      className="rounded-lg border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                    >
                      Inspect Full Event
                    </button>
                    {evt.eventType === "Collision" && evt.collisionDetails && (!evt.collisionDetails?.preventability || evt.collisionDetails.preventability === "Undetermined") && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEventId(evt.id);
                          setIsDeterminationModalOpen(true);
                        }}
                        className="rounded-lg bg-primary px-3 py-1 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
                      >
                        Record Preventability
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW: PERFORMANCE INTELLIGENCE — FACTUAL / DETERMINISTIC METRICS */}
      {subView === "intelligence" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-bold text-foreground">Performance Intelligence</h3><p className="mt-1 text-xs text-muted-foreground">Transparent counts, relationships, recurrence and trend-ready facts. No universal Driver judgment score or fleet rank is used.</p></div>
              <select value={metricsWindow} onChange={(e) => setMetricsWindow(e.target.value as typeof metricsWindow)} className="rounded-lg border border-border bg-background px-3 py-2 text-xs"><option value="30D">30 Days</option><option value="90D">90 Days</option><option value="12M">12 Months</option><option value="YTD">YTD</option><option value="ALL">All</option></select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Safety", intelligenceMetrics.safety, "Occurrence records in the selected window"],
              ["Regulatory / Compliance", intelligenceMetrics.regulatory, "Inspections, OOS orders, citations and violations"],
              ["Operational", intelligenceMetrics.operational, "Service, route, idle and site performance records"],
              ["Vehicle Interaction", intelligenceMetrics.vehicleInteraction, "Events with a canonical or direct Vehicle relationship"],
              ["Data Integrity", intelligenceMetrics.dataIntegrity, `${intelligenceMetrics.unresolvedRelationships} unresolved relationship decision(s)`],
            ].map(([label, value, note]) => <div key={String(label)} className="rounded-xl border border-border bg-background p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span><p className="mt-1 text-2xl font-extrabold text-foreground">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{note}</p></div>)}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Roadside Inspections</span><p className="mt-1 text-xl font-bold text-foreground">{intelligenceMetrics.inspections}</p><p className="mt-1 text-[10px] text-muted-foreground">Canonical inspection records in the selected window.</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">OOS Findings</span><p className="mt-1 text-xl font-bold text-foreground">{intelligenceMetrics.oos}</p><p className="mt-1 text-[10px] text-muted-foreground">Derived only from explicit OOS facts; unknown is not treated as NO.</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Source / Relationship Review</span><p className="mt-1 text-xl font-bold text-foreground">{intelligenceMetrics.unresolvedRelationships}</p><p className="mt-1 text-[10px] text-muted-foreground">Pending, candidate, unresolved or review-required relationship states.</p></div>
          </div>
        </div>
      )}

      {/* SUBVIEW: HOS & TELEMATICS */}
      {subView === "hos" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Hours of Service (HOS) & Telematics Review</h3>
                <p className="text-xs text-muted-foreground">
                  Rule profiles, potential vs confirmed violations, carrier ELD audit reviews, and compliance determinations.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-primary/10 px-3 py-1 font-mono text-xs font-bold text-primary">
                  Active Profile: Canada 70h/7d & US FMCSA 70h/8d
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAuditingHOSEvent(null);
                    setIsHOSAuditModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
                >
                  <Plus className="size-3.5" />
                  <span>Audit HOS Record</span>
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 pt-2">
              <div className="rounded-xl border border-border bg-background p-3">
                <span className="text-[11px] text-muted-foreground block">Canada Cycle 1</span>
                <span className="text-lg font-bold text-foreground">70 Hours / 7 Days</span>
                <p className="text-[10px] text-muted-foreground mt-1">13h Driving • 14h On-Duty • 10h Off-Duty</p>
              </div>

              <div className="rounded-xl border border-border bg-background p-3">
                <span className="text-[11px] text-muted-foreground block">US FMCSA Standard</span>
                <span className="text-lg font-bold text-foreground">70 Hours / 8 Days</span>
                <p className="text-[10px] text-muted-foreground mt-1">11h Driving • 14h Window • 30min Break</p>
              </div>

              <div className="rounded-xl border border-border bg-background p-3">
                <span className="text-[11px] text-muted-foreground block">Telematics Sync</span>
                <span className="text-lg font-bold text-emerald-600">Connected</span>
                <p className="text-[10px] text-muted-foreground mt-1">Real-time ELD telematic data stream</p>
              </div>
            </div>
          </div>

          {/* HOS Events List */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                HOS Non-Compliance Incidents & Raw ELD Triggers
              </h4>
              <span className="text-xs text-muted-foreground">
                {activeEvents.filter((e) => e.eventType === "HOS Violation").length} Recorded
              </span>
            </div>

            {activeEvents.filter((e) => e.eventType === "HOS Violation").length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No Hours of Service violation events recorded for this driver.
              </div>
            ) : (
              <div className="space-y-3">
                {activeEvents
                  .filter((e) => e.eventType === "HOS Violation")
                  .map((evt) => (
                    <div
                      key={evt.id}
                      className="rounded-xl border border-border bg-background p-4 hover:border-primary/50 transition-colors space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-primary">{evt.id}</span>
                          <span className="text-xs font-bold text-foreground">{HOS_VIOLATION_TYPES.find(x => x.value === evt.hosDetails?.violationType)?.label || evt.hosDetails?.legacyViolationType || evt.summary}</span>
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            evt.hosDetails?.reviewStatus === "Confirmed"
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                              : evt.hosDetails?.reviewStatus === "Disputed"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          }`}>
                            {evt.hosDetails?.reviewStatus || "Pending Review"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                            Log Date: {evt.hosDetails?.logDate || evt.eventDate}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setAuditingHOSEvent(evt);
                              setIsHOSAuditModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-muted transition-colors"
                          >
                            <CheckSquare className="size-3" />
                            <span>Audit This Record</span>
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">{evt.summary}</p>
                      
                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                        <span>Jurisdiction: <strong className="text-foreground">{evt.hosDetails?.ruleJurisdiction || evt.country}</strong></span>
                        <span>Source: <strong className="text-foreground">{evt.hosDetails?.source || "ELD System"}</strong></span>
                        {evt.hosDetails?.minutesOverLimit && (
                          <span>Minutes Over Limit: <strong className="text-rose-600">{evt.hosDetails.minutesOverLimit}m</strong></span>
                        )}
                        {evt.hosDetails?.reviewNotes && (
                          <span className="truncate max-w-md">Notes: {evt.hosDetails.reviewNotes}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Audit Review Determinations Ledger */}
          {hosReviews.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Carrier HOS Audit Review & Determination Ledger
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="pb-2 font-semibold">Audit ID</th>
                      <th className="pb-2 font-semibold">Log Date</th>
                      <th className="pb-2 font-semibold">Violation Type</th>
                      <th className="pb-2 font-semibold">Finding</th>
                      <th className="pb-2 font-semibold">Carrier Action</th>
                      <th className="pb-2 font-semibold">Auditor</th>
                      <th className="pb-2 font-semibold">Audit Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {hosReviews.map((rev) => (
                      <tr key={rev.id} className="hover:bg-muted/30">
                        <td className="py-2.5 font-mono text-[11px] font-bold text-primary">{rev.id}</td>
                        <td className="py-2.5 font-mono text-[11px]">{rev.logDate}</td>
                        <td className="py-2.5 font-semibold text-foreground">{rev.violationType}</td>
                        <td className="py-2.5">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            rev.initialReviewFinding === "Confirmed Violation"
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                              : rev.initialReviewFinding === "False Positive"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          }`}>
                            {rev.initialReviewFinding}
                          </span>
                        </td>
                        <td className="py-2.5 text-foreground">{rev.carrierResolution}</td>
                        <td className="py-2.5 text-muted-foreground">{rev.auditorName}</td>
                        <td className="py-2.5 font-mono text-[11px] text-muted-foreground">{rev.reviewDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW: COMPANY ACTIONS & CORRECTIVE ACTION PLANS (CAPs) */}
      {subView === "actions" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-foreground">Company Safety Actions & Development Register</h3>
              <p className="text-xs text-muted-foreground">
                Documented coaching, written warnings, statutory corrective action plans (CAPs), and formal preventability determinations.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCompanyActionModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" />
              <span>Record Action / Coaching</span>
            </button>
          </div>

          {/* Action Records List */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Active & Historic Company Actions ({companyActions.length})
            </h4>

            {companyActions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No formal company actions, coaching sessions, or corrective action plans recorded for this driver.
              </div>
            ) : (
              <div className="space-y-3">
                {companyActions.map((act) => (
                  <div key={act.id} className="rounded-xl border border-border bg-background p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{act.id}</span>
                        <span className="text-xs font-bold text-foreground">{act.actionType}</span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          act.status === "Completed"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : act.status === "In Progress"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}>
                          {act.status}
                        </span>
                        {act.formalSignOffStatus === "Completed" && (
                          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                            Signed Off
                          </span>
                        )}
                      </div>
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                        Issued: {act.issueDate}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-foreground">Trigger Reason: {act.reason}</p>
                      <p className="text-xs text-muted-foreground">{act.description}</p>
                    </div>

                    {act.requiredRemediation && (
                      <div className="rounded-lg bg-muted/40 p-2.5 text-xs">
                        <span className="font-bold text-foreground block mb-0.5">Required Remediation:</span>
                        <span className="text-muted-foreground">{act.requiredRemediation}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-4 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                      <span>Facilitator: <strong className="text-foreground">{act.facilitatorName}</strong> ({act.facilitatorRole})</span>
                      {act.targetCompletionDate && (
                        <span>Due Date: <strong className="font-mono text-foreground">{act.targetCompletionDate}</strong></span>
                      )}
                      {act.actualCompletionDate && (
                        <span>Completed: <strong className="font-mono text-emerald-600">{act.actualCompletionDate}</strong></span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formal Preventability Determinations */}
          {companyDeterminations.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Official Safety Determinations ({companyDeterminations.length})
              </h4>
              <div className="space-y-3">
                {companyDeterminations.map((det) => (
                  <div key={det.id} className="rounded-xl border border-border bg-background p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{det.id}</span>
                        <span className="text-xs font-bold text-foreground">{det.determinationType}</span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          det.preventabilityFinding === "Non-Preventable"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : det.preventabilityFinding === "Preventable"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {det.preventabilityFinding}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">{det.determinationDate}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{det.rationale}</p>
                    <div className="text-[11px] text-muted-foreground">
                      <span>Determined By: <strong className="text-foreground">{det.determinedBy}</strong></span>
                      {det.safetyCommitteeReview && <span className="ml-3 font-semibold text-primary">• Safety Committee Review</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* EVENT DETAIL DRAWER / MODAL */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden my-8">
            <div className="bg-muted/40 px-6 py-4 border-b border-border flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-primary">{selectedEvent.id}</span>
                  <span className="text-sm font-bold text-foreground">{selectedEvent.eventType}</span>
                  {selectedEvent.severity !== "Not Applicable" && <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      selectedEvent.severity === "Critical"
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                        : selectedEvent.severity === "High"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    }`}
                  >
                    {selectedEvent.severity}
                  </span> }
                  {selectedEvent.status !== "Not Applicable" && <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      selectedEvent.status === "Closed"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    }`}
                  >
                    {selectedEvent.status}
                  </span> }
                </div>
                <p className="text-xs text-muted-foreground">{selectedEvent.summary}</p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {/* Event Core Facts Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <ReadOnlyField label="Event Date" value={selectedEvent.eventDate} mono />
                <ReadOnlyField label="Occurrence Precision" value={selectedEvent.occurrencePrecision || (selectedEvent.eventTime ? "EXACT_DATETIME" : "DATE_ONLY")} />
                <ReadOnlyField label="Reported Date" value={selectedEvent.reportedDate || "Not recorded"} mono />
                <ReadOnlyField label="Location" value={selectedEvent.location || "Unspecified"} />
                <ReadOnlyField label="Jurisdiction / Country" value={`${selectedEvent.stateProvince || ""} ${selectedEvent.country || ""}`.trim() || "Unspecified"} />
                <ReadOnlyField label="Processing State" value={selectedEvent.recordProcessingState || "Legacy / Not Recorded"} />
                {selectedEvent.eventType !== "Roadside Inspection" ? <ReadOnlyField label="Subject State" value={selectedEvent.subjectState || "Not Applicable / Not Recorded"} /> : null}
                <ReadOnlyField label="Workflow State" value={selectedEvent.workflowState || "Legacy / Not Recorded"} />
              </div>

              {/* Full Description */}
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  {selectedEvent.descriptionOrigin === "SYSTEM_GENERATED" ? "TES-Generated Event Description" : "Full Event Narrative & Description"}
                </span>
                <div className="rounded-xl bg-muted/20 p-3.5 text-xs text-foreground leading-relaxed">
                  {selectedEvent.description}
                </div>
              </div>

              {/* Collision Specific Payload */}
              {selectedEvent.eventType === "Collision" && selectedEvent.collisionDetails && (
                <div className="rounded-xl border border-border p-4 bg-muted/10 space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Structured Collision Details
                    </h4>
                    <span className="font-bold text-xs text-primary">
                      {selectedCompanyDetermination ? `Company Determination: ${selectedCompanyDetermination.preventabilityFinding || selectedCompanyDetermination.determinationValue || "Recorded"}` : "Company Determination: Not Recorded"}
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 text-xs">
                    <ReadOnlyField label="Collision Type" value={selectedEvent.collisionDetails.collisionType} />
                    <ReadOnlyField label="Weather / Road" value={`${selectedEvent.collisionDetails.weather} / ${selectedEvent.collisionDetails.roadCondition}`} />
                    <ReadOnlyField label="Lighting" value={selectedEvent.collisionDetails.lightCondition} />
                    <ReadOnlyField label="Tow Required" value={selectedEvent.collisionDetails.towRequired ? "Yes" : "No"} />
                    <ReadOnlyField label="Police Attended" value={selectedEvent.collisionDetails.policeAttended ? "Yes" : "No"} />
                    <ReadOnlyField label="Police Report #" value={selectedEvent.collisionDetails.policeReportNumber || "Not recorded"} mono />
                    <ReadOnlyField label="Injuries / Fatalities" value={`${selectedEvent.collisionDetails.injuriesCount} Inj / ${selectedEvent.collisionDetails.fatalitiesCount} Fat`} />
                    <ReadOnlyField label="DOT Reportable" value={selectedEvent.collisionDetails.dotReportable ? "Yes" : "No"} />
                    <ReadOnlyField label="Estimated Cost" value={selectedEvent.collisionDetails.estimatedCost || "Not recorded"} />
                  </div>

                  <div className="rounded-lg bg-card border border-border p-3 space-y-1.5 text-xs">
                    <div className="font-bold text-foreground">Company Determination</div>
                    {selectedCompanyDetermination ? (
                      <>
                        <p className="text-muted-foreground">{selectedCompanyDetermination.preventabilityFinding || selectedCompanyDetermination.determinationValue || "Recorded"} · {selectedCompanyDetermination.determinedBy} · {selectedCompanyDetermination.determinationDate}</p>
                        {selectedCompanyDetermination.rationale && <p className="rounded bg-muted/30 p-2 text-foreground">{selectedCompanyDetermination.rationale}</p>}
                      </>
                    ) : <p className="text-muted-foreground">No Company Determination is recorded. Collision source facts remain unchanged.</p>}
                  </div>
                </div>
              )}

              {/* Roadside Inspection — semantic record presentation */}
              {selectedEvent.eventType === "Roadside Inspection" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-4 bg-muted/10 space-y-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Inspection Identity</h4>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <ReadOnlyField label="Inspection / Report #" value={String(getEventFact(selectedEvent, "inspectionReportNumber") || "Not recorded")} mono />
                      <ReadOnlyField label="Enforcement Agency" value={String(getEventFact(selectedEvent, "agency") || "Not recorded")} />
                      <ReadOnlyField label="Jurisdiction" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "jurisdiction")?.dataPointId || "", getEventFact(selectedEvent, "jurisdiction")) || "Not recorded")} />
                      <ReadOnlyField label="Inspection Regime" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "inspectionRegime")?.dataPointId || "", getEventFact(selectedEvent, "inspectionRegime")) || "Not recorded")} />
                      <ReadOnlyField label="Inspection Level / Type" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "inspectionClassification")?.dataPointId || "", getEventFact(selectedEvent, "inspectionClassification")) || "Not recorded")} />
                      <ReadOnlyField label="Inspection Scope" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "inspectionScope")?.dataPointId || "", getEventFact(selectedEvent, "inspectionScope")) || "Not recorded")} />
                      <ReadOnlyField label="Derived Overall Outcome" value={displayFact(selectedEvent, "", deriveRoadsideInspectionOutcome(Object.fromEntries((selectedEvent.structuredEventFacts || []).map((fact) => [DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((field) => field.dataPointId === fact.dataPointId)?.key || fact.dataPointId, fact.value])), getRoadsideViolationCollection(selectedEvent)))} />
                      <ReadOnlyField label="Source-Reported Total" value={String(getEventFact(selectedEvent, "sourceReportedViolationCount") ?? "Not reported")} />
                    </div>
                  </div>

                  {(getEventFact(selectedEvent, "inspectionScope") === "DRIVER" || getEventFact(selectedEvent, "inspectionScope") === "BOTH") && (
                    <div className="rounded-xl border border-border p-4 bg-background space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Driver Inspection</h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <ReadOnlyField label="Inspected" value="Yes" />
                        <ReadOnlyField label="Result" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "driverInspectionResult")?.dataPointId || "", getEventFact(selectedEvent, "driverInspectionResult")) || "Unknown")} />
                        <ReadOnlyField label="OOS" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "driverOOSState")?.dataPointId || "", getEventFact(selectedEvent, "driverOOSState")) || "Unknown")} />
                        <ReadOnlyField label="Demerit / Points" value={String(getEventFact(selectedEvent, "driverDemeritPoints") ?? "Not recorded")} />
                      </div>
                    </div>
                  )}

                  {(getEventFact(selectedEvent, "inspectionScope") === "VEHICLE" || getEventFact(selectedEvent, "inspectionScope") === "BOTH") && (
                    <div className="rounded-xl border border-border p-4 bg-background space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Vehicle Inspection</h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <ReadOnlyField label="Inspected" value="Yes" />
                        <ReadOnlyField label="Result" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "vehicleInspectionResult")?.dataPointId || "", getEventFact(selectedEvent, "vehicleInspectionResult")) || "Unknown")} />
                        <ReadOnlyField label="OOS" value={String(displayFact(selectedEvent, DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((f) => f.key === "vehicleOOSState")?.dataPointId || "", getEventFact(selectedEvent, "vehicleOOSState")) || "Unknown")} />
                        <ReadOnlyField label="Demerit / Points" value={String(getEventFact(selectedEvent, "vehicleDemeritPoints") ?? "Not recorded")} />
                        {(() => { const equipment = getRoadsideEquipmentCollection(selectedEvent); const items = equipment?.items || []; const legacy = items.length === 0 ? [{ itemId: "legacy-equipment", facts: { role: "POWER_UNIT", sourceVin: getEventFact(selectedEvent, "vehicleSourceVin"), sourcePlate: getEventFact(selectedEvent, "vehicleSourcePlate"), plateJurisdiction: getEventFact(selectedEvent, "vehiclePlateJurisdiction"), sourceUnitNumber: getEventFact(selectedEvent, "vehicleSourceUnitNumber") }, relationships: [] as PerformanceRelationshipResolution[] }] : items; return legacy.some((item) => item.facts.sourceVin || item.facts.sourcePlate || item.facts.sourceUnitNumber) ? legacy.map((item) => { const resolution = item.relationships?.find((r) => r.targetEntityType === "Vehicle") || selectedEvent.relationshipResolutions?.find((r) => r.relationshipKey === `equipment:${item.itemId}`); return <div key={item.itemId} className="rounded-lg border border-border bg-muted/10 p-3 sm:col-span-2 lg:col-span-4"><div className="text-xs font-bold">{item.facts.role === "POWER_UNIT" ? "Power Unit" : "Towed Unit"}</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 mt-2"><ReadOnlyField label="Source VIN" value={String(item.facts.sourceVin || "Not recorded")} mono /><ReadOnlyField label="Source Plate" value={String(item.facts.sourcePlate || "Not recorded")} mono /><ReadOnlyField label="Plate Jurisdiction" value={String(item.facts.plateJurisdiction ? getJurisdictionLabel(String(item.facts.plateJurisdiction)) : "Not recorded")} /><ReadOnlyField label="Source Unit #" value={String(item.facts.sourceUnitNumber || "Not recorded")} mono /><ReadOnlyField label="Resolution" value={resolution?.state === "AUTO_RESOLVED" ? "Matched" : resolution?.state === "REVIEW_REQUIRED" ? "Conflict / Review Required" : resolution?.state === "PENDING_SOURCE_DATA" ? "Pending Source Data" : "Unresolved / External"} /><ReadOnlyField label="Resolution Reason" value={resolution?.deterministicMatchingReason || "Not recorded"} />{resolution?.resolvedRecordId ? <ReadOnlyField label="Canonical Vehicle" value={resolution.resolvedEntitySummary || resolution.resolvedRecordId} /> : null}</div></div>}) : <p className="text-[11px] text-muted-foreground sm:col-span-2 lg:col-span-4">No inspected equipment identifiers were provided.</p>; })()}
                      </div>
                    </div>
                  )}

                  {(() => { const collection = getRoadsideViolationCollection(selectedEvent); const counts = deriveRoadsideViolationCounts(collection); const completeness = collection?.completeness || "NOT_PROVIDED"; return <div className="rounded-xl border border-border p-4 bg-muted/10 space-y-3"><div className="flex items-center justify-between"><h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Violations</h4><span className="text-[10px] text-muted-foreground">{completeness === "COMPLETE" ? `${counts.total} known` : completeness}</span></div>{collection?.items.length ? <div className="space-y-2">{collection.items.map((item) => <div key={item.itemId} className="rounded-lg border border-border bg-background p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs"><ReadOnlyField label="Rule / Regulation" value={String(item.facts.ruleRegulationCode || "Not recorded")} /><ReadOnlyField label="Description" value={String(item.facts.description || "Not recorded")} /><ReadOnlyField label="Attribution" value={String(item.facts.subjectType || "UNKNOWN")} /><ReadOnlyField label="OOS" value={String(item.facts.oosState || "UNKNOWN")} /><ReadOnlyField label="Category" value={String(item.facts.regulatoryCategory || "Not recorded")} /><ReadOnlyField label="Component / System" value={String(item.facts.componentSystem || "Not recorded")} /><ReadOnlyField label="Regulator Weight" value={String(item.facts.regulatorSeverityWeight ?? "Not recorded")} /><ReadOnlyField label="Demerit / Points" value={String(item.facts.demeritPoints ?? "Not recorded")} /></div></div>)}</div> : <p className="text-[11px] text-muted-foreground">{completeness === "COMPLETE" ? "No violations were established in the complete collection (known zero)." : completeness === "PARTIAL" ? "Violation itemization is partial; the source may contain additional unitemized violations." : "Violation information was not provided; this is not equivalent to zero violations."}</p>}<p className="text-[10px] text-muted-foreground">Collection: {collection?.completeness || "NOT_PROVIDED"} · Driver: {counts.driver} · Vehicle: {counts.vehicle} · Carrier: {counts.carrier} · Other: {counts.other}</p></div>; })()}
                {(() => { const statements = selectedEvent.childCollections?.find((collection) => collection.collectionId === "DRV.PERF.ROADSIDE_INSPECTION.DRIVER_STATEMENTS"); return statements?.items.length ? <div className="rounded-xl border border-border p-4 bg-background space-y-3"><h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Driver Statements / Accounts</h4>{statements.items.map((item) => <div key={item.itemId} className="rounded-lg border border-border bg-muted/10 p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><ReadOnlyField label="Status" value={String(item.facts.status || "Not recorded")} /><ReadOnlyField label="Date" value={String(item.facts.date || "Not recorded")} /><ReadOnlyField label="Time" value={String(item.facts.time || "Not recorded")} /><ReadOnlyField label="Method" value={String(item.facts.method || "Not recorded")} /></div><p className="mt-2 whitespace-pre-wrap text-xs text-foreground">{String(item.facts.content || "No statement content recorded.")}</p></div>)}</div> : null; })()}
                </div>
              )}

              {(selectedEvent.structuredEventFacts?.length || Object.keys(selectedEvent.structuredFacts || {}).length > 0) && (
                <div className="space-y-3">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Category-Specific Structured Facts</span>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 rounded-xl border border-border p-4 bg-background">
                    {selectedEvent.structuredEventFacts?.map((fact) => {
                      const field = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[selectedEvent.eventType]?.fields.find((item) => item.dataPointId === fact.dataPointId);
                      const measurement = fact.unit ? `${displayFact(selectedEvent, fact.dataPointId, fact.value)} ${fact.unit}` : displayFact(selectedEvent, fact.dataPointId, fact.value);
                      return <ReadOnlyField key={fact.dataPointId} label={field?.label || fact.dataPointId} value={measurement} />;
                    })}
                    {!selectedEvent.structuredEventFacts?.length && Object.entries(selectedEvent.structuredFacts || {}).map(([key, value]) => value !== null && value !== undefined && value !== "" && value !== false ? (
                      <ReadOnlyField key={key} label={`${key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} (Legacy)`} value={value === true ? "Yes" : String(value)} />
                    ) : null)}
                  </div>
                </div>
              )}

              {/* Canonical Evidence / Document Links */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Evidence & Documents
                </span>
                {selectedEvent.evidenceIds.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedEvent.evidenceIds.map((evidenceId) => { const item = evidence.find((candidate) => candidate.id === evidenceId); const reportNumber = selectedEvent.eventType === "Roadside Inspection" ? getEventFact(selectedEvent, "inspectionReportNumber") : undefined; return <button key={evidenceId} type="button" onClick={() => onOpenDocument?.(evidenceId)} className="inline-flex min-w-[240px] items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left hover:bg-muted"><FileText className="size-4 shrink-0 text-primary" /><span className="min-w-0"><span className="block text-xs font-semibold text-foreground">{selectedEvent.eventType === "Roadside Inspection" ? "Inspection Report" : item?.documentType || "Evidence"}</span><span className="block truncate text-[10px] text-muted-foreground">{reportNumber ? `Report #${reportNumber} · ` : ""}{selectedEvent.eventType === "Roadside Inspection" && getEventFact(selectedEvent, "agency") ? `${String(getEventFact(selectedEvent, "agency"))} · ` : ""}{item?.documentDate ? `${item.documentDate} · ` : ""}{item?.fileName || evidenceId}</span></span></button>; })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No evidence is linked to this performance event.
                  </div>
                )}
              </div>

              {/* Canonical Relationships, Resolution State, and Operational References */}
              {((selectedEvent.canonicalLinks?.length || 0) > 0 || (selectedEvent.relationshipResolutions?.length || 0) > 0 || (selectedEvent.operationalReferences?.length || 0) > 0 || (selectedEvent.linkedRecords?.length || 0) > 0) && (
                <div className="space-y-3">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Related Records & References</span>
                  {(selectedEvent.relationshipResolutions?.length || 0) > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Relationship Resolution State</div>
                      <div className="space-y-2">
                        {selectedEvent.relationshipResolutions!.map((resolution) => <div key={resolution.id} className="rounded-xl border border-border bg-background px-3 py-2"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-foreground">{resolution.relationshipKey}</span><span className="rounded-md bg-muted px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{resolution.state}</span></div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{resolution.deterministicMatchingReason || "No automatic relationship decision was made."}</p>{resolution.candidateIds.length > 0 ? <p className="mt-1 text-[10px] font-mono text-muted-foreground">Candidates: {resolution.candidateIds.join(", ")}</p> : null}</div>)}
                      </div>
                    </div>
                  )}
                  {(selectedEvent.canonicalLinks?.length || 0) > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Canonical TES Relationships</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedEvent.canonicalLinks!.map((lk) => <div key={`${lk.entityType}-${lk.recordId}`} className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-1.5 text-xs font-medium text-foreground"><span className="font-bold text-primary">[{lk.entityType}]</span><span>{lk.label || lk.recordId}</span></div>)}
                      </div>
                    </div>
                  )}
                  {(selectedEvent.operationalReferences?.length || 0) > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Operational References — not canonical TES relationships</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedEvent.operationalReferences!.map((ref, index) => <div key={`${ref.referenceType}-${ref.referenceValue}-${index}`} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 py-1.5 text-xs text-foreground"><span className="font-bold text-muted-foreground">[{ref.referenceType}]</span><span>{ref.label || ref.referenceValue}</span></div>)}
                      </div>
                    </div>
                  )}
                  {(!selectedEvent.canonicalLinks?.length && !selectedEvent.operationalReferences?.length && selectedEvent.linkedRecords?.length) ? <div className="text-xs text-muted-foreground">Historical linked-record references are shown for compatibility.</div> : null}
                </div>
              )}

              {/* Chronology Trail */}
              <div className="space-y-3">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Event Chronology & Lifecycle Actions
                </span>
                <div className="space-y-2 rounded-xl border border-border p-4 bg-background">
                  {selectedEvent.chronology.map((c) => (
                    <div key={c.id} className="text-xs space-y-0.5 border-b border-border/50 pb-2 last:border-none last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-primary">{c.action}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {new Date(c.timestamp).toLocaleString()}
                        </span>
                        {c.actor && <span className="text-[10px] text-muted-foreground font-semibold">by {c.actor}</span>}
                      </div>
                      <p className="text-muted-foreground text-[11px]">{c.details}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="bg-muted/40 px-6 py-4 border-t border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {selectedEvent.eventType === "Collision" && selectedEvent.collisionDetails && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeterminationData({
                        preventability: selectedEvent.collisionDetails?.preventability || "Undetermined",
                        determinedBy: selectedEvent.collisionDetails?.preventabilityDeterminedBy || "",
                        determinationDate: selectedEvent.collisionDetails?.preventabilityDeterminationDate || "",
                        source: selectedEvent.collisionDetails?.preventabilitySource || "",
                        notes: selectedEvent.collisionDetails?.preventabilityNotes || "",
                      });
                      setIsDeterminationModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    <UserCheck className="size-3.5 text-primary" />
                    <span>Update Preventability</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {onArchiveEvent && (
                  <button type="button" onClick={() => { onArchiveEvent(selectedEvent.id); setSelectedEventId(null); }} className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10">
                    Archive Event
                  </button>
                )}
                {selectedEvent.status !== "Closed" && selectedEvent.status !== "Not Applicable" && (
                  <button
                    type="button"
                    onClick={handleCloseEvent}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="size-3.5" />
                    <span>Close Event</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedEventId(null)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <DriverPerformanceEventWorkflow
          relationship={relationship}
          trainings={trainings}
          evidence={evidence}
          onRequestEvidenceUpload={onRequestEvidenceUpload}
          machineAcquisitionDraft={machineAcquisitionDraft}
          initialMachineAcquisitionDraft={initialMachineAcquisitionDraft}
          isProcessingOCR={isProcessingOCR}
          ocrError={ocrError}
          companyRegJurisdiction={companyRegJurisdiction}
          evidenceCreatedId={evidenceCreatedId}
          pendingPerformanceSources={pendingPerformanceSources}
          onClearEvidenceCreatedId={onClearEvidenceCreatedId}
          initialEntryMode={initialEntryMode}
          onClose={() => { onClearEvidenceCreatedId?.(); setIsAddModalOpen(false); }}
          onSave={onAddEvent}
        />
      )}

      {/* HUMAN DETERMINATION RECORDING MODAL */}
      {isDeterminationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Record Human Preventability Determination</h3>
              <button
                type="button"
                onClick={() => setIsDeterminationModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleRecordDetermination} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-foreground block">Preventability Decision *</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setDeterminationData({ ...determinationData, preventability: "Preventable" })}
                    className={`rounded-xl border p-2.5 font-bold transition-colors ${
                      determinationData.preventability === "Preventable"
                        ? "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    Preventable
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeterminationData({ ...determinationData, preventability: "Non-Preventable" })}
                    className={`rounded-xl border p-2.5 font-bold transition-colors ${
                      determinationData.preventability === "Non-Preventable"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    Non-Preventable
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground block">Determined By (Safety Committee / Person) *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Safety Director J. Tremblay"
                  value={determinationData.determinedBy}
                  onChange={(e) => setDeterminationData({ ...determinationData, determinedBy: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-foreground block">Determination Date *</label>
                <input
                  type="date"
                  required
                  value={determinationData.determinationDate}
                  onChange={(e) => setDeterminationData({ ...determinationData, determinationDate: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-foreground block">Investigation Source</label>
                <input
                  type="text"
                  placeholder="e.g. Internal Safety Review INV-PW-0041"
                  value={determinationData.source}
                  onChange={(e) => setDeterminationData({ ...determinationData, source: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-foreground block">Determination Rationale & Notes</label>
                <textarea
                  rows={3}
                  placeholder="Detailed rationale justifying the preventability finding..."
                  value={determinationData.notes}
                  onChange={(e) => setDeterminationData({ ...determinationData, notes: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsDeterminationModalOpen(false)}
                  className="rounded-xl border border-border bg-background px-4 py-2 font-semibold text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground hover:bg-primary/90"
                >
                  Save Determination
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HOS AUDIT DETERMINATION MODAL */}
      {isHOSAuditModalOpen && auditingHOSEvent && (
        <DriverHOSAuditModal
          isOpen={isHOSAuditModalOpen}
          onClose={() => {
            setIsHOSAuditModalOpen(false);
            setAuditingHOSEvent(null);
          }}
          event={auditingHOSEvent}
          onSaveReview={(reviewData) => {
            if (onAddHOSReview) {
              onAddHOSReview(reviewData);
            }
            setIsHOSAuditModalOpen(false);
            setAuditingHOSEvent(null);
          }}
        />
      )}

      {/* COMPANY SAFETY ACTION / COACHING MODAL */}
      <DriverCompanyActionModal
        isOpen={isCompanyActionModalOpen}
        onClose={() => setIsCompanyActionModalOpen(false)}
        companyId={relationship.companyId}
        driverMasterId={master.id}
        events={events}
        onSaveAction={(actionData) => {
          if (onAddCompanyAction) {
            onAddCompanyAction(actionData);
          }
          setIsCompanyActionModalOpen(false);
        }}
      />
    </div>
  );
}