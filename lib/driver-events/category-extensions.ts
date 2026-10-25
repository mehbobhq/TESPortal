import type { PerformanceCategoryDefinition, PerformanceFieldDefinition, PerformanceFieldKind, PerformanceValueType, ControlledOption } from "../driver-performance-schema"

/**
 * Fields the baseline requires that the existing category schemas did not carry (field reconciliation, see docs/driver-events/field-reconciliation.md).
 * Everything here is ADDITIVE: no existing field is renamed, retyped or removed, and nothing duplicates information that a canonical TES record already
 * holds (driver, vehicle, trailer, customer, jurisdiction and reporter are columns of the event; costs, delays, downtime, claims and recoveries are
 * consequence records; corrective actions and restrictions have their own tables; repair orders, citations and claims are relationship links).
 *
 * Data point ids are category-scoped (`DRV.PERF.<CODE>.<KEY>`), so they cannot collide with an existing shared data point.
 */

const machine = (label: string) => label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "UNKNOWN"
const human = (value: string) => value.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
const opts = (values: readonly string[]): ControlledOption[] => values.map((v) => ({ value: machine(v), label: /^[A-Z0-9_]+$/.test(v) ? human(v) : v }))

const YNU = ["YES", "NO", "UNKNOWN"]
const CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]

type Spec = { key: string; label: string; kind: PerformanceFieldKind; options?: readonly string[]; required?: boolean; unit?: string; help?: string; valueType?: PerformanceValueType }

const build = (code: string, spec: Spec): PerformanceFieldDefinition => ({
  key: spec.key,
  dataPointId: `DRV.PERF.${code}.${spec.key.toUpperCase()}`,
  valueType: spec.valueType ?? (spec.kind === "number" ? "number" : spec.kind === "boolean" ? "boolean" : spec.kind === "date" ? "date" : spec.kind === "time" ? "time" : "string"),
  label: spec.label,
  kind: spec.kind,
  required: spec.required,
  options: spec.options ? opts(spec.options) : undefined,
  unit: spec.unit,
  helpText: spec.help,
})

const t = (key: string, label: string, help?: string): Spec => ({ key, label, kind: "text", help })
const a = (key: string, label: string, help?: string): Spec => ({ key, label, kind: "textarea", help })
const s = (key: string, label: string, options: readonly string[], extra: Partial<Spec> = {}): Spec => ({ key, label, kind: "select", options, ...extra })
const n = (key: string, label: string, unit?: string, help?: string): Spec => ({ key, label, kind: "number", unit, help })
const d = (key: string, label: string): Spec => ({ key, label, kind: "date" })
const tm = (key: string, label: string): Spec => ({ key, label, kind: "time" })

