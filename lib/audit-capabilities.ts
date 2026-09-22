/**
 * TES Audit Capability Registry — Phase 2D foundation.
 *
 * A Capability is a reusable domain/audit function that more than one
 * audit regime can compose (see AuditCapability, types/audit-preparedness.ts).
 * It carries no methodology, weight, or evidence obligation of its own —
 * that stays on each regime's own Requirement, which references a
 * Capability via Requirement.capabilityIds without merging with any other
 * regime's requirement for the same capability.
 *
 * TRACEABILITY RULE (Phase 2D section 1): every capability below is
 * instantiated only because at least one already-implemented Requirement
 * in lib/audit-regimes/alberta-nsc.ts or lib/audit-regimes/fmcsa-new-entrant.ts
 * actually uses it — cited inline. None was created speculatively "because
 * it will obviously be needed later."
 */

import type { AuditCapability } from "../types/audit-preparedness";

export const DRIVER_QUALIFICATION: AuditCapability = {
  id: "DRIVER_QUALIFICATION",
  name: "Driver Qualification",
  description: "Driver file/qualification record review — application, employment history, licensing, medical qualification, and related driver-file records.",
  domain: "driver",
};

export const HOS_RECORD_REVIEW: AuditCapability = {
  id: "HOS_RECORD_REVIEW",
  name: "Hours of Service Record Review",
  description: "Review of driver duty-status records (RODS/ELD) and related Hours of Service program compliance, including sampled-day quantitative testing where applicable.",
  domain: "hos",
};

export const VEHICLE_INSPECTION: AuditCapability = {
  id: "VEHICLE_INSPECTION",
  name: "Vehicle Inspection",
  description: "Vehicle/combination-unit inspection record review.",
  domain: "vehicle",
};

export const VEHICLE_MAINTENANCE: AuditCapability = {
  id: "VEHICLE_MAINTENANCE",
  name: "Vehicle Maintenance",
  description: "Vehicle maintenance record review — repair, lubrication, scheduled maintenance, recall compliance, and vehicle identification/file record accuracy.",
  domain: "vehicle",
};

export const ACCIDENT_REVIEW: AuditCapability = {
  id: "ACCIDENT_REVIEW",
  name: "Accident Review",
  description: "Accident/collision reporting and register review.",
  domain: "safety",
};

export const DRUG_ALCOHOL_PROGRAM: AuditCapability = {
  id: "DRUG_ALCOHOL_PROGRAM",
  name: "Drug & Alcohol Program",
  description: "Carrier drug and alcohol testing program review, including random testing procedure, testing pool, and individual testing-context records.",
  domain: "safety",
};

export const FINANCIAL_RESPONSIBILITY: AuditCapability = {
  id: "FINANCIAL_RESPONSIBILITY",
  name: "Financial Responsibility",
  description: "Insurance/financial-responsibility coverage review.",
  domain: "carrier",
};

export const HAZMAT_DOCUMENTATION: AuditCapability = {
  id: "HAZMAT_DOCUMENTATION",
  name: "Hazardous Materials Documentation",
  description: "Hazardous Materials shipping/documentation review. Evidence ownership remains with the Shipment/Load domain regardless of which regime's requirement uses this capability.",
  domain: "carrier",
};

