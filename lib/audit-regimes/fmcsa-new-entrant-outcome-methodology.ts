/**
 * FMCSA New Entrant Safety Audit — Phase 2C Official Outcome Methodology.
 *
 * Encodes the 16 current automatic-failure conditions from 49 CFR §385.321
 * and the FMCSA eFOTM Safety Audit Manual's factor-based scoring
 * methodology. This is regulatory methodology, not a TES-invented weighting
 * — every number here is cited to one of the two sources below.
 *
 * SOURCE A — 49 CFR § 385.321 (Safety audit: Failure). Current rule text
 * supplied directly by the TES operator in the Phase 2C task instructions.
 * This codebase has not independently retrieved the eCFR text; the
 * operator-supplied extraction is the source for the 16 gates below.
 *
 * SOURCE B — FMCSA eFOTM Safety Audit Manual, Version 10.1, September 2026,
 * Section 3.3.7 (Part 385 Safety Fitness Procedures). Also supplied
 * directly by the operator (Phase 2D correction — v9.5 was superseded;
 * see SOURCE PRECEDENCE note below). Source for the Acute=1.5/Critical=1
 * point values and the "3 failed Factors" / "factor fails at >=3 points"
 * thresholds — the point values and thresholds themselves are unchanged
 * between v9.5 and v10.1 per the operator-supplied Phase 2D instructions;
 * only the version/date provenance is corrected here.
 *
 * SOURCE PRECEDENCE (Phase 2D): the CURRENT regulation (Source A, 49 CFR
 * § 385.321) controls every gate's regulatory citation and trigger — the
 * 16 gates below are NOT changed merely because eFOTM v10.1 contains
 * older/different subsection numbering in places. The CURRENT eFOTM
 * controls operational (factor) methodology only where it does not
 * conflict with the current regulation.
 *
 * CRITICAL: these 16 conditions are OUTCOME GATES, not weighted
 * preparedness requirements. A high AuditPreparedness percentage must
 * never suppress, hide, or be read as canceling a TRIGGERED gate — see
 * AuditOutcomeOutput in types/audit-preparedness.ts, where these are kept
 * as structurally independent fields.
 */

import { FMCSA_NEW_ENTRANT_REGIME_ID } from "./fmcsa-new-entrant-ids";
import type { GateRule, Factor, AuditQuestion, SourceReference } from "../../types/audit-preparedness";

// ---------------------------------------------------------------------------
// SOURCE PROVENANCE
// ---------------------------------------------------------------------------

const SOURCE_385_321: SourceReference = {
  description:
    "49 CFR § 385.321 (Safety audit: Failure) — current rule text supplied directly by the TES operator in the Phase 2C task instructions. This codebase has not independently retrieved the eCFR text.",
  citation: "49 CFR § 385.321",
  provenanceTag: "SOURCE_EXPLICIT",
};

const SOURCE_EFOTM_MANUAL: SourceReference = {
  description:
    "FMCSA eFOTM Safety Audit Manual, Version 10.1, September 2026, Section 3.3.7 (Part 385 Safety Fitness Procedures) — supplied directly by the TES operator in the Phase 2D task instructions, correcting Phase 2C's v9.5 provenance. Only this provenance/version field is corrected; the Acute=1.5/Critical=1/Factor-fail>=3/3-failed-Factors values themselves are unchanged.",
  citation: "FMCSA eFOTM Safety Audit Manual v10.1 (2026-09) §3.3.7",
  version: "10.1",
  retrievedAt: "2026-09",
  provenanceTag: "SOURCE_EXPLICIT",
};

// ---------------------------------------------------------------------------
// 16 AUTOMATIC-FAILURE GATES — § 385.321(b)
// ---------------------------------------------------------------------------
// Order and numbering matches the Phase 2C task instructions exactly, to
// keep the gate-by-gate cross-check trivial to verify. triggeringRequirementIds
// links each gate to the most directly related existing FMCSA New Entrant
// Requirement, where one clearly exists — a topical cross-reference, not a
// claim that satisfying that Requirement clears the gate.

