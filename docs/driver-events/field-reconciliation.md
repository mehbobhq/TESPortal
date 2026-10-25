# Driver Events — field reconciliation matrix

Generated from the registry and `lib/driver-events/field-reconciliation.ts` by `scripts/driver-events/build-reconciliation.mts`. Do not edit by hand; the test suite fails if it is stale.

Baseline: TES_Driver_Events_Field_Baseline.md (2026-10-25).

## Totals

- Recordable categories: **21**
- Registry fields in those categories: **429** — preserved unchanged: **370**, added by this work: **59**
- Baseline elements mapped: **142** (CANONICAL 21, EVIDENCE 3, RELATIONSHIP 4, ACTION 3, CONSEQUENCE 7, PRESERVED 49, CHILD_COLLECTION 12, ADDED 39, RESTRICTION 4)

Dispositions: **PRESERVED** an existing field already satisfies it (unchanged); **ADDED** a new field in `category-extensions.ts`; **CANONICAL** a column/link of the event itself; **CONSEQUENCE / RELATIONSHIP / RESTRICTION / ACTION / EVIDENCE** a shared record (linked, not repeated); **CHILD_COLLECTION** an existing rich child collection; **NOT_CAPTURED** deliberately not stored here (with the reason).

No existing field was removed, renamed or retyped. Nothing duplicates canonical TES data: drivers, vehicles, trailers and the reporter are links; costs, delays, downtime, claims and recoveries are consequence records; citations, repair orders and claims are relationship links.

## Baseline element → where it lives

### COMMON

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Event ID; tenant/company | CANONICAL | ESSENTIAL | ALL | `driver_events.id`<br>`driver_events.organization_id` | event_id, organization_id |  |
| Category / subtype / schema version | CANONICAL | ESSENTIAL | ALL | `driver_events.category`<br>`driver_events.category_code`<br>`driver_events.subtype`<br>`driver_events.schema_version` | category, category_code, schema_version |  |
| Title / narrative | CANONICAL | ESSENTIAL | ALL | `driver_events.title`<br>`driver_events.narrative` | - |  |
| Occurred at with IANA zone and source-local time | CANONICAL | ESSENTIAL | ALL | `driver_events.occurred_at`<br>`driver_events.occurred_time_zone`<br>`driver_events.occurred_local_date`<br>`driver_events.occurred_local_time`<br>`driver_events.occurrence_precision` | occurred_at, occurred_time_zone, occurred_local_date, occurrence_precision | A date-only occurrence has no instant; precision is stored, never inferred. |
| Reported at | CANONICAL | ESSENTIAL | ALL | `driver_events.reported_at`<br>`driver_events.reported_local_date` | reported_at, reporting_lag_minutes |  |
| Reporter / actor | CANONICAL | ESSENTIAL | ALL | `driver_events.reporter_actor_id`<br>`driver_events.reporter_label`<br>`driver_events.created_by_actor_id` | - |  |
| Source type and source reference | CANONICAL | ESSENTIAL | ALL | `driver_events.source_type`<br>`driver_events.source_reference`<br>`driver_events.ingestion_origin` | source_type, ingestion_origin, source_reliability | A source reference is unique per company/category/source: ingestion is idempotent. |
| Canonical driver / vehicle / trailer links | CANONICAL | CONDITIONAL | ALL | `driver_events.driver_relationship_id`<br>`driver_events.driver_person_id`<br>`driver_events.vehicle_relationship_id`<br>`driver_events.vehicle_id`<br>`driver_events.trailer_relationship_id`<br>`driver_events.trailer_vehicle_id` | driver_relationship_id, driver_person_id, vehicle_id, trailer_vehicle_id | Composite foreign keys to the company's own relationships; no copy of driver or vehicle data is stored on the event. |
| Trip / shipment / customer references | CANONICAL | CONDITIONAL | ALL | `driver_events.trip_reference`<br>`driver_events.load_reference`<br>`driver_events.shipment_reference`<br>`driver_events.customer_reference` | load_reference, shipment_reference, customer_reference | Free-text references only where no canonical record exists yet; replaced by canonical ids when Trip/Shipment/Customer records are linked. |
| Location and jurisdiction | CANONICAL | CONDITIONAL | ALL | `driver_events.location_text`<br>`driver_events.city`<br>`driver_events.state_province`<br>`driver_events.country`<br>`driver_events.jurisdiction_code`<br>`driver_events.latitude`<br>`driver_events.longitude` | jurisdiction_code, country, state_province |  |
| Observed and potential severity | CANONICAL | CONDITIONAL | ALL | `driver_events.observed_severity`<br>`driver_events.potential_severity` | severity_observed, severity_potential |  |
| Lifecycle state | CANONICAL | ESSENTIAL | ALL | `driver_events.status`<br>`driver_events.record_state` | status, resolution_state |  |
| Data quality / verification state | CANONICAL | CONDITIONAL | ALL | `driver_events.data_quality`<br>`driver_events.verification_state` | data_quality_score, required_fields_missing, quality_flags, verification_state |  |
| Evidence references and status | EVIDENCE | CONDITIONAL | ALL | `evidence:SOURCE_REPORT`<br>`evidence:PHOTO_VIDEO`<br>`evidence:OTHER` | evidence_links_active, evidence_stored, evidence_verified | Links documents that completed the GCS quarantine -> scan -> intake -> evidence lifecycle. Linked is not verified. |
| Related event and downstream record ids | RELATIONSHIP | CONDITIONAL | ALL | `relationship:DUPLICATE_OF`<br>`relationship:SAME_OCCURRENCE`<br>`relationship:CAUSED_BY`<br>`relationship:CAUSES`<br>`relationship:FOLLOW_UP_OF`<br>`relationship:RELATED`<br>`relationship:CITATION`<br>`relationship:REPAIR_ORDER`<br>`relationship:CLAIM`<br>`relationship:INSPECTION_FINDING`<br>`relationship:TRAINING_RECORD`<br>`relationship:COMPANY_ACTION`<br>`relationship:MAINTENANCE_RECORD`<br>`relationship:DISPATCH_RECORD` | duplicates excluded from driver_event_facts_v1 |  |
| Corrective action owner / due / status | ACTION | CONDITIONAL | ALL | `action:CORRECTIVE`<br>`action:PREVENTIVE`<br>`action:COACHING`<br>`action:TRAINING`<br>`action:REPAIR`<br>`action:REPORT`<br>`action:NOTIFICATION`<br>`action:INVESTIGATION`<br>`action:OTHER` | actions_total, actions_open, required_actions_open, next_action_due |  |
| Review and closure attribution | CANONICAL | ESSENTIAL | ALL | `driver_events.closed_at`<br>`driver_events.closed_by_actor_id`<br>`driver_events.closure_reason` | closed_at, hours_to_close |  |
| Consequence records | CONSEQUENCE | CONDITIONAL | ALL | `consequence:OPERATIONAL_DELAY`<br>`consequence:ASSET_DOWNTIME`<br>`consequence:MISSED_SERVICE`<br>`consequence:COST_ESTIMATED`<br>`consequence:COST_ACTUAL`<br>`consequence:CLAIM`<br>`consequence:RECOVERY`<br>`consequence:INJURY`<br>`consequence:DAMAGE`<br>`consequence:ENFORCEMENT`<br>`consequence:ENVIRONMENTAL`<br>`consequence:CUSTOMER_IMPACT`<br>`consequence:INVESTIGATION_TIME`<br>`consequence:CORRECTIVE_ACTION_COST` | delay_minutes, downtime_minutes, cost_*_minor, net_impact_minor | Each consequence carries source, confidence, measurement date and canonical link; one source record is counted once (database-enforced). Child-collection financial facts of the rich workflows are source detail only: analytics read consequence records, so nothing is counted twice. |
| Master Register history | CANONICAL | ESSENTIAL | ALL | `driver_events.current_version` | corrections_count | Immutable driver_event_history + Master Register events (RECORD_CREATED / UPDATED / CORRECTED / STATUS_CHANGED / LINK_ESTABLISHED / EVIDENCE_ASSOCIATED). |

