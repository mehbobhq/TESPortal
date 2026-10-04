/**
 * Cargo Incident controlled vocabularies (dependency-free: shared by the schema registry, the pure Cargo logic and the UI).
 * Business logic compares the canonical `value`; `label` is presentation only.
 */

export interface CargoOption { value: string; label: string }
const o = (value: string, label: string): CargoOption => ({ value, label });

export const CARGO_SOURCES: readonly CargoOption[] = ["Driver Report", "Customer", "Company Staff", "Camera", "Other"].map((label) => o(label, label));

/** Single-valued: what best characterises the occurrence. It never prevents the Damage and Theft outcome modules from coexisting. */
export const CARGO_PRIMARY_FAMILIES: readonly CargoOption[] = [
  o("DAMAGE", "Damage"), o("THEFT", "Theft"), o("ATTEMPTED_THEFT", "Attempted Theft"), o("SHORTAGE_DISCREPANCY", "Shortage / Discrepancy"), o("TEMPERATURE_COLD_CHAIN", "Temperature / Cold Chain"),
  o("SECUREMENT", "Securement"), o("FRAUD_DECEPTION", "Fraud / Deception"), o("HIJACKING_VIOLENT_THEFT", "Hijacking / Violent Theft"), o("CUSTOMER_FACILITY", "Customer / Facility"), o("OTHER_UNKNOWN", "Other / Unknown"),
];