const SPECS: Readonly<Record<string, readonly Spec[]>> = {
  COLLISION: [
    s("towAway", "Tow-Away", YNU, { help: "Whether any vehicle was towed from the scene because of damage. Leave unknown if not established." }),
    s("disablingDamage", "Disabling Damage", YNU),
    s("propertyDamageState", "Property Damage", YNU),
    t("insurerReference", "Insurer / Claim Reference", "The insurer's own reference, entered as given. A claim record is linked as a relationship."),
    s("causeStatus", "Cause Status", ["NOT_DETERMINED", "PRELIMINARY", "DETERMINED"]),
  ],
  CUSTOMER_EVENT: [
    a("expectedService", "Expected Service", "What the customer was entitled to expect (appointment, window, scope)."),
    a("actualService", "Actual Service", "What actually happened, as reported."),
  ],
  SECURITY_INCIDENT: [
    s("affectedAssetClass", "Affected Asset Class", ["VEHICLE", "TRAILER", "CARGO", "DATA_OR_SYSTEM", "FACILITY", "PERSON", "OTHER", "UNKNOWN"]),
    d("discoveryDate", "Discovery Date"),
    tm("discoveryTime", "Discovery Time"),
    s("accessMethod", "Access / Tampering", ["FORCED_ENTRY", "UNLOCKED_ACCESS", "CREDENTIAL_MISUSE", "TAMPERING_EVIDENT", "REMOTE_NETWORK", "NOT_APPLICABLE", "UNKNOWN"]),
    t("policeReportReference", "Police / Authority Report Reference"),
    s("containmentState", "Containment", ["NOT_REQUIRED", "IN_PROGRESS", "CONTAINED", "UNKNOWN"]),
    s("recoveryState", "Recovery", ["NOT_APPLICABLE", "NOT_RECOVERED", "PARTIALLY_RECOVERED", "FULLY_RECOVERED", "UNKNOWN"]),
  ],
  EQUIPMENT_FAILURE: [
    t("component", "Component"),
    t("symptom", "Symptom"),
    s("detectionMethod", "How the Defect Was Found", ["DRIVER_INSPECTION", "PRE_TRIP", "POST_TRIP", "ROADSIDE_INSPECTION", "TELEMATICS_FAULT_CODE", "MAINTENANCE_FINDING", "OTHER", "UNKNOWN"]),
    s("vehicleSafeToOperate", "Vehicle Safe to Operate", YNU, { help: "A restriction (out of service, hold) is recorded as a safety restriction, not here." }),
    s("repairCertificationState", "Repair Certification", ["NOT_REQUIRED", "PENDING", "CERTIFIED", "UNKNOWN"]),
    s("repeatDefectSuspected", "Repeat Defect Suspected", YNU),
  ],
  DEVICE_DATA_INTEGRITY: [
    t("deviceProvider", "Device Provider"),
    t("deviceIdentifier", "Device Identifier"),
    t("affectedIntervalStart", "Affected Interval - Start", "Local date and time, YYYY-MM-DDTHH:mm, in the event's time zone."),
    t("affectedIntervalEnd", "Affected Interval - End"),
    a("remediationNote", "Remediation"),
    s("downstreamFactsInvalidated", "Downstream Facts Invalidated", YNU),
    t("invalidatedScope", "Scope of Invalidated Facts"),
  ],
  FATIGUE_INDICATOR: [
    s("observedConfidence", "Observation Confidence", CONFIDENCE),
    s("interventionTaken", "Intervention", ["NONE", "DRIVER_CONTACTED", "REST_BREAK_REQUIRED", "DRIVER_RELIEVED", "ROUTE_ADJUSTED", "OTHER", "UNKNOWN"]),
    s("restRecoveryOutcome", "Rest / Recovery Outcome", ["NOT_APPLICABLE", "REST_TAKEN_RESUMED", "OFF_DUTY_COMPLETED", "UNRESOLVED", "UNKNOWN"]),
  ],
  EMERGENCY_EVENT: [
    s("emergencyTrigger", "Trigger", ["MEDICAL", "FIRE", "CRASH", "SECURITY_THREAT", "WEATHER", "EQUIPMENT", "OTHER", "UNKNOWN"]),
    t("responseAgencies", "Response Agencies"),
    a("immediateSafetyActions", "Immediate Safety Actions"),
    n("peopleImpactedCount", "People Impacted", "count", "Leave empty when not established; zero means confirmed none."),
    s("resolutionState", "Resolution", ["RESOLVED", "ONGOING", "ESCALATED", "UNKNOWN"]),
  ],
  SPEEDING: [
    s("gpsConfidence", "GPS Confidence", CONFIDENCE),
    s("roadCondition", "Road Condition", ["DRY", "WET", "SNOW", "ICE", "OTHER", "UNKNOWN"]),
  ],
  FOLLOWING_DISTANCE: [
    s("measurementConfidence", "Measurement Confidence", CONFIDENCE),
    s("weatherConditions", "Weather", ["CLEAR", "RAIN", "SNOW", "FOG", "WIND", "OTHER", "UNKNOWN"]),
    s("trafficConditions", "Traffic", ["LIGHT", "MODERATE", "HEAVY", "STOP_AND_GO", "UNKNOWN"]),
  ],
  DISTRACTED_DRIVING: [
    s("observationConfidence", "Observation Confidence", CONFIDENCE),
    t("safeguardsContext", "Safeguards in Place", "For example hands-free equipment in use."),
    s("reviewOutcome", "Review Outcome", ["PENDING", "CONFIRMED", "NOT_CONFIRMED", "UNABLE_TO_DETERMINE"]),
  ],
  IDLE_TIME: [
    t("idleStart", "Idle Start", "Local date and time, YYYY-MM-DDTHH:mm."),
    t("idleEnd", "Idle End"),
    s("engineState", "Engine State", ["IDLING", "PTO_ACTIVE", "REEFER_OPERATING", "UNKNOWN"]),
    n("ambientTemperature", "Ambient Temperature", "°C"),
    s("exemptionReason", "Exemption", ["NONE", "PTO_OPERATION", "LOADING_UNLOADING", "MANDATORY_REST", "EXTREME_TEMPERATURE", "TRAFFIC_QUEUE", "REGULATORY_STOP", "OTHER", "UNKNOWN"]),
    s("fuelEstimateBasis", "Fuel Estimate Basis", ["PROVIDER_REPORTED", "ENGINE_ECM", "COMPANY_RATE", "NOT_ESTIMATED"]),
    n("estimatedFuelUsed", "Estimated Fuel Used", "litres", "Only when a basis is stated; an estimate is never presented as a measurement."),
  ],
  SEATBELT: [
    s("occupantRole", "Occupant", ["DRIVER", "PASSENGER", "UNKNOWN"]),
    s("detectionConfidence", "Detection Confidence", CONFIDENCE),
    a("contextNotes", "Context"),
    s("verifiedOutcome", "Verified Outcome", ["PENDING_REVIEW", "CONFIRMED_NON_USE", "FALSE_POSITIVE", "UNABLE_TO_DETERMINE"]),
  ],
}

