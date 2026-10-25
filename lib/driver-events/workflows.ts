import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, PERFORMANCE_CATEGORY_OWNERSHIP, type PerformanceFieldDefinition } from "@/lib/driver-performance-schema"

/**
 * Category workflows for the Record of Events.
 *
 * Six categories (Collision, Near Miss, Roadside Inspection, Cargo Incident, Spill or Release, Customer Event) keep their existing detailed wizards
 * (src/components/drivers/DriverPerformanceEventWorkflow.tsx), which now save through the canonical store. Every other recordable category has its own
 * workflow below: its own sections in the order a person thinks about that event, the guidance that explains what is and is not decided here, and the
 * records that usually follow (evidence, consequences, follow-up). They all render through ONE shared form (CategoryEventForm), so a field is defined
 * once - in the registry - and validated once, on the server.
 */

export const DETAILED_WIZARD_CATEGORIES = ["Collision", "Near Miss", "Roadside Inspection", "Cargo Incident", "Spill or Release", "Customer Event"] as const

export type WorkflowSection = { id: string; title: string; hint?: string; keys: readonly string[] }
export type CategoryWorkflow = {
  code: string
  intro: string
  /** What this category deliberately does NOT conclude, so nobody reads more into the record than it says. */
  boundary: string
  sections: readonly WorkflowSection[]
  evidenceRoles: readonly string[]
  consequenceKinds: readonly string[]
  /** A restriction this category's answers create automatically (see obligations.ts). */
  createsRestriction?: string
}

const S = (id: string, title: string, keys: readonly string[], hint?: string): WorkflowSection => ({ id, title, keys, hint })
const SOURCE = S("source", "Source", ["sourceType", "sourceRecordId"], "Where this information came from. A device record is an observation until a person reviews it.")

