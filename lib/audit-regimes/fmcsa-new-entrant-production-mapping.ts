/**
 * FMCSA New Entrant Safety Audit — Phase 3D production wiring.
 *
 * Bridges REAL TES canonical records (Vehicle/Driver domain types already
 * used by production UI/store code) to the Phase 3B/3C audit assessment
 * pipeline (EvidenceRelationship -> EvidenceAssessment -> RequirementAssessment
 * -> Preparedness/Coverage). This file NEVER creates an FMCSA-owned copy of
 * a canonical record — it only reads existing canonical types and produces
 * audit-layer relationship/assessment records that reference them by id.
 *
 * SCOPE (Phase 3D selective implementation — see that task's section 18):
 * only the two cleanest, genuinely-modeled, deterministic-applicability
 * paths are wired here:
 *   1. Vehicle Annual/Periodic Inspection (fmcsa-ne-vehicle-inspection)
 *      <- lib/vehicle-data.ts VehicleInspectionRecord + VehicleStore.evidence
 *         (types/evidence.ts EvidenceRecord).
 *   2. Driver Pre-Employment Drug/Alcohol Testing
 *      (fmcsa-ne-drug-alcohol-pre-employment-testing)
 *      <- types/drivers.ts ScreeningRecord.drugAlcoholDetails + the
 *         driver-scoped canonical evidence store (DriverEvidenceItem,
 *         types/drivers.ts — see the header note below on why this is a
 *         SEPARATE canonical evidence store from Vehicle's, not a
 *         duplicate/competitor of it).
 *
 * Every other FMCSA_NEW_ENTRANT_REQUIREMENTS entry is deliberately left
 * unwired in this phase (HOS, drug/alcohol testing pool/consortium/
 * random-testing-procedure records, accident register, driver's licence,
 * medical certificate, MVR, HM shipping papers, proof of insurance) because
 * this phase's inspection found their canonical sources MISSING, PARTIAL,
 * or their applicability/entity-resolution not yet deterministic — see the
 * Phase 3D report's canonical source inventory and requirement mapping
 * matrix for the specific reason per requirement. Those requirements are
 * still represented (as UNDETERMINED, never omitted) by
 * buildFmcsaNewEntrantRequirementAssessments below, so Coverage stays
 * honest rather than reading 100% against only the wired subset.
 *
 * DRIVER EVIDENCE STORE NOTE: this codebase has two separately-scoped
 * canonical evidence models, not one competing pair — types/evidence.ts's
 * EvidenceRecord (used by Vehicle: VehicleStore.evidence, confirmed at
 * lib/vehicle-data.ts:921) and types/drivers.ts's DriverEvidenceItem (used
 * by Driver: lib/driver-data.ts:1351 asserts "Every evidence ID must
 * resolve to a current canonical Driver evidence record," confirmed
 * against DriverEvidenceItem, and lib/driver-data.ts:75 locally aliases
 * `EvidenceRecord = DriverEvidenceItem` for driver-side code — a naming
 * collision with, but not the same store as, types/evidence.ts's
 * EvidenceRecord). Each is internally consistent and is the genuine
 * canonical evidence source for its own domain; this file references each
 * one correctly for its own entity type rather than assuming a single
 * shared evidence store.
 */

import type {
  RequirementAssessment,
  ApplicabilityEvaluationResult,
  EvidenceRelationship,
  EvidenceAssessment,
  AuditEvidenceAssessmentState,
  RequirementAssessmentEvidenceInput,
  Population,
  PopulationAdequacyResult,
  SampleAdequacyResult,
} from "../../types/audit-preparedness";
import type { EntityType } from "../../types/entity-references";
import type { DriverMaster, ScreeningRecord, DriverEvidenceItem } from "../../types/drivers";
import type { EvidenceRecord } from "../../types/evidence";
import type { VehicleRecord } from "../../src/types";
import type { VehicleInspectionRecord } from "../vehicle-data";
import {
  buildRequirementAssessment,
  evaluatePopulationAdequacy,
  evaluateSampleAdequacy,
} from "../audit-preparedness-engine";
import {
  FMCSA_NEW_ENTRANT_REQUIREMENTS,
  FMCSA_NEW_ENTRANT_APPLICABILITY_RULES,
  FMCSA_NE_PART_382_SAMPLING_RULE_ID,
  FMCSA_NEW_ENTRANT_SAMPLING_RULES,
} from "./fmcsa-new-entrant";
import type { CompanyComplianceRuleValue } from "./fmcsa-new-entrant-applicability-facts";
import { buildHmShippingPapersRequirementAssessment } from "./fmcsa-new-entrant-applicability-facts";

// ---------------------------------------------------------------------------
// REGIME-LEVEL APPLICABILITY (Phase 3D section 26)
// ---------------------------------------------------------------------------
// "Is the FMCSA New Entrant Safety Audit applicable to this carrier at all?"
// is distinct from any single Requirement's applicability (Phase 3A found
// this concept entirely missing from the type layer). This function does
// NOT invent a resolution — New Entrant status specifically requires
// knowing whether the carrier is within its post-USDOT-registration New
// Entrant window, a fact this codebase does not model anywhere (confirmed:
// no field resembling a new-entrant designation/date exists on Company,
// src/types.ts:17-28, which is an untyped `[key: string]: any` bag with
// only loosely-used fields like `usdot`). This always returns UNDETERMINED
// with the specific missing fact named, per section 26's "if no: report
// exactly which canonical facts are missing" — it exists so that gap is
// explicit and inspectable rather than silently absent.
export interface FmcsaNewEntrantRegimeApplicabilityResult {
  result: ApplicabilityEvaluationResult;
  reason: string;
  missingCanonicalFacts: string[];
}

export function evaluateFmcsaNewEntrantRegimeApplicability(company: {
  usdot?: string;
}): FmcsaNewEntrantRegimeApplicabilityResult {
  const missingCanonicalFacts: string[] = [];
  if (!company.usdot) missingCanonicalFacts.push("USDOT number (Company.usdot)");
  // Always missing today — no such field exists anywhere in this codebase.
  missingCanonicalFacts.push("New Entrant designation / date the carrier's USDOT operating authority became effective");

  return {
    result: "UNDETERMINED",
    reason:
      "FMCSA New Entrant Safety Audit applicability requires knowing whether the carrier is within its post-authority New Entrant window. TES has no canonical field for this date/designation, so this cannot be resolved to APPLICABLE or NOT_APPLICABLE — it is reported as an explicit, unresolved condition rather than assumed either way.",
    missingCanonicalFacts,
  };
}