let gateCounter = 0;
function gate(
  regulatoryReference: string,
  name: string,
  description: string,
  triggerType: GateRule["triggerType"],
  options?: { threshold?: GateRule["threshold"]; triggeringRequirementIds?: string[] }
): GateRule {
  gateCounter += 1;
  return {
    id: `fmcsa-ne-gate-385-321-${gateCounter}`,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name,
    description,
    outcomeType: "AUTOMATIC_FAILURE",
    triggeringRequirementIds: options?.triggeringRequirementIds ?? [],
    sourceReference: SOURCE_385_321,
    regulatoryReference,
    triggerType,
    threshold: options?.threshold,
  };
}

const THRESHOLD_51_PERCENT: GateRule["threshold"] = {
  numeratorDescription: "violating examined records",
  denominatorDescription: "total examined records",
  comparison: ">=",
  thresholdPercent: 51,
};

export const FMCSA_NE_GATE_RULES: GateRule[] = [
  // 1
  gate(
    "§ 382.115(a) / § 382.115(b)",
    "Failure to implement alcohol/controlled-substances testing program",
    "Failure to implement an alcohol and/or controlled-substances testing program for domestic/foreign motor carriers respectively.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drug-alcohol-program"] }
  ),
  // 2
  gate(
    "§ 382.201",
    "Using a driver with alcohol content 0.04 or greater",
    "Using a driver known to have an alcohol content of 0.04 or greater to perform a safety-sensitive function.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drug-alcohol-program"] }
  ),
  // 3
  gate(
    "§ 382.211",
    "Using a driver who refused a required alcohol/controlled-substances test",
    "Using a driver who has refused to submit to an alcohol or controlled-substances test required under Part 382.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drug-alcohol-program"] }
  ),
  // 4
  gate(
    "§ 382.215",
    "Using a driver known to have tested positive for a controlled substance",
    "Using a driver known to have tested positive for a controlled substance.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drug-alcohol-program"] }
  ),
  // 5
  gate(
    "§ 382.305",
    "Failure to implement random controlled-substances/alcohol-testing program",
    "Failure to implement a random controlled-substances and/or alcohol-testing program.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drug-alcohol-random-testing-procedure"] }
  ),
  // 6
  gate(
    "§ 383.3(a) / § 383.23(a)",
    "Knowingly using a driver without a valid CDL",
    "Knowingly using a driver who does not possess a valid CDL.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drivers-license"] }
  ),
  // 7
  gate(
    "§ 383.37(b)",
    "Allowing operation with a CLP/CDL disqualified by a State",
    "Knowingly allowing/requiring/permitting/authorizing an employee to operate a CMV with a CLP/CDL that is disqualified by a State, where the driver has lost the right to operate a CMV in a State, or where the driver is otherwise disqualified to operate a CMV.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drivers-license"] }
  ),
  // 8
  gate(
    "§ 383.51(a)",
    "Allowing a disqualified driver to drive a CMV",
    "Knowingly allowing/requiring/permitting/authorizing a disqualified driver to drive a CMV. The rule specifies that this refers to a driver operating a CMV as defined under § 383.5.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drivers-license"] }
  ),
  // 9
  gate(
    "§ 387.7(a)",
    "Operating without required minimum financial-responsibility coverage",
    "Operating a motor vehicle without the required minimum levels of financial-responsibility coverage in effect.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-proof-of-insurance"] }
  ),
  // 10
  gate(
    "§ 387.31(a)",
    "Passenger-carrying operation without required minimum financial responsibility",
    "Operating a passenger-carrying vehicle without the required minimum levels of financial responsibility.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-proof-of-insurance"] }
  ),
  // 11
  gate(
    "§ 391.15(a)",
    "Knowingly using a disqualified driver",
    "Knowingly using a disqualified driver.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-drivers-license"] }
  ),
  // 12
  gate(
    "§ 391.11(b)(4)",
    "Knowingly using a physically unqualified driver",
    "Knowingly using a physically unqualified driver. The rule specifies that this refers to a driver operating a CMV as defined under § 390.5.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-medical-certificate"] }
  ),
  // 13 — THRESHOLD
  gate(
    "§ 395.8(a)",
    "Failure to require a driver to make a Record of Duty Status",
    "Failure to require a driver to make a Record of Duty Status. Threshold-based: 51% or more of examined records must violate the requirement to trigger automatic failure. This is NOT a single-occurrence gate.",
    "VIOLATION_RATE_THRESHOLD",
    { threshold: THRESHOLD_51_PERCENT, triggeringRequirementIds: ["fmcsa-ne-driver-rod-supporting-docs"] }
  ),
  // 14
  gate(
    "§ 396.9(c)(2)",
    "Operating a CMV declared Out-of-Service before repairs",
    "Requiring or permitting operation of a CMV declared Out-of-Service before repairs are made.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-vehicle-inspection"] }
  ),
  // 15
  gate(
    "§ 396.11(a)(3)",
    "Failure to correct Out-of-Service defects before re-operation",
    "Failure to correct Out-of-Service defects listed by the driver in a Driver Vehicle Inspection Report before the vehicle is operated again.",
    "SINGLE_OCCURRENCE",
    { triggeringRequirementIds: ["fmcsa-ne-vehicle-inspection"] }
  ),
  // 16 — THRESHOLD
  gate(
    "§ 396.17(a)",
    "Using a CMV that has not been periodically inspected",
    "Using a CMV that has not been periodically inspected. Threshold-based: 51% or more of examined records must violate the requirement to trigger automatic failure. This is NOT a single-occurrence gate.",
    "VIOLATION_RATE_THRESHOLD",
    { threshold: THRESHOLD_51_PERCENT, triggeringRequirementIds: ["fmcsa-ne-vehicle-inspection"] }
  ),
];