### COLLISION

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Collision configuration | PRESERVED | ESSENTIAL | ALL | `COLLISION.collisionClassType`<br>`COLLISION.collisionManner`<br>`COLLISION.firstHarmfulEvent` | category, severity |  |
| Road and weather conditions | PRESERVED | CONDITIONAL | ALL | `COLLISION.weather`<br>`COLLISION.roadCondition`<br>`COLLISION.lightCondition`<br>`COLLISION.visibility`<br>`COLLISION.trafficCondition`<br>`COLLISION.workZone` | contextual dimensions |  |
| Involved parties / assets | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.COLLISION.INVOLVED_PARTIES` | - | Own vehicle/trailer are canonical links (vehicle_id, trailer_vehicle_id); other parties stay in the collection. |
| Injuries / fatalities | PRESERVED | ESSENTIAL | ALL | `COLLISION.injuryStatus`<br>`collection:DRV.PERF.COLLISION.INJURED_PERSONS` | injuries_count, fatalities_count | Counts in the fact come from INJURY consequence records (units injuries / fatalities); unknown stays NULL. |
| Tow-away | ADDED | CONDITIONAL | ALL | `COLLISION.towAway` | tow_away | Replaces the hidden legacy boolean towRequired for new records; YES / NO / UNKNOWN. |
| Disabling damage; property damage | ADDED | CONDITIONAL | ALL | `COLLISION.disablingDamage`<br>`COLLISION.propertyDamageState` | property_damage |  |
| Damage value / cost | CONSEQUENCE | CONDITIONAL | ALL | `consequence:DAMAGE`<br>`consequence:COST_ESTIMATED`<br>`consequence:COST_ACTUAL` | cost_estimated_minor, cost_actual_minor |  |
| Reportability determination and jurisdiction | PRESERVED | CONDITIONAL | US+CA (person-entered, not computed) | `COLLISION.reportabilityResult`<br>`driver_events.jurisdiction_code` | jurisdiction_code | Person-entered. TES does not compute a deadline, reportability or compliance conclusion: the governing regulatory text could not be verified in the build environment. 49 CFR 390.15 accident-register minimum fields are applicable only when the record meets that definition; not asserted here. |
| Police report reference | PRESERVED | CONDITIONAL | ALL | `COLLISION.policeResponse`<br>`COLLISION.policeReportReference`<br>`COLLISION.enforcementStatus` | - |  |
| Insurer report reference | ADDED | CONDITIONAL | ALL | `COLLISION.insurerReference` | - |  |
| Hazmat release | PRESERVED | CONDITIONAL | ALL | `COLLISION.hazmatConsequence`<br>`relationship:CAUSES`<br>`relationship:RELATED` | - | A release is its own Spill or Release event, related to the collision. |
| Cause status | ADDED | CONDITIONAL | ALL | `COLLISION.causeStatus` | - |  |
| Claim and repair links | RELATIONSHIP | CONDITIONAL | ALL | `relationship:CLAIM`<br>`relationship:REPAIR_ORDER`<br>`consequence:CLAIM`<br>`consequence:RECOVERY` | claim_amount_minor, recovery_amount_minor, net_impact_minor |  |
| Operational downtime / service interruption | PRESERVED | CONDITIONAL | ALL | `COLLISION.downtimeHours`<br>`COLLISION.serviceInterruption`<br>`consequence:ASSET_DOWNTIME`<br>`consequence:OPERATIONAL_DELAY` | downtime_minutes, delay_minutes |  |

### NEAR_MISS

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Hazard | PRESERVED | ESSENTIAL | ALL | `NEAR_MISS.nearMissPrimaryType`<br>`NEAR_MISS.zoneType`<br>`NEAR_MISS.unsafeConditionRemains` | precursor patterns |  |
| Maneuver | PRESERVED | CONDITIONAL | ALL | `NEAR_MISS.operatingActivity`<br>`NEAR_MISS.directionOfTravel` | precursor patterns |  |
| Potential impact | PRESERVED | CONDITIONAL | ALL | `NEAR_MISS.potentialSeverityReported`<br>`collection:DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCES`<br>`driver_events.potential_severity` | severity_potential |  |
| Proximity | PRESERVED | CONDITIONAL | ALL | `NEAR_MISS.distanceToImpact`<br>`NEAR_MISS.timeToCollision`<br>`NEAR_MISS.speed` | - |  |
| Witness / source | PRESERVED | CONDITIONAL | ALL | `NEAR_MISS.reporterDescription`<br>`NEAR_MISS.otherPartyType`<br>`NEAR_MISS.otherPartyObject`<br>`NEAR_MISS.sourceType` | source_reliability |  |
| Avoided consequence | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCES` | - | A potential consequence is not a recorded consequence: it is never counted in cost or downtime. |
| Corrective action | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.NEAR_MISS.IMMEDIATE_RESPONSES`<br>`collection:DRV.PERF.NEAR_MISS.UNSAFE_CONDITION_RESOLUTIONS`<br>`action:CORRECTIVE`<br>`action:PREVENTIVE` | actions_open, next_action_due |  |

### ROADSIDE_INSPECTION

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Authority | PRESERVED | ESSENTIAL | ALL | `ROADSIDE_INSPECTION.agency`<br>`ROADSIDE_INSPECTION.inspectionRegime` | - |  |
| Report number | PRESERVED | CONDITIONAL | ALL | `ROADSIDE_INSPECTION.inspectionReportNumber`<br>`driver_events.source_reference` | - | User-provided only, never fabricated. |
| Level | PRESERVED | CONDITIONAL | ALL | `ROADSIDE_INSPECTION.inspectionClassification`<br>`ROADSIDE_INSPECTION.inspectionScope` | - |  |
| Date / location | CANONICAL | CONDITIONAL | US+CA (person-entered, not computed) | `driver_events.occurred_at`<br>`driver_events.occurred_time_zone`<br>`driver_events.location_text`<br>`driver_events.city`<br>`driver_events.jurisdiction_code`<br>`ROADSIDE_INSPECTION.jurisdiction` | occurred_local_date, jurisdiction_code |  |
| Inspected driver / assets | CANONICAL | CONDITIONAL | ALL | `driver_events.driver_relationship_id`<br>`driver_events.vehicle_id`<br>`driver_events.trailer_vehicle_id`<br>`collection:DRV.PERF.ROADSIDE_INSPECTION.INSPECTED_EQUIPMENT` | driver_relationship_id, vehicle_id |  |
| Violation codes and units | CHILD_COLLECTION | ESSENTIAL | ALL | `collection:DRV.PERF.ROADSIDE_INSPECTION.VIOLATIONS`<br>`ROADSIDE_INSPECTION.sourceReportedViolationCount` | violation/OOS rate, recurring defects |  |
| Warning / citation | RELATIONSHIP | CONDITIONAL | ALL | `relationship:CITATION` | - | The authoritative Citation record owns the citation; the event links it once. |
| Out-of-service order and scope | RESTRICTION | ESSENTIAL | US+CA (person-entered, not computed) | `ROADSIDE_INSPECTION.driverOOSState`<br>`ROADSIDE_INSPECTION.vehicleOOSState`<br>`restriction:DRIVER_OUT_OF_SERVICE`<br>`restriction:VEHICLE_OUT_OF_SERVICE` | restrictions_active, restrictions_released, resolution_state | A YES answer creates a mandatory restriction automatically. It is released only through the dedicated capability with verified release evidence; a status change, a correction of the answer or a company clearance cannot clear it. 49 CFR 396.9 applicability is not computed. |
| Required correction | RESTRICTION | CONDITIONAL | ALL | `restriction:VEHICLE_OUT_OF_SERVICE`<br>`action:REPAIR` | required_actions_open | Stored on the restriction (required_correction) and as a required follow-up action. |
| Release evidence | EVIDENCE | ESSENTIAL | ALL | `evidence:RELEASE_EVIDENCE`<br>`evidence:CORRECTION_EVIDENCE`<br>`evidence:REPAIR_RECORD`<br>`evidence:INSPECTION_REPORT` | restrictions_released |  |
| Response deadline | RESTRICTION | CONDITIONAL | US+CA (person-entered, not computed) | `restriction:VEHICLE_OUT_OF_SERVICE`<br>`restriction:DRIVER_OUT_OF_SERVICE` | next_action_due | Person-entered. TES does not compute a deadline, reportability or compliance conclusion: the governing regulatory text could not be verified in the build environment. response_deadline is recorded as stated on the order. |

### CARGO_INCIDENT

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Shipment / load id | PRESERVED | ESSENTIAL | ALL | `CARGO_INCIDENT.loadReference`<br>`CARGO_INCIDENT.shipmentReference`<br>`CARGO_INCIDENT.bolPro`<br>`driver_events.load_reference`<br>`driver_events.shipment_reference` | load_reference, shipment_reference |  |
| Commodity | PRESERVED | CONDITIONAL | ALL | `CARGO_INCIDENT.cargoGeneralDescription`<br>`collection:DRV.PERF.CARGO_INCIDENT.ITEMS` | loss by commodity |  |
| Quantity / value | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.CARGO_INCIDENT.ITEMS`<br>`consequence:DAMAGE`<br>`consequence:COST_ACTUAL` | cost_actual_minor | Item quantities stay in the collection; the monetary loss that is counted is a consequence record. |
| Seal / custody | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.CARGO_INCIDENT.CUSTODY_CHAIN`<br>`collection:DRV.PERF.CARGO_INCIDENT.SECURITY_CONTROLS`<br>`CARGO_INCIDENT.custodyStage`<br>`CARGO_INCIDENT.cargoSecured` | - |  |
| Damage / loss / theft type | PRESERVED | ESSENTIAL | ALL | `CARGO_INCIDENT.primaryFamily`<br>`CARGO_INCIDENT.secondaryClassification`<br>`collection:DRV.PERF.CARGO_INCIDENT.DAMAGE_OUTCOME`<br>`collection:DRV.PERF.CARGO_INCIDENT.THEFT_OUTCOME` | category, severity |  |
| Delivery consequence | CONSEQUENCE | CONDITIONAL | ALL | `consequence:MISSED_SERVICE`<br>`consequence:OPERATIONAL_DELAY`<br>`consequence:CUSTOMER_IMPACT` | missed_service, delay_minutes |  |
| Claim and recovery | CONSEQUENCE | CONDITIONAL | ALL | `consequence:CLAIM`<br>`consequence:RECOVERY`<br>`relationship:CLAIM` | claim_amount_minor, recovery_amount_minor, net_impact_minor |  |

### SPILL_RELEASE

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Substance | CHILD_COLLECTION | ESSENTIAL | ALL | `collection:DRV.PERF.SPILL_RELEASE.MATERIALS` | - |  |
| Quantity / unit | CHILD_COLLECTION | ESSENTIAL | ALL | `collection:DRV.PERF.SPILL_RELEASE.QUANTITIES` | - |  |
| Source | PRESERVED | CONDITIONAL | ALL | `SPILL_RELEASE.sourceCategory`<br>`SPILL_RELEASE.sourceSubsystem`<br>`SPILL_RELEASE.sourceComponent`<br>`SPILL_RELEASE.releaseMechanism` | - |  |
| Location | CANONICAL | CONDITIONAL | ALL | `driver_events.location_text`<br>`driver_events.city`<br>`driver_events.state_province`<br>`driver_events.country`<br>`driver_events.jurisdiction_code`<br>`SPILL_RELEASE.originText`<br>`SPILL_RELEASE.facilitySite` | jurisdiction_code |  |
| Containment | PRESERVED | CONDITIONAL | ALL | `SPILL_RELEASE.valveClosed`<br>`SPILL_RELEASE.absorbentApplied`<br>`SPILL_RELEASE.drainProtected`<br>`SPILL_RELEASE.areaSecured`<br>`SPILL_RELEASE.releaseCondition`<br>`SPILL_RELEASE.continuingDanger`<br>`collection:DRV.PERF.SPILL_RELEASE.RESPONSE_TIMELINE` | - |  |
| Exposure | PRESERVED | CONDITIONAL | ALL | `SPILL_RELEASE.waterwayRisk`<br>`SPILL_RELEASE.publicExposureRisk`<br>`SPILL_RELEASE.evacuationPerformed`<br>`collection:DRV.PERF.SPILL_RELEASE.PERSONS`<br>`collection:DRV.PERF.SPILL_RELEASE.ENVIRONMENTAL_MEDIA` | - |  |
| Reporting applicability / deadline | CHILD_COLLECTION | CONDITIONAL | US+CA (person-entered, not computed) | `collection:DRV.PERF.SPILL_RELEASE.REGULATORY_ASSESSMENTS` | - | Person-entered. TES does not compute a deadline, reportability or compliance conclusion: the governing regulatory text could not be verified in the build environment. |
| Notifications | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.SPILL_RELEASE.REGULATORY_EXECUTIONS`<br>`SPILL_RELEASE.dispatchContacted`<br>`SPILL_RELEASE.emergencyServicesContacted`<br>`SPILL_RELEASE.hazmatResponseContacted` | response latency |  |
| Cleanup contractor / cost | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.SPILL_RELEASE.CLEANUP_RECORDS`<br>`consequence:COST_ACTUAL`<br>`consequence:ENVIRONMENTAL` | cost_actual_minor | The cleanup record names the contractor; the counted cost is a consequence record. |
| Closure evidence | EVIDENCE | CONDITIONAL | ALL | `evidence:REGULATORY_NOTICE`<br>`evidence:CORRECTION_EVIDENCE`<br>`evidence:OTHER`<br>`SPILL_RELEASE.cleanupStatus`<br>`SPILL_RELEASE.releaseDetermination` | hours_to_close, evidence_verified |  |

### CUSTOMER_EVENT

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Customer and shipment / trip link | PRESERVED | ESSENTIAL | ALL | `CUSTOMER_EVENT.customerName`<br>`CUSTOMER_EVENT.customerSite`<br>`CUSTOMER_EVENT.loadReference`<br>`CUSTOMER_EVENT.shipmentReference`<br>`driver_events.customer_reference`<br>`driver_events.shipment_reference`<br>`driver_events.trip_reference` | customer_reference, shipment_reference |  |
| Complaint / commendation / service failure type | PRESERVED | ESSENTIAL | ALL | `CUSTOMER_EVENT.customerEventType`<br>`CUSTOMER_EVENT.complaintPrimaryCategory`<br>`CUSTOMER_EVENT.complaintSecondaryCategories` | service reliability, repeat complaints |  |
| Expected vs actual service | ADDED | CONDITIONAL | ALL | `CUSTOMER_EVENT.expectedService`<br>`CUSTOMER_EVENT.actualService` | - |  |
| Resolution | CHILD_COLLECTION | CONDITIONAL | ALL | `collection:DRV.PERF.CUSTOMER_EVENT.RESOLUTION`<br>`collection:DRV.PERF.CUSTOMER_EVENT.RESPONSE_TIMELINE` | response time, hours_to_close |  |
| SLA / penalty | CONSEQUENCE | CONDITIONAL | ALL | `consequence:COST_ACTUAL`<br>`collection:DRV.PERF.CUSTOMER_EVENT.FINANCIAL_FACTS` | cost_actual_minor | Source detail stays in the collection; the counted penalty is a consequence record. |
| Customer impact | PRESERVED | CONDITIONAL | ALL | `CUSTOMER_EVENT.customerImpactNote`<br>`CUSTOMER_EVENT.operationalInterruption`<br>`collection:DRV.PERF.CUSTOMER_EVENT.CUSTOMER_OUTCOME`<br>`consequence:CUSTOMER_IMPACT`<br>`consequence:MISSED_SERVICE` | missed_service |  |

### SECURITY_INCIDENT

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Threat type | PRESERVED | ESSENTIAL | ALL | `SECURITY_INCIDENT.securityType` | security recurrence |  |
| Assets / data / cargo affected | ADDED | CONDITIONAL | ALL | `SECURITY_INCIDENT.affectedAsset`<br>`SECURITY_INCIDENT.affectedAssetClass` | - |  |
| Discovery time | ADDED | CONDITIONAL | ALL | `SECURITY_INCIDENT.discoveryDate`<br>`SECURITY_INCIDENT.discoveryTime` | reporting_lag_minutes |  |
| Access / tampering | ADDED | CONDITIONAL | ALL | `SECURITY_INCIDENT.accessMethod` | - |  |
| Authorities | ADDED | CONDITIONAL | ALL | `SECURITY_INCIDENT.lawEnforcementNotified`<br>`SECURITY_INCIDENT.policeReportReference` | - |  |
| Containment / recovery | ADDED | CONDITIONAL | ALL | `SECURITY_INCIDENT.containmentState`<br>`SECURITY_INCIDENT.recoveryState` | recovery time |  |
| Loss | CONSEQUENCE | CONDITIONAL | ALL | `consequence:DAMAGE`<br>`consequence:COST_ACTUAL`<br>`consequence:RECOVERY` | cost_actual_minor, recovery_amount_minor |  |

### EQUIPMENT_FAILURE

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Component; symptom | ADDED | ESSENTIAL | ALL | `EQUIPMENT_FAILURE.component`<br>`EQUIPMENT_FAILURE.symptom`<br>`EQUIPMENT_FAILURE.equipmentIssueType` | defect recurrence |  |
| Severity | CANONICAL | CONDITIONAL | ALL | `driver_events.observed_severity`<br>`driver_events.potential_severity` | severity_observed |  |
| Defect source | ADDED | CONDITIONAL | ALL | `EQUIPMENT_FAILURE.detectionMethod`<br>`EQUIPMENT_FAILURE.defectReported`<br>`EQUIPMENT_FAILURE.sourceType` | - |  |
| Vehicle restriction / OOS | RESTRICTION | ESSENTIAL | ALL | `EQUIPMENT_FAILURE.vehicleSafeToOperate`<br>`restriction:EQUIPMENT_HOLD` | restrictions_active | 'Not safe to operate' creates a mandatory equipment hold; released only with the documented correction. |
| Repair order | RELATIONSHIP | CONDITIONAL | ALL | `relationship:REPAIR_ORDER`<br>`relationship:MAINTENANCE_RECORD` | - | A repair order attaches to one occurrence only, so its cost is counted once. |
| Mechanic certification | ADDED | CONDITIONAL | ALL | `EQUIPMENT_FAILURE.repairCertificationState` | - |  |
| Downtime | CONSEQUENCE | CONDITIONAL | ALL | `consequence:ASSET_DOWNTIME` | downtime_minutes |  |
| Repeat defect | ADDED | CONDITIONAL | ALL | `EQUIPMENT_FAILURE.repeatDefectSuspected`<br>`fact:recurrence_vehicle_key` | defect recurrence |  |

### DEVICE_DATA_INTEGRITY

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Device / provider | PRESERVED | CONDITIONAL | ALL | `DEVICE_DATA_INTEGRITY.deviceType`<br>`DEVICE_DATA_INTEGRITY.deviceProvider`<br>`DEVICE_DATA_INTEGRITY.deviceIdentifier` | data reliability | deviceProvider / deviceIdentifier added. |
| Affected asset and interval | ADDED | CONDITIONAL | ALL | `driver_events.vehicle_id`<br>`DEVICE_DATA_INTEGRITY.affectedIntervalStart`<br>`DEVICE_DATA_INTEGRITY.affectedIntervalEnd`<br>`DEVICE_DATA_INTEGRITY.dataLossDurationMinutes` | outage duration |  |
| Missing / corrupt / contradictory data | PRESERVED | ESSENTIAL | ALL | `DEVICE_DATA_INTEGRITY.anomalyType`<br>`DEVICE_DATA_INTEGRITY.dataImpact`<br>`DEVICE_DATA_INTEGRITY.interferenceMethod`<br>`DEVICE_DATA_INTEGRITY.integrityState` | data reliability |  |
| Detection source | PRESERVED | CONDITIONAL | ALL | `DEVICE_DATA_INTEGRITY.sourceType`<br>`DEVICE_DATA_INTEGRITY.detectionDate`<br>`DEVICE_DATA_INTEGRITY.detectionTime` | - |  |
| Remediation | ADDED | CONDITIONAL | ALL | `DEVICE_DATA_INTEGRITY.remediationNote`<br>`DEVICE_DATA_INTEGRITY.dataRecoveryState` | - |  |
| Downstream facts invalidated | ADDED | CONDITIONAL | ALL | `DEVICE_DATA_INTEGRITY.downstreamFactsInvalidated`<br>`DEVICE_DATA_INTEGRITY.invalidatedScope` | affected metrics |  |

### FATIGUE_INDICATOR

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Source | PRESERVED | CONDITIONAL | ALL | `FATIGUE_INDICATOR.sourceType`<br>`FATIGUE_INDICATOR.sourceClassification` | source_reliability |  |
| Duty / HOS context | PRESERVED | CONDITIONAL | ALL | `FATIGUE_INDICATOR.dutyContext`<br>`FATIGUE_INDICATOR.hosProximity`<br>`FATIGUE_INDICATOR.hoursDriven`<br>`FATIGUE_INDICATOR.timeSinceBreakMinutes`<br>`FATIGUE_INDICATOR.consecutiveDrivingDays` | indicators per driving hour | Context only. No HOS compliance conclusion is drawn here; the HOS Violation record owns that. |
| Indicator type | PRESERVED | ESSENTIAL | ALL | `FATIGUE_INDICATOR.indicatorType`<br>`FATIGUE_INDICATOR.eyeClosureDurationMs`<br>`FATIGUE_INDICATOR.perclosPercent` | - |  |
| Observed confidence | ADDED | CONDITIONAL | ALL | `FATIGUE_INDICATOR.observedConfidence` | - |  |
| Intervention; rest / recovery and outcome | ADDED | CONDITIONAL | ALL | `FATIGUE_INDICATOR.interventionTaken`<br>`FATIGUE_INDICATOR.restRecoveryOutcome` | response effectiveness |  |

### EMERGENCY_EVENT

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Emergency class | PRESERVED | ESSENTIAL | ALL | `EMERGENCY_EVENT.emergencyType` | emergency frequency |  |
| Trigger | ADDED | CONDITIONAL | ALL | `EMERGENCY_EVENT.emergencyTrigger` | - |  |
| Response agencies | ADDED | CONDITIONAL | ALL | `EMERGENCY_EVENT.emergencyServices`<br>`EMERGENCY_EVENT.responseAgencies` | response time |  |
| Immediate safety actions | ADDED | CONDITIONAL | ALL | `EMERGENCY_EVENT.immediateSafetyActions` | - |  |
| People / assets impacted | ADDED | CONDITIONAL | ALL | `EMERGENCY_EVENT.peopleImpactedCount`<br>`driver_events.vehicle_id` | - |  |
| Resolution and downstream links | ADDED | CONDITIONAL | ALL | `EMERGENCY_EVENT.resolutionState`<br>`EMERGENCY_EVENT.downtimeHours`<br>`relationship:CAUSES`<br>`relationship:FOLLOW_UP_OF`<br>`relationship:RELATED`<br>`consequence:ASSET_DOWNTIME`<br>`consequence:OPERATIONAL_DELAY` | disruption |  |

### SPEEDING

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Speed | PRESERVED | ESSENTIAL | ALL | `SPEEDING.actualSpeed`<br>`SPEEDING.peakSpeed`<br>`SPEEDING.averageSpeed` | speeding rate by exposure |  |
| Posted / verified limit | PRESERVED | CONDITIONAL | ALL | `SPEEDING.postedSpeedLimit`<br>`SPEEDING.applicableThreshold`<br>`SPEEDING.companyThreshold`<br>`SPEEDING.thresholdBasis`<br>`SPEEDING.thresholdVersion` | - |  |
| Duration / distance | PRESERVED | CONDITIONAL | ALL | `SPEEDING.durationSeconds`<br>`SPEEDING.distanceTraveled`<br>`SPEEDING.amountExceeded` | exposure join keys |  |
| Source | PRESERVED | CONDITIONAL | ALL | `SPEEDING.provider`<br>`SPEEDING.sourceType`<br>`SPEEDING.sourceRecordId` | source_reliability |  |
| GPS confidence | ADDED | CONDITIONAL | ALL | `SPEEDING.gpsConfidence` | - |  |
| Road conditions | ADDED | CONDITIONAL | ALL | `SPEEDING.roadCondition`<br>`SPEEDING.zoneType` | hotspots |  |
| Coaching | ACTION | CONDITIONAL | ALL | `action:COACHING`<br>`relationship:COMPANY_ACTION` | actions_open | Coaching is a Company Action, linked and not duplicated on the event. |

### HARSH_BRAKING

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Subtype, threshold, magnitude, duration | PRESERVED | ESSENTIAL | ALL | `HARSH_BRAKING.triggerDeceleration`<br>`HARSH_BRAKING.threshold`<br>`HARSH_BRAKING.thresholdVariance`<br>`HARSH_BRAKING.peakDeceleration`<br>`HARSH_BRAKING.averageDeceleration`<br>`HARSH_BRAKING.durationSeconds` | harsh events by distance/hour | Harsh Braking, Harsh Acceleration and Harsh Cornering are three categories of the same family; subtype is the category. |
| Source / device and context | PRESERVED | CONDITIONAL | ALL | `HARSH_BRAKING.provider`<br>`HARSH_BRAKING.sourceType`<br>`HARSH_BRAKING.weather`<br>`HARSH_BRAKING.roadSurface`<br>`HARSH_BRAKING.lighting`<br>`HARSH_BRAKING.traffic`<br>`HARSH_BRAKING.loadStatus`<br>`HARSH_BRAKING.forwardCollisionWarning` | source_reliability |  |

### HARSH_ACCELERATION

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Subtype, threshold, magnitude, duration | PRESERVED | ESSENTIAL | ALL | `HARSH_ACCELERATION.triggerAcceleration`<br>`HARSH_ACCELERATION.threshold`<br>`HARSH_ACCELERATION.variance`<br>`HARSH_ACCELERATION.peakAcceleration`<br>`HARSH_ACCELERATION.averageAcceleration`<br>`HARSH_ACCELERATION.durationSeconds` | harsh events by distance/hour |  |
| Source / device and context | PRESERVED | CONDITIONAL | ALL | `HARSH_ACCELERATION.sourceType`<br>`HARSH_ACCELERATION.weather`<br>`HARSH_ACCELERATION.road`<br>`HARSH_ACCELERATION.lighting`<br>`HARSH_ACCELERATION.loadStatus` | source_reliability |  |

### HARSH_CORNERING

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Subtype, threshold, magnitude, duration | PRESERVED | ESSENTIAL | ALL | `HARSH_CORNERING.lateralAcceleration`<br>`HARSH_CORNERING.threshold`<br>`HARSH_CORNERING.variance`<br>`HARSH_CORNERING.peakLateralAcceleration`<br>`HARSH_CORNERING.averageLateralAcceleration`<br>`HARSH_CORNERING.durationSeconds` | harsh events by distance/hour |  |
| Source / device and context | PRESERVED | CONDITIONAL | ALL | `HARSH_CORNERING.sourceType`<br>`HARSH_CORNERING.weather`<br>`HARSH_CORNERING.roadSurface`<br>`HARSH_CORNERING.roadGeometry`<br>`HARSH_CORNERING.turnRadius`<br>`HARSH_CORNERING.loadStatus` | source_reliability |  |

### FOLLOWING_DISTANCE

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Measured headway and unit | PRESERVED | ESSENTIAL | ALL | `FOLLOWING_DISTANCE.timeGapSeconds`<br>`FOLLOWING_DISTANCE.distanceGapMeters`<br>`FOLLOWING_DISTANCE.minimumTimeGapSeconds`<br>`FOLLOWING_DISTANCE.minimumDistanceGapMeters`<br>`FOLLOWING_DISTANCE.timeGapThresholdSeconds`<br>`FOLLOWING_DISTANCE.distanceThresholdMeters` | tailgating frequency |  |
| Relative speed | PRESERVED | CONDITIONAL | ALL | `FOLLOWING_DISTANCE.relativeSpeed`<br>`FOLLOWING_DISTANCE.driverVehicleSpeed`<br>`FOLLOWING_DISTANCE.leadVehicleSpeed` | - |  |
| Conditions | ADDED | CONDITIONAL | ALL | `FOLLOWING_DISTANCE.weatherConditions`<br>`FOLLOWING_DISTANCE.trafficConditions` | - |  |
| Measurement confidence | ADDED | CONDITIONAL | ALL | `FOLLOWING_DISTANCE.measurementConfidence` | source_reliability |  |

### DISTRACTED_DRIVING

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Distraction category | PRESERVED | ESSENTIAL | ALL | `DISTRACTED_DRIVING.distractionType` | verified distraction trend |  |
| Observation source | PRESERVED | CONDITIONAL | ALL | `DISTRACTED_DRIVING.sourceType`<br>`DISTRACTED_DRIVING.sourceRecordId`<br>`DISTRACTED_DRIVING.observedContext` | source_reliability |  |
| Confidence; safeguards; review | ADDED | CONDITIONAL | ALL | `DISTRACTED_DRIVING.observationConfidence`<br>`DISTRACTED_DRIVING.safeguardsContext`<br>`DISTRACTED_DRIVING.reviewOutcome` | verification_state | An observation is not a finding until a person records the review outcome. |
| Duration | PRESERVED | CONDITIONAL | ALL | `DISTRACTED_DRIVING.durationSeconds`<br>`DISTRACTED_DRIVING.speed` | - |  |

### IDLE_TIME

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Start / end / duration | ADDED | ESSENTIAL | ALL | `IDLE_TIME.idleStart`<br>`IDLE_TIME.idleEnd`<br>`IDLE_TIME.durationMinutes`<br>`IDLE_TIME.thresholdMinutes`<br>`IDLE_TIME.varianceMinutes` | avoidable idle hours |  |
| Engine status; ambient conditions | ADDED | CONDITIONAL | ALL | `IDLE_TIME.engineState`<br>`IDLE_TIME.ambientTemperature` | - |  |
| PTO / loading / mandatory-rest exemptions | ADDED | CONDITIONAL | ALL | `IDLE_TIME.exemptionReason`<br>`IDLE_TIME.locationType`<br>`IDLE_TIME.loadStatus` | avoidable idle hours |  |
| Estimated fuel basis | ADDED | CONDITIONAL | ALL | `IDLE_TIME.fuelEstimateBasis`<br>`IDLE_TIME.estimatedFuelUsed` | fuel opportunity estimates | An estimate, labelled as such by its basis; not a measured consumption. |

### SEATBELT

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Observed non-use | PRESERVED | ESSENTIAL | ALL | `SEATBELT.seatbeltState`<br>`SEATBELT.durationSeconds`<br>`SEATBELT.speed` | non-use observations by exposure |  |
| Occupant role | ADDED | CONDITIONAL | ALL | `SEATBELT.occupantRole` | - |  |
| Source and confidence | ADDED | CONDITIONAL | ALL | `SEATBELT.provider`<br>`SEATBELT.sourceType`<br>`SEATBELT.detectionConfidence` | source_reliability |  |
| Context; verified outcome | ADDED | CONDITIONAL | ALL | `SEATBELT.contextNotes`<br>`SEATBELT.verifiedOutcome` | verification_state |  |
| Coaching | ACTION | CONDITIONAL | ALL | `action:COACHING`<br>`relationship:COMPANY_ACTION` | actions_open |  |

### OTHER_EVENT

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| User-supplied title and description | CANONICAL | ESSENTIAL | ALL | `driver_events.title`<br>`driver_events.narrative` | - |  |
| Reason no defined category fits | ADDED | ESSENTIAL | ALL | `OTHER_EVENT.noCategoryReason` | taxonomy gaps |  |
| Impact | ADDED | CONDITIONAL | ALL | `OTHER_EVENT.impactDescription`<br>`consequence:OPERATIONAL_DELAY`<br>`consequence:ASSET_DOWNTIME`<br>`consequence:COST_ACTUAL` | emerging risks |  |
| Involved records; evidence | CANONICAL | CONDITIONAL | ALL | `driver_events.driver_relationship_id`<br>`driver_events.vehicle_id`<br>`evidence:SOURCE_REPORT`<br>`evidence:OTHER` | - |  |
| Classification review; future subtype proposal | ADDED | CONDITIONAL | ALL | `OTHER_EVENT.classificationReview`<br>`OTHER_EVENT.reclassifiedTo`<br>`OTHER_EVENT.proposedSubtype` | taxonomy gaps | Reclassification is a correction (new version), not a second event. |

### ROUTE_DEVIATION

| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |
|---|---|---|---|---|---|---|
| Conditional Route Deviation (existing) | PRESERVED | CONDITIONAL | ALL | `ROUTE_DEVIATION.deviationDistanceMiles`<br>`ROUTE_DEVIATION.deviationDurationMinutes`<br>`ROUTE_DEVIATION.deviationReason` | - | Preserved unchanged; no duplicate category created. |

## Existing field inventory (every recordable category)

### Collision (`COLLISION`, 41 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `collisionClassType` | Collision Type | select | yes |  | 9 |  | `DRV.PERF.COLLISION.CLASS_TYPE` | PRESERVED |
| `collisionManner` | Manner of Collision | select | yes |  | 11 |  | `DRV.PERF.COLLISION.MANNER` | PRESERVED |
| `firstHarmfulEvent` | First Harmful Event | select | yes |  | 13 |  | `DRV.PERF.COLLISION.FIRST_HARMFUL_EVENT` | PRESERVED |
| `driverActivity` | Driver Activity | select |  |  | 11 |  | `DRV.PERF.COLLISION.DRIVER_ACTIVITY` | PRESERVED |
| `driverAction` | Driver Action | select |  |  | 7 |  | `DRV.PERF.COLLISION.DRIVER_ACTION` | PRESERVED |
| `eventTimeZone` | Time Zone (IANA) | select |  |  | 15 |  | `DRV.PERF.COLLISION.EVENT_TIME_ZONE` | PRESERVED |
| `roadHighway` | Road / Highway | text |  |  |  |  | `DRV.PERF.COLLISION.ROAD_HIGHWAY` | PRESERVED |
| `directionOfTravel` | Direction of Travel | select |  |  | 5 |  | `DRV.PERF.COLLISION.DIRECTION_OF_TRAVEL` | PRESERVED |
| `weather` | Weather | select |  |  | 8 |  | `DRV.PERF.SHARED.WEATHER_CONDITION` | PRESERVED |
| `roadCondition` | Road Surface | select |  |  | 8 |  | `DRV.PERF.SHARED.ROAD_SURFACE` | PRESERVED |
| `lightCondition` | Lighting | select |  |  | 5 |  | `DRV.PERF.SHARED.LIGHTING_CONDITION` | PRESERVED |
| `visibility` | Visibility | select |  |  | 4 |  | `DRV.PERF.COLLISION.VISIBILITY` | PRESERVED |
| `trafficCondition` | Traffic | select |  |  | 6 |  | `DRV.PERF.COLLISION.TRAFFIC` | PRESERVED |
| `workZone` | Work Zone | select |  |  | 3 |  | `DRV.PERF.COLLISION.WORK_ZONE` | PRESERVED |
| `speedAtOccurrence` | Speed at Occurrence | number |  |  |  |  | `DRV.PERF.COLLISION.SPEEDATOCCURRENCE` | PRESERVED |
| `injuryStatus` | Injury Status | select | yes |  | 4 |  | `DRV.PERF.COLLISION.INJURY_STATUS` | PRESERVED |
| `policeResponse` | Police Response | select |  |  | 3 |  | `DRV.PERF.COLLISION.POLICE_RESPONSE` | PRESERVED |
| `policeReportReference` | Police Report / Reference | text |  |  |  |  | `DRV.PERF.COLLISION.POLICE_REPORT_REFERENCE` | PRESERVED |
| `enforcementStatus` | Enforcement | select |  |  | 5 |  | `DRV.PERF.COLLISION.ENFORCEMENT` | PRESERVED |
| `cargoImpact` | Cargo | select |  |  | 5 |  | `DRV.PERF.COLLISION.CARGO_IMPACT` | PRESERVED |
| `hazmatConsequence` | Hazmat | select |  |  | 4 |  | `DRV.PERF.COLLISION.HAZMAT` | PRESERVED |
| `serviceInterruption` | Service Interruption | select |  |  | 3 |  | `DRV.PERF.COLLISION.SERVICE_INTERRUPTION` | PRESERVED |
| `downtimeHours` | Operational Downtime | number |  |  |  | hours | `DRV.PERF.COLLISION.DOWNTIMEHOURS` | PRESERVED |
| `reportabilityResult` | Reportability Determination | select |  |  | 3 |  | `DRV.PERF.COLLISION.REPORTABILITYRESULT` | PRESERVED |
| `driverStatementRequired` | Driver Statement Required? | select |  |  | 2 |  | `DRV.PERF.COLLISION.DRIVER_STATEMENT_REQUIRED` | PRESERVED |
| `collisionType` | Legacy Collision Configuration | select |  |  | 11 |  | `DRV.PERF.COLLISION.COLLISIONTYPE` | PRESERVED (legacy, read-only) |
| `otherPartyObject` | Legacy Other Party / Object | text |  |  |  |  | `DRV.PERF.COLLISION.OTHERPARTYOBJECT` | PRESERVED (legacy, read-only) |
| `injuriesCount` | Legacy Injuries (count) | number |  |  |  | count | `DRV.PERF.COLLISION.INJURIESCOUNT` | PRESERVED (legacy, read-only) |
| `fatalitiesCount` | Legacy Fatalities (count) | number |  |  |  | count | `DRV.PERF.COLLISION.FATALITIESCOUNT` | PRESERVED (legacy, read-only) |
| `towRequired` | Legacy Tow-Away | boolean |  |  |  |  | `DRV.PERF.COLLISION.TOWREQUIRED` | PRESERVED (legacy, read-only) |
| `policeAttended` | Legacy Police Attended | boolean |  |  |  |  | `DRV.PERF.COLLISION.POLICEATTENDED` | PRESERVED (legacy, read-only) |
| `propertyDamage` | Legacy Property Damage | boolean |  |  |  |  | `DRV.PERF.COLLISION.PROPERTYDAMAGE` | PRESERVED (legacy, read-only) |
| `driverStatement` | Legacy Driver Statement | textarea |  |  |  |  | `DRV.PERF.COLLISION.DRIVERSTATEMENT` | PRESERVED (legacy, read-only) |
| `investigationNotes` | Legacy Investigation Narrative | textarea |  |  |  |  | `DRV.PERF.COLLISION.INVESTIGATIONNOTES` | PRESERVED (legacy, read-only) |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `towAway` | Tow-Away | select |  |  | 3 |  | `DRV.PERF.COLLISION.TOWAWAY` | ADDED |
| `disablingDamage` | Disabling Damage | select |  |  | 3 |  | `DRV.PERF.COLLISION.DISABLINGDAMAGE` | ADDED |
| `propertyDamageState` | Property Damage | select |  |  | 3 |  | `DRV.PERF.COLLISION.PROPERTYDAMAGESTATE` | ADDED |
| `insurerReference` | Insurer / Claim Reference | text |  |  |  |  | `DRV.PERF.COLLISION.INSURERREFERENCE` | ADDED |
| `causeStatus` | Cause Status | select |  |  | 3 |  | `DRV.PERF.COLLISION.CAUSESTATUS` | ADDED |

### Near Miss (`NEAR_MISS`, 25 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `nearMissPrimaryType` | Primary Near-Miss Type | select | yes |  | 49 |  | `DRV.PERF.NEAR_MISS.PRIMARY_TYPE` | PRESERVED |
| `operatingActivity` | Operating Activity | select | yes |  | 9 |  | `DRV.PERF.NEAR_MISS.OPERATING_ACTIVITY` | PRESERVED |
| `eventTimeZone` | Time Zone (IANA) | select |  |  | 15 |  | `DRV.PERF.NEAR_MISS.EVENT_TIME_ZONE` | PRESERVED |
| `roadHighway` | Road / Highway | text |  |  |  |  | `DRV.PERF.NEAR_MISS.ROAD_HIGHWAY` | PRESERVED |
| `directionOfTravel` | Direction of Travel | select |  |  | 5 |  | `DRV.PERF.NEAR_MISS.DIRECTION_OF_TRAVEL` | PRESERVED |
| `otherPartyType` | Other Party / Object | select |  |  | 14 |  | `DRV.PERF.NEAR_MISS.OTHER_PARTY_TYPE` | PRESERVED |
| `otherPartyObject` | Other Party / Object Description | text |  |  |  |  | `DRV.PERF.NEAR_MISS.OTHERPARTYOBJECT` | PRESERVED |
| `potentialSeverityReported` | Reported Potential Severity | select |  |  | 4 |  | `DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_REPORTED` | PRESERVED |
| `potentialSeverityAssessed` | TES-Assessed Potential Severity | select |  |  | 4 |  | `DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_ASSESSED` | PRESERVED (legacy, read-only) |
| `potentialSeverityAssessedBy` | Potential Severity Assessed By | text |  |  |  |  | `DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_ASSESSED_BY` | PRESERVED (legacy, read-only) |
| `potentialSeverityAssessedAt` | Potential Severity Assessed At | text |  |  |  |  | `DRV.PERF.NEAR_MISS.POTENTIAL_SEVERITY_ASSESSED_AT` | PRESERVED (legacy, read-only) |
| `potentialConsequenceOtherDescription` | Other Potential Consequence | text |  |  |  |  | `DRV.PERF.NEAR_MISS.POTENTIAL_CONSEQUENCE_OTHER` | PRESERVED |
| `immediateResponseOtherDescription` | Other Immediate Response | text |  |  |  |  | `DRV.PERF.NEAR_MISS.IMMEDIATE_RESPONSE_OTHER` | PRESERVED |
| `unsafeConditionRemains` | Unsafe Condition Remains? | select | yes |  | 3 |  | `DRV.PERF.NEAR_MISS.UNSAFE_CONDITION_REMAINS` | PRESERVED |
| `reporterDescription` | Reporter Description | textarea |  |  |  |  | `DRV.PERF.NEAR_MISS.REPORTER_DESCRIPTION` | PRESERVED |
| `distanceToImpact` | Distance to Impact | number |  |  |  | m | `DRV.PERF.NEAR_MISS.DISTANCETOIMPACT` | PRESERVED |
| `timeToCollision` | Time to Collision | number |  |  |  | s | `DRV.PERF.NEAR_MISS.TIMETOCOLLISION` | PRESERVED |
| `speed` | Vehicle Speed | number |  |  |  |  | `DRV.PERF.NEAR_MISS.SPEED` | PRESERVED |
| `zoneType` | Zone Type | select |  |  | 9 |  | `DRV.PERF.SHARED.ZONE_TYPE` | PRESERVED |
| `contextNotes` | Context / Circumstances | textarea |  |  |  |  | `DRV.PERF.NEAR_MISS.CONTEXTNOTES` | PRESERVED |
| `nearMissType` | Legacy Near-Miss Configuration | select |  |  | 7 |  | `DRV.PERF.NEAR_MISS.NEARMISSTYPE` | PRESERVED (legacy, read-only) |
| `triggerSource` | Legacy Trigger Source | select |  |  | 6 |  | `DRV.PERF.NEAR_MISS.TRIGGERSOURCE` | PRESERVED (legacy, read-only) |
| `avoidanceAction` | Legacy Avoidance Action | text |  |  |  |  | `DRV.PERF.NEAR_MISS.AVOIDANCEACTION` | PRESERVED (legacy, read-only) |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Roadside Inspection (`ROADSIDE_INSPECTION`, 19 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `jurisdiction` | Jurisdiction | select | yes |  | 64 |  | `DRV.PERF.ROADSIDE_INSPECTION.JURISDICTION` | PRESERVED |
| `inspectionRegime` | Inspection Regime | select | yes |  | 3 |  | `DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONREGIME` | PRESERVED |
| `inspectionClassification` | Inspection Level / Type | select |  |  | 14 |  | `DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONCLASSIFICATION` | PRESERVED |
| `inspectionScope` | Inspection Scope | select | yes |  | 3 |  | `DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONSCOPE` | PRESERVED |
| `agency` | Enforcement Agency | text |  |  |  |  | `DRV.PERF.ROADSIDE_INSPECTION.AGENCY` | PRESERVED |
| `inspectionReportNumber` | Inspection / Report Number | text |  |  |  |  | `DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONREPORTNUMBER` | PRESERVED |
| `inspectionResult` | Source-Reported Result | select | yes |  | 2 |  | `DRV.PERF.ROADSIDE_INSPECTION.INSPECTIONRESULT` | PRESERVED |
| `overallOutcome` | Overall Outcome | select |  |  | 4 |  | `DRV.PERF.ROADSIDE_INSPECTION.OVERALLOUTCOME` | PRESERVED |
| `driverStatementRequired` | Driver Statement Required | select |  |  | 2 |  | `DRV.PERF.ROADSIDE_INSPECTION.DRIVERSTATEMENTREQUIRED` | PRESERVED |
| `driverInspectionResult` | Driver Inspection Result | select | yes | yes | 2 |  | `DRV.PERF.ROADSIDE_INSPECTION.DRIVERRESULT` | PRESERVED |
| `driverOOSState` | Driver OOS | select | yes | yes | 3 |  | `DRV.PERF.ROADSIDE_INSPECTION.DRIVEROOSSTATE` | PRESERVED |
| `driverDemeritPoints` | Driver Demerit / Points | number |  | yes |  | points | `DRV.PERF.ROADSIDE_INSPECTION.DRIVERDEMERITPOINTS` | PRESERVED |
| `vehicleInspectionResult` | Vehicle Inspection Result | select | yes | yes | 2 |  | `DRV.PERF.ROADSIDE_INSPECTION.VEHICLERESULT` | PRESERVED |
| `vehicleOOSState` | Vehicle OOS | select | yes | yes | 3 |  | `DRV.PERF.ROADSIDE_INSPECTION.VEHICLEOOSSTATE` | PRESERVED |
| `vehicleDemeritPoints` | Vehicle Demerit / Points | number |  | yes |  | points | `DRV.PERF.ROADSIDE_INSPECTION.VEHICLEDEMERITPOINTS` | PRESERVED |
| `hazmatInspected` | Hazmat Inspected | select |  | yes | 3 |  | `DRV.PERF.ROADSIDE_INSPECTION.HAZMATINSPECTED` | PRESERVED |
| `sourceReportedViolationCount` | Source-Reported Total Violations | number | yes | yes |  | count | `DRV.PERF.ROADSIDE_INSPECTION.SOURCEREPORTEDVIOLATIONCOUNT` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Cargo Incident (`CARGO_INCIDENT`, 34 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `primaryFamily` | Primary Incident Family | select | yes |  | 10 |  | `DRV.PERF.CARGO_INCIDENT.PRIMARY_FAMILY` | PRESERVED |
| `cargoContextStatus` | Cargo Context | select |  |  | 2 |  | `DRV.PERF.CARGO_INCIDENT.CARGO_CONTEXT_STATUS` | PRESERVED |
| `cargoGeneralDescription` | General Cargo Description | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.CARGO_GENERAL_DESCRIPTION` | PRESERVED |
| `secondaryClassification` | Secondary Classification | select |  |  | 29 |  | `DRV.PERF.CARGO_INCIDENT.SECONDARY_CLASSIFICATION` | PRESERVED |
| `custodyStage` | Custody Stage | select |  |  | 11 |  | `DRV.PERF.CARGO_INCIDENT.CUSTODY_STAGE` | PRESERVED |
| `occurrenceWindowStart` | Estimated Occurrence Window - Start | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.OCCURRENCE_WINDOW_START` | PRESERVED |
| `occurrenceWindowEnd` | Estimated Occurrence Window - End | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.OCCURRENCE_WINDOW_END` | PRESERVED |
| `occurrenceWindowBasis` | Basis for Estimated Window | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.OCCURRENCE_WINDOW_BASIS` | PRESERVED |
| `discoveryDate` | Discovery Date | date |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.DISCOVERY_DATE` | PRESERVED |
| `discoveryTime` | Discovery Time | time |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.DISCOVERY_TIME` | PRESERVED |
| `reportedTime` | Reported Time | time |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.REPORTED_TIME` | PRESERVED |
| `loadReference` | Load Reference | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.LOAD_REFERENCE` | PRESERVED |
| `bolPro` | BOL / PRO | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.BOL_PRO` | PRESERVED |
| `shipmentReference` | Shipment Reference | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.SHIPMENT_REFERENCE` | PRESERVED |
| `customerName` | Customer | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.CUSTOMER_NAME` | PRESERVED |
| `shipperName` | Shipper | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.SHIPPER_NAME` | PRESERVED |
| `receiverName` | Receiver | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.RECEIVER_NAME` | PRESERVED |
| `brokerName` | Broker | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.BROKER_NAME` | PRESERVED |
| `originText` | Origin | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.ORIGIN` | PRESERVED |
| `destinationText` | Destination | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.DESTINATION` | PRESERVED |
| `facilitySite` | Facility / Site | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.FACILITY_SITE` | PRESERVED |
| `plannedRouteReference` | Planned Route Reference | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.PLANNED_ROUTE_REFERENCE` | PRESERVED |
| `actualRouteReference` | Actual Route Reference | text |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.ACTUAL_ROUTE_REFERENCE` | PRESERVED |
| `dispatchNotified` | Dispatch Notified | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_DISPATCH_NOTIFIED` | PRESERVED |
| `customerNotified` | Customer Notified | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_CUSTOMER_NOTIFIED` | PRESERVED |
| `policeNotified` | Police / Law Enforcement Notified | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_POLICE_NOTIFIED` | PRESERVED |
| `insurerNotified` | Insurer Notified | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_INSURER_NOTIFIED` | PRESERVED |
| `securityNotified` | Security Notified | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_SECURITY_NOTIFIED` | PRESERVED |
| `cargoSecured` | Cargo Secured | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_CARGO_SECURED` | PRESERVED |
| `emergencyResponse` | Emergency Response | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_EMERGENCY` | PRESERVED |
| `recoveryInitiated` | Recovery Initiated | select |  |  | 3 |  | `DRV.PERF.CARGO_INCIDENT.RESPONSE_RECOVERY_INITIATED` | PRESERVED |
| `incidentNarrative` | Reporter Description | textarea |  |  |  |  | `DRV.PERF.CARGO_INCIDENT.INCIDENT_NARRATIVE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Spill or Release (`SPILL_RELEASE`, 54 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `releaseDetermination` | Release Determination | select | yes |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RELEASE_DETERMINATION` | PRESERVED |
| `releaseCondition` | Release Condition | select | yes |  | 4 |  | `DRV.PERF.SPILL_RELEASE.RELEASE_CONDITION` | PRESERVED |
| `cleanupStatus` | Cleanup Status | select |  |  | 4 |  | `DRV.PERF.SPILL_RELEASE.CLEANUP_STATUS` | PRESERVED |
| `releaseForm` | Release Form | select |  |  | 10 |  | `DRV.PERF.SPILL_RELEASE.RELEASE_FORM` | PRESERVED |
| `releaseMechanism` | Release Mechanism | select |  |  | 11 |  | `DRV.PERF.SPILL_RELEASE.RELEASE_MECHANISM` | PRESERVED |
| `releaseMechanismOther` | Other Release Mechanism | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.RELEASE_MECHANISM_OTHER` | PRESERVED |
| `sourceCategory` | Release Source | select |  |  | 9 |  | `DRV.PERF.SPILL_RELEASE.SOURCE_CATEGORY` | PRESERVED |
| `sourceSubsystem` | Subsystem | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.SOURCE_SUBSYSTEM` | PRESERVED |
| `sourceComponent` | Component | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.SOURCE_COMPONENT` | PRESERVED |
| `eventTimeZone` | Time Zone (IANA) | select |  |  | 15 |  | `DRV.PERF.SPILL_RELEASE.EVENT_TIME_ZONE` | PRESERVED |
| `occurrenceWindowStart` | Estimated Occurrence Window - Start | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.OCCURRENCE_WINDOW_START` | PRESERVED |
| `occurrenceWindowEnd` | Estimated Occurrence Window - End | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.OCCURRENCE_WINDOW_END` | PRESERVED |
| `occurrenceWindowBasis` | Basis for Estimated Window | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.OCCURRENCE_WINDOW_BASIS` | PRESERVED |
| `discoveryDate` | Discovery Date | date |  |  |  |  | `DRV.PERF.SPILL_RELEASE.DISCOVERY_DATE` | PRESERVED |
| `discoveryTime` | Discovery Time | time |  |  |  |  | `DRV.PERF.SPILL_RELEASE.DISCOVERY_TIME` | PRESERVED |
| `reportedTime` | Reported Time | time |  |  |  |  | `DRV.PERF.SPILL_RELEASE.REPORTED_TIME` | PRESERVED |
| `loadReference` | Load Reference | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.LOAD_REFERENCE` | PRESERVED |
| `bolPro` | BOL / PRO | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.BOL_PRO` | PRESERVED |
| `shipmentReference` | Shipment Reference | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.SHIPMENT_REFERENCE` | PRESERVED |
| `customerName` | Customer | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.CUSTOMER_NAME` | PRESERVED |
| `shipperName` | Shipper | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.SHIPPER_NAME` | PRESERVED |
| `receiverName` | Receiver | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.RECEIVER_NAME` | PRESERVED |
| `originText` | Origin | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.ORIGIN` | PRESERVED |
| `destinationText` | Destination | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.DESTINATION` | PRESERVED |
| `facilitySite` | Facility / Site | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.FACILITY_SITE` | PRESERVED |
| `routeReference` | Route Reference | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.ROUTE_REFERENCE` | PRESERVED |
| `operatingStage` | Operating Stage | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.OPERATING_STAGE` | PRESERVED |
| `waterwayRisk` | Waterway Risk | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RISK_WATERWAY` | PRESERVED |
| `publicExposureRisk` | Public Exposure Risk | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RISK_PUBLIC_EXPOSURE` | PRESERVED |
| `continuingDanger` | Continuing Danger | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RISK_CONTINUING_DANGER` | PRESERVED |
| `roadwayInterruption` | Roadway Interruption | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.IMPACT_ROADWAY_INTERRUPTION` | PRESERVED |
| `operationalInterruption` | Operational Interruption | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.IMPACT_OPERATIONAL_INTERRUPTION` | PRESERVED |
| `serviceImpact` | Service Impact | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.IMPACT_SERVICE` | PRESERVED |
| `otherImpactNote` | Property / Facility Impact Note | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.IMPACT_OTHER_NOTE` | PRESERVED |
| `vehicleStopped` | Vehicle Stopped | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_VEHICLE_STOPPED` | PRESERVED |
| `engineShutOff` | Engine Shut Off | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_ENGINE_SHUT_OFF` | PRESERVED |
| `valveClosed` | Valve Closed | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_VALVE_CLOSED` | PRESERVED |
| `absorbentApplied` | Absorbent Applied | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_ABSORBENT_APPLIED` | PRESERVED |
| `drainProtected` | Drain Protected | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_DRAIN_PROTECTED` | PRESERVED |
| `dispatchContacted` | Dispatch Contacted | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_DISPATCH_CONTACTED` | PRESERVED |
| `emergencyServicesContacted` | 911 / Emergency Services Contacted | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_EMERGENCY_SERVICES_CONTACTED` | PRESERVED |
| `evacuationPerformed` | Evacuation Performed | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_EVACUATION` | PRESERVED |
| `hazmatResponseContacted` | Hazmat Response Contacted | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_HAZMAT_RESPONSE_CONTACTED` | PRESERVED |
| `areaSecured` | Area Secured | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_AREA_SECURED` | PRESERVED |
| `ignitionSourcesRemoved` | Ignition Sources Removed | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_IGNITION_SOURCES_REMOVED` | PRESERVED |
| `ppeUsed` | PPE Used | select |  |  | 3 |  | `DRV.PERF.SPILL_RELEASE.RESPONSE_PPE_USED` | PRESERVED |
| `responseNotes` | Reporter Description | textarea |  |  |  |  | `DRV.PERF.SPILL_RELEASE.RESPONSENOTES` | PRESERVED |
| `material` | Legacy Material / Substance | text |  |  |  |  | `DRV.PERF.SPILL_RELEASE.MATERIAL` | PRESERVED (legacy, read-only) |
| `quantityReleased` | Legacy Quantity Released | number |  |  |  | dynamic | `DRV.PERF.SPILL_RELEASE.QUANTITYRELEASED` | PRESERVED (legacy, read-only) |
| `releaseEnvironment` | Legacy Release Environment | select |  |  | 8 |  | `DRV.PERF.SPILL_RELEASE.RELEASEENVIRONMENT` | PRESERVED (legacy, read-only) |
| `containmentPerformed` | Legacy Containment Performed | boolean |  |  |  |  | `DRV.PERF.SPILL_RELEASE.CONTAINMENTPERFORMED` | PRESERVED (legacy, read-only) |
| `emergencyResponse` | Legacy Emergency Response | boolean |  |  |  |  | `DRV.PERF.SPILL_RELEASE.EMERGENCYRESPONSE` | PRESERVED (legacy, read-only) |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Customer Event (`CUSTOMER_EVENT`, 50 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `customerEventType` | Customer Event Type | select | yes |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.CUSTOMER_EVENT_TYPE` | PRESERVED |
| `intakeChannel` | Intake Channel | select |  |  | 6 |  | `DRV.PERF.CUSTOMER_EVENT.INTAKE_CHANNEL` | PRESERVED |
| `eventTimeZone` | Time Zone (IANA) | select |  |  | 15 |  | `DRV.PERF.CUSTOMER_EVENT.EVENT_TIME_ZONE` | PRESERVED |
| `occurrenceWindowStart` | Estimated Occurrence Window - Start | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.OCCURRENCE_WINDOW_START` | PRESERVED |
| `occurrenceWindowEnd` | Estimated Occurrence Window - End | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.OCCURRENCE_WINDOW_END` | PRESERVED |
| `occurrenceWindowBasis` | Basis for Estimated Window | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.OCCURRENCE_WINDOW_BASIS` | PRESERVED |
| `discoveryDate` | Discovery Date | date |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.DISCOVERY_DATE` | PRESERVED |
| `discoveryTime` | Discovery Time | time |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.DISCOVERY_TIME` | PRESERVED |
| `reportedTime` | Received Time | time |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.REPORTED_TIME` | PRESERVED |
| `customerName` | Customer | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.CUSTOMER_NAME` | PRESERVED |
| `customerRole` | Customer Role | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.CUSTOMER_ROLE` | PRESERVED |
| `customerContact` | Customer Contact | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.CUSTOMER_CONTACT` | PRESERVED |
| `customerSite` | Customer Site / Facility | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.CUSTOMER_SITE` | PRESERVED |
| `siteArea` | Site Area / Dock / Yard | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.SITE_AREA` | PRESERVED |
| `shipperName` | Shipper | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.SHIPPER_NAME` | PRESERVED |
| `receiverName` | Receiver | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.RECEIVER_NAME` | PRESERVED |
| `brokerName` | Broker | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.BROKER_NAME` | PRESERVED |
| `loadReference` | Load Reference | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.LOAD_REFERENCE` | PRESERVED |
| `shipmentReference` | Shipment Reference | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.SHIPMENT_REFERENCE` | PRESERVED |
| `bolPro` | BOL / PRO | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.BOL_PRO` | PRESERVED |
| `originText` | Origin | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.ORIGIN` | PRESERVED |
| `destinationText` | Destination | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.DESTINATION` | PRESERVED |
| `appointmentReference` | Appointment Reference | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.APPOINTMENT_REFERENCE` | PRESERVED |
| `routeReference` | Route Reference | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.ROUTE_REFERENCE` | PRESERVED |
| `serviceType` | Service Type | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.SERVICE_TYPE` | PRESERVED |
| `operatingStage` | Operating Stage | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.OPERATING_STAGE` | PRESERVED |
| `normalizedNarrative` | Normalized Description | textarea |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.NORMALIZED_NARRATIVE` | PRESERVED |
| `complaintPrimaryCategory` | Complaint Primary Category | select |  |  | 11 |  | `DRV.PERF.CUSTOMER_EVENT.COMPLAINT_PRIMARY_CATEGORY` | PRESERVED |
| `complaintSecondaryCategories` | Complaint Secondary Categories | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.COMPLAINT_SECONDARY_CATEGORIES` | PRESERVED |
| `customerImpactNote` | Customer Impact (as reported) | textarea |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.CUSTOMER_IMPACT_NOTE` | PRESERVED |
| `operationalInterruption` | Operational Interruption / Delay | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.OPERATIONAL_INTERRUPTION` | PRESERVED |
| `safetySignificance` | Safety Significance | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.SAFETY_SIGNIFICANCE` | PRESERVED |
| `regulatorySignificance` | Regulatory Significance | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.REGULATORY_SIGNIFICANCE` | PRESERVED |
| `coachingGiven` | Coaching Given | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_COACHING_GIVEN` | PRESERVED |
| `activityStopped` | Activity Stopped | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_ACTIVITY_STOPPED` | PRESERVED |
| `supervisorContacted` | Supervisor Contacted | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_SUPERVISOR_CONTACTED` | PRESERVED |
| `securityContacted` | Security Contacted | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_SECURITY_CONTACTED` | PRESERVED |
| `emergencyServicesContacted` | Emergency Services Contacted | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_EMERGENCY_SERVICES_CONTACTED` | PRESERVED |
| `areaSecured` | Area Secured | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_AREA_SECURED` | PRESERVED |
| `noImmediateAction` | No Immediate Action | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_NO_IMMEDIATE_ACTION` | PRESERVED |
| `otherImmediateAction` | Other Immediate Action | select |  |  | 3 |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_OTHER` | PRESERVED |
| `otherImmediateActionNote` | Other Immediate Action - Note | text |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.RESPONSE_OTHER_NOTE` | PRESERVED |
| `complaintAssessmentRequired` | Complaint Assessment Required | select |  |  | 2 |  | `DRV.PERF.CUSTOMER_EVENT.REQUIRE_COMPLAINT_ASSESSMENT` | PRESERVED |
| `customerResponseRequired` | Customer Response Required | select |  |  | 2 |  | `DRV.PERF.CUSTOMER_EVENT.REQUIRE_CUSTOMER_RESPONSE` | PRESERVED |
| `siteReviewRequired` | Site Review Required | select |  |  | 2 |  | `DRV.PERF.CUSTOMER_EVENT.REQUIRE_SITE_REVIEW` | PRESERVED |
| `recognitionReviewRequired` | Recognition Review Required | select |  |  | 2 |  | `DRV.PERF.CUSTOMER_EVENT.REQUIRE_RECOGNITION_REVIEW` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `expectedService` | Expected Service | textarea |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.EXPECTEDSERVICE` | ADDED |
| `actualService` | Actual Service | textarea |  |  |  |  | `DRV.PERF.CUSTOMER_EVENT.ACTUALSERVICE` | ADDED |

### Security Incident (`SECURITY_INCIDENT`, 13 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `securityType` | Security Incident Type | select | yes |  | 6 |  | `DRV.PERF.SECURITY_INCIDENT.SECURITYTYPE` | PRESERVED |
| `affectedAsset` | Affected Asset | text |  |  |  |  | `DRV.PERF.SECURITY_INCIDENT.AFFECTEDASSET` | PRESERVED |
| `lawEnforcementNotified` | Law Enforcement Notified | boolean |  |  |  |  | `DRV.PERF.SECURITY_INCIDENT.LAWENFORCEMENTNOTIFIED` | PRESERVED |
| `incidentNarrative` | Incident Narrative | textarea |  |  |  |  | `DRV.PERF.SECURITY_INCIDENT.INCIDENTNARRATIVE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `affectedAssetClass` | Affected Asset Class | select |  |  | 8 |  | `DRV.PERF.SECURITY_INCIDENT.AFFECTEDASSETCLASS` | ADDED |
| `discoveryDate` | Discovery Date | date |  |  |  |  | `DRV.PERF.SECURITY_INCIDENT.DISCOVERYDATE` | ADDED |
| `discoveryTime` | Discovery Time | time |  |  |  |  | `DRV.PERF.SECURITY_INCIDENT.DISCOVERYTIME` | ADDED |
| `accessMethod` | Access / Tampering | select |  |  | 7 |  | `DRV.PERF.SECURITY_INCIDENT.ACCESSMETHOD` | ADDED |
| `policeReportReference` | Police / Authority Report Reference | text |  |  |  |  | `DRV.PERF.SECURITY_INCIDENT.POLICEREPORTREFERENCE` | ADDED |
| `containmentState` | Containment | select |  |  | 4 |  | `DRV.PERF.SECURITY_INCIDENT.CONTAINMENTSTATE` | ADDED |
| `recoveryState` | Recovery | select |  |  | 5 |  | `DRV.PERF.SECURITY_INCIDENT.RECOVERYSTATE` | ADDED |

### Equipment Failure / Critical Defect (`EQUIPMENT_FAILURE`, 13 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `equipmentIssueType` | Equipment Issue | select | yes |  | 7 |  | `DRV.PERF.EQUIPMENT_FAILURE.EQUIPMENTISSUETYPE` | PRESERVED |
| `vehicleContext` | Vehicle Context | text |  |  |  |  | `DRV.PERF.EQUIPMENT_FAILURE.VEHICLECONTEXT` | PRESERVED |
| `defectReported` | Defect Reported by Driver | boolean |  |  |  |  | `DRV.PERF.EQUIPMENT_FAILURE.DEFECTREPORTED` | PRESERVED |
| `reportedDate` | Defect Report Date | date |  |  |  |  | `DRV.PERF.EQUIPMENT_FAILURE.REPORTEDDATE` | PRESERVED |
| `equipmentNarrative` | Equipment Narrative | textarea |  |  |  |  | `DRV.PERF.EQUIPMENT_FAILURE.EQUIPMENTNARRATIVE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `component` | Component | text |  |  |  |  | `DRV.PERF.EQUIPMENT_FAILURE.COMPONENT` | ADDED |
| `symptom` | Symptom | text |  |  |  |  | `DRV.PERF.EQUIPMENT_FAILURE.SYMPTOM` | ADDED |
| `detectionMethod` | How the Defect Was Found | select |  |  | 8 |  | `DRV.PERF.EQUIPMENT_FAILURE.DETECTIONMETHOD` | ADDED |
| `vehicleSafeToOperate` | Vehicle Safe to Operate | select |  |  | 3 |  | `DRV.PERF.EQUIPMENT_FAILURE.VEHICLESAFETOOPERATE` | ADDED |
| `repairCertificationState` | Repair Certification | select |  |  | 4 |  | `DRV.PERF.EQUIPMENT_FAILURE.REPAIRCERTIFICATIONSTATE` | ADDED |
| `repeatDefectSuspected` | Repeat Defect Suspected | select |  |  | 3 |  | `DRV.PERF.EQUIPMENT_FAILURE.REPEATDEFECTSUSPECTED` | ADDED |

### Emergency Event (`EMERGENCY_EVENT`, 11 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `emergencyType` | Emergency Type | select | yes |  | 7 |  | `DRV.PERF.EMERGENCY_EVENT.EMERGENCYTYPE` | PRESERVED |
| `emergencyServices` | Emergency Services Involved | boolean |  |  |  |  | `DRV.PERF.EMERGENCY_EVENT.EMERGENCYSERVICES` | PRESERVED |
| `downtimeHours` | Operational Downtime | number |  |  |  | hours | `DRV.PERF.EMERGENCY_EVENT.DOWNTIMEHOURS` | PRESERVED |
| `emergencyNarrative` | Emergency Narrative | textarea | yes |  |  |  | `DRV.PERF.EMERGENCY_EVENT.EMERGENCYNARRATIVE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `emergencyTrigger` | Trigger | select |  |  | 8 |  | `DRV.PERF.EMERGENCY_EVENT.EMERGENCYTRIGGER` | ADDED |
| `responseAgencies` | Response Agencies | text |  |  |  |  | `DRV.PERF.EMERGENCY_EVENT.RESPONSEAGENCIES` | ADDED |
| `immediateSafetyActions` | Immediate Safety Actions | textarea |  |  |  |  | `DRV.PERF.EMERGENCY_EVENT.IMMEDIATESAFETYACTIONS` | ADDED |
| `peopleImpactedCount` | People Impacted | number |  |  |  | count | `DRV.PERF.EMERGENCY_EVENT.PEOPLEIMPACTEDCOUNT` | ADDED |
| `resolutionState` | Resolution | select |  |  | 4 |  | `DRV.PERF.EMERGENCY_EVENT.RESOLUTIONSTATE` | ADDED |

### Speeding (`SPEEDING`, 19 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `thresholdBasis` | Threshold Basis | select | yes |  | 5 |  | `DRV.PERF.SPEEDING.THRESHOLDBASIS` | PRESERVED |
| `actualSpeed` | Actual / Trigger Speed | number | yes |  |  |  | `DRV.PERF.SPEEDING.ACTUALSPEED` | PRESERVED |
| `postedSpeedLimit` | Posted Speed Limit | number |  |  |  |  | `DRV.PERF.SPEEDING.POSTEDSPEEDLIMIT` | PRESERVED |
| `companyThreshold` | Company Threshold | number |  |  |  |  | `DRV.PERF.SPEEDING.COMPANYTHRESHOLD` | PRESERVED |
| `applicableThreshold` | Applicable Threshold | number |  |  |  |  | `DRV.PERF.SPEEDING.APPLICABLETHRESHOLD` | PRESERVED |
| `amountExceeded` | Amount Exceeded | number |  |  |  |  | `DRV.PERF.SPEEDING.AMOUNTEXCEEDED` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.SPEEDING.DURATIONSECONDS` | PRESERVED |
| `distanceTraveled` | Distance Traveled | number |  |  |  |  | `DRV.PERF.SPEEDING.DISTANCETRAVELED` | PRESERVED |
| `peakSpeed` | Peak Speed | number |  |  |  |  | `DRV.PERF.SPEEDING.PEAKSPEED` | PRESERVED |
| `averageSpeed` | Average Speed | number |  |  |  |  | `DRV.PERF.SPEEDING.AVERAGESPEED` | PRESERVED |
| `zoneType` | Zone Type | select |  |  | 9 |  | `DRV.PERF.SHARED.ZONE_TYPE` | PRESERVED |
| `loadStatus` | Load Status | select |  |  | 4 |  | `DRV.PERF.SHARED.LOAD_STATE` | PRESERVED |
| `provider` | Provider | text |  |  |  |  | `DRV.PERF.SPEEDING.PROVIDER` | PRESERVED |
| `thresholdVersion` | Threshold Version | text |  |  |  |  | `DRV.PERF.SPEEDING.THRESHOLDVERSION` | PRESERVED |
| `thresholdEffectiveDate` | Threshold Effective Date | date |  |  |  |  | `DRV.PERF.SPEEDING.THRESHOLDEFFECTIVEDATE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `gpsConfidence` | GPS Confidence | select |  |  | 4 |  | `DRV.PERF.SPEEDING.GPSCONFIDENCE` | ADDED |
| `roadCondition` | Road Condition | select |  |  | 6 |  | `DRV.PERF.SPEEDING.ROADCONDITION` | ADDED |

### Harsh Braking (`HARSH_BRAKING`, 21 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `triggerDeceleration` | Trigger Deceleration | number | yes |  |  |  | `DRV.PERF.HARSH_BRAKING.TRIGGERDECELERATION` | PRESERVED |
| `threshold` | Threshold | number | yes |  |  |  | `DRV.PERF.HARSH_BRAKING.THRESHOLD` | PRESERVED |
| `thresholdVariance` | Threshold Variance | number |  |  |  |  | `DRV.PERF.HARSH_BRAKING.THRESHOLDVARIANCE` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.HARSH_BRAKING.DURATIONSECONDS` | PRESERVED |
| `distanceTraveled` | Distance Traveled | number |  |  |  |  | `DRV.PERF.HARSH_BRAKING.DISTANCETRAVELED` | PRESERVED |
| `peakDeceleration` | Peak Deceleration | number |  |  |  |  | `DRV.PERF.HARSH_BRAKING.PEAKDECELERATION` | PRESERVED |
| `averageDeceleration` | Average Deceleration | number |  |  |  |  | `DRV.PERF.HARSH_BRAKING.AVERAGEDECELERATION` | PRESERVED |
| `speedAtTrigger` | Speed at Trigger | number |  |  |  |  | `DRV.PERF.HARSH_BRAKING.SPEEDATTRIGGER` | PRESERVED |
| `endingSpeed` | Ending Speed | number |  |  |  |  | `DRV.PERF.HARSH_BRAKING.ENDINGSPEED` | PRESERVED |
| `distanceMeters` | Distance | number |  |  |  | m | `DRV.PERF.HARSH_BRAKING.DISTANCEMETERS` | PRESERVED |
| `roadGrade` | Road Grade | number |  |  |  | % | `DRV.PERF.HARSH_BRAKING.ROADGRADE` | PRESERVED |
| `weather` | Weather | select |  |  | 8 |  | `DRV.PERF.SHARED.WEATHER_CONDITION` | PRESERVED |
| `roadSurface` | Road Surface | select |  |  | 8 |  | `DRV.PERF.SHARED.ROAD_SURFACE` | PRESERVED |
| `lighting` | Lighting | select |  |  | 5 |  | `DRV.PERF.SHARED.LIGHTING_CONDITION` | PRESERVED |
| `traffic` | Traffic | select |  |  | 5 |  | `DRV.PERF.SHARED.TRAFFIC_CONDITION` | PRESERVED |
| `loadStatus` | Load Status | select |  |  | 4 |  | `DRV.PERF.SHARED.LOAD_STATE` | PRESERVED |
| `forwardCollisionWarning` | Forward Collision Warning | boolean |  |  |  |  | `DRV.PERF.HARSH_BRAKING.FORWARDCOLLISIONWARNING` | PRESERVED |
| `provider` | Provider | text |  |  |  |  | `DRV.PERF.HARSH_BRAKING.PROVIDER` | PRESERVED |
| `thresholdVersion` | Threshold Version | text |  |  |  |  | `DRV.PERF.HARSH_BRAKING.THRESHOLDVERSION` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Harsh Acceleration (`HARSH_ACCELERATION`, 16 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `triggerAcceleration` | Trigger Acceleration | number | yes |  |  |  | `DRV.PERF.HARSH_ACCELERATION.TRIGGERACCELERATION` | PRESERVED |
| `threshold` | Threshold | number | yes |  |  |  | `DRV.PERF.HARSH_ACCELERATION.THRESHOLD` | PRESERVED |
| `variance` | Threshold Variance | number |  |  |  |  | `DRV.PERF.HARSH_ACCELERATION.VARIANCE` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.HARSH_ACCELERATION.DURATIONSECONDS` | PRESERVED |
| `distanceTraveled` | Distance Traveled | number |  |  |  |  | `DRV.PERF.HARSH_ACCELERATION.DISTANCETRAVELED` | PRESERVED |
| `peakAcceleration` | Peak Acceleration | number |  |  |  |  | `DRV.PERF.HARSH_ACCELERATION.PEAKACCELERATION` | PRESERVED |
| `averageAcceleration` | Average Acceleration | number |  |  |  |  | `DRV.PERF.HARSH_ACCELERATION.AVERAGEACCELERATION` | PRESERVED |
| `triggerSpeed` | Trigger Speed | number |  |  |  |  | `DRV.PERF.HARSH_ACCELERATION.TRIGGERSPEED` | PRESERVED |
| `endingSpeed` | Ending Speed | number |  |  |  |  | `DRV.PERF.HARSH_ACCELERATION.ENDINGSPEED` | PRESERVED |
| `distanceMeters` | Distance | number |  |  |  | m | `DRV.PERF.HARSH_ACCELERATION.DISTANCEMETERS` | PRESERVED |
| `loadStatus` | Load Status | select |  |  | 4 |  | `DRV.PERF.SHARED.LOAD_STATE` | PRESERVED |
| `weather` | Weather | select |  |  | 8 |  | `DRV.PERF.SHARED.WEATHER_CONDITION` | PRESERVED |
| `road` | Road | select |  |  | 8 |  | `DRV.PERF.SHARED.ROAD_SURFACE` | PRESERVED |
| `lighting` | Lighting | select |  |  | 5 |  | `DRV.PERF.SHARED.LIGHTING_CONDITION` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Harsh Cornering (`HARSH_CORNERING`, 15 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `lateralAcceleration` | Lateral Acceleration | number | yes |  |  |  | `DRV.PERF.HARSH_CORNERING.LATERALACCELERATION` | PRESERVED |
| `threshold` | Threshold | number | yes |  |  |  | `DRV.PERF.HARSH_CORNERING.THRESHOLD` | PRESERVED |
| `variance` | Threshold Variance | number |  |  |  |  | `DRV.PERF.HARSH_CORNERING.VARIANCE` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.HARSH_CORNERING.DURATIONSECONDS` | PRESERVED |
| `distanceTraveled` | Distance Traveled | number |  |  |  |  | `DRV.PERF.HARSH_CORNERING.DISTANCETRAVELED` | PRESERVED |
| `peakLateralAcceleration` | Peak Lateral Acceleration | number |  |  |  |  | `DRV.PERF.HARSH_CORNERING.PEAKLATERALACCELERATION` | PRESERVED |
| `averageLateralAcceleration` | Average Lateral Acceleration | number |  |  |  |  | `DRV.PERF.HARSH_CORNERING.AVERAGELATERALACCELERATION` | PRESERVED |
| `speed` | Speed | number |  |  |  |  | `DRV.PERF.HARSH_CORNERING.SPEED` | PRESERVED |
| `turnRadius` | Turn Radius | number |  |  |  | m | `DRV.PERF.HARSH_CORNERING.TURNRADIUS` | PRESERVED |
| `loadStatus` | Load Status | select |  |  | 4 |  | `DRV.PERF.SHARED.LOAD_STATE` | PRESERVED |
| `roadGeometry` | Road Geometry | text |  |  |  |  | `DRV.PERF.HARSH_CORNERING.ROADGEOMETRY` | PRESERVED |
| `weather` | Weather | select |  |  | 8 |  | `DRV.PERF.SHARED.WEATHER_CONDITION` | PRESERVED |
| `roadSurface` | Road Surface | select |  |  | 8 |  | `DRV.PERF.SHARED.ROAD_SURFACE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Following Distance (`FOLLOWING_DISTANCE`, 19 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `timeGapSeconds` | Time Gap | number | yes |  |  | seconds | `DRV.PERF.FOLLOWING_DISTANCE.TIMEGAPSECONDS` | PRESERVED |
| `timeGapThresholdSeconds` | Applicable Time-Gap Threshold | number | yes |  |  | seconds | `DRV.PERF.FOLLOWING_DISTANCE.TIMEGAPTHRESHOLDSECONDS` | PRESERVED |
| `timeGapVarianceSeconds` | Time-Gap Variance | number |  |  |  | seconds | `DRV.PERF.FOLLOWING_DISTANCE.TIMEGAPVARIANCESECONDS` | PRESERVED |
| `distanceGapMeters` | Distance Gap | number |  |  |  | m | `DRV.PERF.FOLLOWING_DISTANCE.DISTANCEGAPMETERS` | PRESERVED |
| `distanceThresholdMeters` | Applicable Distance Threshold | number |  |  |  | m | `DRV.PERF.FOLLOWING_DISTANCE.DISTANCETHRESHOLDMETERS` | PRESERVED |
| `distanceVarianceMeters` | Distance Variance | number |  |  |  | m | `DRV.PERF.FOLLOWING_DISTANCE.DISTANCEVARIANCEMETERS` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.FOLLOWING_DISTANCE.DURATIONSECONDS` | PRESERVED |
| `minimumTimeGapSeconds` | Minimum Time Gap | number |  |  |  | seconds | `DRV.PERF.FOLLOWING_DISTANCE.MINIMUMTIMEGAPSECONDS` | PRESERVED |
| `minimumDistanceGapMeters` | Minimum Distance Gap | number |  |  |  | m | `DRV.PERF.FOLLOWING_DISTANCE.MINIMUMDISTANCEGAPMETERS` | PRESERVED |
| `driverVehicleSpeed` | Driver Vehicle Speed | number |  |  |  |  | `DRV.PERF.FOLLOWING_DISTANCE.DRIVERVEHICLESPEED` | PRESERVED |
| `leadVehicleSpeed` | Lead Vehicle Speed | number |  |  |  |  | `DRV.PERF.FOLLOWING_DISTANCE.LEADVEHICLESPEED` | PRESERVED |
| `relativeSpeed` | Relative Speed | number |  |  |  |  | `DRV.PERF.FOLLOWING_DISTANCE.RELATIVESPEED` | PRESERVED |
| `distanceTraveledMeters` | Distance Traveled | number |  |  |  | m | `DRV.PERF.FOLLOWING_DISTANCE.DISTANCETRAVELEDMETERS` | PRESERVED |
| `loadStatus` | Load Status | select |  |  | 4 |  | `DRV.PERF.SHARED.LOAD_STATE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `measurementConfidence` | Measurement Confidence | select |  |  | 4 |  | `DRV.PERF.FOLLOWING_DISTANCE.MEASUREMENTCONFIDENCE` | ADDED |
| `weatherConditions` | Weather | select |  |  | 7 |  | `DRV.PERF.FOLLOWING_DISTANCE.WEATHERCONDITIONS` | ADDED |
| `trafficConditions` | Traffic | select |  |  | 5 |  | `DRV.PERF.FOLLOWING_DISTANCE.TRAFFICCONDITIONS` | ADDED |

### Fatigue Indicator (`FATIGUE_INDICATOR`, 15 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `indicatorType` | Indicator Type | select | yes |  | 11 |  | `DRV.PERF.FATIGUE_INDICATOR.INDICATORTYPE` | PRESERVED |
| `eyeClosureDurationMs` | Eye Closure Duration | number |  |  |  | ms | `DRV.PERF.FATIGUE_INDICATOR.EYECLOSUREDURATIONMS` | PRESERVED |
| `perclosPercent` | PERCLOS | number |  |  |  | % | `DRV.PERF.FATIGUE_INDICATOR.PERCLOSPERCENT` | PRESERVED |
| `hoursDriven` | Hours Driven | number |  |  |  | hours | `DRV.PERF.FATIGUE_INDICATOR.HOURSDRIVEN` | PRESERVED |
| `timeSinceBreakMinutes` | Time Since Break | number |  |  |  | minutes | `DRV.PERF.FATIGUE_INDICATOR.TIMESINCEBREAKMINUTES` | PRESERVED |
| `consecutiveDrivingDays` | Consecutive Driving Days | number |  |  |  | days | `DRV.PERF.FATIGUE_INDICATOR.CONSECUTIVEDRIVINGDAYS` | PRESERVED |
| `dutyContext` | Duty Context | select |  |  | 8 |  | `DRV.PERF.SHARED.DUTY_CONTEXT` | PRESERVED |
| `hosProximity` | HOS Proximity | select |  |  | 5 |  | `DRV.PERF.FATIGUE_INDICATOR.HOSPROXIMITY` | PRESERVED |
| `sourceClassification` | Source Classification | select |  |  | 2 |  | `DRV.PERF.FATIGUE_INDICATOR.SOURCECLASSIFICATION` | PRESERVED |
| `indicatorNotes` | Operational Context / Notes | textarea |  |  |  |  | `DRV.PERF.FATIGUE_INDICATOR.INDICATORNOTES` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `observedConfidence` | Observation Confidence | select |  |  | 4 |  | `DRV.PERF.FATIGUE_INDICATOR.OBSERVEDCONFIDENCE` | ADDED |
| `interventionTaken` | Intervention | select |  |  | 7 |  | `DRV.PERF.FATIGUE_INDICATOR.INTERVENTIONTAKEN` | ADDED |
| `restRecoveryOutcome` | Rest / Recovery Outcome | select |  |  | 5 |  | `DRV.PERF.FATIGUE_INDICATOR.RESTRECOVERYOUTCOME` | ADDED |

### Device / Data Integrity (`DEVICE_DATA_INTEGRITY`, 19 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `integrityState` | Integrity State | select | yes |  | 7 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.INTEGRITYSTATE` | PRESERVED |
| `deviceType` | Device Type | select | yes |  | 8 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DEVICETYPE` | PRESERVED |
| `anomalyType` | Event / Anomaly Type | select |  |  | 8 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.ANOMALYTYPE` | PRESERVED |
| `interferenceMethod` | Interference Method | select |  |  | 7 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.INTERFERENCEMETHOD` | PRESERVED |
| `dataImpact` | Data Impact | select |  |  | 6 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DATAIMPACT` | PRESERVED |
| `detectionDate` | Detection Date | date |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DETECTIONDATE` | PRESERVED |
| `detectionTime` | Detection Time | time |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DETECTIONTIME` | PRESERVED |
| `deviceDisabled` | Device Disabled | boolean |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DEVICEDISABLED` | PRESERVED |
| `dataLossDurationMinutes` | Data Loss Duration | number |  |  |  | minutes | `DRV.PERF.DEVICE_DATA_INTEGRITY.DATALOSSDURATIONMINUTES` | PRESERVED |
| `dataRecoveryState` | Data Recovery State | select |  |  | 5 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DATARECOVERYSTATE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.SOURCERECORDID` | PRESERVED |
| `deviceProvider` | Device Provider | text |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DEVICEPROVIDER` | ADDED |
| `deviceIdentifier` | Device Identifier | text |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DEVICEIDENTIFIER` | ADDED |
| `affectedIntervalStart` | Affected Interval - Start | text |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.AFFECTEDINTERVALSTART` | ADDED |
| `affectedIntervalEnd` | Affected Interval - End | text |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.AFFECTEDINTERVALEND` | ADDED |
| `remediationNote` | Remediation | textarea |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.REMEDIATIONNOTE` | ADDED |
| `downstreamFactsInvalidated` | Downstream Facts Invalidated | select |  |  | 3 |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.DOWNSTREAMFACTSINVALIDATED` | ADDED |
| `invalidatedScope` | Scope of Invalidated Facts | text |  |  |  |  | `DRV.PERF.DEVICE_DATA_INTEGRITY.INVALIDATEDSCOPE` | ADDED |

### Seatbelt (`SEATBELT`, 10 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `seatbeltState` | Seatbelt State | select | yes |  | 4 |  | `DRV.PERF.SEATBELT.SEATBELTSTATE` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.SEATBELT.DURATIONSECONDS` | PRESERVED |
| `speed` | Vehicle Speed | number |  |  |  |  | `DRV.PERF.SEATBELT.SPEED` | PRESERVED |
| `provider` | Provider | text |  |  |  |  | `DRV.PERF.SEATBELT.PROVIDER` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `occupantRole` | Occupant | select |  |  | 3 |  | `DRV.PERF.SEATBELT.OCCUPANTROLE` | ADDED |
| `detectionConfidence` | Detection Confidence | select |  |  | 4 |  | `DRV.PERF.SEATBELT.DETECTIONCONFIDENCE` | ADDED |
| `contextNotes` | Context | textarea |  |  |  |  | `DRV.PERF.SEATBELT.CONTEXTNOTES` | ADDED |
| `verifiedOutcome` | Verified Outcome | select |  |  | 4 |  | `DRV.PERF.SEATBELT.VERIFIEDOUTCOME` | ADDED |

### Distracted Driving (`DISTRACTED_DRIVING`, 9 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `distractionType` | Distraction Type | select | yes |  | 6 |  | `DRV.PERF.DISTRACTED_DRIVING.DISTRACTIONTYPE` | PRESERVED |
| `durationSeconds` | Duration | number |  |  |  | seconds | `DRV.PERF.DISTRACTED_DRIVING.DURATIONSECONDS` | PRESERVED |
| `speed` | Vehicle Speed | number |  |  |  |  | `DRV.PERF.DISTRACTED_DRIVING.SPEED` | PRESERVED |
| `observedContext` | Observed Context | textarea |  |  |  |  | `DRV.PERF.DISTRACTED_DRIVING.OBSERVEDCONTEXT` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `observationConfidence` | Observation Confidence | select |  |  | 4 |  | `DRV.PERF.DISTRACTED_DRIVING.OBSERVATIONCONFIDENCE` | ADDED |
| `safeguardsContext` | Safeguards in Place | text |  |  |  |  | `DRV.PERF.DISTRACTED_DRIVING.SAFEGUARDSCONTEXT` | ADDED |
| `reviewOutcome` | Review Outcome | select |  |  | 4 |  | `DRV.PERF.DISTRACTED_DRIVING.REVIEWOUTCOME` | ADDED |

### Idle Time (`IDLE_TIME`, 14 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `durationMinutes` | Idle Duration | number | yes |  |  | minutes | `DRV.PERF.IDLE_TIME.DURATIONMINUTES` | PRESERVED |
| `thresholdMinutes` | Applicable Threshold | number |  |  |  | minutes | `DRV.PERF.IDLE_TIME.THRESHOLDMINUTES` | PRESERVED |
| `varianceMinutes` | Threshold Variance | number |  |  |  | minutes | `DRV.PERF.IDLE_TIME.VARIANCEMINUTES` | PRESERVED |
| `locationType` | Location Type | select |  |  | 6 |  | `DRV.PERF.IDLE_TIME.LOCATIONTYPE` | PRESERVED |
| `loadStatus` | Load Status | select |  |  | 4 |  | `DRV.PERF.SHARED.LOAD_STATE` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |
| `idleStart` | Idle Start | text |  |  |  |  | `DRV.PERF.IDLE_TIME.IDLESTART` | ADDED |
| `idleEnd` | Idle End | text |  |  |  |  | `DRV.PERF.IDLE_TIME.IDLEEND` | ADDED |
| `engineState` | Engine State | select |  |  | 4 |  | `DRV.PERF.IDLE_TIME.ENGINESTATE` | ADDED |
| `ambientTemperature` | Ambient Temperature | number |  |  |  | °C | `DRV.PERF.IDLE_TIME.AMBIENTTEMPERATURE` | ADDED |
| `exemptionReason` | Exemption | select |  |  | 9 |  | `DRV.PERF.IDLE_TIME.EXEMPTIONREASON` | ADDED |
| `fuelEstimateBasis` | Fuel Estimate Basis | select |  |  | 4 |  | `DRV.PERF.IDLE_TIME.FUELESTIMATEBASIS` | ADDED |
| `estimatedFuelUsed` | Estimated Fuel Used | number |  |  |  | litres | `DRV.PERF.IDLE_TIME.ESTIMATEDFUELUSED` | ADDED |

### Route Deviation (`ROUTE_DEVIATION`, 5 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `deviationDistanceMiles` | Deviation Distance | number |  |  |  | miles | `DRV.PERF.ROUTE_DEVIATION.DEVIATIONDISTANCEMILES` | PRESERVED |
| `deviationDurationMinutes` | Deviation Duration | number |  |  |  | minutes | `DRV.PERF.ROUTE_DEVIATION.DEVIATIONDURATIONMINUTES` | PRESERVED |
| `deviationReason` | Reported Reason | text |  |  |  |  | `DRV.PERF.ROUTE_DEVIATION.DEVIATIONREASON` | PRESERVED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

### Other Event (`OTHER_EVENT`, 7 fields)

| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |
|---|---|---|---|---|---|---|---|---|
| `noCategoryReason` | Why No Defined Category Fits | textarea | yes |  |  |  | `DRV.PERF.OTHER_EVENT.NOCATEGORYREASON` | ADDED |
| `impactDescription` | Impact | textarea |  |  |  |  | `DRV.PERF.OTHER_EVENT.IMPACTDESCRIPTION` | ADDED |
| `proposedSubtype` | Proposed Category / Subtype | text |  |  |  |  | `DRV.PERF.OTHER_EVENT.PROPOSEDSUBTYPE` | ADDED |
| `classificationReview` | Classification Review | select |  |  | 4 |  | `DRV.PERF.OTHER_EVENT.CLASSIFICATIONREVIEW` | ADDED |
| `reclassifiedTo` | Reclassified To | text |  |  |  |  | `DRV.PERF.OTHER_EVENT.RECLASSIFIEDTO` | ADDED |
| `sourceType` | Source | select | yes |  | 10 |  | `DRV.PERF.SOURCETYPE` | PRESERVED |
| `sourceRecordId` | Source Record ID | text |  |  |  |  | `DRV.PERF.SOURCERECORDID` | PRESERVED |