// ---------------------------------------------------------------------------
// REQUIREMENT-LEVEL APPLICABILITY ADAPTER (Phase 3D section 14)
// ---------------------------------------------------------------------------
// Deterministic-but-honest rule, using ONLY what the regime's own author
// already encoded (fmcsa-new-entrant.ts:769-771: ApplicabilityRule instances
// were "created only where the source provides a clear applicability
// distinction — not exhaustively for every requirement"). A Requirement
// with ZERO attached ApplicabilityRule instances therefore has no
// source-stated exception at all, per that file's own design intent — this
// is not an invented regulatory rule, it is reading the regime definition's
// existing meaning of "no rule attached." A Requirement WITH one or more
// attached rules resolves UNDETERMINED: evaluateApplicabilityFactsAvailable
// (lib/audit-preparedness-engine.ts) never itself decides APPLICABLE vs.
// NOT_APPLICABLE from present facts (a Phase 2B.1 limitation re-confirmed
// this phase, not something this file works around by inventing that
// missing conditional logic).
export interface FmcsaNewEntrantApplicabilityResult {
  result: ApplicabilityEvaluationResult;
  reason: string;
}

export function evaluateFmcsaNewEntrantRequirementApplicability(requirementId: string): FmcsaNewEntrantApplicabilityResult {
  const attachedRules = FMCSA_NEW_ENTRANT_APPLICABILITY_RULES.filter((r) => r.requirementId === requirementId);

  if (attachedRules.length === 0) {
    return {
      result: "APPLICABLE",
      reason: "No ApplicabilityRule is attached to this requirement in the regime definition — the source material states no exception for it.",
    };
  }

  return {
    result: "UNDETERMINED",
    reason: `This requirement has ${attachedRules.length} source-stated applicability exception(s) (${attachedRules
      .map((r) => r.description)
      .join(" / ")}), and TES cannot yet mechanically resolve which applies (see evaluateApplicabilityFactsAvailable's documented limitation) — applicability is not assumed either way.`,
  };
}

// ---------------------------------------------------------------------------
// EVIDENCE-STATE ADAPTERS (Phase 3D section 13)
// ---------------------------------------------------------------------------
// Never infer VERIFIED merely from a record existing, and never infer VALID
// merely because OCR extracted fields — both adapters below only promote to
// VALID/VERIFIED when the canonical record's OWN verification/date fields
// say so; anything else resolves to a conservative, review-preferring state.

function vehicleInspectionEvidenceState(
  evidence: EvidenceRecord | undefined,
  inspection: VehicleInspectionRecord,
  now: string
): AuditEvidenceAssessmentState {
  if (!evidence) return "MISSING";
  if (evidence.verificationState === "rejected") return "CONFLICTED";
  if (evidence.verificationState === "pending_review") return "REVIEW_REQUIRED";

  const expired = inspection.expiryDate ? inspection.expiryDate < now : false;
  if (expired) return "EXPIRED";

  // "verified" on the canonical EvidenceRecord is an explicit human/system
  // confirmation already made elsewhere — reused here, never fabricated.
  if (evidence.verificationState === "verified") return "VERIFIED";
  // "unverified"/"superseded" or any other state: the document exists and
  // is not expired, but TES has not itself verified it — SUBMITTED, not VALID.
  return "SUBMITTED";
}

function driverScreeningEvidenceState(evidence: DriverEvidenceItem | undefined, screening: ScreeningRecord, now: string): AuditEvidenceAssessmentState {
  if (!evidence) return "MISSING";
  if (evidence.verificationState === "Difference Present") return "CONFLICTED";
  if (evidence.verificationState === "Under Review" || evidence.verificationState === "pending_review") return "REVIEW_REQUIRED";

  const expired = screening.expiryDate ? screening.expiryDate < now : false;
  if (expired) return "EXPIRED";

  if (
    evidence.verificationState === "verified" ||
    evidence.verificationState === "Externally Verified" ||
    evidence.verificationState === "Source Matched"
  ) {
    return "VERIFIED";
  }
  return "SUBMITTED";
}

// ---------------------------------------------------------------------------
// CAPABILITY ADAPTERS BUILT INDEPENDENTLY OF APPLICABILITY
// (Phase 3F sections 21-22 — MVR and Medical Certificate)
// ---------------------------------------------------------------------------
// Both Requirements have canonical evidence (ScreeningRecord + driver
// evidence store) and are genuinely assessable AS RECORDS, but their
// ApplicabilityRules remain UNRESOLVABLE_MISSING_FACT (MVR) or unsafe to
// combine (Medical Certificate) per the Phase 3E/3F Rule -> Fact matrix.
// These adapters reuse driverScreeningEvidenceState (no new evidence-state
// logic) and always pass applicability: "UNDETERMINED" through to
// buildRequirementAssessment, which — per its own existing step-1 decision
// order (lib/audit-preparedness-engine.ts) — short-circuits on UNDETERMINED
// applicability before ever consulting the evidence. The Requirement's
// OUTPUT is therefore unchanged from the generic unwired fallback (still
// UNDETERMINED); what is new is that the evidence-assessment CAPABILITY
// itself now exists in reusable, tested form, ready the moment a future
// phase resolves either Requirement's applicability. This is deliberately
// NOT wired into buildFmcsaNewEntrantRequirementAssessments's dispatch,
// since doing so would not change that function's output at all — calling
// it would be indistinguishable from the existing "unwired" branch to any
// consumer, so it is exposed only as a standalone, independently testable
// capability (see the Phase 3F report's CAPABILITY WIRED / APPLICABILITY
// UNRESOLVED classification for both).

export interface DriverScreeningEvidenceAssessmentInput {
  driver: DriverMaster;
  screeningRecords: ScreeningRecord[];
  driverEvidence: DriverEvidenceItem[];
  assessedAt?: string;
}