// ---------------------------------------------------------------------------
// FACTOR METHODOLOGY CONSTANTS — FMCSA eFOTM Manual v10.1 §3.3.7
// ---------------------------------------------------------------------------
// These are regulatory methodology constants cited to Source B, not
// TES-created weights.

/** Points assigned to an Acute-classified question. */
export const FMCSA_ACUTE_QUESTION_POINTS = 1.5;
/** Points assigned to a Critical-classified question. */
export const FMCSA_CRITICAL_QUESTION_POINTS = 1;
/** A Factor is considered failed once its total points reach this value. */
export const FMCSA_FACTOR_FAIL_POINTS_THRESHOLD = 3;
/** A Safety Audit fails through the factor methodology once this many Factors have failed. */
export const FMCSA_SAFETY_AUDIT_FAILED_FACTOR_COUNT = 3;

export const FMCSA_FACTOR_METHODOLOGY_SOURCE = SOURCE_EFOTM_MANUAL;

// ---------------------------------------------------------------------------
// SIX REGULATORY FACTORS — 49 CFR Part 385 Appendix A (Phase 2E addition)
// ---------------------------------------------------------------------------
// REGULATORY SOURCE: 49 CFR Part 385 Appendix A establishes these six
// Factors and their Part mappings directly — supplied by the TES operator
// in the Phase 2E task instructions. This is distinct from the OPERATIONAL
// SOURCE (the eFOTM Safety Audit Manual, SOURCE_EFOTM_MANUAL above), which
// governs the Acute/Critical point values and factor-fail thresholds, not
// the Factor-to-Part mapping itself.
//
// This dataset still does NOT supply the complete current question-to-
// Factor mapping or Acute/Critical classification for each individual
// audit question — FMCSA_NE_AUDIT_QUESTIONS below remains empty for that
// reason, per Phase 2C's original instruction. Only the six Factor
// definitions themselves (name + regulatory Part mapping) are source-
// backed enough to encode now.

const SOURCE_385_APPENDIX_A: SourceReference = {
  description:
    "49 CFR Part 385 Appendix A (Explanation of Safety Audit Evaluation Criteria) — establishes the six regulatory Factors, their Part mappings, and (Phase 2F) the Factor 4 vehicle OOS performance test and Factor 6 accident-rate performance test. Supplied directly by the TES operator in the Phase 2E/2F task instructions; this codebase has not independently retrieved the eCFR text. Distinct from 49 CFR Part 385 Appendix B (List of Acute and Critical Regulations / Compliance Review scoring) — see the Phase 2F report for why Appendix B's regulation-by-regulation dataset was not encoded this phase, and note this file never imports Appendix B's Compliance Review scoring methodology (its 1-point general Acute rule, 10% Critical-pattern rule, Part 395 2-point Critical-pattern rule, or Satisfactory/Conditional/Unsatisfactory ratings) into this New Entrant path.",
  citation: "49 CFR Part 385 Appendix A",
  provenanceTag: "SOURCE_EXPLICIT",
};

