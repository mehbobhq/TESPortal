/**
 * Customer Event controlled vocabularies (dependency-free: shared by the schema registry, the pure Customer Event logic and the UI).
 * Business logic compares the canonical `value`; `label` is presentation only.
 *
 * Categories and behaviors here are CLASSIFICATION ONLY. They never establish cause, responsibility, a violation or another event.
 */

export interface CustomerOption { value: string; label: string }
const o = (value: string, label: string): CustomerOption => ({ value, label });

/** Subtype is an immutable parent fact. It identifies a new canonical Customer Event. */
export const CE_SUBTYPES: readonly CustomerOption[] = [o("COMPLAINT", "Complaint"), o("COMMENDATION", "Commendation"), o("SITE_BEHAVIOR", "Site Behavior")];

/** Customer-Event-specific source policy values (provenance.source label strings, per the existing convention). */
export const CE_SOURCES: readonly CustomerOption[] = ["Customer", "Company Staff", "Driver Report", "Camera", "Other"].map((label) => o(label, label));
/** Communication channel / context. NOT provenance. */
export const CE_INTAKE_CHANNELS: readonly CustomerOption[] = [o("EMAIL", "Email"), o("PHONE", "Phone"), o("PORTAL", "Portal"), o("IN_PERSON", "In Person"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];

export const CE_OCCURRENCE_PRECISIONS: readonly CustomerOption[] = [o("EXACT_DATETIME", "Exact date and time"), o("DATE_ONLY", "Date only"), o("APPROXIMATE", "Approximate"), o("UNKNOWN", "Unknown")];
export const CE_YES_NO_UNKNOWN: readonly CustomerOption[] = [o("YES", "Yes"), o("NO", "No"), o("UNKNOWN", "Unknown")];
/** Explicit workflow-control facts. Blank means not recorded; nothing here is ever inferred. */
export const CE_YES_NO: readonly CustomerOption[] = [o("YES", "Yes"), o("NO", "No")];
export const CE_CURRENCIES: readonly CustomerOption[] = [o("CAD", "CAD"), o("USD", "USD")];

// --- Parties ---------------------------------------------------------------
export const CE_CAPACITIES: readonly CustomerOption[] = [o("REPORTER", "Reporter"), o("OBSERVER", "Observer"), o("SUBJECT", "Subject"), o("RECOGNIZED_PARTY", "Recognized Party"), o("RECORDED_BY", "Recorded By"), o("INVOLVED", "Involved")];
export const CE_PERSON_TYPES: readonly CustomerOption[] = [
  o("CARRIER_DRIVER", "Carrier Driver"), o("DISPATCHER", "Dispatcher"), o("CUSTOMER_CONTACT", "Customer Contact"), o("CUSTOMER_EMPLOYEE", "Customer Employee"), o("FORKLIFT_OPERATOR", "Forklift Operator"),
  o("YARD_WORKER", "Yard Worker"), o("CONTRACTOR", "Contractor"), o("VISITOR", "Visitor"), o("SECURITY", "Security"), o("OTHER", "Other"),
];
export const CE_IDENTIFICATION_CERTAINTIES: readonly CustomerOption[] = [o("IDENTIFIED", "Identified"), o("PARTIALLY_IDENTIFIED", "Partially Identified"), o("UNIDENTIFIED", "Unidentified")];
/** Sensitivity of person-level and statement content. Enforcement belongs to future authorization; this only classifies. */
export const CE_ACCESS_CLASSES: readonly CustomerOption[] = [o("RESTRICTED_MEDICAL", "Restricted - medical"), o("RESTRICTED_INTERNAL", "Restricted - internal"), o("GENERAL", "General")];

// --- Complaint ---------------------------------------------------------------
export const CE_COMPLAINT_CATEGORIES: readonly CustomerOption[] = [
  o("DELIVERY_PERFORMANCE", "Delivery Performance"), o("PICKUP_PERFORMANCE", "Pickup Performance"), o("COMMUNICATION", "Communication"), o("DRIVER_CONDUCT", "Driver Conduct"), o("CARGO_CONDITION", "Cargo Condition"),
  o("DOCUMENTATION", "Documentation"), o("BILLING_CHARGES", "Billing / Charges"), o("SAFETY_COMPLIANCE", "Safety / Compliance"), o("TECHNOLOGY_VISIBILITY", "Technology / Visibility"), o("SITE_FACILITY", "Site / Facility"), o("OTHER", "Other"),
];
/** What was reported. A claim is an allegation as made, never an established fact. */
export const CE_CLAIM_TYPES: readonly CustomerOption[] = [
  o("LATE_ARRIVAL", "Late arrival"), o("MISSED_APPOINTMENT", "Missed appointment"), o("NO_SHOW", "No show"), o("POOR_COMMUNICATION", "Poor communication"), o("UNPROFESSIONAL_CONDUCT", "Unprofessional conduct"),
  o("UNSAFE_OPERATION", "Unsafe operation"), o("CARGO_DAMAGE_OR_SHORTAGE", "Cargo damage / shortage"), o("DOCUMENTATION_ISSUE", "Documentation issue"), o("BILLING_DISPUTE", "Billing dispute"),
  o("SITE_RULE_CONCERN", "Site rule concern"), o("VISIBILITY_TRACKING_ISSUE", "Visibility / tracking issue"), o("OTHER", "Other"),
];
export const CE_CLAIM_SOURCES: readonly CustomerOption[] = [o("CUSTOMER", "Customer"), o("COMPANY_STAFF", "Company Staff"), o("DRIVER", "Driver"), o("OTHER", "Other")];
/** The only assertion status a new claim can carry. Established facts belong to the investigation. */
export const CE_CLAIM_ASSERTION_REPORTED = "REPORTED";

// --- Commendation ------------------------------------------------------------
export const CE_RECOGNITION_CATEGORIES: readonly CustomerOption[] = [o("SERVICE_QUALITY", "Service Quality"), o("SAFETY", "Safety"), o("PROFESSIONALISM", "Professionalism"), o("COMMUNICATION", "Communication"), o("PROBLEM_SOLVING", "Problem Solving"), o("OTHER", "Other")];
export const CE_RECOGNITION_SOURCES: readonly CustomerOption[] = [o("CUSTOMER", "Customer"), o("COMPANY_STAFF", "Company Staff"), o("PEER", "Peer"), o("OTHER", "Other")];
export const CE_RECOGNITION_LEVELS: readonly CustomerOption[] = [o("INFORMAL", "Informal"), o("WRITTEN", "Written"), o("FORMAL", "Formal"), o("UNKNOWN", "Unknown")];
export const CE_POSITIVE_BEHAVIORS: readonly CustomerOption[] = [
  o("PROACTIVE_COMMUNICATION", "Proactive Communication"), o("PROFESSIONAL_CONDUCT", "Professional Conduct"), o("SAFE_SITE_CONDUCT", "Safe Site Conduct"), o("SAFE_DRIVING_RECOGNITION", "Safe Driving Recognition"),
  o("CAREFUL_CARGO_HANDLING", "Careful Cargo Handling"), o("PROBLEM_RESOLUTION", "Problem Resolution / Service Recovery"), o("DOCUMENTATION_QUALITY", "Documentation / Process Quality"), o("OTHER", "Other"),
];

// --- Site Behavior -----------------------------------------------------------
export const CE_BEHAVIOR_CATEGORIES: readonly CustomerOption[] = [
  o("DRIVER_BEHAVIOR", "Driver Behavior"), o("CUSTOMER_SITE_CONDUCT", "Customer-Site Conduct"), o("SAFETY_COMPLIANCE", "Safety Compliance"), o("SECURITY_BEHAVIOR", "Security Behavior"), o("COMMUNICATION_BEHAVIOR", "Communication Behavior"),
  o("OPERATIONAL_BEHAVIOR", "Operational Behavior"), o("CONFLICT_ESCALATION", "Conflict / Escalation"), o("ENVIRONMENTAL_HOUSEKEEPING", "Environmental / Housekeeping"), o("OTHER", "Other"),
];
export const CE_CERTAINTIES: readonly CustomerOption[] = [o("OBSERVED", "Observed"), o("REPORTED", "Reported"), o("SUSPECTED", "Suspected")];
export const CE_SITE_CONDITION_CATEGORIES: readonly CustomerOption[] = [
  o("BLOCKED_ACCESS_OR_DOCK", "Blocked access / dock"), o("CONGESTION", "Congestion"), o("SURFACE_HAZARD", "Surface hazard"), o("POOR_LIGHTING", "Poor lighting"), o("MISSING_SIGNAGE_OR_CONTROLS", "Missing signage / controls"),
  o("EQUIPMENT_HAZARD", "Equipment hazard"), o("HOUSEKEEPING", "Housekeeping"), o("SECURITY_CONCERN", "Security concern"), o("OTHER", "Other"),
];

// --- Response, resolution, outcome ----------------------------------------------
export const CE_RESPONSE_ACTIONS: readonly CustomerOption[] = [
  o("RECEIVED_RECORDED", "Received / Recorded"), o("ACKNOWLEDGED", "Acknowledged"), o("ASSIGNED", "Assigned"), o("INVESTIGATION_STARTED", "Investigation Started"), o("RESPONSE_SENT", "Response Sent"),
  o("RESOLUTION_PROVIDED", "Resolution Provided"), o("FOLLOW_UP_REQUESTED", "Follow-up Requested"), o("REOPENED", "Reopened"), o("OTHER", "Other"),
];
export const CE_RESOLUTION_STATUSES: readonly CustomerOption[] = [o("NOT_STARTED", "Not started"), o("IN_PROGRESS", "In progress"), o("PROVIDED", "Provided"), o("UNKNOWN", "Unknown")];
/** Customer acceptance is the customer's reaction. It is never case closure. */
export const CE_CUSTOMER_ACCEPTANCES: readonly CustomerOption[] = [o("ACCEPTED", "Accepted"), o("REJECTED", "Rejected"), o("NO_RESPONSE", "No Response"), o("NOT_REQUESTED", "Not Requested"), o("PENDING", "Pending"), o("UNKNOWN", "Unknown")];

// --- Financial ---------------------------------------------------------------
export const CE_FINANCIAL_BASES: readonly CustomerOption[] = [o("ACTUAL", "Actual"), o("POTENTIAL", "Potential")];
export const CE_FINANCIAL_KINDS = ["credit", "chargeback", "penalty", "claim", "detention", "redelivery", "administrativeCost", "revenueAtRisk", "other"] as const;
export const CE_FINANCIAL_LABELS: Readonly<Record<string, string>> = { credit: "Credit", chargeback: "Chargeback", penalty: "Penalty", claim: "Claim", detention: "Detention", redelivery: "Redelivery", administrativeCost: "Administrative cost", revenueAtRisk: "Revenue at risk", other: "Other" };

// --- Workflow-control requirement facts ----------------------------------------------
export const CE_REVIEW_TYPES: readonly CustomerOption[] = [o("SITE", "Site review"), o("RECOGNITION", "Recognition review")];
export const CE_REQUIREMENT_FIELDS: readonly CustomerOption[] = [o("complaintAssessmentRequired", "Complaint assessment required"), o("customerResponseRequired", "Customer response required"), o("siteReviewRequired", "Site review required"), o("recognitionReviewRequired", "Recognition review required")];

export const CE_COLLECTION_IDS = {
  PARTIES: "DRV.PERF.CUSTOMER_EVENT.PARTIES",
  STATEMENTS: "DRV.PERF.CUSTOMER_EVENT.ORIGINAL_STATEMENTS",
  CLAIMS: "DRV.PERF.CUSTOMER_EVENT.COMPLAINT_CLAIMS",
  COMMENDATION: "DRV.PERF.CUSTOMER_EVENT.COMMENDATION",
  BEHAVIORS: "DRV.PERF.CUSTOMER_EVENT.SITE_PERSON_BEHAVIORS",
  CONDITIONS: "DRV.PERF.CUSTOMER_EVENT.SITE_CONDITIONS",
  TIMELINE: "DRV.PERF.CUSTOMER_EVENT.RESPONSE_TIMELINE",
  RESOLUTION: "DRV.PERF.CUSTOMER_EVENT.RESOLUTION",
  OUTCOME: "DRV.PERF.CUSTOMER_EVENT.CUSTOMER_OUTCOME",
  FINANCIAL: "DRV.PERF.CUSTOMER_EVENT.FINANCIAL_FACTS",
  REVIEWS: "DRV.PERF.CUSTOMER_EVENT.REVIEWS",
  STATUS_HISTORY: "DRV.PERF.CUSTOMER_EVENT.STATUS_HISTORY",
} as const;

export const customerOptionLabel = (list: readonly CustomerOption[], value: string | null | undefined) => (value ? list.find((item) => item.value === value)?.label ?? String(value) : "");
export const customerValues = (list: readonly CustomerOption[]) => list.map((item) => item.value);