function buildDriverScreeningCapabilityAssessment(
  requirementId: string,
  screeningFilter: (s: ScreeningRecord) => boolean,
  idPrefix: string,
  input: DriverScreeningEvidenceAssessmentInput
): RequirementAssessment {
  const requirement = FMCSA_NEW_ENTRANT_REQUIREMENTS.find((r) => r.id === requirementId)!;
  const now = input.assessedAt ?? new Date().toISOString();
  const evidenceRequirementId = requirement.evidenceRequirementIds[0];

  const relevant = input.screeningRecords
    .filter((s) => !s.isArchived && s.driverMasterId === input.driver.driverMasterId)
    .filter(screeningFilter)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  const mostRecent = relevant[0];

  const applicabilityReason =
    "Applicability for this requirement is UNDETERMINED (see the Phase 3E/3F Rule -> Fact Contract Matrix) — this evidence assessment is computed as a reusable capability so it is ready once applicability resolves, but it does not itself change the Requirement's overall UNDETERMINED state.";

  if (!mostRecent) {
    return buildRequirementAssessment(`ra-${idPrefix}-capability-${input.driver.driverMasterId}`, {
      requirement,
      entityType: "Driver",
      entityId: input.driver.driverMasterId,
      applicability: "UNDETERMINED",
      applicabilityReason,
      evidenceInputs: [{ evidenceRequirementId, necessity: "required", relationships: [] }],
    });
  }

  const evidenceId = mostRecent.evidenceIds[0];
  const evidenceRecord = input.driverEvidence.find((e) => e.id === evidenceId);
  const state = driverScreeningEvidenceState(evidenceRecord, mostRecent, now);

  const relationship: EvidenceRelationship = {
    id: `evrel-${idPrefix}-${mostRecent.id}`,
    requirementId: requirement.id,
    evidenceRequirementId,
    evidenceId: evidenceId ?? `no-evidence-linked-${mostRecent.id}`,
    entityType: "Driver",
    entityId: input.driver.driverMasterId,
    linkedAt: mostRecent.createdAt,
  };

  const assessment: EvidenceAssessment = {
    id: `evasmt-${idPrefix}-${mostRecent.id}`,
    evidenceRelationshipId: relationship.id,
    state,
    reasons: [
      `Driver ${input.driver.driverMasterId} screening record ${mostRecent.id} (${mostRecent.category}), recorded ${mostRecent.recordDate}.`,
      evidenceRecord ? `Linked evidence item ${evidenceRecord.id}, verificationState=${evidenceRecord.verificationState}.` : "No evidence item is linked to this screening record.",
    ],
    assessedAt: now,
  };

  return buildRequirementAssessment(`ra-${idPrefix}-capability-${input.driver.driverMasterId}`, {
    requirement,
    entityType: "Driver",
    entityId: input.driver.driverMasterId,
    applicability: "UNDETERMINED",
    applicabilityReason,
    evidenceInputs: [{ evidenceRequirementId, necessity: "required", relationships: [{ relationship, assessment }] }],
  });
}

/** MVR/Driver Abstract evidence-assessment capability (Phase 3F section 21) — reuses ScreeningRecord category "Driver Abstract / MVR Review". */
export function buildMvrCapabilityAssessment(input: DriverScreeningEvidenceAssessmentInput): RequirementAssessment {
  return buildDriverScreeningCapabilityAssessment(
    "fmcsa-ne-driver-mvr",
    (s) => s.category === "Driver Abstract / MVR Review",
    "mvr",
    input
  );
}

/** Medical Certificate evidence-assessment capability (Phase 3F section 22) — reuses ScreeningRecord category "Medical Card / DOT Physical" / medicalCardDetails. */
export function buildMedicalCertificateCapabilityAssessment(input: DriverScreeningEvidenceAssessmentInput): RequirementAssessment {
  return buildDriverScreeningCapabilityAssessment(
    "fmcsa-ne-medical-certificate",
    (s) => s.category === "Medical Card / DOT Physical",
    "medical-certificate",
    input
  );
}

// ---------------------------------------------------------------------------
// PATH 1 — VEHICLE ANNUAL/PERIODIC INSPECTION (fmcsa-ne-vehicle-inspection)
// ---------------------------------------------------------------------------

const VEHICLE_INSPECTION_REQUIREMENT_ID = "fmcsa-ne-vehicle-inspection";

export interface VehicleInspectionAssessmentInput {
  vehicle: VehicleRecord;
  /** The vehicle's inspection records from the canonical VehicleStore (lib/vehicle-data.ts). */
  inspectionRecords: VehicleInspectionRecord[];
  /** The company's canonical evidence store (VehicleStore.evidence, types/evidence.ts EvidenceRecord[]). */
  evidenceStore: EvidenceRecord[];
  assessedAt?: string;
}

/**
 * Produces one RequirementAssessment for fmcsa-ne-vehicle-inspection,
 * scoped to a single canonical Vehicle, from its REAL inspection/evidence
 * records — no synthetic inspection or evidence data is created here. Uses
 * the vehicle's single most recent inspection matching the FMCSA-relevant
 * inspection type (annual/periodic), consistent with the requirement's own
 * 12-month recency model (fmcsa-new-entrant.ts:673-680).
 */
export function buildVehicleInspectionRequirementAssessment(input: VehicleInspectionAssessmentInput): RequirementAssessment {
  const requirement = FMCSA_NEW_ENTRANT_REQUIREMENTS.find((r) => r.id === VEHICLE_INSPECTION_REQUIREMENT_ID)!;
  const now = input.assessedAt ?? new Date().toISOString();
  const applicability = evaluateFmcsaNewEntrantRequirementApplicability(VEHICLE_INSPECTION_REQUIREMENT_ID);

  const relevant = input.inspectionRecords
    .filter((i) => !i.archived && i.vehicleId === input.vehicle.id)
    .filter((i) => i.inspectionType.toLowerCase().includes("annual") || i.inspectionType.toLowerCase().includes("periodic"))
    .sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate));
  const mostRecent = relevant[0];

  const evidenceRequirementId = requirement.evidenceRequirementIds[0];

  if (!mostRecent) {
    return buildRequirementAssessment(`ra-vehicle-inspection-${input.vehicle.id}`, {
      requirement,
      entityType: "Vehicle",
      entityId: input.vehicle.id,
      applicability: applicability.result,
      applicabilityReason: applicability.reason,
      evidenceInputs: [{ evidenceRequirementId, necessity: "required", relationships: [] }],
    });
  }

  const evidenceId = mostRecent.evidenceIds[0];
  const evidenceRecord = input.evidenceStore.find((e) => e.id === evidenceId);
  const state = vehicleInspectionEvidenceState(evidenceRecord, mostRecent, now);

  const relationship: EvidenceRelationship = {
    id: `evrel-vehicle-inspection-${mostRecent.id}`,
    requirementId: requirement.id,
    evidenceRequirementId,
    evidenceId: evidenceId ?? `no-evidence-linked-${mostRecent.id}`,
    entityType: "Vehicle",
    entityId: input.vehicle.id,
    linkedAt: mostRecent.createdAt,
  };

  const assessment: EvidenceAssessment = {
    id: `evasmt-vehicle-inspection-${mostRecent.id}`,
    evidenceRelationshipId: relationship.id,
    state,
    reasons: [
      `Vehicle ${input.vehicle.unitNumber} (${input.vehicle.vin}) most recent annual/periodic inspection ${mostRecent.id}, dated ${mostRecent.inspectionDate}, expires ${mostRecent.expiryDate}.`,
      evidenceRecord ? `Linked evidence record ${evidenceRecord.id}, verificationState=${evidenceRecord.verificationState}.` : "No evidence record is linked to this inspection.",
    ],
    assessedAt: now,
  };

  const evidenceInputs: RequirementAssessmentEvidenceInput[] = [
    {
      evidenceRequirementId,
      necessity: "required",
      relationships: [{ relationship, assessment }],
    },
  ];

  return buildRequirementAssessment(`ra-vehicle-inspection-${input.vehicle.id}`, {
    requirement,
    entityType: "Vehicle",
    entityId: input.vehicle.id,
    applicability: applicability.result,
    applicabilityReason: applicability.reason,
    evidenceInputs,
  });
}