// Phase 2F: Appendix A's Factor 4 vehicle-OOS performance test and Factor 6
// accident-rate performance test. Named, exported constants (rather than
// inline literals) so they're independently checkable and never confused
// with each other or with the §385.321 gate thresholds above.

/** Factor 4: minimum qualifying vehicle inspections in the 12-month lookback before the OOS-rate test applies at all. */
export const FMCSA_FACTOR_4_MINIMUM_INSPECTION_COUNT = 3;
/** Factor 4: OOS rate threshold — "34% or more" adds one point. Comparison is >= per source (contrast with Factor 6's strict >). */
export const FMCSA_FACTOR_4_OOS_RATE_THRESHOLD_PERCENT = 34;
/** Factor 4: points contributed by the OOS-rate test when it applies and the rate meets the threshold. */
export const FMCSA_FACTOR_4_OOS_POINTS = 1;
/** Factor 4: lookback window for the OOS-rate test. */
export const FMCSA_FACTOR_4_LOOKBACK_MONTHS = 12;

/** Factor 6: minimum recordable accidents in the lookback before the accident-rate test applies at all (below this: INSUFFICIENT_TRIGGER_POPULATION, never a fabricated zero-risk result). */
export const FMCSA_FACTOR_6_MINIMUM_TRIGGER_ACCIDENT_COUNT = 2;
/** Factor 6: threshold for a carrier operating entirely within the urban radius. Comparison is STRICT > per source — exactly 1.7 does not trigger inadequate. */
export const FMCSA_FACTOR_6_URBAN_THRESHOLD = 1.7;
/** Factor 6: threshold for all other carriers. Comparison is STRICT > per source — exactly 1.5 does not trigger inadequate. */
export const FMCSA_FACTOR_6_OTHER_THRESHOLD = 1.5;
/** Factor 6: the "urban carrier" radius, in air miles. */
export const FMCSA_FACTOR_6_URBAN_RADIUS_AIR_MILES = 100;
/** Factor 6: lookback window for the accident-rate test. */
export const FMCSA_FACTOR_6_LOOKBACK_MONTHS = 12;

const FACTOR_1_GENERAL_ID = "fmcsa-ne-factor-1-general";
const FACTOR_2_DRIVER_ID = "fmcsa-ne-factor-2-driver";
const FACTOR_3_OPERATIONAL_ID = "fmcsa-ne-factor-3-operational";
const FACTOR_4_VEHICLE_ID = "fmcsa-ne-factor-4-vehicle";
const FACTOR_5_HAZMAT_ID = "fmcsa-ne-factor-5-hazmat";
const FACTOR_6_ACCIDENT_ID = "fmcsa-ne-factor-6-accident";