export const CATEGORY_FIELD_EXTENSIONS: Readonly<Record<string, readonly PerformanceFieldDefinition[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([code, specs]) => [code, specs.map((spec) => build(code, spec))]),
)

/** The "Others" category: an occurrence no defined category fits. It records why, so the taxonomy can learn from it. */
export const OTHER_EVENT_CODE = "OTHER_EVENT"
export const OTHER_EVENT_FIELDS: readonly PerformanceFieldDefinition[] = [
  build(OTHER_EVENT_CODE, a("noCategoryReason", "Why No Defined Category Fits", "Required: this is how new categories are identified.") as Spec & { required: true }),
  build(OTHER_EVENT_CODE, a("impactDescription", "Impact")),
  build(OTHER_EVENT_CODE, t("proposedSubtype", "Proposed Category / Subtype")),
  build(OTHER_EVENT_CODE, s("classificationReview", "Classification Review", ["NOT_REVIEWED", "ACCEPTED_AS_OTHER", "RECLASSIFY_TO_EXISTING", "NEW_SUBTYPE_PROPOSED"])),
  build(OTHER_EVENT_CODE, t("reclassifiedTo", "Reclassified To")),
].map((field) => (field.key === "noCategoryReason" ? { ...field, required: true } : field))

export const OTHER_EVENT_CATEGORY_SHELL: Omit<PerformanceCategoryDefinition, "fields"> = {
  code: OTHER_EVENT_CODE,
  value: "Other Event" as PerformanceCategoryDefinition["value"],
  label: "Other Event",
  description: "An occurrence that no defined category fits. It records why, its impact, and the classification review, so recurring cases can become new categories.",
  group: "Operations",
  sources: ["Driver Report", "Company Staff", "Customer", "Camera", "Maintenance", "Other"],
  evidenceRequired: false,
  determinationTypes: [],
  analyticsEligible: true,
  positiveEligible: false,
  temporalBehavior: "Occurrence",
  usesSeverity: true,
  usesStatus: true,
}