// ---------------------------------------------------------------------------
// PATH 2 — DRIVER PRE-EMPLOYMENT DRUG/ALCOHOL TESTING
// (fmcsa-ne-drug-alcohol-pre-employment-testing)
// ---------------------------------------------------------------------------

const PRE_EMPLOYMENT_TESTING_REQUIREMENT_ID = "fmcsa-ne-drug-alcohol-pre-employment-testing";

export interface DriverPreEmploymentTestingAssessmentInput {
  driver: DriverMaster;
  /** The driver's canonical screening records (types/drivers.ts ScreeningRecord[], via CompanyDriverStore.screenings). */
  screeningRecords: ScreeningRecord[];
  /** The driver's canonical evidence items (types/drivers.ts DriverEvidenceItem[]). */
  driverEvidence: DriverEvidenceItem[];
  assessedAt?: string;
}

/**
 * Phase 3F.1 section 2 (locked core invariant): for a CONDITIONAL D&A test
 * type — one that is only legally required after some triggering event or
 * state (an accident, a reasonable-suspicion observation, a prior positive
 * result requiring return-to-duty) — the absence of a matching
 * ScreeningRecord is NOT itself proof the test was missed. It could just as
 * easily mean the triggering condition never occurred. Only when TES can
 * affirmatively establish the trigger (APPLICABLE) does a missing record
 * become evidence of noncompliance; when the trigger cannot be established
 * either way, or is affirmatively absent, the correct result is
 * UNDETERMINED or NOT_APPLICABLE respectively — never UNSATISFIED.
 *
 * Reuses the existing ApplicabilityEvaluationResult vocabulary
 * (types/audit-preparedness.ts) rather than inventing a parallel
 * TRUE/FALSE/UNKNOWN trigger type, per Phase 3F.1 section 13's explicit
 * instruction to prefer existing three-valued structures. This is a
 * genuinely different question from the Requirement's own
 * evaluateFmcsaNewEntrantRequirementApplicability result (which asks "does
 * this D&A category apply to this carrier at all" — already resolved
 * APPLICABLE for all three conditional test types, zero ApplicabilityRules
 * attached) — this is a second, per-instance dimension: "was THIS
 * particular test instance triggered," evaluated only when a record is
 * absent.
 */
export interface DriverDrugAlcoholTestTriggerConfig {
  /**
   * false (Pre-Employment): a missing record is determinative — the
   * pre-employment testing obligation exists simply because the driver
   * was hired, which is not an uncertain external trigger, so the
   * existing missing-evidence-is-determinative path applies unchanged.
   * true (Post-Accident/Reasonable-Suspicion/Return-to-Duty): a missing
   * record must NOT become UNSATISFIED until evaluateTrigger establishes
   * the triggering condition.
   */
  requiresEstablishedTrigger: boolean;
  /**
   * Only consulted when requiresEstablishedTrigger is true and no
   * matching record exists. Currently always returns UNDETERMINED for
   * all three conditional test types (Phase 3F.1 sections 5-7 confirm no
   * canonical accident-reportability, reasonable-suspicion, or RTD/SAP
   * trigger fact exists anywhere in this codebase) — this is a named,
   * separate seam a future phase can replace once such a fact exists,
   * never a regulatory rule invented here.
   */
  evaluateTrigger?: () => { result: ApplicabilityEvaluationResult; reason: string };
}

const UNRESOLVED_TRIGGER: NonNullable<DriverDrugAlcoholTestTriggerConfig["evaluateTrigger"]> = () => ({
  result: "UNDETERMINED",
  reason: "No canonical fact exists in this codebase to establish whether this test's triggering condition occurred — absence of a matching test record is therefore not evidence of anything.",
});

/**
 * Phase 3F generalization (corrected in Phase 3F.1 — see the trigger-gate
 * above): the four D&A test-type Requirements (Pre-Employment, Post-
 * Accident, Reasonable Suspicion, Return-to-Duty) all consume the exact
 * same canonical shape — ScreeningRecord.drugAlcoholDetails filtered by
 * testType, plus the same driver-scoped evidence store — so this shared
 * builder exists to avoid four near-duplicate implementations (Phase 3F
 * section 8/14: these are a FAMILY, not independent systems). Only the
 * requirement id, testType filter, id-prefix, regulatory citation, and now
 * the trigger config differ per call site. No new type was introduced for
 * the input shape — it reuses DriverPreEmploymentTestingAssessmentInput's
 * shape directly (see the section 32A duplicate-model check in the Phase
 * 3F report for why a separate "DriverDrugAlcoholTestInput" type was NOT
 * created there, and DriverDrugAlcoholTestTriggerConfig above for the one
 * new type this phase adds — a control-flow parameter, not a data record).
 */
