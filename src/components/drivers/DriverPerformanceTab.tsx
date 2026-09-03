import React, { useState, useMemo } from "react";
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
  PerformanceEventType,
  PerformanceSeverity,
  EventStatus,
  PreventabilityAssessment,
  CollisionDetails,
  RoadsideInspectionDetails,
  CitationDetails,
  HOSViolationDetails,
  CustomerComplaintDetails,
  CommendationDetails,
  LinkedRecordRef,
  InspectionViolationItem,
  RootCauseFactor,
  TrainingRecord,
  HOSReview,
  CompanyDetermination,
  CompanyActionRecord,
} from "@/types/drivers";
import { ReadOnlyField } from "../shared/ReadOnlyField";
import { EntityLink } from "../shared/EntityLink";
import { fullLegalName } from "@/lib/driver-data";
import {
  calculateDriverPerformanceSnapshot,
  calculateFleetRankings,
} from "@/lib/driver-performance-model";
import { DriverIntelligenceView } from "./DriverIntelligenceView";
import { JURISDICTIONS } from "@/lib/jurisdictions";
import { DriverHOSAuditModal } from "./DriverHOSAuditModal";
import { DriverCompanyActionModal } from "./DriverCompanyActionModal";
import { EVENT_TYPES, EVENT_SEVERITIES, EVENT_STATUSES, PREVENTABILITY_STATES, COLLISION_TYPES, WEATHER_CONDITIONS, ROAD_CONDITIONS, LIGHT_CONDITIONS, INSPECTION_LEVELS, INSPECTION_RESULTS, REPAIR_STATUSES, HOS_RULE_JURISDICTIONS, HOS_RULE_PROFILES, HOS_VIOLATION_TYPES, HOS_SOURCES, HOS_REVIEW_STATUSES } from "@/lib/driver-taxonomy";

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
  onUpdateEvent: (eventId: string, patch: Partial<DriverPerformanceEvent>) => void;
  onAddHOSReview?: (review: Omit<HOSReview, "id" | "createdAt" | "updatedAt">) => void;
  onAddCompanyAction?: (action: Omit<CompanyActionRecord, "id" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onAddCompanyDetermination?: (det: Omit<CompanyDetermination, "id" | "createdAt" | "updatedAt" | "isArchived">) => void;
  onOpenDocument?: (docId: string) => void;
}

const EVENT_TYPE_DEFINITIONS = EVENT_TYPES.map((type) => ({ type, label: type, category: "Driver Event", description: type }));

