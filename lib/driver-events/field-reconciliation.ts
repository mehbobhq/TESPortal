import { CATEGORY_FIELD_EXTENSIONS, OTHER_EVENT_FIELDS } from "./category-extensions"
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, PERFORMANCE_CATEGORY_OWNERSHIP } from "../driver-performance-schema"

/**
 * Field reconciliation: the baseline (TES_Driver_Events_Field_Baseline.md) against what the repository already had.
 *
 *   1. `existingFieldInventory()`  - every field of every recordable category as it exists in the registry (generated, never hand-typed), marked
 *      PRESERVED (existed before this work) or ADDED (introduced by lib/driver-events/category-extensions.ts).
 *   2. `BASELINE_MAPPING`          - for every baseline element, where it lives now. A baseline element is mapped to an existing registry field (PRESERVED),
 *      a field added by the extension (ADDED), a canonical column / link (CANONICAL), a shared record (CONSEQUENCE, RELATIONSHIP, RESTRICTION, ACTION, EVIDENCE),
 *      an existing rich child collection (CHILD_COLLECTION), a derived analytical column (DERIVED) or a decision not to capture it here (NOT_CAPTURED).
 *
 * The test suite asserts that every target exists, so this mapping cannot silently drift from the code.
 */

export type Disposition = "PRESERVED" | "ADDED" | "CANONICAL" | "CONSEQUENCE" | "RELATIONSHIP" | "RESTRICTION" | "ACTION" | "EVIDENCE" | "CHILD_COLLECTION" | "DERIVED" | "NOT_CAPTURED"
export type Target =
  | { kind: "FIELD"; category: string; key: string }
  | { kind: "COLUMN"; name: string }
  | { kind: "CONSEQUENCE"; consequence: string }
  | { kind: "RELATIONSHIP"; type: string }
  | { kind: "RESTRICTION"; restrictionKind: string }
  | { kind: "ACTION"; actionType: string }
  | { kind: "EVIDENCE"; role: string }
  | { kind: "COLLECTION"; id: string }
  | { kind: "FACT"; column: string }
export type Jurisdiction = "ALL" | "US" | "CA" | "US+CA (person-entered, not computed)"
export type MappingRow = { category: string; element: string; disposition: Disposition; targets: Target[]; jurisdiction: Jurisdiction; requirement: "ESSENTIAL" | "CONDITIONAL"; bi: string; note?: string }

const F = (category: string, ...keys: string[]): Target[] => keys.map((key) => ({ kind: "FIELD", category, key }))
const col = (...names: string[]): Target[] => names.map((name) => ({ kind: "COLUMN", name }))
const cons = (...c: string[]): Target[] => c.map((consequence) => ({ kind: "CONSEQUENCE", consequence }))
const rel = (...t: string[]): Target[] => t.map((type) => ({ kind: "RELATIONSHIP", type }))
const res = (...k: string[]): Target[] => k.map((restrictionKind) => ({ kind: "RESTRICTION", restrictionKind }))
const act = (...t: string[]): Target[] => t.map((actionType) => ({ kind: "ACTION", actionType }))
const evd = (...r: string[]): Target[] => r.map((role) => ({ kind: "EVIDENCE", role }))
const coll = (...ids: string[]): Target[] => ids.map((id) => ({ kind: "COLLECTION", id }))
const fact = (...c: string[]): Target[] => c.map((column) => ({ kind: "FACT", column }))

const row = (category: string, element: string, disposition: Disposition, targets: Target[], bi: string, extra: Partial<Pick<MappingRow, "jurisdiction" | "requirement" | "note">> = {}): MappingRow => ({
  category, element, disposition, targets, bi, jurisdiction: extra.jurisdiction ?? "ALL", requirement: extra.requirement ?? "CONDITIONAL", note: extra.note,
})
const REGULATORY_NOTE = "Person-entered. TES does not compute a deadline, reportability or compliance conclusion: the governing regulatory text could not be verified in the build environment."