function buildDriverDrugAlcoholTestRequirementAssessment(
  requirementId: string,
  testType: NonNullable<ScreeningRecord["drugAlcoholDetails"]>["testType"],
  idPrefix: string,
  regulatoryReference: string,
  triggerConfig: DriverDrugAlcoholTestTriggerConfig,
  input: DriverPreEmploymentTestingAssessmentInput
): RequirementAssessment {
  const requirement = FMCSA_NEW_ENTRANT_REQUIREMENTS.find((r) => r.id === requirementId)!;
  const now = input.assessedAt ?? new Date().toISOString();
  const applicability = evaluateFmcsaNewEntrantRequirementApplicability(requirementId);

  const evidenceRequirementId = requirement.evidenceRequirementIds[0];

  const relevant = input.screeningRecords
    .filter((s) => !s.isArchived && s.driverMasterId === input.driver.driverMasterId)
    .filter((s) => s.drugAlcoholDetails?.testType === testType)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  const mostRecent = relevant[0];

  if (!mostRecent) {
    // TRIGGER-GATED PATH (Phase 3F.1 fix) — reachable ONLY when
    // requiresEstablishedTrigger is true. Pre-Employment always passes
    // false and can never enter this branch; its missing-evidence-is-
    // determinative behavior below is completely unchanged and untouched
    // by this addition (see the Phase 3F.1 report's section 7A trace).
    if (triggerConfig.requiresEstablishedTrigger) {
      const trigger = (triggerConfig.evaluateTrigger ?? UNRESOLVED_TRIGGER)();
      if (trigger.result !== "APPLICABLE") {
        const state = trigger.result === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "UNDETERMINED";
        return {
          id: `ra-${idPrefix}-${input.driver.driverMasterId}`,
          requirementId: requirement.id,
          entityType: "Driver",
          entityId: input.driver.driverMasterId,
          state,
          reasons: [
            `No matching ${testType} test record exists for this driver.`,
            `Whether a ${testType} test was legally required cannot be treated as a missing-evidence deficiency until the triggering condition is established: ${trigger.reason}`,
          ],
          evidenceRelationshipIds: [],
          assessedAt: now,
          assessmentMethod: requirement.assessmentMethod,
          reviewRequired: state !== "NOT_APPLICABLE",
        };
      }
      // trigger.result === "APPLICABLE": the triggering condition IS
      // established, so a missing record now legitimately falls through
      // to the ordinary missing-evidence-is-determinative path below —
      // this never currently executes (evaluateTrigger is always
      // UNRESOLVED_TRIGGER today) but is correct if a future phase wires
      // a real trigger fact.
    }

    return buildRequirementAssessment(`ra-${idPrefix}-${input.driver.driverMasterId}`, {
      requirement,
      entityType: "Driver",
      entityId: input.driver.driverMasterId,
      applicability: applicability.result,
      applicabilityReason: applicability.reason,
      evidenceInputs: [{ evidenceRequirementId, necessity: "required", relationships: [] }],
    });
  }

  const evidenceId = mostRecent.evidenceIds[0];
  const evidenceRecord = input.driverEvidence.find((e) => e.id === evidenceId);
  const state = driverScreeningEvidenceState(evidenceRecord, mostRecent, now);

  const relationship: EvidenceRelationship = {
    id: `evrel-${idPrefix}-${mostRecent.id}`,
    requirementId: requirement.id,
    evidenceRequirementId,
    evidenceId: evidenceId ?? `no-evidence-linked-${mostRecent.id}`,
    entityType: "Driver",
    entityId: input.driver.driverMasterId,
    linkedAt: mostRecent.createdAt,
  };

  const assessment: EvidenceAssessment = {
    id: `evasmt-${idPrefix}-${mostRecent.id}`,
    evidenceRelationshipId: relationship.id,
    state,
    reasons: [
      `Driver ${input.driver.driverMasterId} ${testType} drug/alcohol screening ${mostRecent.id}, recorded ${mostRecent.recordDate}, result=${mostRecent.drugAlcoholDetails?.result}.`,
      evidenceRecord ? `Linked evidence item ${evidenceRecord.id}, verificationState=${evidenceRecord.verificationState}.` : "No evidence item is linked to this screening record.",
    ],
    assessedAt: now,
  };

  const evidenceInputs: RequirementAssessmentEvidenceInput[] = [
    {
      evidenceRequirementId,
      necessity: "required",
      relationships: [{ relationship, assessment }],
    },
  ];

  // Established-noncompliance path (Phase 3B step 2): a positive result is
  // a real, canonical, carrier-specific fact — represented here as a
  // RegulatoryAssessment the same way Phase 3B's own decision order
  // expects, never as a fabricated regulatory citation. No Factor/Acute-
  // Critical point value is attached to it here (that stays exclusively
  // official-methodology territory, per Phase 3D section 33).
  const regulatoryAssessments =
    mostRecent.drugAlcoholDetails?.result === "Positive"
      ? [
          {
            id: `ra-reg-${idPrefix}-${mostRecent.id}`,
            auditQuestionId: "not-yet-catalog-mapped",
            regulatoryReference,
            entityType: "Driver" as EntityType,
            entityId: input.driver.driverMasterId,
            applicability: "APPLICABLE" as ApplicabilityEvaluationResult,
            underlyingConditionStatus: "ESTABLISHED" as const,
            knowledgeElementStatus: "NOT_REQUIRED" as const,
            observedFacts: [],
            result: "NONCOMPLIANT" as const,
            reasons: [`${testType} drug/alcohol test ${mostRecent.id} result is Positive.`],
            assessedAt: now,
            assessmentSource: "DETERMINISTIC_SYSTEM" as const,
          },
        ]
      : undefined;

  return buildRequirementAssessment(`ra-${idPrefix}-${input.driver.driverMasterId}`, {
    requirement,
    entityType: "Driver",
    entityId: input.driver.driverMasterId,
    applicability: applicability.result,
    applicabilityReason: applicability.reason,
    evidenceInputs,
    regulatoryAssessments,
  });
}

/**
 * Produces one RequirementAssessment for
 * fmcsa-ne-drug-alcohol-pre-employment-testing, scoped to a single
 * canonical DriverMaster, from real ScreeningRecord/DriverEvidenceItem
 * data — never a fabricated test result. UNCHANGED external behavior from
 * Phase 3D/3E (Phase 3E section 10 "LOCKED") — now delegates to the shared
 * helper above, but produces byte-identical output for the same inputs.
 */
export function buildDriverPreEmploymentTestingRequirementAssessment(
  input: DriverPreEmploymentTestingAssessmentInput
): RequirementAssessment {
  return buildDriverDrugAlcoholTestRequirementAssessment(
    PRE_EMPLOYMENT_TESTING_REQUIREMENT_ID,
    "Pre-Employment",
    "pre-employment-testing",
    "§382.301",
    { requiresEstablishedTrigger: false },
    input
  );
}

