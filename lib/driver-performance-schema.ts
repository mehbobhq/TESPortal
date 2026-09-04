import type { EventType, SemanticState } from "@/types/drivers";

export type PerformanceFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "time"
  | "boolean"
  | "select";

export interface ControlledOption { value: string; label: string }

export type PerformanceValueType = "string" | "number" | "boolean" | "date" | "time" | "duration" | "measurement";

export interface PerformanceFieldDefinition {
  key: string;
  dataPointId: string;
  valueType: PerformanceValueType;
  label: string;
  kind: PerformanceFieldKind;
  required?: boolean;
  options?: readonly ControlledOption[];
  placeholder?: string;
  helpText?: string;
  unit?: string;
  unitOptions?: readonly string[];
}

export interface PerformanceCategoryDefinition {
  code: string;
  value: EventType;
  label: string;
  description: string;
  group: "Safety" | "Regulatory" | "Operations" | "Customer" | "Security" | "Positive" | "HOS / Telematics";
  sources: readonly string[];
  evidenceRequired: boolean;
  determinationTypes: readonly string[];
  analyticsEligible: boolean;
  positiveEligible: boolean;
  temporalBehavior: "Occurrence" | "Measured Interval" | "Lifecycle";
  usesSeverity?: boolean;
  usesStatus?: boolean;
  fields: readonly PerformanceFieldDefinition[];
}

const options = {
  collisionType: ["Rear-End", "Sideswipe", "Backing", "Intersection", "Lane Change", "Rollover", "Jackknife", "Fixed Object", "Animal", "Pedestrian", "Other"],
  weather: ["Clear", "Rain", "Snow", "Fog", "Ice / Freezing Rain", "High Wind", "Other", "Unknown"],
  road: ["Dry", "Wet", "Snow Covered", "Icy", "Gravel", "Construction", "Other", "Unknown"],
  lighting: ["Daylight", "Dawn / Dusk", "Dark — Lighted", "Dark — Unlighted", "Unknown"],
  result: ["Passed", "Violation(s) Found", "Out of Service"],
  source: ["Driver Report", "Company Staff", "Roadside Inspection", "ELD / Telematics", "Camera", "Customer", "Citation", "Maintenance", "Training", "Other"],
  zone: ["Urban", "Rural", "Highway", "Work Zone", "School Zone", "Rail Crossing", "Customer Site", "Other", "Unknown"],
  loadStatus: ["Loaded", "Empty", "Partial", "Unknown"],
  trigger: ["ELD / Telematics", "Forward Camera", "Driver Report", "Roadside Inspection", "Customer", "Other"],
  verification: ["Unverified", "Partially Verified", "Verified", "Unable to Verify"],
  dispute: ["Not Disputed", "Disputed", "Resolved"],
  dataIntegrity: ["DEVICE_MALFUNCTION", "DATA_ANOMALY", "SUSPECTED_TAMPERING", "CONFIRMED_TAMPERING"],
  operationalResult: ["On Time", "Late", "Early", "Cancelled", "Unable to Determine"],
  securityType: ["Theft", "Unauthorized Access", "Threat", "Fraud Indicator", "Security Breach", "Other"],
  cargoType: ["Damage", "Shortage", "Loss", "Contamination", "Securement Concern", "Other"],
  emergencyType: ["Fire", "Medical Emergency", "Weather Emergency", "Road Closure", "Vehicle Failure", "Security Emergency", "Other"],
  complaintCategory: ["Driving Conduct", "Communication", "Delivery Delay", "Cargo Handling", "Site / Shipper Conduct", "Documentation", "Other"],
  complaintState: ["Unreviewed", "Under Review", "Substantiated", "Not Substantiated", "Unable to Determine", "Closed"],
  citationDisposition: ["Pending", "Paid", "Contested", "Dismissed", "Guilty"],
  observationType: ["Safe Driving", "Procedure Compliance", "Customer Service", "Equipment Care", "Other"],
  violationType: ["Traffic", "Operational", "Safety", "Documentation", "Regulatory", "Other"],
  severityBand: ["Low", "Moderate", "High", "Critical"],
};

