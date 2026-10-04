/**
 * Spill or Release controlled vocabularies (dependency-free: shared by the schema registry, the pure Spill logic and the UI).
 * Business logic compares the canonical `value`; `label` is presentation only.
 *
 * Nothing here is a regulatory rule. There are no thresholds, reportable quantities or jurisdictional lists:
 * those belong to a future Rules Pool. Operational categories are NOT regulatory material identity.
 */

export interface SpillOption { value: string; label: string }
const o = (value: string, label: string): SpillOption => ({ value, label });

export const SPILL_SOURCES: readonly SpillOption[] = ["Driver Report", "Company Staff", "Camera", "Other"].map((label) => o(label, label));

export const SPILL_OCCURRENCE_PRECISIONS: readonly SpillOption[] = [o("EXACT_DATETIME", "Exact date and time"), o("DATE_ONLY", "Date only"), o("APPROXIMATE", "Approximate"), o("UNKNOWN", "Unknown")];
export const SPILL_YES_NO_UNKNOWN: readonly SpillOption[] = [o("YES", "Yes"), o("NO", "No"), o("UNKNOWN", "Unknown")];

/** Three separate dimensions. They are never collapsed into one status. */
export const SPILL_RELEASE_DETERMINATIONS: readonly SpillOption[] = [o("SUSPECTED", "Suspected"), o("CONFIRMED", "Confirmed"), o("UNKNOWN", "Unknown")];
export const SPILL_RELEASE_CONDITIONS: readonly SpillOption[] = [o("ACTIVE", "Active"), o("CONTAINED", "Contained"), o("STOPPED", "Stopped"), o("UNKNOWN", "Unknown")];
export const SPILL_CLEANUP_STATUSES: readonly SpillOption[] = [o("NOT_STARTED", "Not Started"), o("IN_PROGRESS", "In Progress"), o("COMPLETE", "Complete"), o("VERIFICATION_PENDING", "Verification Pending")];