const POST_ACCIDENT_TESTING_REQUIREMENT_ID = "fmcsa-ne-drug-alcohol-post-accident-testing";
const REASONABLE_SUSPICION_TESTING_REQUIREMENT_ID = "fmcsa-ne-drug-alcohol-reasonable-suspicion-testing";
const RETURN_TO_DUTY_TESTING_REQUIREMENT_ID = "fmcsa-ne-drug-alcohol-return-to-duty-testing";

/**
 * Phase 3F section 11: wires the Post-Accident Testing production data/
 * evidence path using the exact same canonical mechanism as Pre-Employment
 * Testing (types/drivers.ts:471 already distinguishes testType:
 * "Post-Accident" — this is not an inference, it is the canonical field's
 * own stored value). Deliberately does NOT determine whether a
 * post-accident test was legally REQUIRED for a given accident — that
 * would require accident-triggering facts and regulatory criteria this
 * codebase does not establish (see the Accident Register finding in the
 * Phase 3F report). This function only assesses a test record that
 * already exists as a record; the Requirement's applicability remains
 * governed by evaluateFmcsaNewEntrantRequirementApplicability exactly as
 * for every other zero-rule D&A sub-requirement.
 */
export function buildDriverPostAccidentTestingRequirementAssessment(
  input: DriverPreEmploymentTestingAssessmentInput
): RequirementAssessment {
  return buildDriverDrugAlcoholTestRequirementAssessment(
    POST_ACCIDENT_TESTING_REQUIREMENT_ID,
    "Post-Accident",
    "post-accident-testing",
    "§382.303",
    { requiresEstablishedTrigger: true },
    input
  );
}

/**
 * Phase 3F section 12: wires Reasonable Suspicion Testing's production
 * data/evidence path from the canonical testType: "Reasonable Suspicion"
 * field only — never inferred from driver behavior, roadside events,
 * citations, manager comments, or performance data. If no ScreeningRecord
 * with this exact testType exists for the driver, the result is the same
 * missing-evidence path as any other test type (never a fabricated
 * suspicion trigger).
 */
export function buildDriverReasonableSuspicionTestingRequirementAssessment(
  input: DriverPreEmploymentTestingAssessmentInput
): RequirementAssessment {
  return buildDriverDrugAlcoholTestRequirementAssessment(
    REASONABLE_SUSPICION_TESTING_REQUIREMENT_ID,
    "Reasonable Suspicion",
    "reasonable-suspicion-testing",
    "§382.307",
    { requiresEstablishedTrigger: true },
    input
  );
}

/**
 * Phase 3F section 13: wires Return-to-Duty Testing's production data/
 * evidence path from the canonical testType: "Return-to-Duty" field only.
 * Does NOT infer that an RTD test was required merely because an earlier
 * test was positive, and does not invent any SAP/RTD workflow facts — it
 * only assesses whatever RTD-typed ScreeningRecord already exists.
 */
export function buildDriverReturnToDutyTestingRequirementAssessment(
  input: DriverPreEmploymentTestingAssessmentInput
): RequirementAssessment {
  return buildDriverDrugAlcoholTestRequirementAssessment(
    RETURN_TO_DUTY_TESTING_REQUIREMENT_ID,
    "Return-to-Duty",
    "return-to-duty-testing",
    "§382.309",
    { requiresEstablishedTrigger: true },
    input
  );
}

// ---------------------------------------------------------------------------
// REQUIREMENT-UNIVERSE ROLLUP (Phase 3D section 25)
// ---------------------------------------------------------------------------
// Worst-state-wins rollup for a Requirement assessed across multiple
// sampled entities (e.g. several vehicles). This is a Phase 3D aggregation
// CONVENTION, not a regulatory rule: it does not classify any regulation,
// it only decides how "the requirement itself" reads when the entities
// under it disagree. UNSATISFIED beats UNDETERMINED beats SATISFIED.
function rollUpEntityAssessments(entityAssessments: RequirementAssessment[]): { state: RequirementAssessment["state"]; reasons: string[] } {
  if (entityAssessments.length === 0) {
    return { state: "UNDETERMINED", reasons: ["No sampled entities were available to assess this requirement against."] };
  }
  if (entityAssessments.some((a) => a.state === "NOT_APPLICABLE") && entityAssessments.every((a) => a.state === "NOT_APPLICABLE")) {
    return { state: "NOT_APPLICABLE", reasons: ["Not applicable for every assessed entity."] };
  }
  if (entityAssessments.some((a) => a.state === "UNDETERMINED")) {
    return {
      state: "UNDETERMINED",
      reasons: entityAssessments.filter((a) => a.state === "UNDETERMINED").flatMap((a) => [`${a.entityId}: ${a.reasons[0] ?? "UNDETERMINED"}`]),
    };
  }
  if (entityAssessments.some((a) => a.state === "UNSATISFIED")) {
    return {
      state: "UNSATISFIED",
      reasons: entityAssessments.filter((a) => a.state === "UNSATISFIED").flatMap((a) => [`${a.entityId}: ${a.reasons[0] ?? "UNSATISFIED"}`]),
    };
  }
  return { state: "SATISFIED", reasons: entityAssessments.map((a) => `${a.entityId}: SATISFIED`) };
}

// ---------------------------------------------------------------------------
// CARRIER CONTEXT + FULL REQUIREMENT-UNIVERSE BUILDER (Phase 3D section 25)
// ---------------------------------------------------------------------------
// THE critical property (Phase 3D section 24/24A): this function always
// starts from FMCSA_NEW_ENTRANT_REQUIREMENTS (the full regime-defined
// universe, 19 entries as of this phase) and produces exactly one
// RequirementAssessment per Requirement — never from "whatever evidence
// happened to exist." A Requirement with no production wiring in this
// phase is represented as UNDETERMINED with an explicit reason, never
// silently dropped from the array, so Coverage cannot read artificially
// high relative to what was actually wired.

export interface FmcsaNewEntrantCarrierContext {
  companyId: string;
  vehicles: VehicleRecord[];
  vehicleInspectionRecords: VehicleInspectionRecord[];
  vehicleEvidenceStore: EvidenceRecord[];
  drivers: DriverMaster[];
  screeningRecords: ScreeningRecord[];
  driverEvidence: DriverEvidenceItem[];
  /** Which vehicles/drivers are in the currently-assembled sample, if known — used only for the sample-adequacy trace, never to gate wiring itself. */
  assembledVehicleSampleIds?: string[];
  assembledDriverPart382SampleIds?: string[];
  part382PopulationComplete?: boolean;
  /**
   * Phase 3E addition: the company's compliance-settings rule values for
   * dangerous-goods/hazmat (see fmcsa-new-entrant-applicability-facts.ts —
   * source cited there: app/companies/[id]/settings/page.tsx). Undefined
   * when the caller has not supplied them — never defaulted, per the
   * Zero-Silent-Guessing principle.
   */
  companyComplianceRules?: { dgCanada?: CompanyComplianceRuleValue; dgUs?: CompanyComplianceRuleValue };
  assessedAt?: string;
}