const machineValue = (label: string) => label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "UNKNOWN";
const toOptions = (values: readonly string[] | readonly ControlledOption[]) => values.map((item) => typeof item === "string" ? ({ value: machineValue(item), label: item }) : item);
const SHARED_DATA_POINT_IDS: Readonly<Record<string, string>> = {
  weather: "DRV.PERF.SHARED.WEATHER_CONDITION", roadCondition: "DRV.PERF.SHARED.ROAD_SURFACE", roadSurface: "DRV.PERF.SHARED.ROAD_SURFACE", road: "DRV.PERF.SHARED.ROAD_SURFACE",
  lightCondition: "DRV.PERF.SHARED.LIGHTING_CONDITION", lighting: "DRV.PERF.SHARED.LIGHTING_CONDITION", traffic: "DRV.PERF.SHARED.TRAFFIC_CONDITION",
  loadStatus: "DRV.PERF.SHARED.LOAD_STATE", dutyContext: "DRV.PERF.SHARED.DUTY_CONTEXT", zoneType: "DRV.PERF.SHARED.ZONE_TYPE"
};
const dataPointIdFor = (key: string) => SHARED_DATA_POINT_IDS[key] || `DRV.PERF.${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
const f = (key: string, label: string, kind: PerformanceFieldKind, extra: Partial<PerformanceFieldDefinition> = {}): PerformanceFieldDefinition => ({ key, label, kind, dataPointId: extra.dataPointId || dataPointIdFor(key), valueType: extra.valueType || (kind === "number" ? "number" : kind === "boolean" ? "boolean" : kind === "date" ? "date" : kind === "time" ? "time" : kind === "select" ? "string" : "string"), ...extra });
const text = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "text", extra);
const select = (key: string, label: string, values: readonly string[] | readonly ControlledOption[], extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "select", { ...extra, options: toOptions(values) });
const number = (key: string, label: string, unit?: string, extra: Partial<PerformanceFieldDefinition> = {}) => {
  const unitOptions = unit === "mph / km/h" || unit === "speed unit" ? ["MPH", "KMH"] : unit === "miles / km" ? ["MI", "KM"] : unit === "m/s²" ? ["MPS2", "FTPS2", "G"] : undefined;
  const canonicalUnit = unitOptions ? undefined : unit;
  return f(key, label, "number", { ...extra, unit: canonicalUnit, unitOptions, valueType: canonicalUnit && ["seconds","minutes","hours"].includes(canonicalUnit) ? "duration" : "measurement" });
};
const bool = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "boolean", extra);
const date = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "date", extra);
const time = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "time", extra);
const area = (key: string, label: string, extra: Partial<PerformanceFieldDefinition> = {}) => f(key, label, "textarea", extra);

const base: PerformanceFieldDefinition[] = [
  select("sourceType", "Source", options.source, { required: true }),
  text("sourceRecordId", "Source Record ID", { helpText: "Use the authoritative source identifier when one exists." }),
];

export type PerformanceCategoryOwnership = "RECORDABLE_EVENT" | "LEGACY_READ_ONLY" | "COMPANY_ACTION" | "AUTHORITATIVE_LINKED_RECORD" | "SPECIALIZED_WORKSPACE_RECORD" | "ALIAS";

export const PERFORMANCE_CATEGORY_OWNERSHIP: Readonly<Record<EventType, PerformanceCategoryOwnership>> = {
  "Collision": "RECORDABLE_EVENT", "Near Miss": "RECORDABLE_EVENT", "Roadside Inspection": "RECORDABLE_EVENT", "Out-of-Service Order": "RECORDABLE_EVENT",
  "HOS Violation": "AUTHORITATIVE_LINKED_RECORD", "Traffic Citation": "AUTHORITATIVE_LINKED_RECORD", "Cargo Damage": "RECORDABLE_EVENT", "Cargo Theft": "RECORDABLE_EVENT",
  "Spill or Release": "RECORDABLE_EVENT", "Customer Complaint": "RECORDABLE_EVENT", "Customer Commendation": "RECORDABLE_EVENT", "Positive Safety Observation": "ALIAS",
  "Coaching Session": "COMPANY_ACTION", "Disciplinary Action": "COMPANY_ACTION", "Corrective Action Plan": "COMPANY_ACTION", "Injury": "RECORDABLE_EVENT",
  "Security Incident": "RECORDABLE_EVENT", "Warning": "RECORDABLE_EVENT", "Violation": "RECORDABLE_EVENT", "Citation-linked Event": "LEGACY_READ_ONLY",
  "Equipment-related Event": "ALIAS", "Equipment Failure / Critical Defect": "RECORDABLE_EVENT", "Safety Observation": "RECORDABLE_EVENT", "Customer Compliment": "ALIAS", "Telematics / Camera Observation": "SPECIALIZED_WORKSPACE_RECORD",
  "Security Event": "ALIAS", "Emergency Event": "RECORDABLE_EVENT", "Speeding": "RECORDABLE_EVENT", "Harsh Braking": "RECORDABLE_EVENT", "Harsh Acceleration": "RECORDABLE_EVENT",
  "Harsh Cornering": "RECORDABLE_EVENT", "Following Distance": "RECORDABLE_EVENT", "Fatigue Indicator": "RECORDABLE_EVENT", "Device / Data Integrity": "RECORDABLE_EVENT",
  "Trip Completion / Service Performance": "RECORDABLE_EVENT", "Lane Departure": "RECORDABLE_EVENT", "Seatbelt": "RECORDABLE_EVENT", "Distracted Driving": "RECORDABLE_EVENT",
  "Idle Time": "RECORDABLE_EVENT", "Route Deviation": "RECORDABLE_EVENT", "Backing": "RECORDABLE_EVENT", "Stop Sign / Red Light": "RECORDABLE_EVENT", "Railroad Crossing": "RECORDABLE_EVENT",
  "Customer-Site Behavior": "RECORDABLE_EVENT", "PPE / Safety Protocol": "RECORDABLE_EVENT"
};



const DRIVER_PERFORMANCE_CATEGORY_REGISTRY_RAW: readonly PerformanceCategoryDefinition[] = [
  {
    code: "COLLISION", value: "Collision", label: "Collision", description: "A vehicle collision or physical contact occurrence requiring factual, consequence, and evidence capture.", group: "Safety", sources: options.source, evidenceRequired: true, determinationTypes: ["COLLISION_PREVENTABILITY", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("collisionType", "Collision Configuration", options.collisionType, { required: true }), text("otherPartyObject", "Other Party / Object"), select("weather", "Weather", options.weather), select("roadCondition", "Road Surface", options.road), select("lightCondition", "Lighting", options.lighting), number("speedAtOccurrence", "Speed at Occurrence", "mph / km/h"), number("injuriesCount", "Injuries", "count"), number("fatalitiesCount", "Fatalities", "count"), bool("towRequired", "Tow-Away"), bool("policeAttended", "Police Attended"), text("policeReportNumber", "Police Report Number"), bool("propertyDamage", "Property Damage"), select("reportabilityResult", "Reportability Result", ["Reportable", "Not Reportable", "Unable to Determine"], { helpText: "Preserve the governing jurisdiction/rule context in the reportability determination fields." }), number("downtimeHours", "Downtime", "hours"), area("driverStatement", "Driver Statement"), area("investigationNotes", "Investigation Narrative"), ...base],
  },
  {
    code: "NEAR_MISS", value: "Near Miss", label: "Near Miss", description: "A close call without actual contact where a collision or serious incident could reasonably have occurred.", group: "Safety", sources: options.source, evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS", "INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("nearMissType", "Near-Miss Configuration", ["Rear-End Risk", "Lane Conflict", "Pedestrian Conflict", "Intersection Conflict", "Backing Conflict", "Rollover Risk", "Other"], { required: true }), select("triggerSource", "Trigger Source", options.trigger, { required: true }), text("otherPartyObject", "Other Party / Object"), number("distanceToImpact", "Distance to Impact", "m"), number("timeToCollision", "Time to Collision", "s"), number("speed", "Vehicle Speed", "mph / km/h"), text("avoidanceAction", "Avoidance Action"), select("zoneType", "Zone Type", options.zone), area("contextNotes", "Context / Circumstances"), ...base],
  },
  {
    code: "ROADSIDE_INSPECTION", value: "Roadside Inspection", label: "Roadside Inspection", description: "An enforcement inspection with inspection level, result, violations, and linked regulatory evidence.", group: "Regulatory", sources: ["Roadside Inspection", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("jurisdiction", "Jurisdiction", ["US", "CA"], { required: true }), select("inspectionRegime", "Inspection Regime", ["US_CVSA", "CA_NSC_CVSA", "OTHER"], { required: true }), select("inspectionClassification", "Inspection Level / Type", ["US_LEVEL_I", "US_LEVEL_II", "US_LEVEL_III", "US_LEVEL_IV", "US_LEVEL_V", "US_LEVEL_VI", "US_LEVEL_VII", "US_LEVEL_VIII", "CA_TYPE_1", "CA_TYPE_2", "CA_TYPE_3", "CA_TYPE_4", "CA_TYPE_5", "OTHER"], { required: true }), text("agency", "Enforcement Agency"), text("inspectionReportNumber", "Inspection Report Number"), select("inspectionResult", "Inspection Result", [{ value: "CLEAN", label: "Clean" }, { value: "VIOLATIONS_FOUND", label: "Violations Found" }, { value: "OUT_OF_SERVICE", label: "Out of Service" }, { value: "OTHER_REVIEW_REQUIRED", label: "Other / Review Required" }], { required: true }), number("driverViolationsCount", "Driver Violations", "count"), number("vehicleViolationsCount", "Vehicle Violations", "count"), number("hosViolationsCount", "HOS Violations", "count"), bool("driverOOS", "Driver OOS Issued"), bool("vehicleOOS", "Vehicle OOS Issued"), bool("hazmatInspected", "Hazmat Inspected"), text("oosType", "OOS Type"), date("oosReleaseDate", "OOS Release Date"), text("linkedRepairRecordId", "Linked Repair Record ID"), ...base],
  },
  {
    code: "OUT_OF_SERVICE_ORDER", value: "Out-of-Service Order", label: "Out-of-Service Order", description: "A documented out-of-service order and its governing source, scope, release, and evidence.", group: "Regulatory", sources: ["Roadside Inspection", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [text("orderNumber", "Order / Notice Number", { required: true }), text("issuingAgency", "Issuing Agency"), text("oosType", "OOS Type"), date("issuedDate", "Issued Date", { required: true }), date("releaseDate", "Release Date"), text("releaseAuthority", "Release Authority"), area("basis", "Order Basis"), ...base],
  },
  {
    code: "HOS_VIOLATION", value: "HOS Violation", label: "HOS Violation", description: "A source-supported HOS condition linked to the existing HOS source, calculation, and review architecture.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Roadside Inspection", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("ruleJurisdiction", "Rule Jurisdiction", ["CA_FEDERAL", "US_FMCSA", "US_TEXAS_INTRASTATE", "US_CALIFORNIA_INTRASTATE", "Canada (Federal 70h/7d)", "US (FMCSA 70h/8d)", "Texas Intrastate", "California Intrastate"], { required: true }), text("ruleProfileId", "Rule Profile ID", { required: true }), text("violationType", "Violation Type", { required: true }), date("logDate", "Log Date", { required: true }), select("detectionSource", "Detection Source", ["ELD Live Telematics", "Roadside Inspection", "Internal Audit"], { required: true }), number("hoursExceeded", "Hours Exceeded", "hours"), text("eldProvider", "ELD / Provider"), select("reviewStatus", "Review State", ["Potential", "Under Review", "Confirmed", "Not a Violation", "Unable to Determine", "Disputed", "Resolved"]), area("reviewNotes", "Review Notes"), ...base],
  },
  {
    code: "TRAFFIC_CITATION", value: "Traffic Citation", label: "Traffic Citation", description: "A traffic citation occurrence linked to the authoritative Citation record when available.", group: "Regulatory", sources: ["Citation", "Roadside Inspection", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("citationNumber", "Citation Number", { helpText: "Prefer the canonical Citation relationship when available." }), text("violationCode", "Violation Code"), number("fineAmount", "Fine Amount", "currency"), number("pointsAssessed", "Points Assessed", "points"), text("courtJurisdiction", "Court Jurisdiction"), date("courtDate", "Court Date"), select("disposition", "Disposition", options.citationDisposition), ...base],
  },
  {
    code: "CARGO_DAMAGE", value: "Cargo Damage", label: "Cargo Damage", description: "Documented cargo damage with measurable scope, context, and evidence.", group: "Operations", sources: ["Driver Report", "Customer", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("cargoIssueType", "Cargo Issue", options.cargoType, { required: true }), text("cargoReference", "Load / Cargo Reference"), text("cargoDescription", "Cargo Description"), number("quantityAffected", "Quantity Affected", "count"), number("estimatedLossAmount", "Estimated Loss", "currency"), bool("packagingFailure", "Packaging Failure Observed"), bool("securementConcern", "Securement Concern"), area("damageNotes", "Damage Narrative"), ...base],
  },
  {
    code: "CARGO_THEFT", value: "Cargo Theft", label: "Cargo Theft", description: "A documented cargo loss/theft occurrence with chain-of-custody and security facts.", group: "Security", sources: ["Driver Report", "Customer", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("cargoReference", "Load / Cargo Reference", { required: true }), number("estimatedLossAmount", "Estimated Loss", "currency"), text("lastKnownLocation", "Last Known Location"), date("lastKnownDate", "Last Known Date"), text("securityReference", "Security / Police Reference"), bool("sealCompromised", "Seal Compromised"), area("theftNarrative", "Theft / Loss Narrative"), ...base],
  },
  {
    code: "SPILL_RELEASE", value: "Spill or Release", label: "Spill or Release", description: "A documented environmental spill or release occurrence with material, quantity, response, and evidence.", group: "Safety", sources: ["Driver Report", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS", "INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("material", "Material / Substance", { required: true }), number("quantityReleased", "Quantity Released", "unit-specific"), text("quantityUnit", "Quantity Unit"), select("releaseEnvironment", "Release Environment", ["Roadway", "Customer Site", "Water", "Soil", "Vehicle / Equipment", "Contained", "Unknown", "Other"]), bool("containmentPerformed", "Containment Performed"), bool("emergencyResponse", "Emergency Response"), text("reportReference", "Regulatory / Incident Reference"), area("responseNotes", "Response Narrative"), ...base],
  },
  {
    code: "CUSTOMER_COMPLAINT", value: "Customer Complaint", label: "Customer Complaint", description: "A customer-reported service concern captured separately from the later substantiation determination.", group: "Customer", sources: ["Customer", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["COMPLAINT_SUBSTANTIATION", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [text("customerName", "Customer / Shipper Name", { required: true }), text("customerReference", "Customer Record Reference"), text("loadNumber", "Load Number"), select("complaintCategory", "Complaint Category", options.complaintCategory, { required: true }), date("receivedDate", "Complaint Received Date"), area("complaintNarrative", "Complaint Narrative", { required: true }), select("substantiationStatus", "Review State", options.complaintState), ...base],
  },
  {
    code: "CUSTOMER_COMMENDATION", value: "Customer Commendation", label: "Customer Commendation", description: "Positive customer evidence about objectively supported driver service or safety performance.", group: "Positive", sources: ["Customer", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [text("customerName", "Customer Name"), select("commendationType", "Commendation Type", ["Customer Commendation", "Safe Driving Milestone", "Roadside Clean Inspection", "Peer Commendation", "Community Service"], { required: true }), text("recognizedBy", "Recognized By", { required: true }), date("recognitionDate", "Recognition Date"), area("recognitionNarrative", "Recognition Narrative"), ...base],
  },
  {
    code: "POSITIVE_SAFETY_OBSERVATION", value: "Positive Safety Observation", label: "Positive Safety Observation", description: "Positive operational evidence based on a documented safety observation rather than absence of adverse records.", group: "Positive", sources: ["Company Staff", "Camera", "Customer", "Driver Report", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("observationType", "Observation Type", options.observationType, { required: true }), text("observer", "Observer", { required: true }), date("observationDate", "Observation Date"), area("observationNarrative", "Observation Narrative", { required: true }), ...base],
  },
  {
    code: "COACHING_SESSION", value: "Coaching Session", label: "Coaching Session", description: "A performance-related occurrence that may reference a separate Company Action; the event does not own the action.", group: "Operations", sources: ["Company Staff", "Other"], evidenceRequired: false, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("topic", "Topic", { required: true }), text("coachReference", "Coach / Company Action Reference"), date("sessionDate", "Session Date"), area("discussionSummary", "Discussion Summary"), area("observedFacts", "Observed Facts"), ...base],
  },
  {
    code: "DISCIPLINARY_ACTION", value: "Disciplinary Action", label: "Disciplinary Action", description: "A legacy-compatible event projection; authoritative disciplinary action remains a separate Company Action record.", group: "Operations", sources: ["Company Staff", "Other"], evidenceRequired: false, determinationTypes: [], analyticsEligible: false, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [text("companyActionReference", "Company Action Reference", { required: true }), select("actionType", "Action Type", ["Verbal Warning", "Written Warning", "Final Warning", "Suspension", "Safety Retraining Required", "Other"]), date("effectiveDate", "Effective Date"), area("factualBasis", "Factual Basis"), ...base],
  },
  {
    code: "CORRECTIVE_ACTION_PLAN", value: "Corrective Action Plan", label: "Corrective Action Plan", description: "A reference/projection to a separate corrective Company Action Plan, preserving the event/action ownership boundary.", group: "Operations", sources: ["Company Staff", "Other"], evidenceRequired: false, determinationTypes: ["CORRECTIVE_ACTION_OUTCOME"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [text("companyActionReference", "Company Action Reference", { required: true }), text("planId", "Plan ID"), date("targetDate", "Target Date"), select("planState", "Plan State", ["Open", "In Progress", "Awaiting Verification", "Completed", "Closed"]), area("planContext", "Plan Context"), ...base],
  },
  {
    code: "INJURY", value: "Injury", label: "Injury", description: "An operational injury occurrence with restricted detail and reference to authoritative screening/medical records where applicable.", group: "Safety", sources: ["Driver Report", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("injuryContext", "Injury Context", ["Workplace", "Vehicle Operation", "Loading / Unloading", "Customer Site", "Roadside", "Other"]), text("injuryReference", "Authoritative Injury / Medical Record Reference"), date("injuryDate", "Injury Date"), bool("dutyImpact", "Duty Impact"), text("fitnessState", "Fitness / Restriction State"), date("effectiveDate", "Effective Date"), area("operationalNotes", "Operational / Compliance Notes"), ...base],
  },
  {
    code: "SECURITY_INCIDENT", value: "Security Incident", label: "Security Incident", description: "A security occurrence with structured incident type, reference, location, and response facts.", group: "Security", sources: ["Driver Report", "Company Staff", "Camera", "Customer", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("securityType", "Security Incident Type", options.securityType, { required: true }), text("incidentReference", "Incident Reference"), text("affectedAsset", "Affected Asset"), bool("lawEnforcementNotified", "Law Enforcement Notified"), area("incidentNarrative", "Incident Narrative"), ...base],
  },
  {
    code: "WARNING", value: "Warning", label: "Warning", description: "A documented warning or notice with its issuing source and factual basis.", group: "Regulatory", sources: ["Roadside Inspection", "Citation", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("warningReference", "Warning Reference"), text("issuingAuthority", "Issuing Authority"), select("warningType", "Warning Type", ["Traffic", "Safety", "Regulatory", "Customer", "Internal", "Other"], { required: true }), area("basis", "Factual Basis"), ...base],
  },
  {
    code: "VIOLATION", value: "Violation", label: "Violation", description: "A source-supported operational or regulatory violation represented without conflating it with a later company determination.", group: "Regulatory", sources: ["Roadside Inspection", "Citation", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("violationType", "Violation Family", options.violationType, { required: true }), text("violationCode", "Violation Code"), text("regulatorySource", "Regulatory Source"), area("violationDescription", "Violation Description", { required: true }), ...base],
  },
  {
    code: "CITATION_LINKED_EVENT", value: "Citation-linked Event", label: "Citation-linked Event", description: "A performance event whose occurrence is linked to an authoritative Citation record.", group: "Regulatory", sources: ["Citation", "Company Staff", "Roadside Inspection"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("citationId", "Canonical Citation ID", { required: true }), text("citationNumber", "Citation Number"), text("linkedEventContext", "Event Context"), area("notes", "Contextual Notes"), ...base],
  },
  {
    code: "EQUIPMENT_FAILURE", value: "Equipment Failure / Critical Defect", label: "Equipment Failure / Critical Defect", description: "An equipment occurrence preserving the distinction between mechanical facts and any later attribution to driver, vehicle, or company.", group: "Operations", sources: ["Maintenance", "Driver Report", "Camera", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("equipmentIssueType", "Equipment Issue", ["Mechanical Failure", "Defect", "Warning", "Damage", "Breakdown", "Inspection Finding", "Other"], { required: true }), text("maintenanceReference", "Maintenance / Repair Reference"), text("vehicleContext", "Vehicle Context"), bool("defectReported", "Defect Reported by Driver"), date("reportedDate", "Defect Report Date"), area("equipmentNarrative", "Equipment Narrative"), ...base],
  },
  {
    code: "SAFETY_OBSERVATION", value: "Safety Observation", label: "Safety Observation", description: "A factual safety observation, positive or adverse, without automatically assigning fault.", group: "Safety", sources: ["Company Staff", "Camera", "Driver Report", "Other"], evidenceRequired: true, determinationTypes: ["ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("observationType", "Observation Type", ["Driving", "Equipment", "Procedure", "PPE", "Site", "Cargo", "Other"], { required: true }), select("observationState", "Observation State", ["Positive", "Neutral", "Concern"], { required: true }), text("observer", "Observer"), area("observationNarrative", "Observation Narrative", { required: true }), ...base],
  },
  {
    code: "CUSTOMER_COMPLIMENT", value: "Customer Compliment", label: "Customer Compliment", description: "A positive customer record distinct from a Customer Commendation when the source is less formal.", group: "Positive", sources: ["Customer", "Company Staff", "Other"], evidenceRequired: false, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [text("customerName", "Customer Name"), text("recognizedBy", "Recognized By"), date("complimentDate", "Compliment Date"), area("complimentNarrative", "Compliment Narrative", { required: true }), ...base],
  },
  {
    code: "TELEMATICS_CAMERA_OBSERVATION", value: "Telematics / Camera Observation", label: "Telematics / Camera Observation", description: "A measured or observed telematics/camera occurrence preserving original measurement and threshold provenance.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [text("provider", "Provider"), text("providerEventId", "Provider Event ID"), text("observationType", "Observation Type", { required: true }), number("rawValue", "Raw Measurement"), text("rawUnit", "Original Unit"), number("thresholdValue", "Threshold"), text("thresholdUnit", "Threshold Unit"), text("thresholdSource", "Threshold Source"), text("thresholdId", "Threshold ID"), text("thresholdVersion", "Threshold Version"), date("thresholdEffectiveDate", "Threshold Effective Date"), number("variance", "Threshold Variance"), number("durationSeconds", "Duration", "seconds"), number("peakValue", "Peak"), number("averageValue", "Average"), ...base],
  },
  {
    code: "SECURITY_EVENT", value: "Security Event", label: "Security Event", description: "A structured security event distinct from a later investigation finding or company action.", group: "Security", sources: ["Driver Report", "Company Staff", "Camera", "Customer", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("securityType", "Security Type", options.securityType, { required: true }), text("assetReference", "Asset Reference"), text("securityReference", "Security Reference"), bool("accessCompromised", "Access Compromised"), area("eventNarrative", "Event Narrative"), ...base],
  },
  {
    code: "EMERGENCY_EVENT", value: "Emergency Event", label: "Emergency Event", description: "An emergency occurrence with structured event type, response, operational impact, and evidence.", group: "Safety", sources: ["Driver Report", "Company Staff", "Camera", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("emergencyType", "Emergency Type", options.emergencyType, { required: true }), text("responseReference", "Response Reference"), bool("emergencyServices", "Emergency Services Involved"), number("downtimeHours", "Operational Downtime", "hours"), area("emergencyNarrative", "Emergency Narrative", { required: true }), ...base],
  },

  {
    code: "SPEEDING", value: "Speeding", label: "Speeding", description: "A measurement-driven speed threshold event preserving original speed, applicable limit, variance, duration, and threshold provenance.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("thresholdBasis", "Threshold Basis", ["Posted Speed Limit", "Company Threshold", "Jurisdiction Rule", "Provider Threshold", "Other"], { required: true }), number("actualSpeed", "Actual / Trigger Speed", "mph / km/h", { required: true }), text("speedUnit", "Original Speed Unit", { required: true }), number("postedSpeedLimit", "Posted Speed Limit", "mph / km/h"), number("companyThreshold", "Company Threshold", "mph / km/h"), number("applicableThreshold", "Applicable Threshold", "mph / km/h"), number("amountExceeded", "Amount Exceeded", "speed unit"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakSpeed", "Peak Speed", "mph / km/h"), number("averageSpeed", "Average Speed", "mph / km/h"), select("zoneType", "Zone Type", options.zone), select("loadStatus", "Load Status", options.loadStatus), text("provider", "Provider"), text("providerEventId", "Provider Event ID"), text("thresholdVersion", "Threshold Version"), date("thresholdEffectiveDate", "Threshold Effective Date"), ...base],
  },
  {
    code: "HARSH_BRAKING", value: "Harsh Braking", label: "Harsh Braking", description: "A measured braking threshold event; TES records the measurement and context without automatically judging driver intent or fault.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("triggerDeceleration", "Trigger Deceleration", "m/s²", { required: true }), number("threshold", "Threshold", "m/s²", { required: true }), number("thresholdVariance", "Threshold Variance", "m/s²"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakDeceleration", "Peak Deceleration", "m/s²"), number("averageDeceleration", "Average Deceleration", "m/s²"), number("speedAtTrigger", "Speed at Trigger", "mph / km/h"), number("endingSpeed", "Ending Speed", "mph / km/h"), number("distanceMeters", "Distance", "m"), number("roadGrade", "Road Grade", "%"), select("weather", "Weather", options.weather), select("roadSurface", "Road Surface", options.road), select("lighting", "Lighting", options.lighting), select("traffic", "Traffic", ["Light", "Moderate", "Heavy", "Unknown"]), select("loadStatus", "Load Status", options.loadStatus), text("cargoReference", "Cargo / Load Reference"), bool("forwardCollisionWarning", "Forward Collision Warning"), text("provider", "Provider"), text("providerEventId", "Provider Event ID"), text("thresholdVersion", "Threshold Version"), ...base],
  },
  {
    code: "HARSH_ACCELERATION", value: "Harsh Acceleration", label: "Harsh Acceleration", description: "A measured acceleration threshold event preserving measurement, threshold, exposure, and context.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("triggerAcceleration", "Trigger Acceleration", "m/s²", { required: true }), number("threshold", "Threshold", "m/s²", { required: true }), number("variance", "Threshold Variance", "m/s²"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakAcceleration", "Peak Acceleration", "m/s²"), number("averageAcceleration", "Average Acceleration", "m/s²"), number("triggerSpeed", "Trigger Speed", "mph / km/h"), number("endingSpeed", "Ending Speed", "mph / km/h"), number("distanceMeters", "Distance", "m"), select("loadStatus", "Load Status", options.loadStatus), text("cargoReference", "Cargo / Load Reference"), select("weather", "Weather", options.weather), select("road", "Road", options.road), select("lighting", "Lighting", options.lighting), ...base],
  },
  {
    code: "HARSH_CORNERING", value: "Harsh Cornering", label: "Harsh Cornering", description: "A measured lateral-acceleration event preserving road geometry, load, and environmental context.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING", "ROOT_CAUSE_ANALYSIS"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("lateralAcceleration", "Lateral Acceleration", "m/s²", { required: true }), number("threshold", "Threshold", "m/s²", { required: true }), number("variance", "Threshold Variance", "m/s²"), number("durationSeconds", "Duration", "seconds"), number("distanceTraveled", "Distance Traveled", "miles / km"), number("peakLateralAcceleration", "Peak Lateral Acceleration", "m/s²"), number("averageLateralAcceleration", "Average Lateral Acceleration", "m/s²"), number("speed", "Speed", "mph / km/h"), number("turnRadius", "Turn Radius", "m"), select("loadStatus", "Load Status", options.loadStatus), text("cargoReference", "Cargo / Load Reference"), text("roadGeometry", "Road Geometry"), select("weather", "Weather", options.weather), select("roadSurface", "Road Surface", options.road), ...base],
  },
  {
    code: "FOLLOWING_DISTANCE", value: "Following Distance", label: "Following Distance", description: "A measured time/distance-gap event preserving the applicable threshold and original measurement basis.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("timeGapSeconds", "Time Gap", "seconds", { required: true }), number("timeGapThresholdSeconds", "Applicable Time-Gap Threshold", "seconds", { required: true }), number("timeGapVarianceSeconds", "Time-Gap Variance", "seconds"), number("distanceGapMeters", "Distance Gap", "m"), number("distanceThresholdMeters", "Applicable Distance Threshold", "m"), number("distanceVarianceMeters", "Distance Variance", "m"), number("durationSeconds", "Duration", "seconds"), number("minimumTimeGapSeconds", "Minimum Time Gap", "seconds"), number("minimumDistanceGapMeters", "Minimum Distance Gap", "m"), number("driverVehicleSpeed", "Driver Vehicle Speed", "mph / km/h"), number("leadVehicleSpeed", "Lead Vehicle Speed", "mph / km/h"), number("relativeSpeed", "Relative Speed", "mph / km/h"), number("distanceTraveledMeters", "Distance Traveled", "m"), select("loadStatus", "Load Status", options.loadStatus), ...base],
  },
  {
    code: "FATIGUE_INDICATOR", value: "Fatigue Indicator", label: "Fatigue Indicator", description: "A source/system indicator of possible fatigue-related conditions; it is not a medical diagnosis.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("indicatorType", "Indicator Type", ["Eye Closure", "PERCLOS", "Yawning", "Microsleep Indicator", "Head-Pose Deviation", "Hours Driven", "Time Since Break", "Time of Day", "Consecutive Driving Days", "HOS Proximity", "Other"], { required: true }), number("eyeClosureDurationMs", "Eye Closure Duration", "ms"), number("perclosPercent", "PERCLOS", "%"), number("hoursDriven", "Hours Driven", "hours"), number("timeSinceBreakMinutes", "Time Since Break", "minutes"), number("consecutiveDrivingDays", "Consecutive Driving Days", "days"), text("dutyContext", "Duty Context"), text("hosProximity", "HOS Proximity"), select("sourceClassification", "Source Classification", ["SOURCE_MEASUREMENT", "SYSTEM_DERIVED_INDICATOR"]), area("indicatorNotes", "Operational Context / Notes"), ...base],
  },
  {
    code: "DEVICE_DATA_INTEGRITY", value: "Device / Data Integrity", label: "Device / Data Integrity", description: "A device or data integrity occurrence that distinguishes malfunction, anomaly, suspected interference, and confirmed tampering.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Company Staff", "Other"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Lifecycle",
    fields: [select("integrityState", "Integrity State", options.dataIntegrity, { required: true }), text("deviceType", "Device Type", { required: true }), text("anomalyType", "Event / Anomaly Type"), text("interferenceMethod", "Interference Method"), text("dataImpact", "Data Impact"), date("detectionDate", "Detection Date"), time("detectionTime", "Detection Time"), bool("deviceDisabled", "Device Disabled"), number("dataLossDurationMinutes", "Data Loss Duration", "minutes"), select("dataRecoveryState", "Data Recovery State", ["Not Required", "Pending", "Recovered", "Partially Recovered", "Not Recovered"]), text("sourceRecordId", "Source Record ID"), text("serviceRepairReference", "Service / Repair Reference"), ...base],
  },
  {
    code: "TRIP_SERVICE_PERFORMANCE", value: "Trip Completion / Service Performance", label: "Trip Completion / Service Performance", description: "A deterministic trip or customer-service performance occurrence using scheduled and actual timestamps rather than subjective scoring.", group: "Operations", sources: ["Company Staff", "Customer", "Driver Report", "Other"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [text("tripReference", "Trip Reference", { required: true }), text("loadReference", "Load Reference"), text("serviceType", "Service Type"), date("scheduledDate", "Scheduled Date"), time("scheduledTime", "Scheduled Time"), date("actualDate", "Actual Date"), time("actualTime", "Actual Time"), number("calculatedVarianceMinutes", "Calculated Variance", "minutes"), text("serviceMetric", "Service Metric"), number("metricValue", "Metric Value"), number("metricThreshold", "Metric Threshold"), text("customerReference", "Customer Reference"), text("customerSiteReference", "Customer Site Reference"), text("podReference", "POD Reference"), bool("customerNotificationSent", "Customer Notification"), ...base],
  },
  {
    code: "LANE_DEPARTURE", value: "Lane Departure", label: "Lane Departure", description: "A source-detected lane-position event preserving measurement and roadway context without automatic fault attribution.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("durationSeconds", "Duration", "seconds"), number("lateralDeviationMeters", "Lateral Deviation", "m"), number("speed", "Speed", "mph / km/h"), select("laneType", "Lane Type", ["Travel Lane", "Shoulder", "Merge", "Exit", "Other", "Unknown"]), select("roadType", "Road Type", ["Highway", "Urban", "Rural", "Work Zone", "Other"]), select("weather", "Weather", options.weather), ...base],
  },
  {
    code: "SEATBELT", value: "Seatbelt", label: "Seatbelt", description: "A source-supported seatbelt status event preserving detection source and duration where available.", group: "HOS / Telematics", sources: ["ELD / Telematics", "Camera", "Roadside Inspection", "Company Staff"], evidenceRequired: true, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("seatbeltState", "Seatbelt State", ["Not Detected", "Unfastened", "Fastened", "Unable to Determine"], { required: true }), number("durationSeconds", "Duration", "seconds"), number("speed", "Vehicle Speed", "mph / km/h"), text("provider", "Provider"), text("providerEventId", "Provider Event ID"), ...base],
  },
  {
    code: "DISTRACTED_DRIVING", value: "Distracted Driving", label: "Distracted Driving", description: "A source-supported distraction indicator; TES records the observed condition without inferring intent or medical cause.", group: "Safety", sources: ["Camera", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [select("distractionType", "Distraction Type", ["Mobile Device", "In-Cab Device", "Food / Drink", "Passenger", "Looking Away", "Other"], { required: true }), number("durationSeconds", "Duration", "seconds"), number("speed", "Vehicle Speed", "mph / km/h"), text("sourceEventId", "Source Event ID"), area("observedContext", "Observed Context"), ...base],
  },
  {
    code: "IDLE_TIME", value: "Idle Time", label: "Idle Time", description: "A measured idling interval preserving duration, location, operating context, and applicable threshold.", group: "Operations", sources: ["ELD / Telematics", "Company Staff"], evidenceRequired: false, determinationTypes: [], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Measured Interval",
    fields: [number("durationMinutes", "Idle Duration", "minutes", { required: true }), number("thresholdMinutes", "Applicable Threshold", "minutes"), number("varianceMinutes", "Threshold Variance", "minutes"), select("locationType", "Location Type", ["Customer Site", "Yard", "Rest Area", "Fuel Stop", "Traffic", "Other"]), select("loadStatus", "Load Status", options.loadStatus), ...base],
  },
  {
    code: "ROUTE_DEVIATION", value: "Route Deviation", label: "Route Deviation", description: "A route-variance occurrence preserving planned versus actual route context and measurable deviation.", group: "Operations", sources: ["ELD / Telematics", "Company Staff", "Driver Report"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("tripReference", "Trip Reference"), text("plannedRouteReference", "Planned Route Reference"), text("actualRouteReference", "Actual Route Reference"), number("deviationDistanceMiles", "Deviation Distance", "miles"), number("deviationDurationMinutes", "Deviation Duration", "minutes"), text("deviationReason", "Reported Reason"), ...base],
  },
  {
    code: "BACKING", value: "Backing", label: "Backing", description: "A backing maneuver occurrence with structured maneuver, environment, and outcome facts.", group: "Safety", sources: ["Driver Report", "Camera", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("maneuverType", "Maneuver Type", ["Straight Back", "Offset Back", "Dock", "Alley", "Customer Site", "Other"], { required: true }), select("spotterUsed", "Spotter Used", ["Yes", "No", "Not Applicable", "Unknown"]), bool("contactOccurred", "Contact Occurred"), text("objectContacted", "Object Contacted"), select("siteType", "Site Type", ["Yard", "Customer Site", "Public Road", "Other"]), ...base],
  },
  {
    code: "STOP_SIGN_RED_LIGHT", value: "Stop Sign / Red Light", label: "Stop Sign / Red Light", description: "A documented stop-control event with source, control type, and measurable context where available.", group: "Safety", sources: ["Camera", "Roadside Inspection", "Citation", "Driver Report"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("controlType", "Control Type", ["Stop Sign", "Red Light", "Rail Signal", "Other"], { required: true }), select("observedOutcome", "Observed Outcome", ["Stopped", "Rolling Stop", "Failed to Stop", "Unable to Determine"]), number("speedAtControl", "Speed at Control", "mph / km/h"), text("citationReference", "Citation Reference"), ...base],
  },
  {
    code: "RAILROAD_CROSSING", value: "Railroad Crossing", label: "Railroad Crossing", description: "A railroad-crossing occurrence preserving crossing status, control, and safety context.", group: "Safety", sources: ["Camera", "Driver Report", "Company Staff"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [select("crossingType", "Crossing Type", ["Active Warning", "Passive", "Private", "Unknown"]), select("observedAction", "Observed Action", ["Stopped as Required", "Crossed", "Stopped Short", "Unable to Determine"]), bool("trainPresent", "Train Present"), bool("gatesDown", "Gates Down"), text("crossingReference", "Crossing Reference"), ...base],
  },
  {
    code: "CUSTOMER_SITE_BEHAVIOR", value: "Customer-Site Behavior", label: "Customer-Site Behavior", description: "A customer-site operational occurrence with site, behavior, and evidence context.", group: "Customer", sources: ["Customer", "Company Staff", "Driver Report", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: false, temporalBehavior: "Occurrence",
    fields: [text("customerReference", "Customer Reference"), text("customerSiteReference", "Customer Site Reference"), select("behaviorType", "Behavior Type", ["Safe Site Practice", "Access / Conduct", "Dock Conduct", "PPE", "Communication", "Other"], { required: true }), area("behaviorNarrative", "Behavior Narrative", { required: true }), ...base],
  },
  {
    code: "PPE_SAFETY_PROTOCOL", value: "PPE / Safety Protocol", label: "PPE / Safety Protocol", description: "A documented PPE or site-safety protocol observation with the applicable requirement and observed state.", group: "Safety", sources: ["Company Staff", "Customer", "Driver Report", "Camera"], evidenceRequired: true, determinationTypes: ["INVESTIGATION_FINDING"], analyticsEligible: true, positiveEligible: true, temporalBehavior: "Occurrence",
    fields: [select("protocolType", "Protocol Type", ["PPE", "Fall Protection", "Lockout / Tagout", "Site Speed", "Spotter", "Other"], { required: true }), select("observedState", "Observed State", ["Compliant", "Non-Compliant", "Unable to Determine"], { required: true }), text("requirementSource", "Requirement Source"), text("siteReference", "Site Reference"), area("observationNarrative", "Observation Narrative"), ...base],
  },
];


export const DRIVER_PERFORMANCE_CATEGORY_REGISTRY: readonly PerformanceCategoryDefinition[] = DRIVER_PERFORMANCE_CATEGORY_REGISTRY_RAW.map((definition) => ({
  ...definition,
  fields: definition.fields.map((field) => ({
    ...field,
    dataPointId: field.dataPointId.startsWith("DRV.PERF.SHARED.") ? field.dataPointId : `DRV.PERF.${definition.code}.${field.key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
  })),
}));

