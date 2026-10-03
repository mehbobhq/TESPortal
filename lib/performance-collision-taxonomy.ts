/**
 * Collision controlled vocabularies (dependency-free: shared by the schema registry, the pure Collision logic and the UI).
 * Business logic compares the canonical `value`; `label` is presentation only.
 */

export interface CollisionOption { value: string; label: string }
const o = (value: string, label: string): CollisionOption => ({ value, label });

/** A. Broad occurrence classification. */
export const COLLISION_TYPES: readonly CollisionOption[] = [
  o("MULTI_VEHICLE", "Multi-vehicle collision"), o("SINGLE_VEHICLE", "Single-vehicle collision"), o("VEHICLE_VS_VULNERABLE_ROAD_USER", "Vehicle vs pedestrian / cyclist / motorcyclist"),
  o("VEHICLE_VS_ANIMAL", "Vehicle vs animal"), o("VEHICLE_VS_FIXED_OBJECT", "Vehicle vs fixed object"), o("NON_COLLISION_OCCURRENCE", "Non-collision occurrence (rollover, jackknife, fire)"),
  o("STATIONARY_OR_FACILITY", "Stationary / yard / dock / facility collision"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

/** B. How the involved units / objects interacted. */
export const COLLISION_MANNERS: readonly CollisionOption[] = [
  o("REAR_END", "Rear-end"), o("HEAD_ON", "Head-on"), o("ANGLE", "Angle / T-bone"), o("SIDESWIPE_SAME_DIRECTION", "Sideswipe - same direction"),
  o("SIDESWIPE_OPPOSITE_DIRECTION", "Sideswipe - opposite direction"), o("TURNING", "Turning collision"), o("BACKING", "Backing"), o("RUN_OFF_ROAD", "Run-off-road"),
  o("NO_OTHER_UNIT", "No other unit involved"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

/** C. The first event that actually produced injury or damage. */
export const COLLISION_FIRST_HARMFUL_EVENTS: readonly CollisionOption[] = [
  o("MOTOR_VEHICLE_IN_TRANSPORT", "Collision with motor vehicle in transport"), o("PARKED_VEHICLE", "Collision with parked vehicle"), o("PEDESTRIAN", "Collision with pedestrian"),
  o("CYCLIST_MOTORCYCLIST", "Collision with cyclist / motorcyclist"), o("ANIMAL", "Collision with animal"), o("FIXED_OBJECT", "Collision with fixed object"),
  o("OTHER_OBJECT", "Collision with other object"), o("ROLLOVER", "Rollover / overturn"), o("JACKKNIFE", "Jackknife"), o("FIRE_EXPLOSION", "Fire / explosion"),
  o("CARGO_SHIFT_OR_SEPARATION", "Cargo shift / separation of units"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

export const COLLISION_DRIVER_ACTIVITIES: readonly CollisionOption[] = [
  o("DRIVING_STRAIGHT", "Driving straight"), o("TURNING", "Turning"), o("MERGING", "Merging"), o("CHANGING_LANES", "Changing lanes"), o("BACKING", "Backing"),
  o("PARKING", "Parking"), o("LOADING_UNLOADING", "Loading / unloading"), o("STOPPED_IN_TRAFFIC", "Stopped in traffic"), o("STOPPED_ROADSIDE", "Stopped roadside"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

export const COLLISION_DRIVER_ACTIONS: readonly CollisionOption[] = [
  o("NO_AVOIDANCE_ACTION", "No avoidance action"), o("BRAKED", "Braked"), o("STEERED", "Steered"), o("BRAKED_AND_STEERED", "Braked and steered"),
  o("ACCELERATED", "Accelerated"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];

export const COLLISION_VISIBILITY: readonly CollisionOption[] = [o("CLEAR", "Clear"), o("REDUCED", "Reduced"), o("SEVERELY_REDUCED", "Severely reduced"), o("UNKNOWN", "Unknown")];
export const COLLISION_TRAFFIC: readonly CollisionOption[] = [o("LIGHT", "Light"), o("MODERATE", "Moderate"), o("HEAVY", "Heavy"), o("STOP_AND_GO", "Stop-and-go"), o("NO_TRAFFIC", "No traffic"), o("UNKNOWN", "Unknown")];
export const COLLISION_YES_NO_UNKNOWN: readonly CollisionOption[] = [o("YES", "Yes"), o("NO", "No"), o("UNKNOWN", "Unknown")];

export const COLLISION_INJURY_STATUSES: readonly CollisionOption[] = [
  o("NO_INJURY_REPORTED", "No injury reported"), o("INJURY_REPORTED", "Injury reported"), o("FATALITY_REPORTED", "Fatality reported"), o("UNKNOWN_PENDING", "Unknown / pending"),
];
export const COLLISION_POLICE_RESPONSES: readonly CollisionOption[] = [o("ATTENDED", "Attended"), o("NOT_ATTENDED", "Not attended"), o("UNKNOWN", "Unknown")];
export const COLLISION_ENFORCEMENT: readonly CollisionOption[] = [
  o("NONE_KNOWN", "None known"), o("CHARGE_OR_CITATION_CARRIER_DRIVER", "Charge / citation - carrier driver"), o("CHARGE_OR_CITATION_OTHER_PARTY", "Charge / citation - other party"), o("PENDING", "Pending"), o("UNKNOWN", "Unknown"),
];
export const COLLISION_CARGO_IMPACT: readonly CollisionOption[] = [o("NONE", "No cargo impact"), o("DAMAGED", "Cargo damaged"), o("LOST_OR_SPILLED", "Cargo lost / spilled"), o("NOT_APPLICABLE", "Not applicable (empty)"), o("UNKNOWN", "Unknown")];
export const COLLISION_HAZMAT: readonly CollisionOption[] = [o("NOT_INVOLVED", "Not involved"), o("INVOLVED_NO_RELEASE", "Involved - no release"), o("RELEASE_OR_SPILL", "Release / spill"), o("UNKNOWN", "Unknown")];
export const COLLISION_REPORTABILITY: readonly CollisionOption[] = [o("REPORTABLE", "Reportable"), o("NOT_REPORTABLE", "Not Reportable"), o("UNABLE_TO_DETERMINE", "Unable to Determine")];

export const COLLISION_SEQUENCE_EVENTS: readonly CollisionOption[] = [
  o("LOSS_OF_CONTROL", "Loss of control"), o("LEFT_ROADWAY", "Left roadway"), o("ENTERED_SHOULDER", "Entered shoulder"), o("CROSSED_CENTERLINE", "Crossed centerline"),
  o("STRUCK_VEHICLE", "Struck vehicle"), o("STRUCK_PERSON_OR_ANIMAL", "Struck person / animal"), o("STRUCK_OBJECT", "Struck object"), o("ROLLOVER", "Rollover"),
  o("FIRE", "Fire"), o("CARGO_SHIFT", "Cargo shift / release"), o("CAME_TO_REST", "Came to rest"), o("OTHER", "Other"),
];

export const COLLISION_PARTY_ROLES: readonly CollisionOption[] = [o("CARRIER_POWER_UNIT", "Carrier power unit"), o("CARRIER_TRAILER", "Carrier trailer"), o("OTHER_PARTY", "Other party / object")];
export const COLLISION_OTHER_PARTY_TYPES: readonly CollisionOption[] = [
  o("PASSENGER_VEHICLE", "Passenger vehicle"), o("COMMERCIAL_VEHICLE", "Commercial vehicle"), o("MOTORCYCLE", "Motorcycle"), o("BUS", "Bus / school bus"), o("EMERGENCY_VEHICLE", "Emergency vehicle"),
  o("PEDESTRIAN", "Pedestrian"), o("CYCLIST", "Cyclist"), o("ANIMAL", "Animal"), o("FIXED_OBJECT", "Fixed object"), o("OTHER_PROPERTY", "Other property"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const COLLISION_DAMAGE_STATUSES: readonly CollisionOption[] = [o("NONE", "No damage"), o("MINOR", "Minor"), o("MODERATE", "Moderate"), o("SEVERE", "Severe"), o("TOTAL_LOSS", "Total loss"), o("UNKNOWN", "Unknown")];
export const COLLISION_DRIVABILITY: readonly CollisionOption[] = [o("DRIVABLE", "Drivable"), o("NOT_DRIVABLE", "Not drivable"), o("UNKNOWN", "Unknown")];
export const COLLISION_TOW_STATUSES: readonly CollisionOption[] = [o("NOT_TOWED", "Not towed"), o("TOWED", "Towed"), o("UNKNOWN", "Unknown")];
export const COLLISION_IMPACT_POINTS: readonly CollisionOption[] = [o("FRONT", "Front"), o("REAR", "Rear"), o("LEFT_SIDE", "Left side"), o("RIGHT_SIDE", "Right side"), o("TOP_OR_UNDERSIDE", "Top / underside"), o("MULTIPLE", "Multiple"), o("UNKNOWN", "Unknown")];
export const COLLISION_SPEED_UNITS: readonly CollisionOption[] = [o("MPH", "mph"), o("KMH", "km/h")];

export const COLLISION_PERSON_ROLES: readonly CollisionOption[] = [
  o("CARRIER_DRIVER", "Carrier driver"), o("CARRIER_OCCUPANT", "Carrier occupant"), o("OTHER_DRIVER", "Other driver"), o("OTHER_OCCUPANT", "Other occupant"),
  o("PEDESTRIAN", "Pedestrian"), o("CYCLIST_MOTORCYCLIST", "Cyclist / motorcyclist"), o("OTHER", "Other"), o("UNKNOWN", "Unknown"),
];
export const COLLISION_INJURY_SEVERITIES: readonly CollisionOption[] = [o("FATAL", "Fatal"), o("SERIOUS", "Serious"), o("MINOR", "Minor"), o("POSSIBLE", "Possible injury"), o("UNKNOWN", "Unknown")];
export const COLLISION_TREATMENT_STATUSES: readonly CollisionOption[] = [o("NONE_REPORTED", "None reported"), o("TREATED_AT_SCENE", "Treated at scene"), o("TREATED_AT_FACILITY", "Treated at facility"), o("ADMITTED", "Admitted"), o("UNKNOWN", "Unknown")];
/** Sensitivity of the person-level medical information. Enforcement belongs to future authorization; this only classifies. */
export const COLLISION_ACCESS_CLASSES: readonly CollisionOption[] = [o("RESTRICTED_MEDICAL", "Restricted - medical"), o("RESTRICTED_INTERNAL", "Restricted - internal"), o("GENERAL", "General")];

export const COLLISION_STATEMENT_STATUSES: readonly CollisionOption[] = [o("OBTAINED", "Obtained"), o("REQUESTED", "Requested"), o("DECLINED", "Declined"), o("UNABLE_TO_OBTAIN", "Unable to obtain")];
export const COLLISION_STATEMENT_METHODS: readonly CollisionOption[] = [o("WRITTEN", "Written"), o("RECORDED", "Recorded"), o("INTERVIEW", "Interview"), o("UPLOADED_DOCUMENT", "Uploaded document"), o("OTHER", "Other")];

export const COLLISION_COLLECTION_IDS = {
  EVENT_SEQUENCE: "DRV.PERF.COLLISION.EVENT_SEQUENCE",
  INVOLVED_PARTIES: "DRV.PERF.COLLISION.INVOLVED_PARTIES",
  INJURED_PERSONS: "DRV.PERF.COLLISION.INJURED_PERSONS",
  DRIVER_STATEMENTS: "DRV.PERF.COLLISION.DRIVER_STATEMENTS",
} as const;

export const collisionOptionLabel = (list: readonly CollisionOption[], value: string | null | undefined) => (value ? list.find((item) => item.value === value)?.label ?? String(value) : "");
export const collisionValues = (list: readonly CollisionOption[]) => list.map((item) => item.value);

/** Same values as the generic Collision source policy (provenance.source is a label string by the existing convention). */
export const COLLISION_SOURCES: readonly CollisionOption[] = ["Driver Report", "Company Staff", "Camera", "Roadside Inspection", "Other"].map((label) => o(label, label));

/** Stored machine values of the OLD "Collision Configuration" fact -> their original display labels (read-only compatibility). */
export const LEGACY_COLLISION_CONFIGURATIONS: readonly CollisionOption[] = [
  o("REAR_END", "Rear-End"), o("SIDESWIPE", "Sideswipe"), o("BACKING", "Backing"), o("INTERSECTION", "Intersection"), o("LANE_CHANGE", "Lane Change"), o("ROLLOVER", "Rollover"),
  o("JACKKNIFE", "Jackknife"), o("FIXED_OBJECT", "Fixed Object"), o("ANIMAL", "Animal"), o("PEDESTRIAN", "Pedestrian"), o("OTHER", "Other"),
];