export const BASELINE_MAPPING: readonly MappingRow[] = [
  // ----------------------------------------------------------------------------------------------------------------------------------------- common
  row("COMMON", "Event ID; tenant/company", "CANONICAL", col("id", "organization_id"), "event_id, organization_id", { requirement: "ESSENTIAL" }),
  row("COMMON", "Category / subtype / schema version", "CANONICAL", col("category", "category_code", "subtype", "schema_version"), "category, category_code, schema_version", { requirement: "ESSENTIAL" }),
  row("COMMON", "Title / narrative", "CANONICAL", col("title", "narrative"), "-", { requirement: "ESSENTIAL" }),
  row("COMMON", "Occurred at with IANA zone and source-local time", "CANONICAL", col("occurred_at", "occurred_time_zone", "occurred_local_date", "occurred_local_time", "occurrence_precision"), "occurred_at, occurred_time_zone, occurred_local_date, occurrence_precision", { requirement: "ESSENTIAL", note: "A date-only occurrence has no instant; precision is stored, never inferred." }),
  row("COMMON", "Reported at", "CANONICAL", col("reported_at", "reported_local_date"), "reported_at, reporting_lag_minutes", { requirement: "ESSENTIAL" }),
  row("COMMON", "Reporter / actor", "CANONICAL", col("reporter_actor_id", "reporter_label", "created_by_actor_id"), "-", { requirement: "ESSENTIAL" }),
  row("COMMON", "Source type and source reference", "CANONICAL", col("source_type", "source_reference", "ingestion_origin"), "source_type, ingestion_origin, source_reliability", { requirement: "ESSENTIAL", note: "A source reference is unique per company/category/source: ingestion is idempotent." }),
  row("COMMON", "Canonical driver / vehicle / trailer links", "CANONICAL", col("driver_relationship_id", "driver_person_id", "vehicle_relationship_id", "vehicle_id", "trailer_relationship_id", "trailer_vehicle_id"), "driver_relationship_id, driver_person_id, vehicle_id, trailer_vehicle_id", { note: "Composite foreign keys to the company's own relationships; no copy of driver or vehicle data is stored on the event." }),
  row("COMMON", "Trip / shipment / customer references", "CANONICAL", col("trip_reference", "load_reference", "shipment_reference", "customer_reference"), "load_reference, shipment_reference, customer_reference", { note: "Free-text references only where no canonical record exists yet; replaced by canonical ids when Trip/Shipment/Customer records are linked." }),
  row("COMMON", "Location and jurisdiction", "CANONICAL", col("location_text", "city", "state_province", "country", "jurisdiction_code", "latitude", "longitude"), "jurisdiction_code, country, state_province"),
  row("COMMON", "Observed and potential severity", "CANONICAL", col("observed_severity", "potential_severity"), "severity_observed, severity_potential"),
  row("COMMON", "Lifecycle state", "CANONICAL", col("status", "record_state"), "status, resolution_state", { requirement: "ESSENTIAL" }),
  row("COMMON", "Data quality / verification state", "CANONICAL", col("data_quality", "verification_state"), "data_quality_score, required_fields_missing, quality_flags, verification_state"),
  row("COMMON", "Evidence references and status", "EVIDENCE", evd("SOURCE_REPORT", "PHOTO_VIDEO", "OTHER"), "evidence_links_active, evidence_stored, evidence_verified", { note: "Links documents that completed the GCS quarantine -> scan -> intake -> evidence lifecycle. Linked is not verified." }),
  row("COMMON", "Related event and downstream record ids", "RELATIONSHIP", rel("DUPLICATE_OF", "SAME_OCCURRENCE", "CAUSED_BY", "CAUSES", "FOLLOW_UP_OF", "RELATED", "CITATION", "REPAIR_ORDER", "CLAIM", "INSPECTION_FINDING", "TRAINING_RECORD", "COMPANY_ACTION", "MAINTENANCE_RECORD", "DISPATCH_RECORD"), "duplicates excluded from driver_event_facts_v1"),
  row("COMMON", "Corrective action owner / due / status", "ACTION", act("CORRECTIVE", "PREVENTIVE", "COACHING", "TRAINING", "REPAIR", "REPORT", "NOTIFICATION", "INVESTIGATION", "OTHER"), "actions_total, actions_open, required_actions_open, next_action_due"),
  row("COMMON", "Review and closure attribution", "CANONICAL", col("closed_at", "closed_by_actor_id", "closure_reason"), "closed_at, hours_to_close", { requirement: "ESSENTIAL" }),
  row("COMMON", "Consequence records", "CONSEQUENCE", cons("OPERATIONAL_DELAY", "ASSET_DOWNTIME", "MISSED_SERVICE", "COST_ESTIMATED", "COST_ACTUAL", "CLAIM", "RECOVERY", "INJURY", "DAMAGE", "ENFORCEMENT", "ENVIRONMENTAL", "CUSTOMER_IMPACT", "INVESTIGATION_TIME", "CORRECTIVE_ACTION_COST"), "delay_minutes, downtime_minutes, cost_*_minor, net_impact_minor", { note: "Each consequence carries source, confidence, measurement date and canonical link; one source record is counted once (database-enforced). Child-collection financial facts of the rich workflows are source detail only: analytics read consequence records, so nothing is counted twice." }),
  row("COMMON", "Master Register history", "CANONICAL", col("current_version"), "corrections_count", { requirement: "ESSENTIAL", note: "Immutable driver_event_history + Master Register events (RECORD_CREATED / UPDATED / CORRECTED / STATUS_CHANGED / LINK_ESTABLISHED / EVIDENCE_ASSOCIATED)." }),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 1 collision
  row("COLLISION", "Collision configuration", "PRESERVED", F("COLLISION", "collisionClassType", "collisionManner", "firstHarmfulEvent"), "category, severity", { requirement: "ESSENTIAL" }),
  row("COLLISION", "Road and weather conditions", "PRESERVED", F("COLLISION", "weather", "roadCondition", "lightCondition", "visibility", "trafficCondition", "workZone"), "contextual dimensions"),
  row("COLLISION", "Involved parties / assets", "CHILD_COLLECTION", coll("DRV.PERF.COLLISION.INVOLVED_PARTIES"), "-", { note: "Own vehicle/trailer are canonical links (vehicle_id, trailer_vehicle_id); other parties stay in the collection." }),
  row("COLLISION", "Injuries / fatalities", "PRESERVED", [...F("COLLISION", "injuryStatus"), ...coll("DRV.PERF.COLLISION.INJURED_PERSONS")], "injuries_count, fatalities_count", { requirement: "ESSENTIAL", note: "Counts in the fact come from INJURY consequence records (units injuries / fatalities); unknown stays NULL." }),
  row("COLLISION", "Tow-away", "ADDED", F("COLLISION", "towAway"), "tow_away", { note: "Replaces the hidden legacy boolean towRequired for new records; YES / NO / UNKNOWN." }),
  row("COLLISION", "Disabling damage; property damage", "ADDED", F("COLLISION", "disablingDamage", "propertyDamageState"), "property_damage"),
  row("COLLISION", "Damage value / cost", "CONSEQUENCE", cons("DAMAGE", "COST_ESTIMATED", "COST_ACTUAL"), "cost_estimated_minor, cost_actual_minor"),
  row("COLLISION", "Reportability determination and jurisdiction", "PRESERVED", [...F("COLLISION", "reportabilityResult"), ...col("jurisdiction_code")], "jurisdiction_code", { jurisdiction: "US+CA (person-entered, not computed)", note: REGULATORY_NOTE + " 49 CFR 390.15 accident-register minimum fields are applicable only when the record meets that definition; not asserted here." }),
  row("COLLISION", "Police report reference", "PRESERVED", F("COLLISION", "policeResponse", "policeReportReference", "enforcementStatus"), "-"),
  row("COLLISION", "Insurer report reference", "ADDED", F("COLLISION", "insurerReference"), "-"),
  row("COLLISION", "Hazmat release", "PRESERVED", [...F("COLLISION", "hazmatConsequence"), ...rel("CAUSES", "RELATED")], "-", { note: "A release is its own Spill or Release event, related to the collision." }),
  row("COLLISION", "Cause status", "ADDED", F("COLLISION", "causeStatus"), "-"),
  row("COLLISION", "Claim and repair links", "RELATIONSHIP", [...rel("CLAIM", "REPAIR_ORDER"), ...cons("CLAIM", "RECOVERY")], "claim_amount_minor, recovery_amount_minor, net_impact_minor"),
  row("COLLISION", "Operational downtime / service interruption", "PRESERVED", [...F("COLLISION", "downtimeHours", "serviceInterruption"), ...cons("ASSET_DOWNTIME", "OPERATIONAL_DELAY")], "downtime_minutes, delay_minutes"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 2 near miss
  row("NEAR_MISS", "Hazard", "PRESERVED", F("NEAR_MISS", "nearMissPrimaryType", "zoneType", "unsafeConditionRemains"), "precursor patterns", { requirement: "ESSENTIAL" }),
  row("NEAR_MISS", "Maneuver", "PRESERVED", F("NEAR_MISS", "operatingActivity", "directionOfTravel"), "precursor patterns"),
  row("NEAR_MISS", "Potential impact", "PRESERVED", [...F("NEAR_MISS", "potentialSeverityReported"), ...coll("DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCES"), ...col("potential_severity")], "severity_potential"),
  row("NEAR_MISS", "Proximity", "PRESERVED", F("NEAR_MISS", "distanceToImpact", "timeToCollision", "speed"), "-"),
  row("NEAR_MISS", "Witness / source", "PRESERVED", F("NEAR_MISS", "reporterDescription", "otherPartyType", "otherPartyObject", "sourceType"), "source_reliability"),
  row("NEAR_MISS", "Avoided consequence", "CHILD_COLLECTION", coll("DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCES"), "-", { note: "A potential consequence is not a recorded consequence: it is never counted in cost or downtime." }),
  row("NEAR_MISS", "Corrective action", "CHILD_COLLECTION", [...coll("DRV.PERF.NEAR_MISS.IMMEDIATE_RESPONSES", "DRV.PERF.NEAR_MISS.UNSAFE_CONDITION_RESOLUTIONS"), ...act("CORRECTIVE", "PREVENTIVE")], "actions_open, next_action_due"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 3 roadside
  row("ROADSIDE_INSPECTION", "Authority", "PRESERVED", F("ROADSIDE_INSPECTION", "agency", "inspectionRegime"), "-", { requirement: "ESSENTIAL" }),
  row("ROADSIDE_INSPECTION", "Report number", "PRESERVED", [...F("ROADSIDE_INSPECTION", "inspectionReportNumber"), ...col("source_reference")], "-", { note: "User-provided only, never fabricated." }),
  row("ROADSIDE_INSPECTION", "Level", "PRESERVED", F("ROADSIDE_INSPECTION", "inspectionClassification", "inspectionScope"), "-"),
  row("ROADSIDE_INSPECTION", "Date / location", "CANONICAL", [...col("occurred_at", "occurred_time_zone", "location_text", "city", "jurisdiction_code"), ...F("ROADSIDE_INSPECTION", "jurisdiction")], "occurred_local_date, jurisdiction_code", { jurisdiction: "US+CA (person-entered, not computed)" }),
  row("ROADSIDE_INSPECTION", "Inspected driver / assets", "CANONICAL", [...col("driver_relationship_id", "vehicle_id", "trailer_vehicle_id"), ...coll("DRV.PERF.ROADSIDE_INSPECTION.INSPECTED_EQUIPMENT")], "driver_relationship_id, vehicle_id"),
  row("ROADSIDE_INSPECTION", "Violation codes and units", "CHILD_COLLECTION", [...coll("DRV.PERF.ROADSIDE_INSPECTION.VIOLATIONS"), ...F("ROADSIDE_INSPECTION", "sourceReportedViolationCount")], "violation/OOS rate, recurring defects", { requirement: "ESSENTIAL" }),
  row("ROADSIDE_INSPECTION", "Warning / citation", "RELATIONSHIP", rel("CITATION"), "-", { note: "The authoritative Citation record owns the citation; the event links it once." }),
  row("ROADSIDE_INSPECTION", "Out-of-service order and scope", "RESTRICTION", [...F("ROADSIDE_INSPECTION", "driverOOSState", "vehicleOOSState"), ...res("DRIVER_OUT_OF_SERVICE", "VEHICLE_OUT_OF_SERVICE")], "restrictions_active, restrictions_released, resolution_state", { requirement: "ESSENTIAL", jurisdiction: "US+CA (person-entered, not computed)", note: "A YES answer creates a mandatory restriction automatically. It is released only through the dedicated capability with verified release evidence; a status change, a correction of the answer or a company clearance cannot clear it. 49 CFR 396.9 applicability is not computed." }),
  row("ROADSIDE_INSPECTION", "Required correction", "RESTRICTION", [...res("VEHICLE_OUT_OF_SERVICE"), ...act("REPAIR")], "required_actions_open", { note: "Stored on the restriction (required_correction) and as a required follow-up action." }),
  row("ROADSIDE_INSPECTION", "Release evidence", "EVIDENCE", evd("RELEASE_EVIDENCE", "CORRECTION_EVIDENCE", "REPAIR_RECORD", "INSPECTION_REPORT"), "restrictions_released", { requirement: "ESSENTIAL" }),
  row("ROADSIDE_INSPECTION", "Response deadline", "RESTRICTION", res("VEHICLE_OUT_OF_SERVICE", "DRIVER_OUT_OF_SERVICE"), "next_action_due", { jurisdiction: "US+CA (person-entered, not computed)", note: REGULATORY_NOTE + " response_deadline is recorded as stated on the order." }),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 4 cargo
  row("CARGO_INCIDENT", "Shipment / load id", "PRESERVED", [...F("CARGO_INCIDENT", "loadReference", "shipmentReference", "bolPro"), ...col("load_reference", "shipment_reference")], "load_reference, shipment_reference", { requirement: "ESSENTIAL" }),
  row("CARGO_INCIDENT", "Commodity", "PRESERVED", [...F("CARGO_INCIDENT", "cargoGeneralDescription"), ...coll("DRV.PERF.CARGO_INCIDENT.ITEMS")], "loss by commodity"),
  row("CARGO_INCIDENT", "Quantity / value", "CHILD_COLLECTION", [...coll("DRV.PERF.CARGO_INCIDENT.ITEMS"), ...cons("DAMAGE", "COST_ACTUAL")], "cost_actual_minor", { note: "Item quantities stay in the collection; the monetary loss that is counted is a consequence record." }),
  row("CARGO_INCIDENT", "Seal / custody", "CHILD_COLLECTION", [...coll("DRV.PERF.CARGO_INCIDENT.CUSTODY_CHAIN", "DRV.PERF.CARGO_INCIDENT.SECURITY_CONTROLS"), ...F("CARGO_INCIDENT", "custodyStage", "cargoSecured")], "-"),
  row("CARGO_INCIDENT", "Damage / loss / theft type", "PRESERVED", [...F("CARGO_INCIDENT", "primaryFamily", "secondaryClassification"), ...coll("DRV.PERF.CARGO_INCIDENT.DAMAGE_OUTCOME", "DRV.PERF.CARGO_INCIDENT.THEFT_OUTCOME")], "category, severity", { requirement: "ESSENTIAL" }),
  row("CARGO_INCIDENT", "Delivery consequence", "CONSEQUENCE", cons("MISSED_SERVICE", "OPERATIONAL_DELAY", "CUSTOMER_IMPACT"), "missed_service, delay_minutes"),
  row("CARGO_INCIDENT", "Claim and recovery", "CONSEQUENCE", [...cons("CLAIM", "RECOVERY"), ...rel("CLAIM")], "claim_amount_minor, recovery_amount_minor, net_impact_minor"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 5 spill
  row("SPILL_RELEASE", "Substance", "CHILD_COLLECTION", coll("DRV.PERF.SPILL_RELEASE.MATERIALS"), "-", { requirement: "ESSENTIAL" }),
  row("SPILL_RELEASE", "Quantity / unit", "CHILD_COLLECTION", coll("DRV.PERF.SPILL_RELEASE.QUANTITIES"), "-", { requirement: "ESSENTIAL" }),
  row("SPILL_RELEASE", "Source", "PRESERVED", F("SPILL_RELEASE", "sourceCategory", "sourceSubsystem", "sourceComponent", "releaseMechanism"), "-"),
  row("SPILL_RELEASE", "Location", "CANONICAL", [...col("location_text", "city", "state_province", "country", "jurisdiction_code"), ...F("SPILL_RELEASE", "originText", "facilitySite")], "jurisdiction_code"),
  row("SPILL_RELEASE", "Containment", "PRESERVED", [...F("SPILL_RELEASE", "valveClosed", "absorbentApplied", "drainProtected", "areaSecured", "releaseCondition", "continuingDanger"), ...coll("DRV.PERF.SPILL_RELEASE.RESPONSE_TIMELINE")], "-"),
  row("SPILL_RELEASE", "Exposure", "PRESERVED", [...F("SPILL_RELEASE", "waterwayRisk", "publicExposureRisk", "evacuationPerformed"), ...coll("DRV.PERF.SPILL_RELEASE.PERSONS", "DRV.PERF.SPILL_RELEASE.ENVIRONMENTAL_MEDIA")], "-"),
  row("SPILL_RELEASE", "Reporting applicability / deadline", "CHILD_COLLECTION", coll("DRV.PERF.SPILL_RELEASE.REGULATORY_ASSESSMENTS"), "-", { jurisdiction: "US+CA (person-entered, not computed)", note: REGULATORY_NOTE }),
  row("SPILL_RELEASE", "Notifications", "CHILD_COLLECTION", [...coll("DRV.PERF.SPILL_RELEASE.REGULATORY_EXECUTIONS"), ...F("SPILL_RELEASE", "dispatchContacted", "emergencyServicesContacted", "hazmatResponseContacted")], "response latency"),
  row("SPILL_RELEASE", "Cleanup contractor / cost", "CHILD_COLLECTION", [...coll("DRV.PERF.SPILL_RELEASE.CLEANUP_RECORDS"), ...cons("COST_ACTUAL", "ENVIRONMENTAL")], "cost_actual_minor", { note: "The cleanup record names the contractor; the counted cost is a consequence record." }),
  row("SPILL_RELEASE", "Closure evidence", "EVIDENCE", [...evd("REGULATORY_NOTICE", "CORRECTION_EVIDENCE", "OTHER"), ...F("SPILL_RELEASE", "cleanupStatus", "releaseDetermination")], "hours_to_close, evidence_verified"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 6 customer
  row("CUSTOMER_EVENT", "Customer and shipment / trip link", "PRESERVED", [...F("CUSTOMER_EVENT", "customerName", "customerSite", "loadReference", "shipmentReference"), ...col("customer_reference", "shipment_reference", "trip_reference")], "customer_reference, shipment_reference", { requirement: "ESSENTIAL" }),
  row("CUSTOMER_EVENT", "Complaint / commendation / service failure type", "PRESERVED", F("CUSTOMER_EVENT", "customerEventType", "complaintPrimaryCategory", "complaintSecondaryCategories"), "service reliability, repeat complaints", { requirement: "ESSENTIAL" }),
  row("CUSTOMER_EVENT", "Expected vs actual service", "ADDED", F("CUSTOMER_EVENT", "expectedService", "actualService"), "-"),
  row("CUSTOMER_EVENT", "Resolution", "CHILD_COLLECTION", coll("DRV.PERF.CUSTOMER_EVENT.RESOLUTION", "DRV.PERF.CUSTOMER_EVENT.RESPONSE_TIMELINE"), "response time, hours_to_close"),
  row("CUSTOMER_EVENT", "SLA / penalty", "CONSEQUENCE", [...cons("COST_ACTUAL"), ...coll("DRV.PERF.CUSTOMER_EVENT.FINANCIAL_FACTS")], "cost_actual_minor", { note: "Source detail stays in the collection; the counted penalty is a consequence record." }),
  row("CUSTOMER_EVENT", "Customer impact", "PRESERVED", [...F("CUSTOMER_EVENT", "customerImpactNote", "operationalInterruption"), ...coll("DRV.PERF.CUSTOMER_EVENT.CUSTOMER_OUTCOME"), ...cons("CUSTOMER_IMPACT", "MISSED_SERVICE")], "missed_service"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 7 security
  row("SECURITY_INCIDENT", "Threat type", "PRESERVED", F("SECURITY_INCIDENT", "securityType"), "security recurrence", { requirement: "ESSENTIAL" }),
  row("SECURITY_INCIDENT", "Assets / data / cargo affected", "ADDED", F("SECURITY_INCIDENT", "affectedAsset", "affectedAssetClass"), "-"),
  row("SECURITY_INCIDENT", "Discovery time", "ADDED", F("SECURITY_INCIDENT", "discoveryDate", "discoveryTime"), "reporting_lag_minutes"),
  row("SECURITY_INCIDENT", "Access / tampering", "ADDED", F("SECURITY_INCIDENT", "accessMethod"), "-"),
  row("SECURITY_INCIDENT", "Authorities", "ADDED", F("SECURITY_INCIDENT", "lawEnforcementNotified", "policeReportReference"), "-"),
  row("SECURITY_INCIDENT", "Containment / recovery", "ADDED", F("SECURITY_INCIDENT", "containmentState", "recoveryState"), "recovery time"),
  row("SECURITY_INCIDENT", "Loss", "CONSEQUENCE", cons("DAMAGE", "COST_ACTUAL", "RECOVERY"), "cost_actual_minor, recovery_amount_minor"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 8 equipment
  row("EQUIPMENT_FAILURE", "Component; symptom", "ADDED", F("EQUIPMENT_FAILURE", "component", "symptom", "equipmentIssueType"), "defect recurrence", { requirement: "ESSENTIAL" }),
  row("EQUIPMENT_FAILURE", "Severity", "CANONICAL", col("observed_severity", "potential_severity"), "severity_observed"),
  row("EQUIPMENT_FAILURE", "Defect source", "ADDED", F("EQUIPMENT_FAILURE", "detectionMethod", "defectReported", "sourceType"), "-"),
  row("EQUIPMENT_FAILURE", "Vehicle restriction / OOS", "RESTRICTION", [...F("EQUIPMENT_FAILURE", "vehicleSafeToOperate"), ...res("EQUIPMENT_HOLD")], "restrictions_active", { requirement: "ESSENTIAL", note: "'Not safe to operate' creates a mandatory equipment hold; released only with the documented correction." }),
  row("EQUIPMENT_FAILURE", "Repair order", "RELATIONSHIP", [...rel("REPAIR_ORDER", "MAINTENANCE_RECORD")], "-", { note: "A repair order attaches to one occurrence only, so its cost is counted once." }),
  row("EQUIPMENT_FAILURE", "Mechanic certification", "ADDED", F("EQUIPMENT_FAILURE", "repairCertificationState"), "-"),
  row("EQUIPMENT_FAILURE", "Downtime", "CONSEQUENCE", cons("ASSET_DOWNTIME"), "downtime_minutes"),
  row("EQUIPMENT_FAILURE", "Repeat defect", "ADDED", [...F("EQUIPMENT_FAILURE", "repeatDefectSuspected"), ...fact("recurrence_vehicle_key")], "defect recurrence"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 9 device
  row("DEVICE_DATA_INTEGRITY", "Device / provider", "PRESERVED", [...F("DEVICE_DATA_INTEGRITY", "deviceType", "deviceProvider", "deviceIdentifier")], "data reliability", { note: "deviceProvider / deviceIdentifier added." }),
  row("DEVICE_DATA_INTEGRITY", "Affected asset and interval", "ADDED", [...col("vehicle_id"), ...F("DEVICE_DATA_INTEGRITY", "affectedIntervalStart", "affectedIntervalEnd", "dataLossDurationMinutes")], "outage duration"),
  row("DEVICE_DATA_INTEGRITY", "Missing / corrupt / contradictory data", "PRESERVED", F("DEVICE_DATA_INTEGRITY", "anomalyType", "dataImpact", "interferenceMethod", "integrityState"), "data reliability", { requirement: "ESSENTIAL" }),
  row("DEVICE_DATA_INTEGRITY", "Detection source", "PRESERVED", F("DEVICE_DATA_INTEGRITY", "sourceType", "detectionDate", "detectionTime"), "-"),
  row("DEVICE_DATA_INTEGRITY", "Remediation", "ADDED", F("DEVICE_DATA_INTEGRITY", "remediationNote", "dataRecoveryState"), "-"),
  row("DEVICE_DATA_INTEGRITY", "Downstream facts invalidated", "ADDED", F("DEVICE_DATA_INTEGRITY", "downstreamFactsInvalidated", "invalidatedScope"), "affected metrics"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 10 fatigue
  row("FATIGUE_INDICATOR", "Source", "PRESERVED", F("FATIGUE_INDICATOR", "sourceType", "sourceClassification"), "source_reliability"),
  row("FATIGUE_INDICATOR", "Duty / HOS context", "PRESERVED", F("FATIGUE_INDICATOR", "dutyContext", "hosProximity", "hoursDriven", "timeSinceBreakMinutes", "consecutiveDrivingDays"), "indicators per driving hour", { note: "Context only. No HOS compliance conclusion is drawn here; the HOS Violation record owns that." }),
  row("FATIGUE_INDICATOR", "Indicator type", "PRESERVED", F("FATIGUE_INDICATOR", "indicatorType", "eyeClosureDurationMs", "perclosPercent"), "-", { requirement: "ESSENTIAL" }),
  row("FATIGUE_INDICATOR", "Observed confidence", "ADDED", F("FATIGUE_INDICATOR", "observedConfidence"), "-"),
  row("FATIGUE_INDICATOR", "Intervention; rest / recovery and outcome", "ADDED", F("FATIGUE_INDICATOR", "interventionTaken", "restRecoveryOutcome"), "response effectiveness"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 11 emergency
  row("EMERGENCY_EVENT", "Emergency class", "PRESERVED", F("EMERGENCY_EVENT", "emergencyType"), "emergency frequency", { requirement: "ESSENTIAL" }),
  row("EMERGENCY_EVENT", "Trigger", "ADDED", F("EMERGENCY_EVENT", "emergencyTrigger"), "-"),
  row("EMERGENCY_EVENT", "Response agencies", "ADDED", F("EMERGENCY_EVENT", "emergencyServices", "responseAgencies"), "response time"),
  row("EMERGENCY_EVENT", "Immediate safety actions", "ADDED", F("EMERGENCY_EVENT", "immediateSafetyActions"), "-"),
  row("EMERGENCY_EVENT", "People / assets impacted", "ADDED", [...F("EMERGENCY_EVENT", "peopleImpactedCount"), ...col("vehicle_id")], "-"),
  row("EMERGENCY_EVENT", "Resolution and downstream links", "ADDED", [...F("EMERGENCY_EVENT", "resolutionState", "downtimeHours"), ...rel("CAUSES", "FOLLOW_UP_OF", "RELATED"), ...cons("ASSET_DOWNTIME", "OPERATIONAL_DELAY")], "disruption"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- 12-17 telematics observations
  row("SPEEDING", "Speed", "PRESERVED", F("SPEEDING", "actualSpeed", "peakSpeed", "averageSpeed"), "speeding rate by exposure", { requirement: "ESSENTIAL" }),
  row("SPEEDING", "Posted / verified limit", "PRESERVED", F("SPEEDING", "postedSpeedLimit", "applicableThreshold", "companyThreshold", "thresholdBasis", "thresholdVersion"), "-"),
  row("SPEEDING", "Duration / distance", "PRESERVED", F("SPEEDING", "durationSeconds", "distanceTraveled", "amountExceeded"), "exposure join keys"),
  row("SPEEDING", "Source", "PRESERVED", F("SPEEDING", "provider", "sourceType", "sourceRecordId"), "source_reliability"),
  row("SPEEDING", "GPS confidence", "ADDED", F("SPEEDING", "gpsConfidence"), "-"),
  row("SPEEDING", "Road conditions", "ADDED", F("SPEEDING", "roadCondition", "zoneType"), "hotspots"),
  row("SPEEDING", "Coaching", "ACTION", [...act("COACHING"), ...rel("COMPANY_ACTION")], "actions_open", { note: "Coaching is a Company Action, linked and not duplicated on the event." }),
  row("HARSH_BRAKING", "Subtype, threshold, magnitude, duration", "PRESERVED", F("HARSH_BRAKING", "triggerDeceleration", "threshold", "thresholdVariance", "peakDeceleration", "averageDeceleration", "durationSeconds"), "harsh events by distance/hour", { requirement: "ESSENTIAL", note: "Harsh Braking, Harsh Acceleration and Harsh Cornering are three categories of the same family; subtype is the category." }),
  row("HARSH_BRAKING", "Source / device and context", "PRESERVED", F("HARSH_BRAKING", "provider", "sourceType", "weather", "roadSurface", "lighting", "traffic", "loadStatus", "forwardCollisionWarning"), "source_reliability"),
  row("HARSH_ACCELERATION", "Subtype, threshold, magnitude, duration", "PRESERVED", F("HARSH_ACCELERATION", "triggerAcceleration", "threshold", "variance", "peakAcceleration", "averageAcceleration", "durationSeconds"), "harsh events by distance/hour", { requirement: "ESSENTIAL" }),
  row("HARSH_ACCELERATION", "Source / device and context", "PRESERVED", F("HARSH_ACCELERATION", "sourceType", "weather", "road", "lighting", "loadStatus"), "source_reliability"),
  row("HARSH_CORNERING", "Subtype, threshold, magnitude, duration", "PRESERVED", F("HARSH_CORNERING", "lateralAcceleration", "threshold", "variance", "peakLateralAcceleration", "averageLateralAcceleration", "durationSeconds"), "harsh events by distance/hour", { requirement: "ESSENTIAL" }),
  row("HARSH_CORNERING", "Source / device and context", "PRESERVED", F("HARSH_CORNERING", "sourceType", "weather", "roadSurface", "roadGeometry", "turnRadius", "loadStatus"), "source_reliability"),
  row("FOLLOWING_DISTANCE", "Measured headway and unit", "PRESERVED", F("FOLLOWING_DISTANCE", "timeGapSeconds", "distanceGapMeters", "minimumTimeGapSeconds", "minimumDistanceGapMeters", "timeGapThresholdSeconds", "distanceThresholdMeters"), "tailgating frequency", { requirement: "ESSENTIAL" }),
  row("FOLLOWING_DISTANCE", "Relative speed", "PRESERVED", F("FOLLOWING_DISTANCE", "relativeSpeed", "driverVehicleSpeed", "leadVehicleSpeed"), "-"),
  row("FOLLOWING_DISTANCE", "Conditions", "ADDED", F("FOLLOWING_DISTANCE", "weatherConditions", "trafficConditions"), "-"),
  row("FOLLOWING_DISTANCE", "Measurement confidence", "ADDED", F("FOLLOWING_DISTANCE", "measurementConfidence"), "source_reliability"),
  row("DISTRACTED_DRIVING", "Distraction category", "PRESERVED", F("DISTRACTED_DRIVING", "distractionType"), "verified distraction trend", { requirement: "ESSENTIAL" }),
  row("DISTRACTED_DRIVING", "Observation source", "PRESERVED", F("DISTRACTED_DRIVING", "sourceType", "sourceRecordId", "observedContext"), "source_reliability"),
  row("DISTRACTED_DRIVING", "Confidence; safeguards; review", "ADDED", F("DISTRACTED_DRIVING", "observationConfidence", "safeguardsContext", "reviewOutcome"), "verification_state", { note: "An observation is not a finding until a person records the review outcome." }),
  row("DISTRACTED_DRIVING", "Duration", "PRESERVED", F("DISTRACTED_DRIVING", "durationSeconds", "speed"), "-"),
  row("IDLE_TIME", "Start / end / duration", "ADDED", F("IDLE_TIME", "idleStart", "idleEnd", "durationMinutes", "thresholdMinutes", "varianceMinutes"), "avoidable idle hours", { requirement: "ESSENTIAL" }),
  row("IDLE_TIME", "Engine status; ambient conditions", "ADDED", F("IDLE_TIME", "engineState", "ambientTemperature"), "-"),
  row("IDLE_TIME", "PTO / loading / mandatory-rest exemptions", "ADDED", F("IDLE_TIME", "exemptionReason", "locationType", "loadStatus"), "avoidable idle hours"),
  row("IDLE_TIME", "Estimated fuel basis", "ADDED", F("IDLE_TIME", "fuelEstimateBasis", "estimatedFuelUsed"), "fuel opportunity estimates", { note: "An estimate, labelled as such by its basis; not a measured consumption." }),
  row("SEATBELT", "Observed non-use", "PRESERVED", F("SEATBELT", "seatbeltState", "durationSeconds", "speed"), "non-use observations by exposure", { requirement: "ESSENTIAL" }),
  row("SEATBELT", "Occupant role", "ADDED", F("SEATBELT", "occupantRole"), "-"),
  row("SEATBELT", "Source and confidence", "ADDED", F("SEATBELT", "provider", "sourceType", "detectionConfidence"), "source_reliability"),
  row("SEATBELT", "Context; verified outcome", "ADDED", F("SEATBELT", "contextNotes", "verifiedOutcome"), "verification_state"),
  row("SEATBELT", "Coaching", "ACTION", [...act("COACHING"), ...rel("COMPANY_ACTION")], "actions_open"),
  // ----------------------------------------------------------------------------------------------------------------------------------------- others + route deviation
  row("OTHER_EVENT", "User-supplied title and description", "CANONICAL", col("title", "narrative"), "-", { requirement: "ESSENTIAL" }),
  row("OTHER_EVENT", "Reason no defined category fits", "ADDED", F("OTHER_EVENT", "noCategoryReason"), "taxonomy gaps", { requirement: "ESSENTIAL" }),
  row("OTHER_EVENT", "Impact", "ADDED", [...F("OTHER_EVENT", "impactDescription"), ...cons("OPERATIONAL_DELAY", "ASSET_DOWNTIME", "COST_ACTUAL")], "emerging risks"),
  row("OTHER_EVENT", "Involved records; evidence", "CANONICAL", [...col("driver_relationship_id", "vehicle_id"), ...evd("SOURCE_REPORT", "OTHER")], "-"),
  row("OTHER_EVENT", "Classification review; future subtype proposal", "ADDED", F("OTHER_EVENT", "classificationReview", "reclassifiedTo", "proposedSubtype"), "taxonomy gaps", { note: "Reclassification is a correction (new version), not a second event." }),
  row("ROUTE_DEVIATION", "Conditional Route Deviation (existing)", "PRESERVED", F("ROUTE_DEVIATION", "deviationDistanceMiles", "deviationDurationMinutes", "deviationReason"), "-", { note: "Preserved unchanged; no duplicate category created." }),
]

// -------------------------------------------------------------------------------------------------------------------------------------------------
// Generated inventory of what exists
// -------------------------------------------------------------------------------------------------------------------------------------------------

export type InventoryRow = {
  categoryCode: string; category: string; key: string; label: string; dataPointId: string; kind: string; valueType: string
  required: boolean; conditional: boolean; options: number; unit: string | null; disposition: "PRESERVED" | "ADDED"; legacyOnly: boolean
}

export function existingFieldInventory(): InventoryRow[] {
  const out: InventoryRow[] = []
  for (const d of DRIVER_PERFORMANCE_CATEGORY_REGISTRY) {
    if (PERFORMANCE_CATEGORY_OWNERSHIP[d.value] !== "RECORDABLE_EVENT") continue
    const added = new Set((d.code === "OTHER_EVENT" ? OTHER_EVENT_FIELDS : CATEGORY_FIELD_EXTENSIONS[d.code] ?? []).map((f) => f.key))
    for (const f of d.fields) {
      out.push({
        categoryCode: d.code, category: d.value, key: f.key, label: f.label, dataPointId: f.dataPointId, kind: f.kind, valueType: f.valueType,
        required: f.required === true, conditional: Boolean(f.visibleWhen || f.applicability?.some((r) => r.when)), options: f.options?.length ?? 0, unit: f.unit ?? null,
        disposition: added.has(f.key) ? "ADDED" : "PRESERVED", legacyOnly: f.hiddenInCreation === true,
      })
    }
  }
  return out
}

export function recordableCategories() {
  return DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter((d) => PERFORMANCE_CATEGORY_OWNERSHIP[d.value] === "RECORDABLE_EVENT").map((d) => ({ code: d.code, value: d.value, label: d.label, group: d.group }))
}
