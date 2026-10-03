/**
 * Near Miss controlled vocabularies (dependency-free so the schema registry and the pure Near Miss logic can both import it).
 * Business logic compares the canonical `value`; `label` is presentation only.
 */

export interface NearMissOption { value: string; label: string }
export interface NearMissTypeGroup { key: string; label: string; types: readonly NearMissOption[] }

const t = (value: string, label: string): NearMissOption => ({ value, label });

export const NEAR_MISS_TYPE_GROUPS: readonly NearMissTypeGroup[] = [
  { key: "VEHICLE_CONFLICT", label: "Vehicle Conflict", types: [t("UNSAFE_FOLLOWING_DISTANCE", "Unsafe Following Distance"), t("CUT_OFF", "Cut-off"), t("LANE_CHANGE_CONFLICT", "Lane-change Conflict"), t("MERGE_CONFLICT", "Merge Conflict"), t("SIDESWIPE_AVOIDED", "Sideswipe Avoided"), t("HEAD_ON_CENTERLINE_ENCROACHMENT", "Head-on / Centerline Encroachment"), t("REAR_END_NARROWLY_AVOIDED", "Rear-end Narrowly Avoided"), t("OTHER_VEHICLE_CONFLICT", "Other Vehicle Conflict")] },
  { key: "INTERSECTION_CONFLICT", label: "Intersection Conflict", types: [t("RED_LIGHT_CONFLICT", "Red-light Conflict"), t("STOP_SIGN_CONFLICT", "Stop-sign Conflict"), t("FAILURE_TO_YIELD", "Failure-to-yield"), t("TURNING_CONFLICT", "Turning Conflict"), t("ROUNDABOUT_CONFLICT", "Roundabout Conflict"), t("BLOCKED_INTERSECTION", "Blocked Intersection")] },
  { key: "VULNERABLE_ROAD_USER", label: "Vulnerable Road User", types: [t("PEDESTRIAN", "Pedestrian"), t("CYCLIST", "Cyclist"), t("MOTORCYCLIST", "Motorcyclist"), t("SCHOOL_BUS", "School Bus"), t("CONSTRUCTION_WORKER", "Construction Worker"), t("EMERGENCY_RESPONDER", "Emergency Responder")] },
  { key: "ROADSIDE_PARKING", label: "Roadside / Parking", types: [t("BACKING_CONFLICT", "Backing Conflict"), t("DOCK_CONFLICT", "Dock Conflict"), t("YARD_CONFLICT", "Yard Conflict"), t("PARKING_LOT_CONFLICT", "Parking-lot Conflict"), t("STRUCK_OBJECT_AVOIDED", "Struck-object Avoided"), t("LOW_CLEARANCE_OVERHEAD_OBSTRUCTION", "Low-clearance / Overhead Obstruction")] },
  { key: "ROAD_ENVIRONMENT", label: "Road / Environment", types: [t("ANIMAL_STRIKE_AVOIDED", "Animal Strike Avoided"), t("DEBRIS", "Debris"), t("POTHOLE_ROAD_DEFECT", "Pothole / Road Defect"), t("BLACK_ICE", "Black Ice"), t("HYDROPLANING", "Hydroplaning"), t("HIGH_WIND", "High Wind"), t("REDUCED_VISIBILITY", "Reduced Visibility"), t("WORK_ZONE", "Work Zone")] },
  { key: "EQUIPMENT_MECHANICAL", label: "Equipment / Mechanical", types: [t("BRAKE_CONCERN", "Brake Concern"), t("TIRE_FAILURE_AVOIDED", "Tire Failure Avoided"), t("STEERING_CONCERN", "Steering Concern"), t("LIGHTING_VISIBILITY_ISSUE", "Lighting / Visibility Issue"), t("COUPLING_SECUREMENT_CONCERN", "Coupling / Securement Concern"), t("LOAD_SHIFT", "Load Shift")] },
  { key: "COMPLIANCE_OPERATIONAL", label: "Compliance / Operational", types: [t("HOS_FATIGUE_CONCERN", "HOS / Fatigue Concern"), t("DISTRACTED_DRIVING_CONCERN", "Distracted-driving Concern"), t("UNSAFE_ROUTE_INSTRUCTION", "Unsafe Route Instruction"), t("PRE_TRIP_INSPECTION_CONCERN", "Pre-trip / Inspection Concern"), t("COMMUNICATION_FAILURE", "Communication Failure")] },
  { key: "SECURITY_CARGO", label: "Security / Cargo", types: [t("CARGO_THEFT_ATTEMPT", "Cargo Theft Attempt"), t("UNSAFE_SHIPPER_SITE_CONDITION", "Unsafe Shipper Site Condition"), t("LOADING_UNLOADING_NEAR_MISS", "Loading / Unloading Near Miss"), t("DANGEROUS_GOODS_EXPOSURE_AVOIDED", "Dangerous-goods Exposure Avoided")] },
];