export const DRIVER_PERFORMANCE_CATEGORY_BY_VALUE: Readonly<Record<EventType, PerformanceCategoryDefinition>> = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.reduce((map, definition) => {
  map[definition.value] = definition;
  return map;
}, {} as Record<EventType, PerformanceCategoryDefinition>);

export const RECORDABLE_PERFORMANCE_CATEGORIES: readonly EventType[] = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter((definition) => PERFORMANCE_CATEGORY_OWNERSHIP[definition.value] === "RECORDABLE_EVENT").map((definition) => definition.value);

export const DRIVER_PERFORMANCE_LEGACY_CATEGORY_ALIASES: Readonly<Record<string, EventType>> = {
  "Positive Safety Observation": "Safety Observation",
  "Customer Compliment": "Customer Commendation",
  "Equipment-related Event": "Equipment Failure / Critical Defect",
  "Security Event": "Security Incident",
  "Telematics / Camera Observation": "Device / Data Integrity",
};

export const PERFORMANCE_VERIFICATION_STATES = ["Unverified", "Partially Verified", "Verified", "Unable to Verify"] as const;
export const PERFORMANCE_DISPUTE_STATES = ["Not Disputed", "Disputed", "Resolved"] as const;
export const PERFORMANCE_SEMANTIC_UNKNOWN: SemanticState = "Unknown";