/** How the release manifested. */
export const SPILL_RELEASE_FORMS: readonly SpillOption[] = [o("LEAK", "Leak"), o("SEEPAGE", "Seepage"), o("DRIP", "Drip"), o("SPILL", "Spill"), o("SPRAY", "Spray"), o("MIST", "Mist"), o("VAPOR", "Vapor"), o("GAS", "Gas"), o("RUPTURE", "Rupture"), o("UNKNOWN", "Unknown")];
/** Occurrence / mechanism information. It is NEVER an authoritative root cause. */
export const SPILL_RELEASE_MECHANISMS: readonly SpillOption[] = [
  o("CONTAINER_FAILURE", "Container Failure"), o("VALVE_FAILURE", "Valve Failure"), o("FITTING_FAILURE", "Fitting Failure"), o("HOSE_FAILURE", "Hose Failure"), o("OVERFILL", "Overfill"),
  o("COLLISION_DAMAGE", "Collision Damage"), o("FIRE_DAMAGE", "Fire Damage"), o("HANDLING_DAMAGE", "Handling Damage"), o("EQUIPMENT_FAILURE", "Equipment Failure"), o("UNKNOWN", "Unknown"), o("OTHER", "Other"),
];
export const SPILL_SOURCE_CATEGORIES: readonly SpillOption[] = [
  o("CARGO_PACKAGE", "Cargo Package"), o("CARGO_TANK_BULK", "Cargo Tank / Bulk Container"), o("TRAILER_BODY", "Trailer Body"), o("REEFER_UNIT", "Reefer Unit"), o("VEHICLE_SYSTEM", "Vehicle System"),
  o("LOADING_UNLOADING_EQUIPMENT", "Loading / Unloading Equipment"), o("CUSTOMER_FACILITY_EQUIPMENT", "Customer / Facility Equipment"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

// --- Materials -------------------------------------------------------------
/** Operational grouping only. It is not the proper shipping name, UN/ID, hazard class or packing group. */
export const SPILL_MATERIAL_CATEGORIES: readonly SpillOption[] = [
  o("FUEL", "Fuel"), o("OIL_LUBRICANT", "Oil / Lubricant"), o("COOLANT", "Coolant / Antifreeze"), o("HYDRAULIC_FLUID", "Hydraulic Fluid"), o("CARGO_PRODUCT", "Cargo Product"),
  o("CHEMICAL", "Chemical"), o("WASTE", "Waste"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const SPILL_IDENTIFICATION_STATUSES: readonly SpillOption[] = [o("CONFIRMED", "Confirmed"), o("REPORTED", "Reported"), o("ESTIMATED", "Estimated"), o("UNKNOWN", "Unknown"), o("PENDING_IDENTIFICATION", "Pending Identification")];
export const SPILL_MATERIAL_SOURCES: readonly SpillOption[] = [
  o("SHIPPING_PAPER", "Shipping Paper"), o("SDS", "SDS"), o("LABEL", "Label"), o("PLACARD", "Placard"), o("DRIVER_REPORT", "Driver Report"), o("SHIPPER", "Shipper"), o("RECEIVER", "Receiver"),
  o("EMERGENCY_RESPONDER", "Emergency Responder"), o("LABORATORY", "Laboratory"), o("OTHER", "Other"),
];
export const SPILL_PHYSICAL_STATES: readonly SpillOption[] = [o("LIQUID", "Liquid"), o("SOLID", "Solid"), o("GAS", "Gas"), o("SEMI_SOLID", "Semi-solid / sludge"), o("MIXED", "Mixed"), o("UNKNOWN", "Unknown")];
export const SPILL_PACKING_GROUPS: readonly SpillOption[] = [o("I", "I"), o("II", "II"), o("III", "III"), o("NOT_APPLICABLE", "Not applicable"), o("UNKNOWN", "Unknown")];
export const SPILL_SDS_STATUSES: readonly SpillOption[] = [o("AVAILABLE", "Available"), o("REQUESTED", "Requested"), o("NOT_AVAILABLE", "Not available"), o("NOT_APPLICABLE", "Not applicable"), o("UNKNOWN", "Unknown")];
export const SPILL_SHIPPING_PAPER_STATUSES: readonly SpillOption[] = [o("AVAILABLE", "Available"), o("NOT_AVAILABLE", "Not available"), o("NOT_APPLICABLE", "Not applicable"), o("UNKNOWN", "Unknown")];

// --- Quantities --------------------------------------------------------------
export const SPILL_QUANTITY_DIMENSIONS: readonly SpillOption[] = [o("INVOLVED", "Quantity Involved"), o("RELEASED", "Quantity Released"), o("RECOVERED", "Quantity Recovered"), o("DISPOSED", "Quantity Disposed"), o("REMAINING", "Quantity Remaining")];
export const SPILL_QUANTITY_UNITS: readonly SpillOption[] = [o("LITRES", "Litres"), o("US_GALLONS", "US gallons"), o("IMPERIAL_GALLONS", "Imperial gallons"), o("KG", "kg"), o("LB", "lb"), o("CUBIC_METRES", "m3"), o("DRUMS", "Drums"), o("PIECES", "Pieces"), o("OTHER", "Other")];
export const SPILL_QUANTITY_STATUSES: readonly SpillOption[] = [o("MEASURED", "Measured"), o("ESTIMATED", "Estimated"), o("REPORTED", "Reported"), o("UNKNOWN", "Unknown")];
export const SPILL_ESTIMATION_METHODS: readonly SpillOption[] = [
  o("GAUGE_OR_METER", "Gauge / meter"), o("CONTAINER_VOLUME", "Container volume"), o("VISUAL_ESTIMATE", "Visual estimate"), o("WEIGHT_DIFFERENCE", "Weight difference"), o("DOCUMENT", "Document / manifest"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const SPILL_CURRENCIES: readonly SpillOption[] = [o("CAD", "CAD"), o("USD", "USD")];

// --- People -----------------------------------------------------------------
export const SPILL_PERSON_ROLES: readonly SpillOption[] = [
  o("CARRIER_DRIVER", "Carrier driver"), o("CARRIER_OCCUPANT", "Carrier occupant"), o("FACILITY_WORKER", "Facility worker"), o("RESPONDER", "Emergency / hazmat responder"), o("MEMBER_OF_PUBLIC", "Member of the public"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const SPILL_EXPOSURE_STATUSES: readonly SpillOption[] = [o("EXPOSED", "Exposed"), o("SUSPECTED_EXPOSURE", "Suspected exposure"), o("NOT_EXPOSED", "Not exposed"), o("UNKNOWN", "Unknown")];
export const SPILL_EXPOSURE_ROUTES: readonly SpillOption[] = [o("INHALATION", "Inhalation"), o("SKIN_CONTACT", "Skin contact"), o("EYE_CONTACT", "Eye contact"), o("INGESTION", "Ingestion"), o("MULTIPLE", "Multiple routes"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const SPILL_MEDICAL_EVALUATIONS: readonly SpillOption[] = [o("NONE", "None"), o("AT_SCENE", "Evaluated at scene"), o("AT_FACILITY", "Evaluated at a facility"), o("UNKNOWN", "Unknown")];
/** Sensitivity of person-level information. Enforcement belongs to future authorization; this only classifies. */
export const SPILL_ACCESS_CLASSES: readonly SpillOption[] = [o("RESTRICTED_MEDICAL", "Restricted - medical"), o("RESTRICTED_INTERNAL", "Restricted - internal"), o("GENERAL", "General")];

// --- Environment ------------------------------------------------------------
export const SPILL_ENVIRONMENTAL_MEDIA: readonly SpillOption[] = [
  o("ROADWAY", "Roadway"), o("SOIL", "Soil"), o("STORM_DRAIN", "Storm Drain"), o("SURFACE_WATER", "Surface Water"), o("GROUNDWATER", "Groundwater"), o("AIR", "Air"), o("VEGETATION", "Vegetation"), o("SENSITIVE_AREA", "Sensitive Area"), o("OTHER", "Other"),
];
export const SPILL_IMPACT_STATUSES: readonly SpillOption[] = [o("CONFIRMED", "Confirmed"), o("SUSPECTED", "Suspected"), o("NOT_OBSERVED", "Not Observed"), o("UNKNOWN", "Unknown")];

// --- Response timeline ------------------------------------------------------
export const SPILL_RESPONSE_ACTIONS: readonly SpillOption[] = [
  o("RELEASE_DISCOVERED", "Release Discovered"), o("VEHICLE_STOPPED", "Vehicle Stopped"), o("AREA_SECURED", "Area Secured"), o("DISPATCH_NOTIFIED", "Dispatch Notified"), o("EMERGENCY_SERVICES_NOTIFIED", "Emergency Services Notified"),
  o("HAZMAT_ARRIVED", "Hazmat Arrived"), o("RELEASE_CONTAINED", "Release Contained"), o("CLEANUP_STARTED", "Cleanup Started"), o("CLEANUP_COMPLETED", "Cleanup Completed"), o("OTHER", "Other"),
];
export const SPILL_STEP_SOURCES: readonly SpillOption[] = [o("DRIVER_REPORT", "Driver Report"), o("DISPATCH_LOG", "Dispatch Log"), o("RESPONDER_REPORT", "Responder Report"), o("TELEMATICS", "Telematics"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];

// --- Cleanup ----------------------------------------------------------------
export const SPILL_RESTORATION_STATUSES: readonly SpillOption[] = [o("NOT_REQUIRED_REPORTED", "Reported as not needed"), o("NOT_STARTED", "Not started"), o("IN_PROGRESS", "In progress"), o("COMPLETE", "Complete"), o("UNKNOWN", "Unknown")];
export const SPILL_VERIFICATION_STATUSES: readonly SpillOption[] = [o("NOT_VERIFIED", "Not verified"), o("PENDING", "Pending"), o("VERIFIED", "Verified"), o("UNKNOWN", "Unknown")];

// --- Regulatory (data architecture only; no rules) --------------------------
export const SPILL_ASSESSMENT_STATUSES: readonly SpillOption[] = [o("NOT_ASSESSED", "Not Assessed"), o("UNDER_REVIEW", "Under Review"), o("REQUIRED", "Required"), o("NOT_REQUIRED", "Not Required"), o("UNDETERMINED", "Undetermined")];
export const SPILL_EXECUTION_STATUSES: readonly SpillOption[] = [o("NOT_STARTED", "Not started"), o("IN_PROGRESS", "In progress"), o("COMPLETED", "Completed")];

export const SPILL_COLLECTION_IDS = {
  MATERIALS: "DRV.PERF.SPILL_RELEASE.MATERIALS",
  QUANTITIES: "DRV.PERF.SPILL_RELEASE.QUANTITIES",
  PERSONS: "DRV.PERF.SPILL_RELEASE.PERSONS",
  ENVIRONMENTAL_MEDIA: "DRV.PERF.SPILL_RELEASE.ENVIRONMENTAL_MEDIA",
  RESPONSE_TIMELINE: "DRV.PERF.SPILL_RELEASE.RESPONSE_TIMELINE",
  CLEANUP: "DRV.PERF.SPILL_RELEASE.CLEANUP_RECORDS",
  REGULATORY_ASSESSMENTS: "DRV.PERF.SPILL_RELEASE.REGULATORY_ASSESSMENTS",
  REGULATORY_EXECUTIONS: "DRV.PERF.SPILL_RELEASE.REGULATORY_EXECUTIONS",
  FINANCIAL: "DRV.PERF.SPILL_RELEASE.FINANCIAL_FACTS",
  STATUS_HISTORY: "DRV.PERF.SPILL_RELEASE.STATUS_HISTORY",
} as const;

export const spillOptionLabel = (list: readonly SpillOption[], value: string | null | undefined) => (value ? list.find((item) => item.value === value)?.label ?? String(value) : "");
export const spillValues = (list: readonly SpillOption[]) => list.map((item) => item.value);