export const NEAR_MISS_PRIMARY_TYPES: readonly NearMissOption[] = NEAR_MISS_TYPE_GROUPS.flatMap((group) => group.types);
export const NEAR_MISS_TYPE_GROUP_BY_VALUE: Readonly<Record<string, string>> = Object.fromEntries(NEAR_MISS_TYPE_GROUPS.flatMap((group) => group.types.map((item) => [item.value, group.label])));

/** Values the Near Miss `nearMissType` data point held before the new taxonomy. Stored records keep them; they are never remapped. */
export const LEGACY_NEAR_MISS_TYPES: readonly NearMissOption[] = [
  t("REAR_END_RISK", "Rear-End Risk"), t("LANE_CONFLICT", "Lane Conflict"), t("PEDESTRIAN_CONFLICT", "Pedestrian Conflict"), t("INTERSECTION_CONFLICT", "Intersection Conflict"),
  t("BACKING_CONFLICT", "Backing Conflict"), t("ROLLOVER_RISK", "Rollover Risk"), t("OTHER", "Other"),
];
export const LEGACY_NEAR_MISS_TRIGGER_SOURCES: readonly NearMissOption[] = [
  t("ELD_TELEMATICS", "ELD / Telematics"), t("FORWARD_CAMERA", "Forward Camera"), t("DRIVER_REPORT", "Driver Report"), t("ROADSIDE_INSPECTION", "Roadside Inspection"), t("CUSTOMER", "Customer"), t("OTHER", "Other"),
];

export const NEAR_MISS_OPERATING_ACTIVITIES: readonly NearMissOption[] = [
  t("DRIVING_STRAIGHT", "Driving Straight"), t("TURNING", "Turning"), t("MERGING", "Merging"), t("CHANGING_LANES", "Changing Lanes"), t("BACKING", "Backing"),
  t("PARKING", "Parking"), t("LOADING_UNLOADING", "Loading / Unloading"), t("STOPPED_ROADSIDE", "Stopped Roadside"), t("OTHER", "Other"),
];

export const NEAR_MISS_OTHER_PARTY_TYPES: readonly NearMissOption[] = [
  t("PASSENGER_VEHICLE", "Passenger Vehicle"), t("COMMERCIAL_VEHICLE", "Commercial Vehicle"), t("PEDESTRIAN", "Pedestrian"), t("CYCLIST", "Cyclist"), t("MOTORCYCLIST", "Motorcyclist"),
  t("SCHOOL_BUS", "School Bus"), t("EMERGENCY_VEHICLE", "Emergency Vehicle"), t("ANIMAL", "Animal"), t("FIXED_OBJECT", "Fixed Object"), t("ROAD_ENVIRONMENT", "Road / Environment"),
  t("EQUIPMENT", "Equipment"), t("CUSTOMER_SITE", "Customer / Site"), t("OTHER", "Other"), t("UNKNOWN", "Unknown"),
];

export const NEAR_MISS_POTENTIAL_CONSEQUENCES: readonly NearMissOption[] = [
  t("COLLISION", "Collision"), t("INJURY", "Injury"), t("FATALITY", "Fatality"), t("ROLLOVER", "Rollover"), t("PROPERTY_DAMAGE", "Property Damage"),
  t("CARGO_LOSS", "Cargo Loss"), t("SPILL_RELEASE", "Spill / Release"), t("CITATION_INSPECTION_ISSUE", "Citation / Inspection Issue"), t("OTHER", "Other"),
];