const other = (): CargoOption[] => [o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
/** Family-dependent. Stored as canonical values; never an authoritative root cause. */
export const CARGO_SECONDARY_BY_FAMILY: Readonly<Record<string, readonly CargoOption[]>> = {
  DAMAGE: [o("PHYSICAL_DAMAGE", "Physical Damage"), o("WATER_MOISTURE_DAMAGE", "Water / Moisture Damage"), o("CONTAMINATION", "Contamination"), o("PACKAGING_DAMAGE", "Packaging Damage"), o("LOAD_SHIFT_DAMAGE", "Load Shift Damage"), o("HANDLING_DAMAGE", "Handling Damage"), ...other()],
  THEFT: [o("PARTIAL_CARGO_THEFT", "Partial Cargo Theft"), o("FULL_CARGO_THEFT", "Full Cargo Theft"), o("BREAK_IN_FORCED_ENTRY", "Break-In / Forced Entry"), o("PILFERAGE", "Pilferage"), ...other()],
  ATTEMPTED_THEFT: [o("ATTEMPTED_BREAK_IN", "Attempted Break-In"), o("ATTEMPTED_CARGO_REMOVAL", "Attempted Cargo Removal"), ...other()],
  SHORTAGE_DISCREPANCY: [o("QUANTITY_SHORTAGE", "Quantity Shortage"), o("MISSING_ITEM", "Missing Item"), o("DELIVERY_DISCREPANCY", "Delivery Discrepancy"), ...other()],
  TEMPERATURE_COLD_CHAIN: [o("TEMPERATURE_EXCURSION", "Temperature Excursion"), o("REEFER_INTERRUPTION_FAILURE", "Reefer Interruption / Failure"), o("DOOR_OPEN_EXPOSURE", "Door-Open Exposure"), ...other()],
  SECUREMENT: [o("LOAD_SHIFT", "Load Shift"), o("SECUREMENT_CONCERN_FAILURE", "Securement Concern / Failure"), ...other()],
  FRAUD_DECEPTION: [o("FRAUDULENT_PICKUP", "Fraudulent Pickup"), o("IDENTITY_DOCUMENT_DECEPTION", "Identity / Document Deception"), ...other()],
  HIJACKING_VIOLENT_THEFT: [o("HIJACKING", "Hijacking"), o("ROBBERY_VIOLENT_CARGO_THEFT", "Robbery / Violent Cargo Theft"), ...other()],
  CUSTOMER_FACILITY: [o("LOADING_DAMAGE", "Loading Damage"), o("UNLOADING_DAMAGE", "Unloading Damage"), o("FACILITY_HANDLING_ISSUE", "Facility Handling Issue"), ...other()],
  OTHER_UNKNOWN: other(),
};
export const CARGO_SECONDARY_ALL: readonly CargoOption[] = [...new Map(Object.values(CARGO_SECONDARY_BY_FAMILY).flat().map((item) => [item.value, item])).values()];

export const CARGO_CUSTODY_STAGES: readonly CargoOption[] = [
  o("PICKUP_LOADING", "Pickup Loading"), o("ORIGIN_DEPARTURE", "Origin Departure"), o("EN_ROUTE", "En Route"), o("TERMINAL_YARD", "Terminal / Yard"), o("FUEL_STOP", "Fuel Stop"),
  o("REST_STOP_PARKING", "Rest Stop / Parking"), o("CUSTOMER_ARRIVAL", "Customer Arrival"), o("UNLOADING", "Unloading"), o("POST_DELIVERY", "Post-Delivery"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

export const CARGO_OCCURRENCE_PRECISIONS: readonly CargoOption[] = [o("EXACT_DATETIME", "Exact date and time"), o("DATE_ONLY", "Date only"), o("APPROXIMATE", "Approximate"), o("UNKNOWN", "Unknown")];
/** Lightweight incident cargo context. It never creates a CargoItem; blank means not recorded. */
export const CARGO_CONTEXT_STATUSES: readonly CargoOption[] = [o("KNOWN_GENERAL", "General cargo description known"), o("NOT_ESTABLISHED", "Cargo not yet established")];
export const CARGO_YES_NO_UNKNOWN: readonly CargoOption[] = [o("YES", "Yes"), o("NO", "No"), o("UNKNOWN", "Unknown")];

export const CARGO_ITEM_STATUSES: readonly CargoOption[] = [
  o("LOADED", "Loaded"), o("IN_TRANSIT", "In Transit"), o("DELIVERED", "Delivered"), o("MISSING", "Missing"), o("STOLEN", "Stolen"), o("RECOVERED", "Recovered"),
  o("DAMAGED", "Damaged"), o("DISPOSED", "Disposed"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const CARGO_QUANTITY_UNITS: readonly CargoOption[] = [o("PIECES", "Pieces"), o("PALLETS", "Pallets"), o("CASES", "Cases"), o("CARTONS", "Cartons"), o("DRUMS", "Drums"), o("KG", "kg"), o("LB", "lb"), o("LITRES", "Litres"), o("OTHER", "Other")];
export const CARGO_CURRENCIES: readonly CargoOption[] = [o("CAD", "CAD"), o("USD", "USD")];

export const CARGO_DAMAGE_TYPES: readonly CargoOption[] = [o("PHYSICAL_DAMAGE", "Physical Damage"), o("WATER_MOISTURE_DAMAGE", "Water / Moisture Damage"), o("CONTAMINATION", "Contamination"), o("PACKAGING_DAMAGE", "Packaging Damage"), o("LOAD_SHIFT_DAMAGE", "Load Shift Damage"), o("HANDLING_DAMAGE", "Handling Damage"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const CARGO_DAMAGE_SCOPES: readonly CargoOption[] = [o("ISOLATED", "Isolated items"), o("PARTIAL", "Part of the load"), o("TOTAL", "Entire load"), o("UNKNOWN", "Unknown")];
export const CARGO_DAMAGE_ORIGINS: readonly CargoOption[] = [o("NEW_INCIDENT", "New Incident"), o("PRE_EXISTING", "Pre-Existing"), o("MIXED", "Mixed"), o("UNKNOWN", "Unknown")];
export const CARGO_DISPOSITIONS: readonly CargoOption[] = [o("DELIVERED_WITH_DAMAGE", "Delivered with damage"), o("REJECTED", "Rejected by receiver"), o("SALVAGED", "Salvaged"), o("DISPOSED", "Disposed"), o("RETURNED", "Returned to shipper"), o("PENDING", "Pending"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
/** Reported / Suspected Cause: occurrence data only. It is NEVER the TES root cause. */
export const CARGO_REPORTED_CAUSES: readonly CargoOption[] = [
  o("LOADING_UNLOADING", "Loading / Unloading"), o("SECUREMENT_CONCERN", "Securement Concern"), o("LOAD_SHIFT", "Load Shift"), o("ROAD_MOVEMENT", "Road / Movement"), o("COLLISION", "Collision"),
  o("WEATHER_WATER", "Weather / Water"), o("EQUIPMENT_REEFER_CONCERN", "Equipment / Reefer Concern"), o("PACKAGING_CONCERN", "Packaging Concern"), o("HANDLING", "Handling"),
  o("CUSTOMER_FACILITY", "Customer / Facility"), o("UNKNOWN", "Unknown"), o("OTHER", "Other"),
];

export const CARGO_TEMPERATURE_UNITS: readonly CargoOption[] = [o("C", "°C"), o("F", "°F")];
export const CARGO_MEASUREMENT_SOURCES: readonly CargoOption[] = [o("TELEMATICS", "Telematics"), o("REEFER_CONTROLLER", "Reefer Controller"), o("MANUAL_READING", "Manual Reading"), o("DRIVER_REPORT", "Driver Report"), o("CUSTOMER_READING", "Customer Reading"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const CARGO_REEFER_STATUSES: readonly CargoOption[] = [o("RUNNING", "Running"), o("OFF", "Off"), o("FAULT_ALARM", "Fault / alarm"), o("NOT_EQUIPPED", "Not a reefer"), o("UNKNOWN", "Unknown")];
export const CARGO_REEFER_FUEL: readonly CargoOption[] = [o("ADEQUATE", "Adequate"), o("LOW", "Low"), o("EMPTY", "Empty"), o("UNKNOWN", "Unknown")];

export const CARGO_THEFT_STATUSES: readonly CargoOption[] = [o("CONFIRMED", "Confirmed"), o("SUSPECTED", "Suspected"), o("ATTEMPTED", "Attempted"), o("UNDER_ESTABLISHMENT", "Under establishment"), o("UNKNOWN", "Unknown")];
export const CARGO_THEFT_METHODS: readonly CargoOption[] = [o("FORCED_ENTRY", "Forced entry"), o("SEAL_TAMPERING", "Seal tampering"), o("FRAUDULENT_PICKUP", "Fraudulent pickup"), o("HIJACKING", "Hijacking"), o("UNATTENDED_THEFT", "Theft while unattended"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const CARGO_THEFT_TARGETS: readonly CargoOption[] = [o("ENTIRE_LOAD", "Entire load"), o("PART_OF_LOAD", "Part of the load"), o("SPECIFIC_ITEMS", "Specific items"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const CARGO_LOCATION_TYPES: readonly CargoOption[] = [o("PARKING_LOT", "Parking lot / truck stop"), o("ROADSIDE", "Roadside"), o("YARD_TERMINAL", "Yard / terminal"), o("CUSTOMER_FACILITY", "Customer / shipper / receiver facility"), o("EN_ROUTE_MOVING", "Moving en route"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const CARGO_TIME_CERTAINTIES: readonly CargoOption[] = [o("EXACT", "Exact"), o("ESTIMATED_WINDOW", "Estimated window"), o("UNKNOWN", "Unknown")];
export const CARGO_DISCOVERY_METHODS: readonly CargoOption[] = [o("DRIVER_INSPECTION", "Driver inspection"), o("SEAL_CHECK", "Seal check"), o("TRACKING_ALERT", "Tracking alert"), o("CUSTOMER_REPORT", "Customer report"), o("DELIVERY_SHORTAGE", "Found at delivery"), o("POLICE_NOTIFICATION", "Police notification"), o("OTHER", "Other"), o("UNKNOWN", "Unknown")];
export const CARGO_TRACKING_STATUSES: readonly CargoOption[] = [o("ACTIVE", "Reporting normally"), o("SIGNAL_LOST", "Signal lost"), o("DISABLED", "Disabled"), o("NOT_EQUIPPED", "No tracking"), o("UNKNOWN", "Unknown")];
export const CARGO_SEAL_STATES: readonly CargoOption[] = [o("INTACT", "Intact"), o("BROKEN", "Broken"), o("REPLACED", "Replaced / changed"), o("MISSING", "Missing"), o("NOT_USED", "No seal used"), o("UNKNOWN", "Unknown")];
export const CARGO_POLICE_RESPONSES: readonly CargoOption[] = [o("ATTENDED", "Attended"), o("REPORT_FILED_ONLY", "Report filed only"), o("NOT_NOTIFIED", "Not notified"), o("UNKNOWN", "Unknown")];
export const CARGO_RECOVERY_STATUSES: readonly CargoOption[] = [o("NOT_RECOVERED", "Not recovered"), o("PARTIALLY_RECOVERED", "Partially recovered"), o("FULLY_RECOVERED", "Fully recovered"), o("UNKNOWN", "Unknown")];

export const CARGO_CUSTODY_ROLES: readonly CargoOption[] = [
  o("NORMAL_CUSTODY", "Normal custody"), o("LAST_KNOWN_GOOD", "Last Known Good"), o("FIRST_SECURITY_ANOMALY", "First Security Anomaly"), o("DISCOVERY", "Discovery"),
  o("TRANSFER", "Transfer"), o("DELIVERY", "Delivery"), o("RECOVERY", "Recovery"), o("OTHER", "Other"),
];
/** An anomaly is an observation. It is not a confirmed theft method. */
export const CARGO_ANOMALY_TYPES: readonly CargoOption[] = [
  o("UNAUTHORIZED_STOP", "Unauthorized Stop"), o("GPS_SIGNAL_LOST", "GPS Signal Lost"), o("SEAL_CHANGED_BROKEN", "Seal Changed / Broken"), o("DOOR_OPENED", "Door Opened"),
  o("GEOFENCE_VIOLATION", "Geofence Violation"), o("UNEXPECTED_ROUTE_DEVIATION", "Unexpected Route Deviation"), o("TRACKER_DISABLED", "Tracker Disabled"), o("UNKNOWN_PERSON_ACCESS", "Unknown Person Access"),
  o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const CARGO_GPS_STATES: readonly CargoOption[] = [o("ACTIVE", "Reporting"), o("LOST", "Signal lost"), o("DISABLED", "Disabled"), o("NOT_EQUIPPED", "No GPS"), o("UNKNOWN", "Unknown")];
export const CARGO_VERIFICATION_METHODS: readonly CargoOption[] = [o("SEAL_NUMBER_CHECK", "Seal number check"), o("VISUAL_INSPECTION", "Visual inspection"), o("GPS_TELEMATICS", "GPS / telematics"), o("DOCUMENT_CHECK", "Document check"), o("NONE", "None"), o("OTHER", "Other")];

export const CARGO_CONTROL_TYPES: readonly CargoOption[] = [
  o("SEAL", "Seal"), o("GPS", "GPS"), o("TELEMATICS", "Telematics"), o("CAMERA", "Camera"), o("ALARM", "Alarm"), o("LOCK", "Lock"), o("ESCORT", "Escort"),
  o("PARKING_PLAN", "Parking Plan"), o("YARD_SECURITY", "Yard Security"), o("IDENTITY_VERIFICATION", "Identity Verification"), o("OTHER", "Other"),
];
export const CARGO_CONTROL_STATES: readonly CargoOption[] = [o("IN_PLACE_FUNCTIONING", "In place and functioning"), o("IN_PLACE_NOT_FUNCTIONING", "In place but not functioning"), o("NOT_IN_PLACE", "Not in place"), o("NOT_REQUIRED", "Not required"), o("UNKNOWN", "Unknown")];

export const CARGO_COLLECTION_IDS = {
  ITEMS: "DRV.PERF.CARGO_INCIDENT.ITEMS",
  ITEM_STATUS_HISTORY: "DRV.PERF.CARGO_INCIDENT.ITEM_STATUS_HISTORY",
  DAMAGE_OUTCOME: "DRV.PERF.CARGO_INCIDENT.DAMAGE_OUTCOME",
  TEMPERATURE: "DRV.PERF.CARGO_INCIDENT.TEMPERATURE_OBSERVATIONS",
  THEFT_OUTCOME: "DRV.PERF.CARGO_INCIDENT.THEFT_OUTCOME",
  CUSTODY: "DRV.PERF.CARGO_INCIDENT.CUSTODY_CHAIN",
  SECURITY_CONTROLS: "DRV.PERF.CARGO_INCIDENT.SECURITY_CONTROLS",
} as const;

export const cargoOptionLabel = (list: readonly CargoOption[], value: string | null | undefined) => (value ? list.find((item) => item.value === value)?.label ?? String(value) : "");
export const cargoValues = (list: readonly CargoOption[]) => list.map((item) => item.value);