const HM_SHIPPING_PAPERS_REQUIREMENT_ID_LOCAL = "fmcsa-ne-hm-shipping-papers";
const WIRED_REQUIREMENT_IDS = new Set([
  VEHICLE_INSPECTION_REQUIREMENT_ID,
  PRE_EMPLOYMENT_TESTING_REQUIREMENT_ID,
  HM_SHIPPING_PAPERS_REQUIREMENT_ID_LOCAL,
  POST_ACCIDENT_TESTING_REQUIREMENT_ID,
  REASONABLE_SUSPICION_TESTING_REQUIREMENT_ID,
  RETURN_TO_DUTY_TESTING_REQUIREMENT_ID,
]);

/**
 * Phase 3F: Post-Accident/Reasonable-Suspicion/Return-to-Duty Testing have
 * NO populationRuleId set on their Requirement definitions
 * (fmcsa-new-entrant.ts's postAccidentTestingRequirement/
 * reasonableSuspicionTestingRequirement/returnToDutyTestingRequirement) —
 * unlike Pre-Employment Testing's Part 382 tiered rule, these are
 * per-triggering-event tests with no sample-size methodology to defer to.
 * A worst-state-wins rollup across assessed drivers is therefore the
 * correct treatment here (Phase 3F section 34 check: no population/sample/
 * event-day/regime-specific aggregation methodology applies to these three
 * — generic rollup is not overriding anything).
 */
function rollUpDrugAlcoholTestRequirement(
  requirementId: string,
  perDriverBuilder: (input: DriverPreEmploymentTestingAssessmentInput) => RequirementAssessment,
  context: FmcsaNewEntrantCarrierContext,
  now: string
): RequirementAssessment {
  const requirement = FMCSA_NEW_ENTRANT_REQUIREMENTS.find((r) => r.id === requirementId)!;
  const perDriver = context.drivers.map((driver) =>
    perDriverBuilder({ driver, screeningRecords: context.screeningRecords, driverEvidence: context.driverEvidence, assessedAt: now })
  );
  const rollup = rollUpEntityAssessments(perDriver);
  return {
    id: `ra-${requirementId}`,
    requirementId,
    state: rollup.state,
    reasons: rollup.reasons,
    evidenceRelationshipIds: perDriver.flatMap((a) => a.evidenceRelationshipIds),
    assessedAt: now,
    assessmentMethod: requirement.assessmentMethod,
    reviewRequired: rollup.state === "UNDETERMINED",
  };
}