export function DriverPerformanceTab({
  master,
  relationship,
  events,
  trainings = [],
  hosReviews = [],
  companyActions = [],
  companyDeterminations = [],
  allDriversCohort = [],
  onAddEvent,
  onUpdateEvent,
  onAddHOSReview,
  onAddCompanyAction,
  onAddCompanyDetermination,
  onOpenDocument,
}: DriverPerformanceTabProps) {
  // Sub-views
  const [subView, setSubView] = useState<"overview" | "intelligence" | "register" | "followup" | "hos" | "actions" | "chronology">("overview");

  // Filters for Event Register
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  // Selected event for detail view drawer/modal
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Time window for Performance Indicators
  const [metricsWindow, setMetricsWindow] = useState<"30D" | "90D" | "12M" | "YTD" | "ALL">("12M");

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeterminationModalOpen, setIsDeterminationModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isHOSAuditModalOpen, setIsHOSAuditModalOpen] = useState(false);
  const [auditingHOSEvent, setAuditingHOSEvent] = useState<DriverPerformanceEvent | null>(null);
  const [isCompanyActionModalOpen, setIsCompanyActionModalOpen] = useState(false);

  // Deterministic Performance Intelligence Snapshot
  const performanceSnapshot = useMemo(() => {
    return calculateDriverPerformanceSnapshot(
      master.id,
      relationship.companyDriverRecordId || relationship.id || master.id,
      events,
      trainings,
      metricsWindow
    );
  }, [master.id, relationship, events, trainings, metricsWindow]);

  // Fleet Cohort Rankings
  const fleetRankings = useMemo(() => {
    return calculateFleetRankings(allDriversCohort || [], master.id, metricsWindow);
  }, [allDriversCohort, metricsWindow, master.id]);

  // Progressive Disclosure Wizard State (Steps 1 to 6)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [selectedWizardType, setSelectedWizardType] = useState<PerformanceEventType>("Collision");

  // Form State initialized truthfully (NO hardcoded fictional values)
  const [commonForm, setCommonForm] = useState({
    eventDate: "",
    eventTime: "",
    reportedDate: new Date().toISOString().slice(0, 10),
    location: "",
    city: "",
    stateProvince: "",
    country: "" as "Canada" | "United States" | "",
    severity: "" as PerformanceSeverity | "",
    status: "Open" as EventStatus,
    summary: "",
    description: "",
    followUpActionRequired: false,
    followUpDueDate: "",
    followUpActionSummary: "",
  });

  // Type-specific form fields
  const [collisionForm, setCollisionForm] = useState<{
    collisionType: CollisionDetails["collisionType"] | "";
    driverMovement: string;
    weather: CollisionDetails["weather"] | "";
    roadCondition: CollisionDetails["roadCondition"] | "";
    lightCondition: CollisionDetails["lightCondition"] | "";
    towRequired: boolean;
    policeAttended: boolean;
    policeReportNumber: string;
    injuriesCount: number;
    fatalitiesCount: number;
    dotReportable: boolean;
    preventability: PreventabilityAssessment;
    preventabilityDeterminedBy: string;
    preventabilityDeterminationDate: string;
    preventabilitySource: string;
    preventabilityNotes: string;
    estimatedCost: string;
    driverStatement: string;
  }>({
    collisionType: "",
    driverMovement: "",
    weather: "",
    roadCondition: "",
    lightCondition: "",
    towRequired: false,
    policeAttended: false,
    policeReportNumber: "",
    injuriesCount: 0,
    fatalitiesCount: 0,
    dotReportable: false,
    preventability: "Undetermined",
    preventabilityDeterminedBy: "",
    preventabilityDeterminationDate: "",
    preventabilitySource: "",
    preventabilityNotes: "",
    estimatedCost: "",
    driverStatement: "",
  });

  const [inspectionForm, setInspectionForm] = useState<{
    inspectionLevel: RoadsideInspectionDetails["inspectionLevel"] | "";
    reportNumber: string;
    agency: string;
    result: RoadsideInspectionDetails["result"] | "";
    driverViolationsCount: number;
    vehicleViolationsCount: number;
    hosViolationsCount: number;
    driverOOS: boolean;
    vehicleOOS: boolean;
    hazmatInspected: boolean;
    repairStatus: "Not Required" | "Repair Pending" | "Completed" | "";
  }>({
    inspectionLevel: "",
    reportNumber: "",
    agency: "",
    result: "",
    driverViolationsCount: 0,
    vehicleViolationsCount: 0,
    hosViolationsCount: 0,
    driverOOS: false,
    vehicleOOS: false,
    hazmatInspected: false,
    repairStatus: "",
  });

  const [hosForm, setHosForm] = useState<{
    ruleJurisdiction: HOSViolationDetails["ruleJurisdiction"] | "";
    ruleProfileId: string;
    violationType: HOSViolationDetails["violationType"] | "";
    logDate: string;
    source: HOSViolationDetails["source"] | "";
    hoursExceeded: string;
    eldProvider: string;
    reviewStatus: NonNullable<HOSViolationDetails["reviewStatus"]> | "";
    reviewNotes: string;
  }>({
    ruleJurisdiction: "",
    ruleProfileId: "",
    violationType: "",
    logDate: "",
    source: "",
    hoursExceeded: "",
    eldProvider: "",
    reviewStatus: "",
    reviewNotes: "",
  });

  const [citationForm, setCitationForm] = useState<{
    citationNumber: string;
    violationCode: string;
    fineAmount: string;
    pointsAssessed: string;
    courtJurisdiction: string;
    courtDate: string;
    disposition: CitationDetails["disposition"] | "";
  }>({
    citationNumber: "",
    violationCode: "",
    fineAmount: "",
    pointsAssessed: "",
    courtJurisdiction: "",
    courtDate: "",
    disposition: "Pending",
  });

  const [complaintForm, setComplaintForm] = useState<{
    customerName: string;
    loadNumber: string;
    category: CustomerComplaintDetails["category"];
    substantiationStatus: CustomerComplaintDetails["substantiationStatus"];
    reviewNotes: string;
  }>({
    customerName: "",
    loadNumber: "",
    category: "Driving Conduct",
    substantiationStatus: "Unreviewed",
    reviewNotes: "",
  });

  const [commendationForm, setCommendationForm] = useState<{
    category: CommendationDetails["category"];
    customerName: string;
    recognizedBy: string;
    description: string;
  }>({
    category: "Customer Commendation",
    customerName: "",
    recognizedBy: "",
    description: "",
  });

  // Cross-module linked records draft
  const [linkedVehicleNumber, setLinkedVehicleNumber] = useState("");
  const [linkedTrailerNumber, setLinkedTrailerNumber] = useState("");
  const [linkedTrainingRef, setLinkedTrainingRef] = useState("");

  // Determination Modal State
  const [determinationData, setDeterminationData] = useState<{
    preventability: "Preventable" | "Non-Preventable" | "Undetermined";
    determinedBy: string;
    determinationDate: string;
    source: string;
    notes: string;
  }>({
    preventability: "Undetermined",
    determinedBy: "",
    determinationDate: "",
    source: "",
    notes: "",
  });

  // Filter Active Events
  const activeEvents = useMemo(() => {
    return events.filter((e) => !e.isArchived);
  }, [events]);

  const selectedEvent = useMemo(() => {
    return activeEvents.find((e) => e.id === selectedEventId) || null;
  }, [activeEvents, selectedEventId]);

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
    const preventableCollisions = collisions.filter((c) => c.collisionDetails?.preventability === "Preventable");
    const nonPreventableCollisions = collisions.filter((c) => c.collisionDetails?.preventability === "Non-Preventable");
    const undeterminedCollisions = collisions.filter((c) => !c.collisionDetails?.preventability || c.collisionDetails.preventability === "Undetermined");

    const inspections = filteredByWindow.filter((e) => e.eventType === "Roadside Inspection");
    const cleanInspections = inspections.filter((i) => i.inspectionDetails?.result === "Passed" && (i.inspectionDetails?.driverViolationsCount || 0) === 0);
    const driverOOSInspections = inspections.filter((i) => i.inspectionDetails?.driverOOS);

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
      cleanInspections: cleanInspections.length,
      driverOOSCount: driverOOSInspections.length,
      hosCount: hosViolations.length,
      citationsCount: citations.length,
      complaintsCount: complaints.length,
      commendationsCount: commendations.length,
      coachingsCount,
      openCapsCount,
    };
  }, [filteredByWindow, filteredActionsByWindow, companyActions]);

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
        if (statusFilter !== "all" && e.status !== statusFilter) return false;
        if (severityFilter !== "all" && e.severity !== severityFilter) return false;
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
  }, [activeEvents, typeFilter, statusFilter, severityFilter, searchTerm]);

  // Handlers for Creation
  const handleOpenAddWizard = () => {
    setWizardStep(1);
    setSelectedWizardType("Collision");
    setCommonForm({
      eventDate: "",
      eventTime: "",
      reportedDate: new Date().toISOString().slice(0, 10),
      location: "",
      city: "",
      stateProvince: "",
      country: "",
      severity: "",
      status: "Open",
      summary: "",
      description: "",
      followUpActionRequired: false,
      followUpDueDate: "",
      followUpActionSummary: "",
    });
    setCollisionForm({
      collisionType: "",
      driverMovement: "",
      weather: "",
      roadCondition: "",
      lightCondition: "",
      towRequired: false,
      policeAttended: false,
      policeReportNumber: "",
      injuriesCount: 0,
      fatalitiesCount: 0,
      dotReportable: false,
      preventability: "Undetermined",
      preventabilityDeterminedBy: "",
      preventabilityDeterminationDate: "",
      preventabilitySource: "",
      preventabilityNotes: "",
      estimatedCost: "",
      driverStatement: "",
    });
    setInspectionForm({
      inspectionLevel: "",
      reportNumber: "",
      agency: "",
      result: "",
      driverViolationsCount: 0,
      vehicleViolationsCount: 0,
      hosViolationsCount: 0,
      driverOOS: false,
      vehicleOOS: false,
      hazmatInspected: false,
      repairStatus: "",
    });
    setHosForm({
      ruleJurisdiction: "",
      ruleProfileId: "",
      violationType: "",
      logDate: "",
      source: "",
      hoursExceeded: "",
      eldProvider: "",
      reviewStatus: "",
      reviewNotes: "",
    });
    setCitationForm({
      citationNumber: "",
      violationCode: "",
      fineAmount: "",
      pointsAssessed: "",
      courtJurisdiction: "",
      courtDate: "",
      disposition: "Pending",
    });
    setComplaintForm({
      customerName: "",
      loadNumber: "",
      category: "Driving Conduct",
      substantiationStatus: "Unreviewed",
      reviewNotes: "",
    });
    setCommendationForm({
      category: "Customer Commendation",
      customerName: "",
      recognizedBy: "",
      description: "",
    });
    setLinkedVehicleNumber("");
    setLinkedTrailerNumber("");
    setLinkedTrainingRef("");
    setIsAddModalOpen(true);
  };

  const handleNextStep = () => {
    if (wizardStep === 2) {
      if (!commonForm.eventDate || !commonForm.summary.trim()) {
        alert("Please provide the event date and one-line summary before proceeding.");
        return;
      }
    }
    if (wizardStep === 3) {
      if (selectedWizardType === "Collision" && !collisionForm.collisionType) {
        alert("Please select a Collision Type before proceeding.");
        return;
      }
      if (selectedWizardType === "Roadside Inspection" && (!inspectionForm.inspectionLevel || !inspectionForm.result)) {
        alert("Please select the Inspection Level and Inspection Result before proceeding.");
        return;
      }
      if (
        selectedWizardType === "HOS Violation" &&
        (!hosForm.ruleJurisdiction || !hosForm.ruleProfileId || !hosForm.violationType || !hosForm.logDate || !hosForm.source)
      ) {
        alert("Please select Rule Jurisdiction, Violation Category, Log Date, and Detection Source before proceeding.");
        return;
      }
      if (selectedWizardType === "Customer Complaint" && !complaintForm.customerName.trim()) {
        alert("Please provide the Customer / Shipper Name before proceeding.");
        return;
      }
    }
    setWizardStep((prev) => (prev < 6 ? ((prev + 1) as any) : prev));
  };

  const handleSaveWizard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commonForm.summary.trim() || !commonForm.eventDate) {
      alert("Please provide an event date and summary.");
      return;
    }
    if (selectedWizardType === "Collision" && !collisionForm.collisionType) {
      alert("Please select a Collision Type.");
      return;
    }
    if (selectedWizardType === "Roadside Inspection" && (!inspectionForm.inspectionLevel || !inspectionForm.result)) {
      alert("Please select Inspection Level and Inspection Result.");
      return;
    }
    if (
      selectedWizardType === "HOS Violation" &&
      (!hosForm.ruleJurisdiction || !hosForm.violationType || !hosForm.logDate || !hosForm.source)
    ) {
      alert("Please select Rule Jurisdiction, Rule Profile, Violation Category, Log Date, and Detection Source.");
      return;
    }
    if (selectedWizardType === "Customer Complaint" && !complaintForm.customerName.trim()) {
      alert("Please provide the Customer Name.");
      return;
    }

    // Build linked records (preserve explicit unlinked operational references without manufactured entity IDs)
    const linked: LinkedRecordRef[] = [];
    if (linkedVehicleNumber.trim()) {
      linked.push({
        entityType: "Unlinked Operational Reference",
        id: "",
        label: `Unit: ${linkedVehicleNumber.trim()}`,
        secondaryText: "Unlinked Operational Reference (Manual Unit #)",
      });
    }
    if (linkedTrailerNumber.trim()) {
      linked.push({
        entityType: "Unlinked Operational Reference",
        id: "",
        label: `Trailer: ${linkedTrailerNumber.trim()}`,
        secondaryText: "Unlinked Operational Reference (Manual Trailer #)",
      });
    }
    if (linkedTrainingRef.trim()) {
      linked.push({
        entityType: "Training",
        id: linkedTrainingRef.trim(),
        label: `Training Ref: ${linkedTrainingRef.trim()}`,
      });
    }

    // Chronology item
    const initialChronology = [
      {
        id: `CHRON-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        action: "EVENT_LOGGED",
        actor: null,
        details: `Initial ${selectedWizardType} compliance record created.`,
      },
    ];

    const payload: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> = {
      eventType: selectedWizardType,
      eventDate: commonForm.eventDate,
      eventTime: commonForm.eventTime || undefined,
      reportedDate: commonForm.reportedDate,
      location: commonForm.location || undefined,
      city: commonForm.city || undefined,
      stateProvince: commonForm.stateProvince || undefined,
      country: commonForm.country || undefined,
      severity: commonForm.severity as PerformanceSeverity,
      status: commonForm.status,
      summary: commonForm.summary.trim(),
      description: commonForm.description.trim() || commonForm.summary.trim(),
      followUpActionRequired: commonForm.followUpActionRequired,
      followUpDueDate: commonForm.followUpDueDate || undefined,
      followUpActionSummary: commonForm.followUpActionSummary || undefined,
      linkedRecords: linked,
      evidenceIds: [],
      chronology: initialChronology,
    };

    if (selectedWizardType === "Collision") {
      payload.collisionDetails = {
        collisionType: collisionForm.collisionType as CollisionDetails["collisionType"],
        driverMovement: collisionForm.driverMovement || undefined,
        weather: (collisionForm.weather || undefined) as CollisionDetails["weather"] | undefined,
        roadCondition: (collisionForm.roadCondition || undefined) as CollisionDetails["roadCondition"] | undefined,
        lightCondition: (collisionForm.lightCondition || undefined) as CollisionDetails["lightCondition"] | undefined,
        towRequired: collisionForm.towRequired,
        policeAttended: collisionForm.policeAttended,
        policeReportNumber: collisionForm.policeReportNumber.trim() || undefined,
        injuriesCount: collisionForm.injuriesCount,
        fatalitiesCount: collisionForm.fatalitiesCount,
        dotReportable: collisionForm.dotReportable,
        preventability: collisionForm.preventability,
        preventabilityDeterminedBy: collisionForm.preventabilityDeterminedBy.trim() || undefined,
        preventabilityDeterminationDate: collisionForm.preventabilityDeterminationDate || undefined,
        preventabilitySource: collisionForm.preventabilitySource.trim() || undefined,
        preventabilityNotes: collisionForm.preventabilityNotes.trim() || undefined,
        estimatedCost: collisionForm.estimatedCost.trim() || undefined,
        driverStatement: collisionForm.driverStatement.trim() || undefined,
      };
    } else if (selectedWizardType === "Roadside Inspection") {
      payload.inspectionDetails = {
        inspectionLevel: inspectionForm.inspectionLevel as RoadsideInspectionDetails["inspectionLevel"],
        reportNumber: inspectionForm.reportNumber.trim() || undefined,
        agency: inspectionForm.agency.trim() || undefined,
        result: inspectionForm.result as RoadsideInspectionDetails["result"],
        driverViolationsCount: inspectionForm.driverViolationsCount,
        vehicleViolationsCount: inspectionForm.vehicleViolationsCount,
        hosViolationsCount: inspectionForm.hosViolationsCount,
        driverOOS: inspectionForm.driverOOS,
        vehicleOOS: inspectionForm.vehicleOOS,
        hazmatInspected: inspectionForm.hazmatInspected,
        repairStatus: (inspectionForm.repairStatus || undefined) as RoadsideInspectionDetails["repairStatus"] | undefined,
      };
    } else if (selectedWizardType === "HOS Violation") {
      payload.hosDetails = {
        ruleJurisdiction: hosForm.ruleJurisdiction as HOSViolationDetails["ruleJurisdiction"],
        ruleProfileId: hosForm.ruleProfileId || undefined,
        violationType: hosForm.violationType as HOSViolationDetails["violationType"],
        semanticConditionClass: HOS_VIOLATION_TYPES.find((v) => v.value === hosForm.violationType)?.semanticClass,
        logDate: hosForm.logDate,
        source: hosForm.source as HOSViolationDetails["source"],
        hoursExceeded: hosForm.hoursExceeded ? parseFloat(hosForm.hoursExceeded) : undefined,
        eldProvider: hosForm.eldProvider.trim() || undefined,
        reviewStatus: (hosForm.reviewStatus || undefined) as HOSViolationDetails["reviewStatus"] | undefined,
        reviewNotes: hosForm.reviewNotes.trim() || undefined,
      };
    } else if (selectedWizardType === "Traffic Citation") {
      payload.citationDetails = {
        citationNumber: citationForm.citationNumber.trim() || undefined,
        violationCode: citationForm.violationCode.trim() || undefined,
        fineAmount: citationForm.fineAmount.trim() || undefined,
        pointsAssessed: citationForm.pointsAssessed ? parseInt(citationForm.pointsAssessed, 10) : undefined,
        courtJurisdiction: citationForm.courtJurisdiction.trim() || undefined,
        courtDate: citationForm.courtDate || undefined,
        disposition: citationForm.disposition || undefined,
      };
    } else if (selectedWizardType === "Customer Complaint") {
      payload.complaintDetails = {
        customerName: complaintForm.customerName.trim(),
        loadNumber: complaintForm.loadNumber.trim() || undefined,
        category: complaintForm.category,
        substantiationStatus: complaintForm.substantiationStatus,
        reviewNotes: complaintForm.reviewNotes.trim() || undefined,
      };
    } else if (selectedWizardType === "Customer Commendation" || selectedWizardType === "Positive Safety Observation") {
      payload.commendationDetails = {
        category: commendationForm.category,
        customerName: commendationForm.customerName.trim() || undefined,
        recognizedBy: commendationForm.recognizedBy.trim() || undefined,
        description: commendationForm.description.trim() || undefined,
      };
    }

    onAddEvent(payload);
    setIsAddModalOpen(false);
  };

  const handleRecordDetermination = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || selectedEvent.eventType !== "Collision" || !selectedEvent.collisionDetails) {
      alert("Cannot record preventability determination: This event does not have an underlying collision details record.");
      return;
    }

    if (!determinationData.determinedBy.trim()) {
      alert("Please provide the name or title of the person/committee who made the determination.");
      return;
    }

    const updatedChronology = [
      ...(selectedEvent.chronology || []),
      {
        id: `CHRON-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        action: "PREVENTABILITY_DETERMINED",
        actor: determinationData.determinedBy,
        details: `Human Determination recorded as "${determinationData.preventability}". Source: ${determinationData.source}. ${determinationData.notes}`,
      },
    ];

    const updatedCollisionDetails: CollisionDetails = {
      ...selectedEvent.collisionDetails,
      preventability: determinationData.preventability,
      preventabilityDeterminedBy: determinationData.determinedBy,
      preventabilityDeterminationDate: determinationData.determinationDate,
      preventabilitySource: determinationData.source,
      preventabilityNotes: determinationData.notes,
    };

    onUpdateEvent(selectedEvent.id, {
      collisionDetails: updatedCollisionDetails,
      chronology: updatedChronology,
      updatedAt: new Date().toISOString(),
    });

    setIsDeterminationModalOpen(false);
  };

  const handleCloseEvent = () => {
    if (!selectedEvent) return;
    const updatedChronology = [
      ...(selectedEvent.chronology || []),
      {
        id: `CHRON-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        action: "EVENT_CLOSED",
        actor: null,
        details: "Event marked as Closed. All remediation and documentation finalized.",
      },
    ];

    onUpdateEvent(selectedEvent.id, {
      status: "Closed",
      followUpActionRequired: false,
      chronology: updatedChronology,
      updatedAt: new Date().toISOString(),
    });
    setIsCloseModalOpen(false);
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
            <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
              performanceSnapshot.overallScore >= 85
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : performanceSnapshot.overallScore >= 70
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "bg-rose-500/20 text-rose-700 dark:text-rose-300"
            }`}>
              {performanceSnapshot.overallScore}/100
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
            onClick={handleOpenAddWizard}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-3.5" />
            <span>Record Performance Event</span>
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
              <span className="text-[11px] font-semibold text-muted-foreground">Clean Inspections</span>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{stats.cleanInspections}</p>
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
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search event ID, summary, location, description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-xl border border-border bg-background py-1.5 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All Event Types</option>
                {EVENT_TYPE_DEFINITIONS.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All Statuses</option>
                {EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                <option value="all">All Severities</option>
                {EVENT_SEVERITIES.map((sev) => (
                  <option key={sev} value={sev}>
                    {sev}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table of Events */}
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 border-b border-border text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Event ID & Date</th>
                    <th className="px-4 py-3">Event Type</th>
                    <th className="px-4 py-3">Summary & Location</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Key Details</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {registerEvents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        No performance events found matching the selected filters.
                      </td>
                    </tr>
                  ) : (
                    registerEvents.map((evt) => (
                      <tr
                        key={evt.id}
                        onClick={() => setSelectedEventId(evt.id)}
                        className="cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-primary block">{evt.id}</span>
                          <span className="text-[11px] text-muted-foreground">{evt.eventDate}</span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">{evt.eventType}</td>
                        <td className="px-4 py-3 max-w-xs">
                          <p className="font-medium text-foreground line-clamp-1">{evt.summary}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{evt.location || "Location not specified"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              evt.severity === "Critical"
                                ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                : evt.severity === "High"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                : evt.severity === "Moderate"
                                ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {evt.severity}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              evt.status === "Closed"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : evt.status === "Follow-up Required"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            }`}
                          >
                            {evt.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground">
                          {evt.eventType === "Collision" && (
                            <span>
                              {evt.collisionDetails?.preventability || "Undetermined"} •{" "}
                              {evt.collisionDetails?.collisionType || "Collision"}
                            </span>
                          )}
                          {evt.eventType === "Roadside Inspection" && (
                            <span>
                              {evt.inspectionDetails?.result || "Inspected"} • Driver OOS:{" "}
                              {evt.inspectionDetails?.driverOOS ? "YES" : "No"}
                            </span>
                          )}
                          {evt.eventType === "HOS Violation" && (
                            <span>{HOS_VIOLATION_TYPES.find(x => x.value === evt.hosDetails?.violationType)?.label || evt.hosDetails?.legacyViolationType || "Duty Violation"}</span>
                          )}
                          {evt.eventType === "Customer Complaint" && (
                            <span>
                              {evt.complaintDetails?.customerName || "Customer"} ({evt.complaintDetails?.substantiationStatus})
                            </span>
                          )}
                          {evt.eventType === "Coaching Session" && (
                            <span>Topic: {evt.coachingDetails?.topic || "Safety"}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEventId(evt.id);
                            }}
                            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
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

      {/* SUBVIEW: PERFORMANCE INTELLIGENCE & EXPLAINABLE RATINGS */}
      {subView === "intelligence" && (
        <DriverIntelligenceView
          snapshot={performanceSnapshot}
          fleetRankings={fleetRankings}
          events={events}
          onSelectPeriod={(period) => setMetricsWindow(period)}
          onInspectEvent={(eventId) => setSelectedEventId(eventId)}
        />
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
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      selectedEvent.severity === "Critical"
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                        : selectedEvent.severity === "High"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    }`}
                  >
                    {selectedEvent.severity}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                      selectedEvent.status === "Closed"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    }`}
                  >
                    {selectedEvent.status}
                  </span>
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
                <ReadOnlyField label="Reported Date" value={selectedEvent.reportedDate} mono />
                <ReadOnlyField label="Location" value={selectedEvent.location || "Unspecified"} />
                <ReadOnlyField label="Jurisdiction / Country" value={`${selectedEvent.stateProvince || ""} ${selectedEvent.country || ""}`.trim() || "Unspecified"} />
              </div>

              {/* Full Description */}
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Full Event Narrative & Description
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
                      Preventability: {selectedEvent.collisionDetails.preventability}
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

                  {/* Preventability Details Box */}
                  <div className="rounded-lg bg-card border border-border p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-foreground">Human Preventability Determination:</span>
                      {selectedEvent.collisionDetails.preventabilityDeterminationDate && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          Determined: {selectedEvent.collisionDetails.preventabilityDeterminationDate}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      Determined By: {selectedEvent.collisionDetails.preventabilityDeterminedBy || "Pending Review"} • Source: {selectedEvent.collisionDetails.preventabilitySource || "Internal Review"}
                    </p>
                    {selectedEvent.collisionDetails.preventabilityNotes && (
                      <p className="text-xs text-foreground bg-muted/30 p-2 rounded">
                        Notes: {selectedEvent.collisionDetails.preventabilityNotes}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Roadside Inspection Specific Payload */}
              {selectedEvent.eventType === "Roadside Inspection" && selectedEvent.inspectionDetails && (
                <div className="rounded-xl border border-border p-4 bg-muted/10 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Roadside Inspection Details
                  </h4>

                  <div className="grid gap-3 sm:grid-cols-3 text-xs">
                    <ReadOnlyField label="Inspection Level" value={selectedEvent.inspectionDetails.inspectionLevel} />
                    <ReadOnlyField label="Enforcement Agency" value={selectedEvent.inspectionDetails.agency} />
                    <ReadOnlyField label="Report Number" value={selectedEvent.inspectionDetails.reportNumber || "Not recorded"} mono />
                    <ReadOnlyField label="Inspection Result" value={selectedEvent.inspectionDetails.result} />
                    <ReadOnlyField label="Driver Violations" value={String(selectedEvent.inspectionDetails.driverViolationsCount)} />
                    <ReadOnlyField label="Driver Out of Service" value={selectedEvent.inspectionDetails.driverOOS ? "YES (OOS)" : "No"} />
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
                    {selectedEvent.evidenceIds.map((evidenceId) => (
                      <button
                        key={evidenceId}
                        type="button"
                        onClick={() => onOpenDocument?.(evidenceId)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-primary hover:bg-muted"
                      >
                        <FileText className="size-3.5" />
                        Open {evidenceId}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No evidence is linked to this performance event.
                  </div>
                )}
              </div>

              {/* Linked Records */}
              {selectedEvent.linkedRecords && selectedEvent.linkedRecords.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    Linked Commercial Fleet Records
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {selectedEvent.linkedRecords.map((lk) => (
                      <div
                        key={lk.id}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-1.5 text-xs font-medium text-foreground"
                      >
                        <span className="font-bold text-primary">[{lk.entityType}]</span>
                        <span>{lk.label}</span>
                        {lk.secondaryText && <span className="text-muted-foreground text-[10px]">({lk.secondaryText})</span>}
                      </div>
                    ))}
                  </div>
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
                {selectedEvent.status !== "Closed" && (
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

      {/* PROGRESSIVE DISCLOSURE EVENT CREATION WIZARD (Phase 33) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden my-8">
            {/* Wizard Header */}
            <div className="bg-muted/40 px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Record Commercial Performance Event</h3>
                <p className="text-xs text-muted-foreground">
                  Step {wizardStep} of 6:{" "}
                  {wizardStep === 1 && "Select Event Classification"}
                  {wizardStep === 2 && "Core Facts & Chronology Spine"}
                  {wizardStep === 3 && `Type-Specific Details (${selectedWizardType})`}
                  {wizardStep === 4 && "Link Related TES Records"}
                  {wizardStep === 5 && "Evidence & Documents"}
                  {wizardStep === 6 && "Review & Commit"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Wizard Step Content */}
            <form onSubmit={handleSaveWizard} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {/* STEP 1: Select Event Type */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 flex items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <span className="font-bold text-foreground block">Looking to record Coaching, Disciplinary Action, or a CAP?</span>
                      <span className="text-muted-foreground block text-[11px]">
                        Carrier corrective actions, counseling sessions, warnings, and remediation plans are recorded directly under Carrier Company Actions.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddModalOpen(false);
                        setIsCompanyActionModalOpen(true);
                      }}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
                    >
                      Record Company Action
                    </button>
                  </div>

                  <span className="text-xs font-bold text-foreground block">
                    Choose the regulatory or operational event category:
                  </span>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {EVENT_TYPE_DEFINITIONS.map((t) => (
                      <button
                        key={t.type}
                        type="button"
                        onClick={() => setSelectedWizardType(t.type)}
                        className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                          selectedWizardType === t.type
                            ? "border-primary bg-primary/5 shadow-2xs"
                            : "border-border bg-background hover:bg-muted/40"
                        }`}
                      >
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                            selectedWizardType === t.type
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <FileText className="size-4" />
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-foreground block">{t.label}</span>
                          <span className="text-[11px] text-muted-foreground leading-snug block">
                            {t.description}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 2: Core Facts Spine */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-bold text-foreground">Event Date *</label>
                      <input
                        type="date"
                        required
                        value={commonForm.eventDate}
                        onChange={(e) => setCommonForm({ ...commonForm, eventDate: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground">Event Time (24h)</label>
                      <input
                        type="time"
                        value={commonForm.eventTime}
                        onChange={(e) => setCommonForm({ ...commonForm, eventTime: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground">Severity Level *</label>
                      <select
                        value={commonForm.severity}
                        onChange={(e) => setCommonForm({ ...commonForm, severity: e.target.value as PerformanceSeverity })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      >
                        <option value="">-- Select Severity --</option>
                        {EVENT_SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground">Initial Status *</label>
                      <select
                        value={commonForm.status}
                        onChange={(e) => setCommonForm({ ...commonForm, status: e.target.value as EventStatus })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      >
                        {EVENT_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-xs font-bold text-foreground">Location Description / Highway / Milepost</label>
                      <input
                        type="text"
                        placeholder="e.g. Hwy 401 Eastbound near Exit 328"
                        value={commonForm.location}
                        onChange={(e) => setCommonForm({ ...commonForm, location: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground">City / Municipality</label>
                      <input
                        type="text"
                        placeholder="e.g. Milton"
                        value={commonForm.city}
                        onChange={(e) => setCommonForm({ ...commonForm, city: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground">Province / State & Country</label>
                      <div className="flex gap-2 mt-1">
                        <select value={commonForm.stateProvince} onChange={(e) => setCommonForm({ ...commonForm, stateProvince: e.target.value })} className="w-1/3 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
                          <option value="">-- State / Province --</option>
                          {JURISDICTIONS.filter(j => !commonForm.country || j.country === commonForm.country).map(j => <option key={j.code} value={j.code}>{j.code}</option>)}
                        </select>
                        <select value={commonForm.country} onChange={(e) => setCommonForm({ ...commonForm, country: e.target.value as "Canada" | "United States" | "", stateProvince: "" })} className="w-2/3 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
                          <option value="">-- Country --</option><option value="Canada">Canada</option><option value="United States">United States</option>
                        </select>
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-xs font-bold text-foreground">One-Line Executive Summary *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Backing contact with warehouse dock frame"
                        value={commonForm.summary}
                        onChange={(e) => setCommonForm({ ...commonForm, summary: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-xs font-bold text-foreground">Detailed Description / Statement</label>
                      <textarea
                        rows={3}
                        placeholder="Provide detailed narrative facts as reported..."
                        value={commonForm.description}
                        onChange={(e) => setCommonForm({ ...commonForm, description: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Type-Specific Details */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  {selectedWizardType === "Collision" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-bold text-foreground">Collision Type *</label>
                        <select
                          value={collisionForm.collisionType}
                          onChange={(e) => setCollisionForm({ ...collisionForm, collisionType: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select collision type...</option>
                          {COLLISION_TYPES.map((ct) => (
                            <option key={ct} value={ct}>
                              {ct}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Weather Condition</label>
                        <select
                          value={collisionForm.weather}
                          onChange={(e) => setCollisionForm({ ...collisionForm, weather: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select weather condition...</option>
                          {WEATHER_CONDITIONS.map((w) => (
                            <option key={w} value={w}>
                              {w}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Road Surface</label>
                        <select
                          value={collisionForm.roadCondition}
                          onChange={(e) => setCollisionForm({ ...collisionForm, roadCondition: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select road surface condition...</option>
                          {ROAD_CONDITIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Lighting</label>
                        <select
                          value={collisionForm.lightCondition}
                          onChange={(e) => setCollisionForm({ ...collisionForm, lightCondition: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select lighting condition...</option>
                          {LIGHT_CONDITIONS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-4 sm:col-span-2 pt-2">
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={collisionForm.towRequired}
                            onChange={(e) => setCollisionForm({ ...collisionForm, towRequired: e.target.checked })}
                            className="rounded border-border"
                          />
                          <span>Vehicle Towed from Scene</span>
                        </label>

                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={collisionForm.policeAttended}
                            onChange={(e) => setCollisionForm({ ...collisionForm, policeAttended: e.target.checked })}
                            className="rounded border-border"
                          />
                          <span>Police Attended Scene</span>
                        </label>

                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={collisionForm.dotReportable}
                            onChange={(e) => setCollisionForm({ ...collisionForm, dotReportable: e.target.checked })}
                            className="rounded border-border"
                          />
                          <span>DOT / FMCSA Reportable</span>
                        </label>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Police Report # (if issued)</label>
                        <input
                          type="text"
                          placeholder="Optional police report number"
                          value={collisionForm.policeReportNumber}
                          onChange={(e) => setCollisionForm({ ...collisionForm, policeReportNumber: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Estimated Damage ($)</label>
                        <input
                          type="text"
                          placeholder="e.g. $1,200.00"
                          value={collisionForm.estimatedCost}
                          onChange={(e) => setCollisionForm({ ...collisionForm, estimatedCost: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {selectedWizardType === "Roadside Inspection" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-bold text-foreground">Inspection Level *</label>
                        <select
                          value={inspectionForm.inspectionLevel}
                          onChange={(e) => setInspectionForm({ ...inspectionForm, inspectionLevel: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select inspection level...</option>
                          {INSPECTION_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Inspection Result *</label>
                        <select
                          value={inspectionForm.result}
                          onChange={(e) => setInspectionForm({ ...inspectionForm, result: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select inspection result...</option>
                          {INSPECTION_RESULTS.map((res) => (
                            <option key={res} value={res}>
                              {res}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Enforcement Agency</label>
                        <input
                          type="text"
                          placeholder="e.g. Ontario Ministry of Transportation (MTO)"
                          value={inspectionForm.agency}
                          onChange={(e) => setInspectionForm({ ...inspectionForm, agency: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Inspection Report #</label>
                        <input
                          type="text"
                          placeholder="Report / Citation reference"
                          value={inspectionForm.reportNumber}
                          onChange={(e) => setInspectionForm({ ...inspectionForm, reportNumber: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Vehicle Repair Status</label>
                        <select
                          value={inspectionForm.repairStatus}
                          onChange={(e) => setInspectionForm({ ...inspectionForm, repairStatus: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select repair status...</option>
                          {REPAIR_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-4 sm:col-span-2 pt-2">
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={inspectionForm.driverOOS}
                            onChange={(e) => setInspectionForm({ ...inspectionForm, driverOOS: e.target.checked })}
                            className="rounded border-border"
                          />
                          <span className="font-bold text-rose-600">Driver Placed Out of Service (OOS)</span>
                        </label>

                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={inspectionForm.vehicleOOS}
                            onChange={(e) => setInspectionForm({ ...inspectionForm, vehicleOOS: e.target.checked })}
                            className="rounded border-border"
                          />
                          <span>Vehicle Placed Out of Service</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {selectedWizardType === "HOS Violation" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-bold text-foreground">Rule Jurisdiction *</label>
                        <select
                          value={hosForm.ruleJurisdiction}
                          onChange={(e) => setHosForm({ ...hosForm, ruleJurisdiction: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select rule jurisdiction...</option>
                          {HOS_RULE_JURISDICTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Rule Profile *</label>
                        <select
                          value={hosForm.ruleProfileId}
                          onChange={(e) => setHosForm({ ...hosForm, ruleProfileId: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select rule profile...</option>
                          {HOS_RULE_PROFILES.filter((profile) => !hosForm.ruleJurisdiction || profile.value.startsWith(hosForm.ruleJurisdiction + "_") || profile.value === hosForm.ruleJurisdiction).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Violation Category *</label>
                        <select
                          value={hosForm.violationType}
                          onChange={(e) => setHosForm({ ...hosForm, violationType: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select violation category...</option>
                          {HOS_VIOLATION_TYPES.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Log Date *</label>
                        <input
                          type="date"
                          value={hosForm.logDate}
                          onChange={(e) => setHosForm({ ...hosForm, logDate: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Detection / Review Status</label>
                        <select value={hosForm.reviewStatus} onChange={(e) => setHosForm({ ...hosForm, reviewStatus: e.target.value as NonNullable<HOSViolationDetails["reviewStatus"]> })} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none">
                          <option value="">-- Not Established --</option>
                          {HOS_REVIEW_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Detection Source *</label>
                        <select
                          value={hosForm.source}
                          onChange={(e) => setHosForm({ ...hosForm, source: e.target.value as any })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        >
                          <option value="">Select detection source...</option>
                          {HOS_SOURCES.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {selectedWizardType === "Customer Complaint" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-bold text-foreground">Customer / Shipper Name *</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Metro Distribution Center"
                          value={complaintForm.customerName}
                          onChange={(e) => setComplaintForm({ ...complaintForm, customerName: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-foreground">Load / BOL Reference</label>
                        <input
                          type="text"
                          placeholder="e.g. LD-88192"
                          value={complaintForm.loadNumber}
                          onChange={(e) => setComplaintForm({ ...complaintForm, loadNumber: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: Cross-Module Links */}
              {wizardStep === 4 && (
                <div className="space-y-4">
                  <span className="text-xs font-bold text-foreground block">
                    Associate with other operational entities in TES:
                  </span>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-bold text-foreground">Power Unit / Tractor #</label>
                      <input
                        type="text"
                        placeholder="e.g. 101"
                        value={linkedVehicleNumber}
                        onChange={(e) => setLinkedVehicleNumber(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-foreground">Trailer Unit #</label>
                      <input
                        type="text"
                        placeholder="e.g. 902"
                        value={linkedTrailerNumber}
                        onChange={(e) => setLinkedTrailerNumber(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-xs font-bold text-foreground">Linked Training Record ID</label>
                      <input
                        type="text"
                        placeholder="e.g. TRN-000047"
                        value={linkedTrainingRef}
                        onChange={(e) => setLinkedTrainingRef(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: Evidence & Follow-up Setting */}
              {wizardStep === 5 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-foreground">
                      <input
                        type="checkbox"
                        checked={commonForm.followUpActionRequired}
                        onChange={(e) => setCommonForm({ ...commonForm, followUpActionRequired: e.target.checked })}
                        className="rounded border-border"
                      />
                      <span>Flag this event for active compliance follow-up</span>
                    </label>

                    {commonForm.followUpActionRequired && (
                      <div className="space-y-3 pt-2">
                        <div>
                          <label className="text-xs font-bold text-foreground">Follow-up Target Due Date</label>
                          <input
                            type="date"
                            value={commonForm.followUpDueDate}
                            onChange={(e) => setCommonForm({ ...commonForm, followUpDueDate: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-bold text-foreground">Follow-up Action Summary</label>
                          <textarea
                            rows={2}
                            placeholder="Specify required follow-up deliverables or investigation tasks..."
                            value={commonForm.followUpActionSummary}
                            onChange={(e) => setCommonForm({ ...commonForm, followUpActionSummary: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 6: Review & Commit */}
              {wizardStep === 6 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <span className="text-xs font-bold text-foreground">Event Summary Review</span>
                      <span className="text-xs font-bold text-primary">{selectedWizardType}</span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Event Date:</span>
                        <span className="font-bold text-foreground">{commonForm.eventDate}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Severity:</span>
                        <span className="font-bold text-foreground">{commonForm.severity}</span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground block text-[11px]">Summary:</span>
                        <span className="font-bold text-foreground">{commonForm.summary}</span>
                      </div>
                      {commonForm.location && (
                        <div className="sm:col-span-2">
                          <span className="text-muted-foreground block text-[11px]">Location:</span>
                          <span className="text-foreground">{commonForm.location}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Wizard Footer Navigation */}
              <div className="bg-muted/40 -mx-6 -mb-6 px-6 py-4 border-t border-border flex items-center justify-between">
                {wizardStep > 1 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep((prev) => (prev - 1) as any)}
                    className="rounded-xl border border-border bg-background px-4 py-2 text-xs font-bold text-foreground hover:bg-muted"
                  >
                    Back
                  </button>
                ) : (
                  <div />
                )}

                {wizardStep < 6 ? (
                  <button
                    type="button"
                    onClick={handleNextStep}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                  >
                    <span>Next Step</span>
                    <ArrowRight className="size-3.5" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                  >
                    <CheckCircle2 className="size-4" />
                    <span>Commit Performance Event</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
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