/**
 * Every capability actually instantiated in Phase 2D, with its traceable
 * source requirement(s) cited. This list is the full extent of what's
 * created this phase — nothing here is speculative.
 *
 *   DRIVER_QUALIFICATION    → alberta-nsc.ts: driverFileRequirements (all 9)
 *                             fmcsa-new-entrant.ts: fmcsa-ne-drivers-list,
 *                             fmcsa-ne-drivers-license, fmcsa-ne-driver-mvr,
 *                             fmcsa-ne-medical-certificate
 *   HOS_RECORD_REVIEW       → alberta-nsc.ts: hoursOfServiceRequirements (all 6)
 *                             fmcsa-new-entrant.ts: fmcsa-ne-driver-rod-supporting-docs
 *   VEHICLE_INSPECTION      → alberta-nsc.ts: ab-nsc-vehicle-file-cvip-inspection,
 *                             ab-nsc-vehicle-file-trip-inspection
 *                             fmcsa-new-entrant.ts: fmcsa-ne-vehicle-inspection,
 *                             fmcsa-ne-vehicle-list
 *   VEHICLE_MAINTENANCE     → alberta-nsc.ts: ab-nsc-vehicle-file-identification,
 *                             ab-nsc-vehicle-file-repair-records,
 *                             ab-nsc-vehicle-file-lubrication-records,
 *                             ab-nsc-vehicle-file-scheduled-maintenance,
 *                             ab-nsc-vehicle-file-manufacturer-recalls,
 *                             ab-nsc-vehicle-file-record-accuracy
 *   ACCIDENT_REVIEW         → alberta-nsc.ts: ab-nsc-carrier-safety-collision-reporting,
 *                             ab-nsc-driver-file-reportable-collisions
 *                             fmcsa-new-entrant.ts: fmcsa-ne-accident-register
 *   DRUG_ALCOHOL_PROGRAM    → fmcsa-new-entrant.ts: fmcsa-ne-drug-alcohol-program
 *                             and its decomposition requirements (random
 *                             testing procedure, testing pool, consortium
 *                             documentation, testing records, pre-employment/
 *                             post-accident/reasonable-suspicion/return-to-duty
 *                             testing). No Alberta NSC requirement exists for
 *                             this capability — it is FMCSA-only in this phase.
 *   FINANCIAL_RESPONSIBILITY → alberta-nsc.ts: ab-nsc-financial-responsibility-insurance
 *                              fmcsa-new-entrant.ts: fmcsa-ne-proof-of-insurance
 *   HAZMAT_DOCUMENTATION     → fmcsa-new-entrant.ts: fmcsa-ne-hm-shipping-papers.
 *                              No Alberta NSC requirement exists for this
 *                              capability — it is FMCSA-only in this phase.
 */
export const AUDIT_CAPABILITIES: AuditCapability[] = [
  DRIVER_QUALIFICATION,
  HOS_RECORD_REVIEW,
  VEHICLE_INSPECTION,
  VEHICLE_MAINTENANCE,
  ACCIDENT_REVIEW,
  DRUG_ALCOHOL_PROGRAM,
  FINANCIAL_RESPONSIBILITY,
  HAZMAT_DOCUMENTATION,
];

/**
 * DOCUMENTED FUTURE CONCEPTS — NOT instantiated in this phase.
 *
 * These are named in the Phase 2D task instructions as illustrative future
 * capability ids for regimes not yet implemented (IFTA, IRP, Oregon WMT, NY
 * HUT, KYU, NM WDT, CT HUF). No requirement in alberta-nsc.ts or
 * fmcsa-new-entrant.ts backs any of them, so per the traceability rule they
 * remain a comment, not a record, until a regime actually implements the
 * requirement they'd represent:
 *
 *   DISTANCE_RECONCILIATION, TRIP_RECONSTRUCTION, ODOMETER_CONTINUITY,
 *   GPS_DISTANCE_VALIDATION, FUEL_RECONCILIATION, JURISDICTION_ALLOCATION,
 *   RECORD_ADEQUACY, SHIPMENT_DOCUMENTATION
 *
 * SHIPMENT_DOCUMENTATION specifically was considered and rejected for
 * instantiation this phase: FMCSA's ROD supporting-document evidence
 * (Bill of Lading, trip reports) exists only as EvidenceRequirement entries
 * under fmcsa-ne-driver-rod-supporting-docs, not as their own standalone
 * Requirement — there is no independent Requirement to trace this
 * capability to yet, distinct from HOS_RECORD_REVIEW.
 */