export function buildFmcsaNewEntrantRequirementAssessments(context: FmcsaNewEntrantCarrierContext): RequirementAssessment[] {
  const now = context.assessedAt ?? new Date().toISOString();

  return FMCSA_NEW_ENTRANT_REQUIREMENTS.map((requirement) => {
    if (!WIRED_REQUIREMENT_IDS.has(requirement.id)) {
      const applicability = evaluateFmcsaNewEntrantRequirementApplicability(requirement.id);
      // Even a deterministically APPLICABLE, unwired requirement must not
      // read as silently resolved — it is represented as UNDETERMINED
      // because no production source exists to assess it, which is a
      // distinct reason from an unresolved applicability rule.
      //
      // Phase 3F.1 classification corrections (section 10-12), reflected
      // here rather than left only in a past report, since these three
      // requirements fall through this generic branch for DIFFERENT
      // reasons than "no capability exists at all":
      //   - fmcsa-ne-drivers-list / fmcsa-ne-vehicle-list: the canonical
      //     population source DOES exist (DriverMaster+CompanyDriverRelationship,
      //     types/drivers.ts:148-206; VehicleRecord, src/types.ts:158-196).
      //     Correct classification is CANONICAL_POPULATION_SOURCE_FOUND /
      //     COMPLETENESS_ASSESSMENT_PENDING — not "missing," and not
      //     "wired," since population *completeness* (are these rosters
      //     known to be the complete real-world list, per the Phase 3C
      //     population-completeness safeguard) has never been assessed.
      //     No duplicate "Drivers List"/"Vehicle List" document record was
      //     or should be created — the roster itself IS the requirement's
      //     real-world referent.
      //   - fmcsa-ne-drug-alcohol-testing-records (Testing Records —
      //     General): NOT "N/A by design." The architecture rule (one
      //     event -> one canonical record -> many relationships) explains
      //     why this Requirement has no INDEPENDENT assessment logic of
      //     its own (building one would re-consume the same ScreeningRecord
      //     objects the four specific test-type Requirements already
      //     assess, double-counting one canonical fact across two
      //     Requirement-level conclusions) — it does not make the
      //     Requirement NOT_APPLICABLE. Correct classification is
      //     REGULATORY/AGGREGATION SEMANTICS PENDING: TES has not yet
      //     decided whether/how this Requirement should roll up the other
      //     four's results without double-counting. It remains
      //     UNDETERMINED via this same generic branch, visible in the
      //     19-requirement universe, exactly as it should be pending that
      //     decision.
      return buildRequirementAssessment(`ra-unwired-${requirement.id}`, {
        requirement,
        applicability: applicability.result === "APPLICABLE" ? "UNDETERMINED" : applicability.result,
        applicabilityReason:
          applicability.result === "APPLICABLE"
            ? "Applicable per the regime definition, but no Phase 3D production canonical-data wiring exists yet for this requirement — see the Phase 3D report's requirement mapping matrix."
            : applicability.reason,
        evidenceInputs: [],
      });
    }

    if (requirement.id === VEHICLE_INSPECTION_REQUIREMENT_ID) {
      const sampledVehicles = context.assembledVehicleSampleIds
        ? context.vehicles.filter((v) => context.assembledVehicleSampleIds!.includes(v.id))
        : context.vehicles;
      const perVehicle = sampledVehicles.map((vehicle) =>
        buildVehicleInspectionRequirementAssessment({
          vehicle,
          inspectionRecords: context.vehicleInspectionRecords,
          evidenceStore: context.vehicleEvidenceStore,
          assessedAt: now,
        })
      );
      const rollup = rollUpEntityAssessments(perVehicle);
      return {
        id: `ra-${requirement.id}`,
        requirementId: requirement.id,
        state: rollup.state,
        reasons: rollup.reasons,
        evidenceRelationshipIds: perVehicle.flatMap((a) => a.evidenceRelationshipIds),
        assessedAt: now,
        assessmentMethod: requirement.assessmentMethod,
        reviewRequired: rollup.state === "UNDETERMINED",
      };
    }

    if (requirement.id === PRE_EMPLOYMENT_TESTING_REQUIREMENT_ID) {
      // Phase 3E section 24 correction: Pre-Employment Testing is governed
      // by the Part 382 TIERED sampling rule (FMCSA_NE_PART_382_SAMPLING_RULE_ID
      // has real sampleSizeTiers, unlike DVIR) — worst-state-wins across
      // individually-assessed drivers must never be allowed to stand in for
      // that rule's own population/sample methodology. Sample adequacy is
      // checked FIRST; only a genuinely ADEQUATE (or NOT_APPLICABLE, which
      // cannot occur for this tiered rule but is handled for completeness)
      // sample proceeds to the entity-level rollup. An INADEQUATE or
      // UNDETERMINED sample forces the Requirement itself to UNDETERMINED,
      // regardless of what the individually-assessed drivers show — this
      // is the same "population/sample methodology controls the result"
      // rule Phase 3B's buildRequirementAssessment already applies to a
      // single-entity assessment (step 3 of its decision order), now
      // correctly applied before rollup here too.
      const { populationAdequacy, sampleAdequacy } = evaluatePart382SampleAdequacyForContext(context);
      if (sampleAdequacy.state !== "ADEQUATE" && sampleAdequacy.state !== "NOT_APPLICABLE") {
        return {
          id: `ra-${requirement.id}`,
          requirementId: requirement.id,
          state: "UNDETERMINED",
          reasons: [
            `Part 382 sample adequacy is ${sampleAdequacy.state}: ${sampleAdequacy.reason}`,
            `Population adequacy: ${populationAdequacy.state} — ${populationAdequacy.reason}`,
            "Individual driver-level Pre-Employment Testing assessments are not rolled up into this Requirement's result until the tiered sample itself is confirmed adequate — population/sample methodology governs this Requirement, not a worst-state-wins rollup across whichever drivers happen to be assessed.",
          ],
          evidenceRelationshipIds: [],
          assessedAt: now,
          assessmentMethod: requirement.assessmentMethod,
          reviewRequired: true,
        };
      }

      const sampledDrivers = context.assembledDriverPart382SampleIds
        ? context.drivers.filter((d) => context.assembledDriverPart382SampleIds!.includes(d.driverMasterId))
        : context.drivers;
      const perDriver = sampledDrivers.map((driver) =>
        buildDriverPreEmploymentTestingRequirementAssessment({
          driver,
          screeningRecords: context.screeningRecords,
          driverEvidence: context.driverEvidence,
          assessedAt: now,
        })
      );
      const rollup = rollUpEntityAssessments(perDriver);
      return {
        id: `ra-${requirement.id}`,
        requirementId: requirement.id,
        state: rollup.state,
        reasons: [`Sample adequacy: ${sampleAdequacy.state} — ${sampleAdequacy.reason}`, ...rollup.reasons],
        evidenceRelationshipIds: perDriver.flatMap((a) => a.evidenceRelationshipIds),
        assessedAt: now,
        assessmentMethod: requirement.assessmentMethod,
        reviewRequired: rollup.state === "UNDETERMINED",
      };
    }

    if (requirement.id === HM_SHIPPING_PAPERS_REQUIREMENT_ID_LOCAL) {
      return buildHmShippingPapersRequirementAssessment(
        { dgCanada: context.companyComplianceRules?.dgCanada, dgUs: context.companyComplianceRules?.dgUs },
        now
      );
    }

    if (requirement.id === POST_ACCIDENT_TESTING_REQUIREMENT_ID) {
      return rollUpDrugAlcoholTestRequirement(POST_ACCIDENT_TESTING_REQUIREMENT_ID, buildDriverPostAccidentTestingRequirementAssessment, context, now);
    }
    if (requirement.id === REASONABLE_SUSPICION_TESTING_REQUIREMENT_ID) {
      return rollUpDrugAlcoholTestRequirement(REASONABLE_SUSPICION_TESTING_REQUIREMENT_ID, buildDriverReasonableSuspicionTestingRequirementAssessment, context, now);
    }
    if (requirement.id === RETURN_TO_DUTY_TESTING_REQUIREMENT_ID) {
      return rollUpDrugAlcoholTestRequirement(RETURN_TO_DUTY_TESTING_REQUIREMENT_ID, buildDriverReturnToDutyTestingRequirementAssessment, context, now);
    }

    // Unreachable given WIRED_REQUIREMENT_IDS, but keeps this function total.
    return buildRequirementAssessment(`ra-unwired-${requirement.id}`, {
      requirement,
      applicability: "UNDETERMINED",
      applicabilityReason: "Unwired requirement.",
      evidenceInputs: [],
    });
  });
}

// ---------------------------------------------------------------------------
// SAMPLE-ADEQUACY TRACE for the Part 382 (pre-employment testing) path
// (Phase 3D section 16 — reuses Phase 3B's existing tier mechanism as-is)
// ---------------------------------------------------------------------------
export function evaluatePart382SampleAdequacyForContext(context: FmcsaNewEntrantCarrierContext): {
  populationAdequacy: PopulationAdequacyResult;
  sampleAdequacy: SampleAdequacyResult;
} {
  const rule = FMCSA_NEW_ENTRANT_SAMPLING_RULES.find((r) => r.id === FMCSA_NE_PART_382_SAMPLING_RULE_ID)!;
  const population: Population | null = context.assembledDriverPart382SampleIds
    ? {
        id: `pop-part382-${context.companyId}`,
        populationRuleId: rule.id,
        mode: "PRE_AUDIT_ELIGIBLE_POPULATION",
        memberEntityType: "Driver",
        memberEntityIds: context.drivers.map((d) => d.driverMasterId),
        determinedAt: context.assessedAt ?? new Date().toISOString(),
        completenessConfirmed: context.part382PopulationComplete === true,
      }
    : null;
  const populationAdequacy = evaluatePopulationAdequacy(rule, population);
  const sampleAdequacy = evaluateSampleAdequacy(rule, populationAdequacy, {
    entitySampleSize: context.assembledDriverPart382SampleIds?.length ?? null,
  });
  return { populationAdequacy, sampleAdequacy };
}