export const NEAR_MISS_POTENTIAL_SEVERITIES: readonly NearMissOption[] = [t("LOW", "Low"), t("MODERATE", "Moderate"), t("SERIOUS", "Serious"), t("CATASTROPHIC", "Catastrophic")];

export const NEAR_MISS_IMMEDIATE_RESPONSES: readonly NearMissOption[] = [
  t("BRAKED", "Braked"), t("STEERED_EVADED", "Steered / Evaded"), t("SLOWED", "Slowed"), t("STOPPED", "Stopped"), t("SOUNDED_HORN", "Sounded Horn"),
  t("NOTIFIED_DISPATCH", "Notified Dispatch"), t("REMOVED_UNIT_FROM_SERVICE", "Removed Unit from Service"), t("OTHER", "Other"),
];

export const NEAR_MISS_UNSAFE_CONDITION_STATES: readonly NearMissOption[] = [t("YES", "Yes"), t("NO", "No"), t("UNKNOWN", "Unknown")];

/** Value = label by the existing generic authoritative-source convention (provenance.source is a label string used by the Tab's source filter). */
export const NEAR_MISS_SOURCES: readonly NearMissOption[] = ["Driver Self-report", "Dashcam / AI", "Telematics", "Dispatcher", "Customer", "Public Complaint", "Safety Manager", "Other"].map((label) => t(label, label));

export const NEAR_MISS_DIRECTIONS_OF_TRAVEL: readonly NearMissOption[] = [t("NORTHBOUND", "Northbound"), t("SOUTHBOUND", "Southbound"), t("EASTBOUND", "Eastbound"), t("WESTBOUND", "Westbound"), t("NOT_APPLICABLE", "Not applicable / stationary")];

/** IANA zone identifiers (never MST/EST abbreviations). The list is a controlled convenience subset; the data model accepts any valid IANA id. */
export const IANA_TIME_ZONES: readonly NearMissOption[] = [
  t("America/St_Johns", "Newfoundland - America/St_Johns"), t("America/Halifax", "Atlantic - America/Halifax"), t("America/Toronto", "Eastern - America/Toronto"), t("America/New_York", "Eastern - America/New_York"),
  t("America/Winnipeg", "Central - America/Winnipeg"), t("America/Chicago", "Central - America/Chicago"), t("America/Regina", "Central (no DST) - America/Regina"), t("America/Edmonton", "Mountain - America/Edmonton"),
  t("America/Denver", "Mountain - America/Denver"), t("America/Phoenix", "Mountain (no DST) - America/Phoenix"), t("America/Vancouver", "Pacific - America/Vancouver"), t("America/Los_Angeles", "Pacific - America/Los_Angeles"),
  t("America/Anchorage", "Alaska - America/Anchorage"), t("Pacific/Honolulu", "Hawaii - Pacific/Honolulu"), t("America/Mexico_City", "Central Mexico - America/Mexico_City"),
];

export const NEAR_MISS_COLLECTION_IDS = {
  SECONDARY_TYPES: "DRV.PERF.NEAR_MISS.SECONDARY_TYPES",
  POTENTIAL_CONSEQUENCES: "DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCES",
  IMMEDIATE_RESPONSES: "DRV.PERF.NEAR_MISS.IMMEDIATE_RESPONSES",
  UNSAFE_CONDITION_RESOLUTIONS: "DRV.PERF.NEAR_MISS.UNSAFE_CONDITION_RESOLUTIONS",
} as const;

const labelFrom = (list: readonly NearMissOption[], value: string | null | undefined, fallback = "") => (value ? list.find((item) => item.value === value)?.label ?? fallback : fallback);
export const nearMissPrimaryTypeLabel = (value: string | null | undefined) => labelFrom(NEAR_MISS_PRIMARY_TYPES, value);
export const legacyNearMissTypeLabel = (value: string | null | undefined) => labelFrom(LEGACY_NEAR_MISS_TYPES, value);
export const nearMissOptionLabel = (list: readonly NearMissOption[], value: string | null | undefined) => labelFrom(list, value, value ? String(value) : "");