export const CATEGORY_WORKFLOWS: Readonly<Record<string, CategoryWorkflow>> = {
  SECURITY_INCIDENT: {
    code: "SECURITY_INCIDENT",
    intro: "Theft, tampering, unauthorised access or another threat to a vehicle, trailer, cargo, data or person.",
    boundary: "Records what was observed and what was done. Loss values are consequence records; a police report is referenced, not summarised.",
    sections: [
      S("what", "What happened", ["securityType", "incidentNarrative", "affectedAssetClass", "affectedAsset"]),
      S("discovery", "Discovery and access", ["discoveryDate", "discoveryTime", "accessMethod"], "When it was found can differ from when it happened."),
      S("response", "Authorities, containment and recovery", ["lawEnforcementNotified", "policeReportReference", "containmentState", "recoveryState"]),
      SOURCE,
    ],
    evidenceRoles: ["POLICE_REPORT", "PHOTO_VIDEO", "SOURCE_REPORT"],
    consequenceKinds: ["DAMAGE", "COST_ACTUAL", "RECOVERY", "OPERATIONAL_DELAY"],
  },
  EQUIPMENT_FAILURE: {
    code: "EQUIPMENT_FAILURE",
    intro: "A mechanical or equipment failure or critical defect, kept separate from any later attribution to the driver, vehicle or company.",
    boundary: "'Not safe to operate' creates a mandatory equipment hold; it is released only with the documented correction. Repair orders and their cost are linked, not retyped.",
    sections: [
      S("defect", "The defect", ["equipmentIssueType", "component", "symptom", "equipmentNarrative"]),
      S("detection", "How it was found", ["defectReported", "reportedDate", "detectionMethod", "vehicleContext"]),
      S("safety", "Safety and repair", ["vehicleSafeToOperate", "repairCertificationState", "repeatDefectSuspected"], "Answering 'No' to safe to operate holds the vehicle."),
      SOURCE,
    ],
    evidenceRoles: ["REPAIR_RECORD", "PHOTO_VIDEO", "INSPECTION_REPORT", "RELEASE_EVIDENCE"],
    consequenceKinds: ["ASSET_DOWNTIME", "COST_ACTUAL", "OPERATIONAL_DELAY", "MISSED_SERVICE"],
    createsRestriction: "EQUIPMENT_HOLD",
  },
  DEVICE_DATA_INTEGRITY: {
    code: "DEVICE_DATA_INTEGRITY",
    intro: "A telematics, ELD, camera or other device produced missing, corrupt, tampered or contradictory data.",
    boundary: "Says which data cannot be trusted and for what interval; it does not decide what the driver did. Facts built on this data are marked as affected.",
    sections: [
      S("device", "The device", ["deviceType", "deviceProvider", "deviceIdentifier", "integrityState"]),
      S("anomaly", "The anomaly", ["anomalyType", "interferenceMethod", "dataImpact", "deviceDisabled", "dataLossDurationMinutes"]),
      S("interval", "Detection and affected interval", ["detectionDate", "detectionTime", "affectedIntervalStart", "affectedIntervalEnd"]),
      S("remedy", "Remediation and downstream effect", ["dataRecoveryState", "remediationNote", "downstreamFactsInvalidated", "invalidatedScope"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "OTHER"],
    consequenceKinds: ["OPERATIONAL_DELAY", "INVESTIGATION_TIME", "CORRECTIVE_ACTION_COST"],
  },
  FATIGUE_INDICATOR: {
    code: "FATIGUE_INDICATOR",
    intro: "A fatigue indicator from a camera, sensor, observation or the driver, with the duty context it occurred in.",
    boundary: "An indicator is not a finding of fatigue and not an hours-of-service conclusion; the HOS Violation record owns that. Confidence is stated, not assumed.",
    sections: [
      S("indicator", "The indicator", ["indicatorType", "eyeClosureDurationMs", "perclosPercent", "observedConfidence", "indicatorNotes"]),
      S("context", "Duty context", ["dutyContext", "hosProximity", "hoursDriven", "timeSinceBreakMinutes", "consecutiveDrivingDays", "sourceClassification"]),
      S("response", "Intervention and outcome", ["interventionTaken", "restRecoveryOutcome"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "PHOTO_VIDEO"],
    consequenceKinds: ["OPERATIONAL_DELAY", "MISSED_SERVICE"],
  },
  EMERGENCY_EVENT: {
    code: "EMERGENCY_EVENT",
    intro: "A medical, fire, crash, security or weather emergency involving a driver or unit.",
    boundary: "Captures class, response and resolution. Injuries, damage and cost are consequence records; a resulting collision or spill is its own linked event.",
    sections: [
      S("emergency", "The emergency", ["emergencyType", "emergencyTrigger", "emergencyNarrative"]),
      S("response", "Response", ["emergencyServices", "responseAgencies", "immediateSafetyActions"]),
      S("impact", "Impact and resolution", ["peopleImpactedCount", "downtimeHours", "resolutionState"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "POLICE_REPORT", "MEDICAL_RECORD", "PHOTO_VIDEO"],
    consequenceKinds: ["INJURY", "DAMAGE", "OPERATIONAL_DELAY", "ASSET_DOWNTIME", "COST_ACTUAL"],
  },
  SPEEDING: {
    code: "SPEEDING",
    intro: "A measured speed above a threshold, from telematics, a camera or another recorded source.",
    boundary: "A measurement against a stated threshold. It is not a citation and not a finding of fault. Rates need exposure (distance, hours), which is joined from trip and ELD facts, not typed here.",
    sections: [
      S("measure", "Measurement", ["actualSpeed", "peakSpeed", "averageSpeed", "durationSeconds", "distanceTraveled", "amountExceeded"]),
      S("threshold", "Threshold", ["thresholdBasis", "postedSpeedLimit", "companyThreshold", "applicableThreshold", "thresholdVersion", "thresholdEffectiveDate"], "The posted limit is the limit on the road; the company threshold is a policy value. Say which one applies."),
      S("context", "Context and confidence", ["zoneType", "loadStatus", "roadCondition", "gpsConfidence", "provider"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "PHOTO_VIDEO"],
    consequenceKinds: ["INVESTIGATION_TIME"],
  },
  HARSH_BRAKING: {
    code: "HARSH_BRAKING",
    intro: "A braking event beyond the configured deceleration threshold.",
    boundary: "A device-detected event. Cause (a hazard ahead, a driving habit) is not decided here; coaching is a Company Action linked to the event.",
    sections: [
      S("event", "The event", ["triggerDeceleration", "peakDeceleration", "averageDeceleration", "durationSeconds", "speedAtTrigger", "endingSpeed", "distanceMeters", "distanceTraveled"]),
      S("threshold", "Threshold", ["threshold", "thresholdVariance", "thresholdVersion"]),
      S("context", "Context", ["roadGrade", "weather", "roadSurface", "lighting", "traffic", "loadStatus", "forwardCollisionWarning", "provider"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "PHOTO_VIDEO"],
    consequenceKinds: ["INVESTIGATION_TIME"],
  },
  HARSH_ACCELERATION: {
    code: "HARSH_ACCELERATION",
    intro: "An acceleration event beyond the configured threshold.",
    boundary: "A device-detected event; the driver's intent or the road situation is not decided here.",
    sections: [
      S("event", "The event", ["triggerAcceleration", "peakAcceleration", "averageAcceleration", "durationSeconds", "triggerSpeed", "endingSpeed", "distanceMeters", "distanceTraveled"]),
      S("threshold", "Threshold", ["threshold", "variance"]),
      S("context", "Context", ["loadStatus", "weather", "road", "lighting"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT"],
    consequenceKinds: ["INVESTIGATION_TIME"],
  },
  HARSH_CORNERING: {
    code: "HARSH_CORNERING",
    intro: "A cornering event beyond the configured lateral acceleration threshold.",
    boundary: "A device-detected event; the driver's intent or the road geometry is not decided here.",
    sections: [
      S("event", "The event", ["lateralAcceleration", "peakLateralAcceleration", "averageLateralAcceleration", "durationSeconds", "speed", "turnRadius", "distanceTraveled"]),
      S("threshold", "Threshold", ["threshold", "variance"]),
      S("context", "Context", ["loadStatus", "roadGeometry", "weather", "roadSurface"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT"],
    consequenceKinds: ["INVESTIGATION_TIME"],
  },
  FOLLOWING_DISTANCE: {
    code: "FOLLOWING_DISTANCE",
    intro: "A following gap (time or distance) below the configured threshold.",
    boundary: "A measured headway with its unit and confidence. Whether it was unsafe in the conditions is a person's review, not this record.",
    sections: [
      S("gap", "Measured gap", ["timeGapSeconds", "distanceGapMeters", "minimumTimeGapSeconds", "minimumDistanceGapMeters", "durationSeconds", "distanceTraveledMeters"]),
      S("threshold", "Thresholds", ["timeGapThresholdSeconds", "timeGapVarianceSeconds", "distanceThresholdMeters", "distanceVarianceMeters"]),
      S("speed", "Speeds", ["driverVehicleSpeed", "leadVehicleSpeed", "relativeSpeed"]),
      S("context", "Conditions and confidence", ["loadStatus", "weatherConditions", "trafficConditions", "measurementConfidence"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "PHOTO_VIDEO"],
    consequenceKinds: ["INVESTIGATION_TIME"],
  },
  DISTRACTED_DRIVING: {
    code: "DISTRACTED_DRIVING",
    intro: "An observed distraction (phone, eating, looking away and similar) from a camera, device or witness.",
    boundary: "An observation, with the source's confidence. It becomes a verified distraction only when a person records the review outcome.",
    sections: [
      S("observation", "The observation", ["distractionType", "durationSeconds", "speed", "observedContext"]),
      S("reliability", "Confidence and review", ["observationConfidence", "safeguardsContext", "reviewOutcome"], "Say how sure the source is and what a reviewer concluded."),
      SOURCE,
    ],
    evidenceRoles: ["PHOTO_VIDEO", "SOURCE_REPORT"],
    consequenceKinds: ["INVESTIGATION_TIME"],
  },
  IDLE_TIME: {
    code: "IDLE_TIME",
    intro: "An engine-idling interval beyond the configured threshold.",
    boundary: "Duration and conditions. Fuel use is an estimate with a stated basis, never a measurement unless the source measured it; exempt idling (PTO, loading, mandatory rest) is recorded as exempt, not as waste.",
    sections: [
      S("interval", "The interval", ["idleStart", "idleEnd", "durationMinutes", "thresholdMinutes", "varianceMinutes"]),
      S("conditions", "Conditions", ["engineState", "ambientTemperature", "locationType", "loadStatus"]),
      S("exemption", "Exemption and fuel estimate", ["exemptionReason", "fuelEstimateBasis", "estimatedFuelUsed"], "An estimated figure must say what it was estimated from."),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT"],
    consequenceKinds: [],
  },
  SEATBELT: {
    code: "SEATBELT",
    intro: "An observed seatbelt non-use, or a seatbelt alert, with who was observed.",
    boundary: "An observation with confidence. A verified outcome is entered by a reviewer after checking the source.",
    sections: [
      S("observation", "The observation", ["seatbeltState", "occupantRole", "durationSeconds", "speed"]),
      S("reliability", "Source, confidence and outcome", ["provider", "detectionConfidence", "verifiedOutcome", "contextNotes"]),
      SOURCE,
    ],
    evidenceRoles: ["PHOTO_VIDEO", "SOURCE_REPORT"],
    consequenceKinds: [],
  },
  OTHER_EVENT: {
    code: "OTHER_EVENT",
    intro: "Something that matters operationally but fits none of the defined categories.",
    boundary: "State why no category fits. A reviewer later classifies it into an existing category (a correction, not a second event) or proposes a new subtype.",
    sections: [
      S("why", "Why no category fits", ["noCategoryReason", "impactDescription"]),
      S("review", "Classification review", ["classificationReview", "proposedSubtype", "reclassifiedTo"]),
      SOURCE,
    ],
    evidenceRoles: ["SOURCE_REPORT", "PHOTO_VIDEO", "OTHER"],
    consequenceKinds: ["OPERATIONAL_DELAY", "ASSET_DOWNTIME", "COST_ACTUAL", "DAMAGE"],
  },
  ROUTE_DEVIATION: {
    code: "ROUTE_DEVIATION",
    intro: "A departure from the planned route (existing conditional category, preserved unchanged).",
    boundary: "Distance, duration and the stated reason. Whether it was authorised is a dispatch record, linked rather than copied.",
    sections: [S("deviation", "The deviation", ["deviationDistanceMiles", "deviationDurationMinutes", "deviationReason"]), SOURCE],
    evidenceRoles: ["SOURCE_REPORT"],
    consequenceKinds: ["OPERATIONAL_DELAY", "MISSED_SERVICE"],
  },
}

/** Sections for a category with every remaining creatable field gathered into a final section, so nothing the registry defines is unreachable. */
export function sectionsFor(code: string): WorkflowSection[] {
  const workflow = CATEGORY_WORKFLOWS[code]
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === code)
  if (!workflow || !definition) return []
  const creatable = definition.fields.filter((f) => !f.hiddenInCreation)
  const used = new Set(workflow.sections.flatMap((s) => s.keys))
  const rest = creatable.filter((f) => !used.has(f.key)).map((f) => f.key)
  return rest.length ? [...workflow.sections, S("more", "Additional details", rest)] : [...workflow.sections]
}

export const fieldsOf = (code: string): Map<string, PerformanceFieldDefinition> => new Map((DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === code)?.fields ?? []).map((f) => [f.key, f]))

export const WORKFLOW_CODES = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter(
  (d) => PERFORMANCE_CATEGORY_OWNERSHIP[d.value] === "RECORDABLE_EVENT" && !(DETAILED_WIZARD_CATEGORIES as readonly string[]).includes(d.value),
).map((d) => d.code)