export const FMCSA_NE_FACTORS: Factor[] = [
  {
    id: FACTOR_1_GENERAL_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "General",
    regulatoryParts: ["387", "390"],
    questionIds: [], // question-to-Factor dataset not available — see header note
    sourceReference: SOURCE_385_APPENDIX_A,
  },
  {
    id: FACTOR_2_DRIVER_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Driver",
    regulatoryParts: ["382", "383", "391"],
    questionIds: [],
    sourceReference: SOURCE_385_APPENDIX_A,
  },
  {
    id: FACTOR_3_OPERATIONAL_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Operational",
    regulatoryParts: ["392", "395"],
    questionIds: [],
    sourceReference: SOURCE_385_APPENDIX_A,
  },
  {
    id: FACTOR_4_VEHICLE_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Vehicle",
    regulatoryParts: ["393", "396"],
    questionIds: [],
    // Factor 4 is Parts 393/396 PLUS inspection data for the previous 12
    // months — not purely question-point based. Phase 2F: the OOS-rate
    // threshold is now source-confirmed (Appendix A) — see
    // FMCSA_FACTOR_4_OOS_RATE_THRESHOLD_PERCENT / _MINIMUM_INSPECTION_COUNT
    // / _OOS_POINTS above. Phase 2F.1 correction: fewer than the minimum
    // qualifying inspections is NOT_APPLICABLE (0 points, does not blank
    // the Factor), not UNDETERMINED — see evaluateVehicleOOSPerformanceTest
    // / applyVehicleOOSPointToFactorResult (lib/audit-preparedness-engine.ts)
    // for how it combines with Part 396 Acute/Critical points.
    performanceTest: {
      metricDescription: `Vehicle Out-of-Service rate over the previous ${FMCSA_FACTOR_4_LOOKBACK_MONTHS} months (applies only when at least ${FMCSA_FACTOR_4_MINIMUM_INSPECTION_COUNT} qualifying inspections occurred)`,
      threshold: FMCSA_FACTOR_4_OOS_RATE_THRESHOLD_PERCENT,
      thresholdUnit: "percent OOS (comparison: >=, i.e. 34% or more)",
      sourceReference: SOURCE_385_APPENDIX_A,
    },
    sourceReference: SOURCE_385_APPENDIX_A,
  },
  {
    id: FACTOR_5_HAZMAT_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Hazardous Materials",
    regulatoryParts: ["171", "177", "180", "397"],
    questionIds: [],
    sourceReference: SOURCE_385_APPENDIX_A,
  },
  {
    id: FACTOR_6_ACCIDENT_ID,
    regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
    name: "Accident",
    // No regulatory Part list applies — Factor 6 is a performance factor
    // (Recordable Accident Rate per Million Miles), not a Parts-based
    // question factor. regulatoryParts intentionally omitted rather than
    // populated with an unrelated Part number.
    questionIds: [], // Factor 6 must NOT be forced into fake AuditQuestions — see performanceTest instead.
    // Phase 2F: threshold is now source-confirmed but genuinely dynamic
    // (urban vs. other carrier), so a single static number here would
    // misrepresent it — threshold stays undefined on this static
    // definition; the two branch thresholds live as named constants
    // (FMCSA_FACTOR_6_URBAN_THRESHOLD / _OTHER_THRESHOLD) consumed by
    // evaluateFactorSixAccidentRate (lib/audit-preparedness-engine.ts),
    // which also enforces the applicability floor
    // (FMCSA_FACTOR_6_MINIMUM_TRIGGER_ACCIDENT_COUNT) and the strict >
    // comparison (never >=).
    performanceTest: {
      metricDescription: `Recordable Accident Rate per Million Miles over the previous ${FMCSA_FACTOR_6_LOOKBACK_MONTHS} months (applies only when at least ${FMCSA_FACTOR_6_MINIMUM_TRIGGER_ACCIDENT_COUNT} recordable accidents occurred)`,
      thresholdUnit: "accidents per million miles",
      threshold: undefined,
      sourceReference: SOURCE_385_APPENDIX_A,
    },
    sourceReference: SOURCE_385_APPENDIX_A,
  },
];

/**
 * Deterministic derivation only: extracts the three-digit Part number from
 * a "§ NNN.xxx" style regulatoryReference (as used by FMCSA_NE_GATE_RULES)
 * and looks it up against the Part-to-Factor mapping established above. A
 * pure string/lookup operation — never a judgment about whether the gate
 * or its Requirement is itself satisfied, classified, or scored.
 */
export function deriveFactorIdFromRegulatoryReference(regulatoryReference: string): string | undefined {
  const match = regulatoryReference.match(/§\s*(\d{3})/);
  if (!match) return undefined;
  const part = match[1];
  return FMCSA_NE_FACTORS.find((factor) => factor.regulatoryParts?.includes(part))?.id;
}

// ---------------------------------------------------------------------------
// AUDIT QUESTIONS — deliberately empty
// ---------------------------------------------------------------------------
// This source package establishes the point values/thresholds above and
// the six Factor definitions, but does NOT supply the complete current
// question-to-Factor mapping or the Acute/Critical classification for each
// individual audit question. That dataset is left incomplete rather than
// invented: no AuditQuestion below is classified, and no Factor has real
// question membership. calculateFactorMethodologyResult
// (lib/audit-preparedness-engine.ts) will therefore correctly return
// overallResult: "UNDETERMINED" for this regime until that dataset is
// supplied from an authoritative source.

export const FMCSA_NE_AUDIT_QUESTIONS: AuditQuestion[] = [];
