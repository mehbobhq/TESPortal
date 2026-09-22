/**
 * TES Audit Preparedness Engine — Phase 1 Calculation Contracts.
 *
 * Mirrors the existing lib/deadline-engine.ts convention: ../types/audit-
 * preparedness.ts defines the shape, this file defines the calculation.
 *
 * No regime-specific percentage calculation is implemented here. Alberta
 * NSC Full Facility Audit, FMCSA New Entrant Safety Audit, and FMCSA Safety
 * Audit each require an approved methodology (official subject-area
 * weights, gate/override conditions, sampling rules) sourced from that
 * regime's own authoritative material. No such source document exists
 * anywhere in this repository as of this implementation (verified by
 * repository-wide search — see the Phase 1 report), so
 * REGISTERED_CALCULATION_METHODS is intentionally empty and
 * getAuditPreparedness always returns percentage: null with a reason.
 *
 * The one calculation implemented here — evidence completeness — is a
 * plain count of required vs. supplied evidence categories. It carries no
 * regulatory judgment and is true regardless of which methodology a regime
 * eventually adopts, which is why it's safe to implement now.
 */

import type {
  AuditRegime,
  RequirementAssessment,
  AuditPreparedness,
  EvidenceCompleteness,
  GateCondition,
  ApplicabilityRule,
  ApplicabilityRuleEvaluation,
  ApplicabilityEvaluationResult,
  CarrierFact,
  GateRule,
  GateRuleEvaluation,
  GateRuleEvaluationInput,
  ThresholdComparison,
  Factor,
  AuditQuestion,
  FactorResult,
  FactorMethodologyResult,
  AutomaticFailureGateStatus,
  AuditOutcomeOutput,
  UnconfiguredRegimeReport,
  FactorPerformanceTest,
  FactorPerformanceResult,
  KnowledgeElementStatus,
  RegulatoryFinding,
  RegulatoryAssessment,
  RegulatoryAssessmentResult,
  RegulatoryAssessmentSource,
  UnderlyingConditionStatus,
  Population,
  PopulationRule,
  PopulationAdequacyResult,
  SampleAdequacyResult,
  RequiredEventDayComparison,
  RequiredEventDayAdequacyResult,
  EvidencePeriodValidityContext,
  EvidencePeriodValidityInput,
  EvidencePeriodValidityEvaluation,
  RequirementAssessmentBuildInput,
  RequirementAssessmentState,
  AuditEvidenceAssessmentState,
  PopulationMode,
  PreparednessCoverageResult,
  PreparednessCoverageBreakdown,
} from "../types/audit-preparedness";
import type { EntityType } from "../types/entity-references";
import { FMCSA_NEW_ENTRANT_REGIME_ID } from "./audit-regimes/fmcsa-new-entrant-ids";

export interface RegimeCalculationMethod {
  id: string;
  regimeId: string;
  methodologyVersion: string;
  /**
   * Must return percentage: null with unavailableReason set whenever the
   * methodology cannot legitimately produce a percentage from the given
   * assessments — e.g. missing official subject-area weights, or
   * unresolved UNDETERMINED requirements this methodology treats as
   * blocking. Implementations must not substitute a guess.
   */
  calculatePreparedness: (
    regime: AuditRegime,
    companyId: string,
    requirementAssessments: RequirementAssessment[]
  ) => AuditPreparedness;
  evaluateGateConditions: (
    regime: AuditRegime,
    companyId: string,
    requirementAssessments: RequirementAssessment[]
  ) => GateCondition[];
  /**
   * Phase 3C addition — optional and additive. Returns the separate
   * Preparedness + Coverage measurement (see PreparednessCoverageResult)
   * for regimes using that methodology. Does not replace or change the
   * pre-existing calculatePreparedness contract above: a regime that never
   * needs Coverage may leave this unset and keep using calculatePreparedness
   * alone. getPreparednessAndCoverage (below) is the dispatcher for this.
   */
  calculatePreparednessAndCoverage?: (
    regime: AuditRegime,
    companyId: string,
    requirementAssessments: RequirementAssessment[],
    mode?: PopulationMode
  ) => PreparednessCoverageResult;
}

/**
 * Phase 1 registry: intentionally empty. No RegimeCalculationMethod has
 * been registered for any regime because no approved methodology source
 * was found in this repository. Calling code must treat a missing entry as
 * "cannot calculate" and surface null — never fall back to a guess.
 */
export const REGISTERED_CALCULATION_METHODS: Record<string, RegimeCalculationMethod> = {};

/**
 * Pure mechanics: counts required vs. supplied evidence categories for a
 * requirement (or a whole regime, if the caller passes every required id).
 * Does not decide what evidence is required — the caller supplies that
 * list from the regime's own EvidenceRequirement records.
 */
export function calculateEvidenceCompleteness(
  requiredEvidenceRequirementIds: string[],
  suppliedEvidenceRequirementIds: string[],
  scopeRequirementId?: string
): EvidenceCompleteness {
  const suppliedSet = new Set(suppliedEvidenceRequirementIds);
  const missingEvidenceRequirementIds = requiredEvidenceRequirementIds.filter(
    (id) => !suppliedSet.has(id)
  );

  return {
    scopeRequirementId,
    requiredCount: requiredEvidenceRequirementIds.length,
    suppliedCount: requiredEvidenceRequirementIds.length - missingEvidenceRequirementIds.length,
    missingEvidenceRequirementIds,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Resolves preparedness for a regime. Delegates to a registered
 * methodology when one exists; otherwise returns the honest "cannot
 * calculate yet" result rather than manufacturing a percentage.
 */
export function getAuditPreparedness(
  regime: AuditRegime,
  companyId: string,
  requirementAssessments: RequirementAssessment[]
): AuditPreparedness {
  const method = regime.calculationMethodId
    ? REGISTERED_CALCULATION_METHODS[regime.calculationMethodId]
    : undefined;

  if (!method) {
    return {
      regimeId: regime.id,
      companyId,
      percentage: null,
      unavailableReason:
        "No approved calculation methodology has been registered for this audit regime yet.",
      calculatedAt: new Date().toISOString(),
    };
  }

  return method.calculatePreparedness(regime, companyId, requirementAssessments);
}

/**
 * Movement between two preparedness snapshots. Returns null whenever
 * either side is unavailable — preparedness change cannot be derived from
 * an unavailable baseline, and must never be inferred from evidence/upload
 * activity instead.
 *
 * Phase 3C section 20/Scenario T guard: also returns null when both sides
 * carry a methodologyVersion and the two differ — comparing preparedness
 * across an incompatible methodology change (e.g. a future revision to
 * the state-treatment rules in this file) is not a meaningful "+N points"
 * without qualification, and this function has no way to explain that
 * nuance through a bare number. When either side omits methodologyVersion
 * (pre-Phase-3C data), no comparison is attempted here — this is the
 * smallest additive guard using a field AuditPreparedness already carried,
 * not a redesign of snapshot/versioning architecture.
 */
export function calculatePreparednessChange(
  current: AuditPreparedness,
  comparison: AuditPreparedness
): number | null {
  if (current.percentage === null || comparison.percentage === null) return null;
  if (current.methodologyVersion && comparison.methodologyVersion && current.methodologyVersion !== comparison.methodologyVersion) {
    return null;
  }
  return current.percentage - comparison.percentage;
}

/**
 * Pure mechanics: days-with-violations divided by total sampled days.
 * Carries no regulatory judgment about what rate is acceptable — that
 * threshold, if one is ever established from authoritative source
 * material, belongs in a regime's own RegimeCalculationMethod, not here.
 */
export function calculateHOSViolationRate(totalDays: number, daysWithViolations: number): number | null {
  if (totalDays <= 0) return null;
  return daysWithViolations / totalDays;
}

/**
 * Pure mechanics only: detects whether the facts an ApplicabilityRule
 * declares it needs are actually present. Returns UNDETERMINED whenever
 * any are missing — never fabricates a fact, and never itself decides
 * APPLICABLE vs. NOT_APPLICABLE from present facts, since that requires
 * regime-specific conditional logic this function does not have.
 */
function compareThreshold(value: number, comparison: ThresholdComparison, threshold: number): boolean {
  switch (comparison) {
    case ">=":
      return value >= threshold;
    case ">":
      return value > threshold;
    case "<=":
      return value <= threshold;
    case "<":
      return value < threshold;
    case "==":
      return value === threshold;
  }
}

/**
 * Deterministic gate evaluation. Pure mechanics only: applies the
 * GateRule's own declared triggerType/threshold to the given facts. Never
 * invents a fact, never lets a missing fact resolve to NOT_TRIGGERED, and
 * never derives a result from anything other than this one rule's own
 * data — a preparedness percentage computed elsewhere cannot reach in and
 * change this outcome.
 */
export function evaluateGateRule(
  rule: GateRule,
  input: GateRuleEvaluationInput,
  context: { regimeId: string; companyId: string; methodologyVersion?: string }
): GateRuleEvaluation {
  const base = {
    gateRuleId: rule.id,
    regimeId: context.regimeId,
    companyId: context.companyId,
    evaluatedAt: new Date().toISOString(),
    methodologyVersion: context.methodologyVersion,
  };

  if (!rule.triggerType) {
    return { ...base, result: "NOT_EVALUATED", reason: "This gate has no machine-evaluable trigger type configured." };
  }

  if (rule.triggerType === "SINGLE_OCCURRENCE") {
    if (input.occurrenceKnown === null || input.occurrenceKnown === undefined) {
      return {
        ...base,
        result: "UNDETERMINED",
        reason: "Whether a qualifying occurrence exists is unknown. Missing facts must not resolve to NOT_TRIGGERED.",
      };
    }
    return {
      ...base,
      result: input.occurrenceKnown ? "TRIGGERED" : "NOT_TRIGGERED",
      reason: input.occurrenceKnown
        ? "A qualifying occurrence is recorded for this gate."
        : "No qualifying occurrence is recorded for this gate.",
    };
  }

  if (rule.triggerType === "VIOLATION_RATE_THRESHOLD") {
    const { violatingRecordCount, totalExaminedRecordCount } = input;
    if (
      violatingRecordCount === null ||
      violatingRecordCount === undefined ||
      totalExaminedRecordCount === null ||
      totalExaminedRecordCount === undefined ||
      totalExaminedRecordCount <= 0 ||
      !rule.threshold
    ) {
      return {
        ...base,
        result: "UNDETERMINED",
        reason:
          "Examined-record counts are unknown, or no examined population/sample exists yet. A violation rate cannot be determined without the actual examined sample — a future auditor's sample is never invented.",
        computedRatePercent: null,
      };
    }

    const ratePercent = (violatingRecordCount / totalExaminedRecordCount) * 100;
    const triggered = compareThreshold(ratePercent, rule.threshold.comparison, rule.threshold.thresholdPercent);
    return {
      ...base,
      result: triggered ? "TRIGGERED" : "NOT_TRIGGERED",
      reason: `${violatingRecordCount}/${totalExaminedRecordCount} examined records (${ratePercent.toFixed(1)}%) ${
        triggered ? "meets or exceeds" : "is below"
      } the ${rule.threshold.thresholdPercent}% threshold (${rule.threshold.numeratorDescription} / ${rule.threshold.denominatorDescription}).`,
      computedRatePercent: ratePercent,
    };
  }

  return { ...base, result: "NOT_EVALUATED", reason: "Unrecognized trigger type." };
}

/**
 * Evaluates every gate rule for a regime and classifies the overall
 * automatic-failure status. UNDETERMINED whenever any gate's own
 * evaluation is UNDETERMINED and none is TRIGGERED — a carrier is never
 * told "no gates triggered" merely because some gates couldn't be checked.
 */
export function evaluateAllGateRules(
  rules: GateRule[],
  inputsByRuleId: Record<string, GateRuleEvaluationInput>,
  context: { regimeId: string; companyId: string; methodologyVersion?: string }
): {
  evaluations: GateRuleEvaluation[];
  triggeredGates: GateRuleEvaluation[];
  undeterminedGates: GateRuleEvaluation[];
  automaticFailureGateStatus: AutomaticFailureGateStatus;
} {
  // Phase 2D lock: every rule is evaluated via .map — a TRIGGERED gate must
  // never stop evaluation of the remaining rules, so the audit assessment
  // can identify every other deficiency rather than stopping at the first
  // automatic-failure condition found. Do not change this to a loop that
  // breaks/returns early on the first TRIGGERED result.
  const evaluations = rules.map((rule) => evaluateGateRule(rule, inputsByRuleId[rule.id] ?? {}, context));
  const triggeredGates = evaluations.filter((e) => e.result === "TRIGGERED");
  const undeterminedGates = evaluations.filter((e) => e.result === "UNDETERMINED");

  const automaticFailureGateStatus: AutomaticFailureGateStatus =
    triggeredGates.length > 0 ? "GATE_TRIGGERED" : undeterminedGates.length > 0 ? "UNDETERMINED" : "NO_GATES_TRIGGERED";

  return { evaluations, triggeredGates, undeterminedGates, automaticFailureGateStatus };
}

/**
 * Combines Factors 1-5's points-based FactorResults with Factor 6's
 * separate, non-points-based accident-rate result into one
 * FactorMethodologyResult (Appendix A "PATH A" — Factor methodology).
 * failedFactorCount/overallResult only count Factor 6 as inadequate when
 * its own result is FAIL, and remain null/UNDETERMINED whenever any
 * Factor is itself undetermined — never a partial count.
 *
 * Deliberately kept separate from any GateRule/GateCondition evaluation
 * (Appendix A "PATH B" — automatic-failure gates, see evaluateGateRule/
 * evaluateAllGateRules above). Nothing here reads a gate's result or
 * writes into one, and nothing in the gate functions reads this result —
 * the two paths remain independently computed, never merged into one
 * unexplained score.
 */
export function combineOverallFactorOutcome(
  regimeId: string,
  companyId: string,
  factorResultsOneToFive: FactorResult[],
  factorSixResult: FactorPerformanceResult,
  requiredInadequateFactorCount: number,
  methodologyVersion?: string
): FactorMethodologyResult {
  const calculatedAt = new Date().toISOString();

  const anyOneToFiveUndetermined = factorResultsOneToFive.some((r) => r.failed === null);
  const factorSixUndetermined = factorSixResult.result === "UNDETERMINED";

  if (anyOneToFiveUndetermined || factorSixUndetermined) {
    return {
      regimeId,
      companyId,
      factorResults: factorResultsOneToFive,
      factorSixResult,
      failedFactorCount: null,
      overallResult: "UNDETERMINED",
      unavailableReason: "One or more Factors (1-5 points-based, or Factor 6 accident-rate) could not be determined.",
      methodologyVersion,
      calculatedAt,
    };
  }

  const failedFactorCount =
    factorResultsOneToFive.filter((r) => r.failed === true).length + (factorSixResult.result === "FAIL" ? 1 : 0);

  return {
    regimeId,
    companyId,
    factorResults: factorResultsOneToFive,
    factorSixResult,
    failedFactorCount,
    overallResult: failedFactorCount >= requiredInadequateFactorCount ? "FAIL" : "PASS",
    methodologyVersion,
    calculatedAt,
  };
}

/**
 * Sums an already-classified/scored set of AuditQuestions into Factor
 * results. Pure arithmetic only — classification/points themselves must
 * already be source-confirmed on each AuditQuestion (see
 * lib/audit-regimes/fmcsa-new-entrant-outcome-methodology.ts); this
 * function never assigns a classification or point value itself.
 */
export function calculateFactorMethodologyResult(
  factors: Factor[],
  questions: AuditQuestion[],
  context: { regimeId: string; companyId: string; methodologyVersion?: string; factorFailPointsThreshold: number; safetyAuditFailedFactorCount: number }
): FactorMethodologyResult {
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const calculatedAt = new Date().toISOString();

  const factorResults: FactorResult[] = factors.map((factor) => {
    const factorQuestions = factor.questionIds.map((id) => questionsById.get(id)).filter((q): q is AuditQuestion => Boolean(q));
    const missingOrUnclassified = factor.questionIds.length === 0 || factorQuestions.some((q) => q.points === undefined);

    if (missingOrUnclassified) {
      return {
        factorId: factor.id,
        companyId: context.companyId,
        totalPoints: null,
        failed: null,
        unavailableReason: "One or more questions in this Factor are not yet source-classified/scored.",
        calculatedAt,
        methodologyVersion: context.methodologyVersion,
      };
    }

    const totalPoints = factorQuestions.reduce((sum, q) => sum + (q.points ?? 0), 0);
    return {
      factorId: factor.id,
      companyId: context.companyId,
      totalPoints,
      failed: totalPoints >= context.factorFailPointsThreshold,
      calculatedAt,
      methodologyVersion: context.methodologyVersion,
    };
  });

  const anyUndetermined = factorResults.some((r) => r.failed === null);
  const failedFactorCount = anyUndetermined ? null : factorResults.filter((r) => r.failed === true).length;

  return {
    regimeId: context.regimeId,
    companyId: context.companyId,
    factorResults,
    failedFactorCount,
    overallResult:
      failedFactorCount === null ? "UNDETERMINED" : failedFactorCount >= context.safetyAuditFailedFactorCount ? "FAIL" : "PASS",
    unavailableReason: anyUndetermined ? "One or more Factors could not be scored — see individual FactorResult.unavailableReason." : undefined,
    methodologyVersion: context.methodologyVersion,
    calculatedAt,
  };
}

/**
 * Bundles the three independently-computed outputs into one object for
 * convenience only. Does not compute anything itself, and does not let any
 * field influence another — auditPreparedness and factorMethodologyResult
 * are passed through exactly as their own functions produced them.
 */
/**
 * The honest fallback for a regime whose methodology isn't (fully)
 * configured yet (Phase 2D §5). Pure aggregation only — never computes or
 * fabricates a percentage, pass/fail, or outcome. reviewRequired is always
 * true here: an unconfigured/partially-configured regime always needs
 * human review, never an automated outcome.
 */
export function buildUnconfiguredRegimeReport(
  regime: AuditRegime,
  companyId: string,
  context: {
    availableEvidenceRelationshipIds: string[];
    missingRequestedEvidenceRequirementIds: string[];
    unmappedRequirementIds: string[];
  }
): UnconfiguredRegimeReport {
  return {
    regimeId: regime.id,
    companyId,
    methodologyConfigurationStatus: regime.methodologyConfigurationStatus ?? "NOT_CONFIGURED",
    recognizedCapabilityIds: regime.capabilityIds ?? [],
    availableEvidenceRelationshipIds: context.availableEvidenceRelationshipIds,
    missingRequestedEvidenceRequirementIds: context.missingRequestedEvidenceRequirementIds,
    unmappedRequirementIds: context.unmappedRequirementIds,
    reviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
}

export function buildAuditOutcomeOutput(
  regimeId: string,
  companyId: string,
  auditPreparedness: AuditPreparedness,
  factorMethodologyResult: FactorMethodologyResult,
  gateEvaluation: { triggeredGates: GateRuleEvaluation[]; undeterminedGates: GateRuleEvaluation[]; automaticFailureGateStatus: AutomaticFailureGateStatus }
): AuditOutcomeOutput {
  return {
    regimeId,
    companyId,
    auditPreparedness,
    factorMethodologyResult,
    automaticFailureGateStatus: gateEvaluation.automaticFailureGateStatus,
    triggeredGates: gateEvaluation.triggeredGates,
    undeterminedGates: gateEvaluation.undeterminedGates,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Pure arithmetic: recordable accidents per million miles. The formula is
 * inherent in Factor 6's own name/definition, not a TES judgment — this
 * function computes it, but the threshold used to judge the result stays
 * on the FactorPerformanceTest (see evaluateFactorPerformanceTest), left
 * undefined unless a source confirms one.
 */
export function calculateAccidentRatePerMillionMiles(
  recordableAccidentCount: number | null,
  totalMilesTraveled: number | null
): number | null {
  if (recordableAccidentCount === null || totalMilesTraveled === null || totalMilesTraveled <= 0) return null;
  return (recordableAccidentCount / totalMilesTraveled) * 1_000_000;
}

/**
 * Evaluates a Factor's performance test against an already-computed metric
 * value. UNDETERMINED whenever the test carries no source-confirmed
 * threshold, or the metric itself couldn't be computed — never invents
 * either. Reuses the same comparison semantics as gate thresholds.
 */
export function evaluateFactorPerformanceTest(
  factorId: string,
  companyId: string,
  test: FactorPerformanceTest,
  metricInputs: Record<string, number | null>,
  computedMetricValue: number | null,
  comparison: ThresholdComparison = ">="
): FactorPerformanceResult {
  const calculatedAt = new Date().toISOString();

  if (computedMetricValue === null) {
    return {
      factorId,
      companyId,
      metricInputs,
      computedMetricValue: null,
      threshold: test.threshold ?? null,
      result: "UNDETERMINED",
      unavailableReason: "The performance metric could not be computed from the given inputs.",
      calculatedAt,
      sourceReference: test.sourceReference,
    };
  }

  if (test.threshold === undefined) {
    return {
      factorId,
      companyId,
      metricInputs,
      computedMetricValue,
      threshold: null,
      result: "UNDETERMINED",
      unavailableReason: "No source-confirmed threshold is available for this performance test.",
      calculatedAt,
      sourceReference: test.sourceReference,
    };
  }

  const failed = compareThreshold(computedMetricValue, comparison, test.threshold);
  return {
    factorId,
    companyId,
    metricInputs,
    computedMetricValue,
    threshold: test.threshold,
    result: failed ? "FAIL" : "PASS",
    calculatedAt,
    sourceReference: test.sourceReference,
  };
}

/**
 * Pure subtraction for a RequiredEventDayComparison (e.g. DVIR). Never
 * assumes a required-day count that wasn't actually supplied.
 */
export function calculateMissingRequiredRecords(
  requiredDayCount: number | null,
  recordsPresentCount: number | null
): number | null {
  if (requiredDayCount === null || recordsPresentCount === null) return null;
  return requiredDayCount - recordsPresentCount;
}

/**
 * Pure mechanics: vehicle Out-of-Service rate, and whether the minimum
 * qualifying inspection count was met. Returns null for the rate whenever
 * the minimum inspection count isn't met or inputs are missing — this is
 * how "fewer than 3 qualifying inspections → no OOS performance point" is
 * represented, via the existing UNDETERMINED path in
 * evaluateFactorPerformanceTest, without adding a new result state.
 */
/** Pure arithmetic only — does not decide applicability; see evaluateVehicleOOSPerformanceTest for that. */
export function calculateVehicleOOSRate(inspectionCount: number | null, oosCount: number | null): number | null {
  if (inspectionCount === null || oosCount === null || inspectionCount <= 0) return null;
  return (oosCount / inspectionCount) * 100;
}

/**
 * Factor 4 vehicle-OOS performance test (Phase 2F.1 correction). Fewer
 * than the minimum qualifying inspections is NOT_APPLICABLE — a known
 * fact ("the minimum inspection population isn't present"), never
 * UNDETERMINED ("we don't know"), and never PASS ("performance was
 * good"). Only a genuinely unknown input (inspection or OOS count itself
 * unknown) produces UNDETERMINED.
 */
export function evaluateVehicleOOSPerformanceTest(
  factorId: string,
  companyId: string,
  input: { inspectionCount: number | null; oosCount: number | null },
  config: {
    minimumInspectionCount: number;
    oosRateThresholdPercent: number;
    sourceReference?: FactorPerformanceResult["sourceReference"];
  }
): FactorPerformanceResult {
  const calculatedAt = new Date().toISOString();
  const metricInputs = { inspectionCount: input.inspectionCount, oosCount: input.oosCount };
  const base = { factorId, companyId, metricInputs, calculatedAt, sourceReference: config.sourceReference };

  if (input.inspectionCount === null) {
    return {
      ...base,
      computedMetricValue: null,
      threshold: config.oosRateThresholdPercent,
      result: "UNDETERMINED",
      unavailableReason: "Inspection count is unknown.",
    };
  }

  if (input.inspectionCount < config.minimumInspectionCount) {
    return {
      ...base,
      computedMetricValue: null,
      threshold: config.oosRateThresholdPercent,
      result: "NOT_APPLICABLE",
      unavailableReason: `Fewer than ${config.minimumInspectionCount} qualifying inspections — the OOS performance component does not apply (contributes 0 points; Factor 4 continues to be evaluated from applicable Part 396 Acute/Critical findings).`,
    };
  }

  if (input.oosCount === null) {
    return {
      ...base,
      computedMetricValue: null,
      threshold: config.oosRateThresholdPercent,
      result: "UNDETERMINED",
      unavailableReason: "OOS count is unknown despite a qualifying inspection count.",
    };
  }

  const rate = calculateVehicleOOSRate(input.inspectionCount, input.oosCount);
  // >= per source ("34% or more"), contrasted with Factor 6's strict >.
  const triggered = rate !== null && rate >= config.oosRateThresholdPercent;
  return {
    ...base,
    computedMetricValue: rate,
    threshold: config.oosRateThresholdPercent,
    result: triggered ? "FAIL" : "PASS",
  };
}

/**
 * Folds a Factor 4 vehicle-OOS performance result into that Factor's
 * points-based FactorResult (Acute/Critical Part 396 findings).
 *
 * Phase 2F.1 correction: NOT_APPLICABLE (fewer than the minimum qualifying
 * inspections) now contributes 0 points WITHOUT blanking the combined
 * total — it is a known fact, not missing data. Only a genuinely
 * UNDETERMINED OOS result (unknown inspection/OOS counts), or an
 * UNDETERMINED base Acute/Critical total, blanks the combined result —
 * Appendix A adds the OOS point "to points from discovered Acute/Critical
 * noncompliance with Part 396," so if that base total is itself unknown,
 * the combined total must remain unknown too.
 */
export function applyVehicleOOSPointToFactorResult(
  baseFactorResult: FactorResult,
  oosResult: FactorPerformanceResult,
  oosPointsIfTriggered: number,
  factorFailPointsThreshold: number
): FactorResult {
  if (oosResult.result === "UNDETERMINED") {
    return {
      ...baseFactorResult,
      totalPoints: null,
      failed: null,
      assessmentScopeComplete: false,
      unavailableReason: baseFactorResult.unavailableReason ?? "Vehicle OOS performance test result is undetermined.",
    };
  }

  // Phase 2G wiring fix: a base result from an incomplete assessment scope
  // (assessmentScopeComplete === false, e.g. from
  // calculateFactorPointsFromAssessments below) must stay incomplete here
  // too, even when it already carries a numeric totalPoints — checking
  // only `totalPoints === null` would miss this and let an OOS point get
  // added on top of an incomplete Part 396 scope, silently producing a
  // confident-looking failed:true/false from a partial picture.
  if (baseFactorResult.totalPoints === null || baseFactorResult.assessmentScopeComplete === false) {
    return { ...baseFactorResult, failed: null, assessmentScopeComplete: false };
  }

  // NOT_APPLICABLE and PASS both contribute 0 points — only FAIL (the
  // >=34% condition was met, on a qualifying inspection population)
  // contributes oosPointsIfTriggered.
  const oosPoints = oosResult.result === "FAIL" ? oosPointsIfTriggered : 0;
  const totalPoints = baseFactorResult.totalPoints + oosPoints;
  return {
    ...baseFactorResult,
    totalPoints,
    failed: totalPoints >= factorFailPointsThreshold,
    assessmentScopeComplete: true,
    unavailableReason: undefined,
  };
}

/**
 * Knowledge-element-aware regulatory finding evaluation (Phase 2F.1).
 * violationEstablished is derived, never set directly: true only when the
 * underlying condition is established AND (no knowledge element is
 * required OR it is itself ESTABLISHED). An UNRESOLVED required knowledge
 * element can never produce true, regardless of the underlying condition.
 */
export function evaluateRegulatoryFinding(
  underlyingConditionEstablished: boolean | null,
  knowledgeElementStatus: KnowledgeElementStatus,
  requiresKnowledgeElement: boolean | undefined
): boolean | null {
  if (underlyingConditionEstablished === null) return null;
  if (!underlyingConditionEstablished) return false;

  if (!requiresKnowledgeElement) return true;

  if (knowledgeElementStatus === "ESTABLISHED") return true;
  if (knowledgeElementStatus === "NEGATED") return false;
  // UNRESOLVED (or NOT_REQUIRED mismatched with a regulation that actually
  // requires it) — never auto-trigger a violation from the underlying
  // condition alone.
  return null;
}

// ---------------------------------------------------------------------------
// PHASE 2G — EVIDENCE-TO-FINDING ASSESSMENT BRIDGE
// ---------------------------------------------------------------------------

/**
 * The single function permitted to set RegulatoryAssessment.result.
 * Layers applicability handling around evaluateRegulatoryFinding (the
 * Phase 2F.1 knowledge-element logic) rather than re-implementing that
 * logic a second, possibly-divergent way — this is the wiring
 * evaluateRegulatoryFinding was always meant to feed.
 */
export function evaluateRegulatoryAssessmentResult(
  applicability: ApplicabilityEvaluationResult,
  underlyingConditionStatus: UnderlyingConditionStatus,
  knowledgeElementStatus: KnowledgeElementStatus,
  requiresKnowledgeElement: boolean | undefined
): RegulatoryAssessmentResult {
  if (applicability === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (applicability === "UNDETERMINED") return "REVIEW_REQUIRED";

  const underlyingConditionEstablished: boolean | null =
    underlyingConditionStatus === "ESTABLISHED" ? true : underlyingConditionStatus === "NOT_ESTABLISHED" ? false : null;

  const violationEstablished = evaluateRegulatoryFinding(underlyingConditionEstablished, knowledgeElementStatus, requiresKnowledgeElement);

  if (violationEstablished === true) return "NONCOMPLIANT";
  if (violationEstablished === false) return "COMPLIANT";
  return "REVIEW_REQUIRED";
}

/**
 * Builds a complete RegulatoryAssessment. result is always derived via
 * evaluateRegulatoryAssessmentResult — never passed in or set separately,
 * so it can never drift from the knowledge-element rule.
 */
export function buildRegulatoryAssessment(
  id: string,
  auditQuestion: AuditQuestion,
  entityType: EntityType,
  entityId: string,
  input: {
    applicability: ApplicabilityEvaluationResult;
    underlyingConditionStatus: UnderlyingConditionStatus;
    knowledgeElementStatus: KnowledgeElementStatus;
    observedFacts: CarrierFact[];
    evidenceIds?: string[];
    assessmentSource: RegulatoryAssessmentSource;
    assessedBy?: string;
    reasons?: string[];
    methodologyVersion?: string;
  }
): RegulatoryAssessment {
  return {
    id,
    auditQuestionId: auditQuestion.id,
    regulatoryReference: auditQuestion.regulatoryReference ?? "",
    entityType,
    entityId,
    applicability: input.applicability,
    underlyingConditionStatus: input.underlyingConditionStatus,
    knowledgeElementStatus: input.knowledgeElementStatus,
    observedFacts: input.observedFacts,
    evidenceIds: input.evidenceIds,
    result: evaluateRegulatoryAssessmentResult(
      input.applicability,
      input.underlyingConditionStatus,
      input.knowledgeElementStatus,
      auditQuestion.requiresKnowledgeElement
    ),
    reasons: input.reasons ?? [],
    assessedAt: new Date().toISOString(),
    assessedBy: input.assessedBy,
    assessmentSource: input.assessmentSource,
    methodologyVersion: input.methodologyVersion,
    sourceReference: auditQuestion.sourceReference,
  };
}

/**
 * Converts a completed RegulatoryAssessment into the Phase 2F.1
 * RegulatoryFinding model (Phase 2G §9). NOT_APPLICABLE and COMPLIANT both
 * map to violationEstablished: false (a definitive "not a violation");
 * REVIEW_REQUIRED maps to null (unresolved — never collapsed into false);
 * only NONCOMPLIANT maps to true. No points are assigned here — finding
 * generation and scoring remain separate (see
 * calculateFactorPointsFromAssessments below).
 */
export function buildRegulatoryFindingFromAssessment(assessment: RegulatoryAssessment, companyId: string): RegulatoryFinding {
  const underlyingConditionEstablished: boolean | null =
    assessment.underlyingConditionStatus === "ESTABLISHED"
      ? true
      : assessment.underlyingConditionStatus === "NOT_ESTABLISHED"
      ? false
      : null;

  const violationEstablished: boolean | null =
    assessment.result === "NONCOMPLIANT" ? true : assessment.result === "REVIEW_REQUIRED" ? null : false;

  return {
    id: `${assessment.id}-finding`,
    companyId,
    auditQuestionId: assessment.auditQuestionId,
    underlyingConditionEstablished,
    knowledgeElementStatus: assessment.knowledgeElementStatus,
    evidenceIds: assessment.evidenceIds,
    violationEstablished,
    determinedAt: assessment.assessedAt,
    determinedBy: assessment.assessedBy,
  };
}

/**
 * Closes the Phase 2F.1 gap: sums Appendix A points (Acute=1.5,
 * Critical=1) for ONE Factor from carrier-specific RegulatoryAssessments,
 * considering only assessments whose result is NONCOMPLIANT — never a
 * catalog entry with no assessment, never COMPLIANT/REVIEW_REQUIRED/
 * NOT_APPLICABLE assessments.
 *
 * assessmentScopeComplete is derived, not caller-supplied: true only when
 * every catalog regulation belonging to this Factor has a definitive
 * assessment (COMPLIANT/NONCOMPLIANT/NOT_APPLICABLE) — any regulation with
 * no assessment at all, or a REVIEW_REQUIRED one, makes the scope
 * incomplete. This is what prevents "zero assessments supplied" from ever
 * looking identical to "assessed everything, found nothing."
 */
export function calculateFactorPointsFromAssessments(
  factorId: string,
  companyId: string,
  catalog: AuditQuestion[],
  assessments: RegulatoryAssessment[],
  context: { factorFailPointsThreshold: number; methodologyVersion?: string }
): FactorResult {
  const calculatedAt = new Date().toISOString();
  const factorCatalog = catalog.filter((q) => q.factorId === factorId);
  const factorCatalogIds = new Set(factorCatalog.map((q) => q.id));
  const assessmentsForFactor = assessments.filter((a) => factorCatalogIds.has(a.auditQuestionId));

  const assessedIds = new Set(assessmentsForFactor.map((a) => a.auditQuestionId));
  const unassessedCount = factorCatalog.filter((q) => !assessedIds.has(q.id)).length;
  const reviewRequiredCount = assessmentsForFactor.filter((a) => a.result === "REVIEW_REQUIRED").length;
  const scopeComplete = unassessedCount === 0 && reviewRequiredCount === 0;

  const totalPoints = assessmentsForFactor
    .filter((a) => a.result === "NONCOMPLIANT")
    .reduce((sum, a) => {
      const question = factorCatalog.find((q) => q.id === a.auditQuestionId);
      return sum + (question?.points ?? 0);
    }, 0);

  if (!scopeComplete) {
    const reasonParts: string[] = [];
    if (unassessedCount > 0) reasonParts.push(`${unassessedCount} regulation(s) in this Factor's catalog have not been assessed yet`);
    if (reviewRequiredCount > 0) reasonParts.push(`${reviewRequiredCount} assessment(s) remain REVIEW_REQUIRED`);
    return {
      factorId,
      companyId,
      totalPoints,
      failed: null,
      assessmentScopeComplete: false,
      unavailableReason: reasonParts.join("; ") + " — points found so far do not represent a complete-scope conclusion.",
      calculatedAt,
      methodologyVersion: context.methodologyVersion,
    };
  }

  return {
    factorId,
    companyId,
    totalPoints,
    failed: totalPoints >= context.factorFailPointsThreshold,
    assessmentScopeComplete: true,
    calculatedAt,
    methodologyVersion: context.methodologyVersion,
  };
}

/**
 * Factor 6 (Accident) evaluation. Not points-based — a dedicated function
 * rather than reusing calculateFactorMethodologyResult, per the explicit
 * "do not force Factor 6 into the points model" instruction. Every
 * regulatory number (2-accident applicability floor, 1.7/1.5 thresholds,
 * strict >) is passed in as a parameter rather than hardcoded here, so
 * this function stays a generic mechanical evaluator and the actual
 * regulatory constants live with the regime data
 * (lib/audit-regimes/fmcsa-new-entrant-outcome-methodology.ts).
 */
export function evaluateFactorSixAccidentRate(
  factorId: string,
  companyId: string,
  input: {
    recordableAccidentCount: number | null;
    totalMilesTraveled: number | null;
    /** true = urban (operates entirely within the urban radius), false = other, null/undefined = unknown. Must never default to false. */
    operatesEntirelyWithinUrbanRadius: boolean | null | undefined;
  },
  config: {
    minimumTriggerAccidentCount: number;
    urbanCarrierThreshold: number;
    otherCarrierThreshold: number;
    sourceReference?: FactorPerformanceResult["sourceReference"];
  }
): FactorPerformanceResult {
  const calculatedAt = new Date().toISOString();
  const metricInputs = {
    recordableAccidentCount: input.recordableAccidentCount,
    totalMilesTraveled: input.totalMilesTraveled,
  };
  const rawRate = calculateAccidentRatePerMillionMiles(input.recordableAccidentCount, input.totalMilesTraveled);

  const base = {
    factorId,
    companyId,
    metricInputs,
    computedMetricValue: rawRate,
    calculatedAt,
    sourceReference: config.sourceReference,
  };

  // Applicability floor: fewer than the minimum trigger accident count means
  // this rate-based test does not apply at all — never fabricated as a
  // zero-risk PASS.
  if (input.recordableAccidentCount === null || input.recordableAccidentCount < config.minimumTriggerAccidentCount) {
    return {
      ...base,
      threshold: null,
      result: "UNDETERMINED",
      unavailableReason: `INSUFFICIENT_TRIGGER_POPULATION: fewer than ${config.minimumTriggerAccidentCount} recordable accidents in the lookback period — the accident-rate test does not apply.`,
    };
  }

  if (input.operatesEntirelyWithinUrbanRadius === null || input.operatesEntirelyWithinUrbanRadius === undefined) {
    return {
      ...base,
      threshold: null,
      result: "UNDETERMINED",
      unavailableReason: "Urban/non-urban operating-radius status is unknown — threshold selection cannot default to either value.",
    };
  }

  if (rawRate === null) {
    return {
      ...base,
      threshold: null,
      result: "UNDETERMINED",
      unavailableReason: "The accident rate could not be computed from the given inputs.",
    };
  }

  const threshold = input.operatesEntirelyWithinUrbanRadius ? config.urbanCarrierThreshold : config.otherCarrierThreshold;
  // STRICT greater-than per source: exactly 1.7 (urban) or exactly 1.5
  // (other) does NOT trigger inadequate. Never >=.
  const inadequate = rawRate > threshold;

  return {
    ...base,
    threshold,
    result: inadequate ? "FAIL" : "PASS",
  };
}

export function evaluateApplicabilityFactsAvailable(
  rule: ApplicabilityRule,
  facts: CarrierFact[]
): ApplicabilityRuleEvaluation {
  const knownKeys = new Set(facts.filter((f) => f.value !== null && f.value !== undefined).map((f) => f.key));
  const missingFactKeys = rule.factsRequired.map((f) => f.factKey).filter((key) => !knownKeys.has(key));

  if (missingFactKeys.length > 0) {
    return {
      ruleId: rule.id,
      result: "UNDETERMINED",
      reason: "Required carrier facts are missing or unknown; applicability cannot be determined without them.",
      missingFactKeys,
    };
  }

  return {
    ruleId: rule.id,
    result: "UNDETERMINED",
    reason:
      "All required facts are present, but this rule's conditional logic (turning present facts into APPLICABLE vs. NOT_APPLICABLE) is not yet implemented — deferred pending regime-specific methodology, not guessed.",
    missingFactKeys: [],
  };
}

// ---------------------------------------------------------------------------
// PHASE 2H — FMCSA NEW ENTRANT ORCHESTRATION ENTRY POINT
// ---------------------------------------------------------------------------
// Thin orchestration only: chains the already-accepted Phase 2A-2G
// functions (calculateFactorPointsFromAssessments, applyVehicleOOSPoint-
// ToFactorResult, evaluateVehicleOOSPerformanceTest,
// evaluateFactorSixAccidentRate, combineOverallFactorOutcome,
// evaluateAllGateRules, buildAuditOutcomeOutput) in the sequence the New
// Entrant methodology requires. No new calculation logic is introduced
// here, and no FMCSA-specific constant (point values, thresholds, gate
// definitions) is hardcoded in this function — callers supply their own
// regime data (see lib/audit-regimes/fmcsa-new-entrant-outcome-
// methodology.ts), keeping this function regime-agnostic like every other
// function in this file.
//
// PATH A (Factor methodology) and PATH B (automatic-failure gates) remain
// two independently computed, independently exposed fields on the
// returned AuditOutcomeOutput (factorMethodologyResult.overallResult vs.
// automaticFailureGateStatus) — nothing here merges them into one boolean.

export interface FmcsaNewEntrantFactor4Input {
  factorId: string;
  oosInput: { inspectionCount: number | null; oosCount: number | null };
  oosConfig: {
    minimumInspectionCount: number;
    oosRateThresholdPercent: number;
    oosPointsIfTriggered: number;
    sourceReference?: FactorPerformanceResult["sourceReference"];
  };
}

export interface FmcsaNewEntrantFactor6Input {
  factorId: string;
  input: {
    recordableAccidentCount: number | null;
    totalMilesTraveled: number | null;
    operatesEntirelyWithinUrbanRadius: boolean | null | undefined;
  };
  config: {
    minimumTriggerAccidentCount: number;
    urbanCarrierThreshold: number;
    otherCarrierThreshold: number;
    sourceReference?: FactorPerformanceResult["sourceReference"];
  };
}

export interface FmcsaNewEntrantEvaluationInput {
  regimeId: string;
  companyId: string;
  /** The relevant catalog rows (a subset or all of the 110-row dataset) for the Factors being evaluated. */
  catalog: AuditQuestion[];
  /** One entry per Factor 1-5 (Factor 4's base points are computed here too, then combined with its OOS component below). */
  assessmentsByFactor: Record<string, RegulatoryAssessment[]>;
  factor4: FmcsaNewEntrantFactor4Input;
  factor6: FmcsaNewEntrantFactor6Input;
  factorFailPointsThreshold: number;
  requiredInadequateFactorCount: number;
  gateRules: GateRule[];
  gateInputsByRuleId: Record<string, GateRuleEvaluationInput>;
  methodologyVersion?: string;
}

export interface FmcsaNewEntrantEvaluationOutput {
  /** Factors 1-5, in the order their ids appeared in assessmentsByFactor — Factor 4's entry already includes its OOS contribution. */
  factorResultsOneToFive: FactorResult[];
  factor4OosResult: FactorPerformanceResult;
  factor6Result: FactorPerformanceResult;
  /** PATH A. */
  factorMethodologyResult: FactorMethodologyResult;
  /** PATH B. */
  gateEvaluation: {
    evaluations: GateRuleEvaluation[];
    triggeredGates: GateRuleEvaluation[];
    undeterminedGates: GateRuleEvaluation[];
    automaticFailureGateStatus: AutomaticFailureGateStatus;
  };
  /** Both paths bundled for convenience — still independently readable via factorMethodologyResult.overallResult and automaticFailureGateStatus. */
  auditOutcomeOutput: AuditOutcomeOutput;
}

export function evaluateFmcsaNewEntrant(input: FmcsaNewEntrantEvaluationInput): FmcsaNewEntrantEvaluationOutput {
  const baseResultsByFactor: Record<string, FactorResult> = {};
  for (const factorId of Object.keys(input.assessmentsByFactor)) {
    baseResultsByFactor[factorId] = calculateFactorPointsFromAssessments(
      factorId,
      input.companyId,
      input.catalog,
      input.assessmentsByFactor[factorId],
      { factorFailPointsThreshold: input.factorFailPointsThreshold, methodologyVersion: input.methodologyVersion }
    );
  }

  const factor4OosResult = evaluateVehicleOOSPerformanceTest(
    input.factor4.factorId,
    input.companyId,
    input.factor4.oosInput,
    input.factor4.oosConfig
  );

  const factor4Base = baseResultsByFactor[input.factor4.factorId];
  if (factor4Base) {
    baseResultsByFactor[input.factor4.factorId] = applyVehicleOOSPointToFactorResult(
      factor4Base,
      factor4OosResult,
      input.factor4.oosConfig.oosPointsIfTriggered,
      input.factorFailPointsThreshold
    );
  }

  const factor6Result = evaluateFactorSixAccidentRate(input.factor6.factorId, input.companyId, input.factor6.input, input.factor6.config);

  const factorResultsOneToFive = Object.keys(input.assessmentsByFactor).map((id) => baseResultsByFactor[id]);

  const factorMethodologyResult = combineOverallFactorOutcome(
    input.regimeId,
    input.companyId,
    factorResultsOneToFive,
    factor6Result,
    input.requiredInadequateFactorCount,
    input.methodologyVersion
  );

  const gateEvaluation = evaluateAllGateRules(input.gateRules, input.gateInputsByRuleId, {
    regimeId: input.regimeId,
    companyId: input.companyId,
    methodologyVersion: input.methodologyVersion,
  });

  // TES Audit Preparedness (the separate, forward-looking percentage) is
  // explicitly out of scope for this phase — an honest null placeholder,
  // never a fabricated value, consistent with getAuditPreparedness's own
  // fallback elsewhere in this file.
  const auditOutcomeOutput = buildAuditOutcomeOutput(
    input.regimeId,
    input.companyId,
    {
      regimeId: input.regimeId,
      companyId: input.companyId,
      percentage: null,
      unavailableReason: "TES Audit Preparedness is out of scope for Phase 2H.",
      calculatedAt: new Date().toISOString(),
    },
    factorMethodologyResult,
    gateEvaluation
  );

  return { factorResultsOneToFive, factor4OosResult, factor6Result, factorMethodologyResult, gateEvaluation, auditOutcomeOutput };
}

// ---------------------------------------------------------------------------
// PHASE 3B — POPULATION ADEQUACY
// (Phase 3C section 16 safeguard applied — see inline note below)
// ---------------------------------------------------------------------------
// Answers "do we know the eligible universe?" only. Never inspects evidence,
// never touches compliance. A null `population` (no Population record
// assembled yet) is UNDETERMINED, never assumed complete or incomplete.
// `population.isIncomplete === true` is the only path to INCOMPLETE.
//
// PHASE 3C CORRECTION: Phase 3B originally treated any non-true
// `isIncomplete` (i.e. `false` or `undefined`) as COMPLETE, reasoning that
// an assembled Population (memberEntityIds + determinedAt) implied
// successful, complete determination. Phase 3C's own review (see that
// task's section 16) found this created false certainty: "no one flagged
// it incomplete" and "someone affirmatively confirmed this is the full
// eligible universe" are different claims, and the original logic
// conflated them. `Population.completenessConfirmed` (Phase 3C addition to
// types/audit-preparedness.ts) is now required, not merely the absence of
// isIncomplete, before this function returns COMPLETE. Every Phase 3B
// scenario that previously reached COMPLETE via an omitted `isIncomplete`
// flag alone now resolves to UNDETERMINED unless it also asserts
// `completenessConfirmed: true` — see the Phase 3C regression report for
// the resulting (intentional) scenario-output changes.
export function evaluatePopulationAdequacy(
  rule: PopulationRule,
  population: Population | null
): PopulationAdequacyResult {
  const evaluatedAt = new Date().toISOString();
  const base = {
    populationRuleId: rule.id,
    mode: rule.mode,
    scopeEntityType: rule.scopeEntityType,
    sourceReference: rule.sourceReference,
    evaluatedAt,
  };

  if (!population) {
    return {
      ...base,
      populationId: undefined,
      populationSize: null,
      state: "UNDETERMINED",
      reason: "No Population record has been determined yet for this rule; the eligible universe is unknown.",
    };
  }

  if (population.isIncomplete === true) {
    return {
      ...base,
      populationId: population.id,
      populationSize: population.memberEntityIds.length,
      state: "INCOMPLETE",
      reason:
        population.incompleteReason ??
        "This Population is explicitly marked incomplete — the minimum required population/sample could not be fully reviewed/selected.",
    };
  }

  if (population.completenessConfirmed === true) {
    return {
      ...base,
      populationId: population.id,
      populationSize: population.memberEntityIds.length,
      state: "COMPLETE",
      reason: "The eligible population for this rule has been assembled and its completeness has been affirmatively confirmed.",
    };
  }

  return {
    ...base,
    populationId: population.id,
    populationSize: population.memberEntityIds.length,
    state: "UNDETERMINED",
    reason:
      "A Population record exists and is not flagged incomplete, but its completeness has not been affirmatively confirmed (completenessConfirmed is not set) — the absence of an incomplete flag is not itself proof the eligible universe is fully known.",
  };
}

// ---------------------------------------------------------------------------
// PHASE 3B — SAMPLE ADEQUACY
// ---------------------------------------------------------------------------
// Critical behavior (Phase 3A Scenario I): an INCOMPLETE or UNDETERMINED
// PopulationAdequacyResult must resolve sample adequacy to UNDETERMINED
// regardless of how the actual sample count compares to the nominal tier
// minimum — a nominally-sufficient sample drawn from an unknown/incomplete
// universe is not evidence of anything. This check runs BEFORE any tier
// lookup or count comparison, so it cannot be bypassed by tier data alone.

export function evaluateSampleAdequacy(
  rule: PopulationRule,
  populationAdequacy: PopulationAdequacyResult,
  actual: { entitySampleSize: number | null; recordSampleSize?: number | null }
): SampleAdequacyResult {
  const evaluatedAt = new Date().toISOString();
  const base = {
    populationRuleId: rule.id,
    populationAdequacy,
    actualEntitySampleSize: actual.entitySampleSize,
    actualRecordSampleSize: actual.recordSampleSize ?? null,
    evaluatedAt,
  };

  if (!rule.sampleSizeTiers || rule.sampleSizeTiers.length === 0) {
    return {
      ...base,
      requiredEntitySampleSize: null,
      requiredRecordSampleSize: null,
      state: "NOT_APPLICABLE",
      reason:
        "This population rule has no sample-size-tier methodology (e.g. a required-event-day comparison rule such as DVIR) — see evaluateRequiredEventDayAdequacy for that pattern instead.",
    };
  }

  // Population-adequacy gate — checked first and unconditionally. Neither an
  // INCOMPLETE nor an UNDETERMINED population can be overridden by a
  // sufficient-looking sample count below.
  if (populationAdequacy.state === "UNDETERMINED") {
    return {
      ...base,
      requiredEntitySampleSize: null,
      requiredRecordSampleSize: null,
      state: "UNDETERMINED",
      reason:
        "Population adequacy is UNDETERMINED (" +
        populationAdequacy.reason +
        ") — sample adequacy cannot be evaluated without a known eligible population.",
    };
  }

  if (populationAdequacy.state === "INCOMPLETE") {
    return {
      ...base,
      requiredEntitySampleSize: null,
      requiredRecordSampleSize: null,
      state: "UNDETERMINED",
      reason:
        "The eligible population is INCOMPLETE (" +
        populationAdequacy.reason +
        "). A sample drawn from an incomplete population cannot be certified ADEQUATE merely because it meets the nominal tier minimum — the eligible universe itself is not established.",
    };
  }

  // populationAdequacy.state === "COMPLETE" from here on.
  const populationSize = populationAdequacy.populationSize;
  if (populationSize === null) {
    return {
      ...base,
      requiredEntitySampleSize: null,
      requiredRecordSampleSize: null,
      state: "UNDETERMINED",
      reason: "Population is marked complete but carries no known size — cannot resolve a sample-size tier.",
    };
  }

  const tier = rule.sampleSizeTiers.find(
    (t) => populationSize >= t.minPopulationSize && (t.maxPopulationSize === undefined || populationSize <= t.maxPopulationSize)
  );

  if (!tier) {
    return {
      ...base,
      requiredEntitySampleSize: null,
      requiredRecordSampleSize: null,
      state: "UNDETERMINED",
      reason: `Population size ${populationSize} does not resolve to any defined sample-size tier for this rule.`,
    };
  }

  if (actual.entitySampleSize === null) {
    return {
      ...base,
      requiredEntitySampleSize: tier.requiredEntitySampleSize,
      requiredRecordSampleSize: tier.requiredRecordSampleSize ?? null,
      state: "UNDETERMINED",
      reason: "The actual assembled sample size is not yet known.",
    };
  }

  const entityAdequate = actual.entitySampleSize >= tier.requiredEntitySampleSize;

  if (tier.requiredRecordSampleSize !== undefined) {
    if (actual.recordSampleSize === null || actual.recordSampleSize === undefined) {
      return {
        ...base,
        requiredEntitySampleSize: tier.requiredEntitySampleSize,
        requiredRecordSampleSize: tier.requiredRecordSampleSize,
        state: "UNDETERMINED",
        reason: "This tier requires a record-level sample count in addition to an entity count, and the record count is not yet known.",
      };
    }
    const recordAdequate = actual.recordSampleSize >= tier.requiredRecordSampleSize;
    const adequate = entityAdequate && recordAdequate;
    return {
      ...base,
      requiredEntitySampleSize: tier.requiredEntitySampleSize,
      requiredRecordSampleSize: tier.requiredRecordSampleSize,
      state: adequate ? "ADEQUATE" : "INADEQUATE",
      reason: adequate
        ? `Actual sample (${actual.entitySampleSize} entities, ${actual.recordSampleSize} records) meets the required minimum (${tier.requiredEntitySampleSize} entities, ${tier.requiredRecordSampleSize} records) for a population of ${populationSize}.`
        : `Actual sample (${actual.entitySampleSize} entities, ${actual.recordSampleSize} records) does not meet the required minimum (${tier.requiredEntitySampleSize} entities, ${tier.requiredRecordSampleSize} records) for a population of ${populationSize}.`,
    };
  }

  return {
    ...base,
    requiredEntitySampleSize: tier.requiredEntitySampleSize,
    requiredRecordSampleSize: null,
    state: entityAdequate ? "ADEQUATE" : "INADEQUATE",
    reason: entityAdequate
      ? `Actual sample (${actual.entitySampleSize} entities) meets the required minimum (${tier.requiredEntitySampleSize} entities) for a population of ${populationSize}.`
      : `Actual sample (${actual.entitySampleSize} entities) does not meet the required minimum (${tier.requiredEntitySampleSize} entities) for a population of ${populationSize}.`,
  };
}

/**
 * DVIR-style required-event-day adequacy (Phase 3B). Deliberately separate
 * from evaluateSampleAdequacy — this pattern ("was a required record
 * prepared for each qualifying day") has no population/tier concept at all.
 * Never invents a required-day count: a RequiredEventDayComparison with
 * null fields (e.g. FMCSA_NE_DVIR_REQUIRED_DAY_COMPARISONS, currently
 * empty) resolves to UNDETERMINED, not a fabricated ADEQUATE/INADEQUATE.
 */
export function evaluateRequiredEventDayAdequacy(
  requirementId: string,
  comparison: RequiredEventDayComparison | null
): RequiredEventDayAdequacyResult {
  const evaluatedAt = new Date().toISOString();

  if (!comparison || comparison.requiredDayCount === null || comparison.recordsPresentCount === null) {
    return {
      requirementId,
      state: "UNDETERMINED",
      requiredDayCount: comparison?.requiredDayCount ?? null,
      recordsPresentCount: comparison?.recordsPresentCount ?? null,
      missingRecordCount: null,
      reason:
        "No RequiredEventDayComparison instance exists for this requirement, or its required-day/records-present counts are not yet known — required-event-day adequacy is not configured, not a fabricated result.",
      evaluatedAt,
    };
  }

  const missingRecordCount = calculateMissingRequiredRecords(comparison.requiredDayCount, comparison.recordsPresentCount);
  const adequate = missingRecordCount === 0;

  return {
    requirementId,
    state: adequate ? "ADEQUATE" : "INADEQUATE",
    requiredDayCount: comparison.requiredDayCount,
    recordsPresentCount: comparison.recordsPresentCount,
    missingRecordCount,
    reason: adequate
      ? `All ${comparison.requiredDayCount} required day(s) have a corresponding record present.`
      : `${missingRecordCount} of ${comparison.requiredDayCount} required day(s) are missing a corresponding record.`,
    evaluatedAt,
  };
}

// ---------------------------------------------------------------------------
// PHASE 3B — EVIDENCE VALIDITY FOR A TEST PERIOD
// ---------------------------------------------------------------------------
// Prevents "EXPIRED TODAY = INVALID FOR ALL HISTORICAL AUDIT PERIODS."
// Never fabricates a validFrom/validUntil date — when the caller doesn't
// supply them, an EXPIRED item's period validity is UNDETERMINED, not
// assumed either way. EXPIRING is never treated as already-expired: a
// currently-valid-but-approaching-expiration item is VALID_NOW regardless
// of any period context.

export function evaluateEvidenceValidityForPeriod(
  input: EvidencePeriodValidityInput,
  context: EvidencePeriodValidityContext
): EvidencePeriodValidityEvaluation {
  if (input.currentState === "VALID" || input.currentState === "VERIFIED" || input.currentState === "EXPIRING") {
    return {
      result: "VALID_NOW",
      reason: `Evidence state is ${input.currentState} as of the assessment date — currently usable regardless of any historical test period.`,
    };
  }

  if (input.currentState !== "EXPIRED") {
    return {
      result: "UNDETERMINED",
      reason: `Evidence state is ${input.currentState} — period validity is not applicable; this is not a valid/expired temporal question for this state.`,
    };
  }

  // currentState === "EXPIRED" from here on.
  if (!context.testPeriodStart && !context.testPeriodEnd) {
    return {
      result: "UNDETERMINED",
      reason:
        "Evidence is expired as of today, and no historical test period was supplied to evaluate against — this assessment concerns current validity only.",
    };
  }

  if (!input.validFrom && !input.validUntil) {
    return {
      result: "UNDETERMINED",
      reason:
        "Evidence is expired today and a historical test period was supplied, but no effective/expiration dates are available for this evidence item — EXPIRED-today must not be assumed to mean invalid for the test period without that date data.",
    };
  }

  const testEnd = context.testPeriodEnd ?? context.assessmentAsOf ?? new Date().toISOString();
  const testStart = context.testPeriodStart ?? testEnd;

  if (input.validUntil && input.validUntil < testStart) {
    return {
      result: "INVALID_FOR_PERIOD",
      reason: `Evidence's own validity ended (${input.validUntil}) before the test period began (${testStart}) — it was already invalid during the relevant period, not only today.`,
    };
  }

  if (input.validFrom && input.validFrom > testEnd) {
    return {
      result: "INVALID_FOR_PERIOD",
      reason: `Evidence's own validity did not begin (${input.validFrom}) until after the test period ended (${testEnd}).`,
    };
  }

  if (input.validUntil && input.validUntil >= testStart && (!input.validFrom || input.validFrom <= testEnd)) {
    return {
      result: "VALID_FOR_PERIOD",
      reason: `Evidence is expired as of today, but its own validity window (through ${input.validUntil}) covered the relevant test period (${testStart} to ${testEnd}).`,
    };
  }

  return {
    result: "UNDETERMINED",
    reason: "Available effective/expiration dates were insufficient to conclusively resolve validity for the test period.",
  };
}

// ---------------------------------------------------------------------------
// PHASE 3B — REQUIREMENT ASSESSMENT BUILDER
// ---------------------------------------------------------------------------
// The single function permitted to construct a RequirementAssessment for
// TES Audit Preparedness purposes. Reuses the existing Phase 1
// RequirementAssessment type as-is — no FMCSA-specific duplicate. Never
// infers SATISFIED merely from evidence presence; never assigns a numeric
// weight; never lets a Factor point value or gate-trigger status leak into
// this result (see Scenarios M/N in the Phase 3B report for the isolation
// this preserves).
//
// Decision order (each step returns immediately if it resolves the state;
// later steps never override an earlier one):
//   1. Applicability NOT_APPLICABLE / UNDETERMINED.
//   2. Established regulatory noncompliance (dominant signal — an actual
//      finding of NONCOMPLIANT resolves UNSATISFIED even if all evidence is
//      otherwise present and valid; this is Scenario F).
//   3. Population/sample adequacy gate (an incomplete/undetermined
//      population or an inadequate/undetermined sample blocks SATISFIED
//      regardless of evidence completeness; this is Scenarios G/H/I).
//   4. Evidence-state aggregation across this Requirement's evidence
//      requirements (missing/conflicted/review-required/expired-without-
//      period-resolution block SATISFIED; valid/verified/expiring/
//      valid-for-period support it).
// PARTIALLY_SATISFIED is never emitted by this function — see the Phase 3B
// report's explicit finding on why current Requirement data cannot
// defensibly support it (no sub-obligation decomposition exists on
// Requirement). The state remains supported by the type for a future
// caller with richer data.
export function buildRequirementAssessment(id: string, input: RequirementAssessmentBuildInput): RequirementAssessment {
  const assessedAt = input.assessedAt ?? new Date().toISOString();
  const evidenceRelationshipIds = input.evidenceInputs.flatMap((e) => e.relationships.map((r) => r.relationship.id));

  const finish = (state: RequirementAssessmentState, reasons: string[], reviewRequired: boolean): RequirementAssessment => ({
    id,
    requirementId: input.requirement.id,
    populationId: input.populationId,
    entityType: input.entityType,
    entityId: input.entityId,
    state,
    reasons,
    evidenceRelationshipIds,
    assessedAt,
    assessmentMethod: input.requirement.assessmentMethod,
    reviewRequired,
    methodologyVersion: input.methodologyVersion,
  });

  // Step 1 — applicability.
  if (input.applicability === "NOT_APPLICABLE") {
    return finish(
      "NOT_APPLICABLE",
      [input.applicabilityReason ?? "This requirement is not applicable to this carrier/entity."],
      false
    );
  }
  if (input.applicability === "UNDETERMINED") {
    return finish(
      "UNDETERMINED",
      [input.applicabilityReason ?? "Applicability could not be determined from the facts available."],
      true
    );
  }

  // Step 2 — established regulatory noncompliance dominates evidence state.
  const regulatoryAssessments = input.regulatoryAssessments ?? [];
  const noncompliant = regulatoryAssessments.filter((a) => a.result === "NONCOMPLIANT");
  if (noncompliant.length > 0) {
    return finish(
      "UNSATISFIED",
      [
        `Established regulatory noncompliance: ${noncompliant.length} regulatory assessment(s) resulted in NONCOMPLIANT (${noncompliant
          .map((a) => a.regulatoryReference || a.auditQuestionId)
          .join(", ")}).`,
        ...noncompliant.flatMap((a) => a.reasons),
      ],
      false
    );
  }
  const reviewRequiredRegulatory = regulatoryAssessments.filter((a) => a.result === "REVIEW_REQUIRED");

  // Step 3 — population/sample adequacy gate.
  const reasons: string[] = [];
  let populationSampleBlocks = false;
  if (input.populationAdequacy && input.populationAdequacy.state !== "COMPLETE") {
    populationSampleBlocks = true;
    reasons.push(`Population adequacy is ${input.populationAdequacy.state}: ${input.populationAdequacy.reason}`);
  }
  if (input.sampleAdequacy && input.sampleAdequacy.state !== "ADEQUATE" && input.sampleAdequacy.state !== "NOT_APPLICABLE") {
    populationSampleBlocks = true;
    reasons.push(`Sample adequacy is ${input.sampleAdequacy.state}: ${input.sampleAdequacy.reason}`);
  }
  if (populationSampleBlocks) {
    return finish("UNDETERMINED", reasons, true);
  }

  // Step 4 — evidence-state aggregation.
  let anyMissingRequired = false;
  let anyUnresolvedRequired = false;
  const evidenceReasons: string[] = [];

  for (const evReq of input.evidenceInputs) {
    if (evReq.necessity !== "required") continue; // conditional items: not evaluated as mandatory here — their own applicability is not resolved by this builder.

    if (evReq.relationships.length === 0) {
      anyMissingRequired = true;
      evidenceReasons.push(`Required evidence (${evReq.evidenceRequirementId}) has no linked evidence.`);
      continue;
    }

    for (const rel of evReq.relationships) {
      if (!rel.assessment || rel.assessment.state === "MISSING") {
        anyMissingRequired = true;
        evidenceReasons.push(`Required evidence (${evReq.evidenceRequirementId}) is missing.`);
        continue;
      }
      const state = rel.assessment.state;
      if (state === "CONFLICTED" || state === "REVIEW_REQUIRED" || state === "SUBMITTED") {
        anyUnresolvedRequired = true;
        evidenceReasons.push(`Required evidence (${evReq.evidenceRequirementId}) is ${state}.`);
        continue;
      }
      if (state === "EXPIRED") {
        if (rel.periodValidity === "VALID_FOR_PERIOD") {
          evidenceReasons.push(`Required evidence (${evReq.evidenceRequirementId}) is expired today but was valid for the relevant test period.`);
          continue;
        }
        if (rel.periodValidity === "INVALID_FOR_PERIOD") {
          anyMissingRequired = true;
          evidenceReasons.push(`Required evidence (${evReq.evidenceRequirementId}) was already invalid during the relevant test period.`);
          continue;
        }
        anyUnresolvedRequired = true;
        evidenceReasons.push(
          `Required evidence (${evReq.evidenceRequirementId}) is expired today and its validity during the relevant test period is undetermined.`
        );
        continue;
      }
      // VALID, VERIFIED, EXPIRING all support satisfaction.
      evidenceReasons.push(`Required evidence (${evReq.evidenceRequirementId}) is ${state}.`);
    }
  }

  if (anyMissingRequired) {
    return finish("UNSATISFIED", evidenceReasons.length ? evidenceReasons : ["Required evidence is missing."], false);
  }

  if (anyUnresolvedRequired || reviewRequiredRegulatory.length > 0) {
    return finish(
      "UNDETERMINED",
      [
        ...evidenceReasons,
        ...reviewRequiredRegulatory.map((a) => `Regulatory assessment ${a.regulatoryReference || a.auditQuestionId} remains REVIEW_REQUIRED.`),
      ],
      true
    );
  }

  return finish(
    "SATISFIED",
    evidenceReasons.length ? evidenceReasons : ["No evidence requirements are attached to this requirement."],
    false
  );
}

// ---------------------------------------------------------------------------
// PHASE 3C — TES AUDIT PREPAREDNESS + COVERAGE
// ---------------------------------------------------------------------------
// TES's own preparedness-methodology version (Section 18). Describes the
// methodology defined in this phase — Requirement as the fundamental unit,
// SATISFIED/UNSATISFIED as resolved, UNDETERMINED/PARTIALLY_SATISFIED as
// unresolved, NOT_APPLICABLE excluded from both measurements, no arbitrary
// weights — never an FMCSA regulatory version. Regime-agnostic: any future
// regime adopting this same state-treatment methodology reuses this
// version string rather than inventing its own for the same rules.
export const TES_PREPAREDNESS_METHODOLOGY_VERSION = "tes-preparedness-v1";

/**
 * The only function permitted to compute Preparedness and Coverage.
 * Pure aggregation over RequirementAssessment.state — no document counts,
 * no EvidenceRequirement counts, no Acute/Critical points, no Factor
 * totals, no SubjectArea weights. One RequirementAssessment contributes at
 * most one unit, regardless of how many EvidenceRequirements/evidence
 * items back it.
 *
 * State treatment (locked, Phase 3C section 4):
 *   SATISFIED            -> counts toward both numerators and both denominators.
 *   UNSATISFIED          -> counts toward Preparedness denominator and
 *                           Coverage numerator+denominator, but NOT the
 *                           Preparedness numerator.
 *   UNDETERMINED          -> counts toward Coverage denominator only.
 *   PARTIALLY_SATISFIED   -> counts toward Coverage denominator only (no
 *                           numeric fraction assigned — treated as
 *                           unresolved for aggregation, per section 4,
 *                           while its own state is preserved verbatim in
 *                           the breakdown, never silently rewritten to
 *                           UNDETERMINED).
 *   NOT_APPLICABLE        -> excluded from every numerator/denominator;
 *                           visible only in notApplicableCount/breakdown.
 *
 * null-vs-zero (Phase 3C section 5, section 0): preparednessPercentage is
 * null when R (resolved applicable = S+U) is 0 — "nothing resolved yet,"
 * never manufactured as 0%. It is the literal number 0 only when R > 0 and
 * S = 0 — "everything resolved is unprepared." coveragePercentage is null
 * only when A (applicable = S+U+D+P) is 0.
 */
export function calculatePreparednessAndCoverage(
  requirementAssessments: RequirementAssessment[],
  context: { regimeId: string; companyId: string; methodologyVersion?: string; mode?: PopulationMode }
): PreparednessCoverageResult {
  const calculatedAt = new Date().toISOString();
  const methodologyVersion = context.methodologyVersion ?? TES_PREPAREDNESS_METHODOLOGY_VERSION;

  const breakdown: PreparednessCoverageBreakdown = {
    satisfiedRequirementIds: [],
    unsatisfiedRequirementIds: [],
    undeterminedRequirementIds: [],
    partiallySatisfiedRequirementIds: [],
    notApplicableRequirementIds: [],
  };

  for (const ra of requirementAssessments) {
    switch (ra.state) {
      case "SATISFIED":
        breakdown.satisfiedRequirementIds.push(ra.requirementId);
        break;
      case "UNSATISFIED":
        breakdown.unsatisfiedRequirementIds.push(ra.requirementId);
        break;
      case "UNDETERMINED":
        breakdown.undeterminedRequirementIds.push(ra.requirementId);
        break;
      case "PARTIALLY_SATISFIED":
        breakdown.partiallySatisfiedRequirementIds.push(ra.requirementId);
        break;
      case "NOT_APPLICABLE":
        breakdown.notApplicableRequirementIds.push(ra.requirementId);
        break;
    }
  }

  const satisfiedCount = breakdown.satisfiedRequirementIds.length;
  const unsatisfiedCount = breakdown.unsatisfiedRequirementIds.length;
  const undeterminedCount = breakdown.undeterminedRequirementIds.length;
  const partiallySatisfiedCount = breakdown.partiallySatisfiedRequirementIds.length;
  const notApplicableCount = breakdown.notApplicableRequirementIds.length;

  const resolvedApplicableCount = satisfiedCount + unsatisfiedCount; // R
  const applicableAssessmentCount = satisfiedCount + unsatisfiedCount + undeterminedCount + partiallySatisfiedCount; // A
  const totalAssessmentCount = requirementAssessments.length;

  const preparednessNumerator = satisfiedCount;
  const preparednessDenominator = resolvedApplicableCount;
  const coverageNumerator = resolvedApplicableCount;
  const coverageDenominator = applicableAssessmentCount;

  const preparednessPercentage = resolvedApplicableCount > 0 ? (satisfiedCount / resolvedApplicableCount) * 100 : null;
  const coveragePercentage = applicableAssessmentCount > 0 ? (resolvedApplicableCount / applicableAssessmentCount) * 100 : null;

  let unavailableReason: string | undefined;
  if (preparednessPercentage === null && coveragePercentage === null) {
    unavailableReason =
      applicableAssessmentCount === 0
        ? "No applicable RequirementAssessments exist to calculate from (every assessment is NOT_APPLICABLE, or none were supplied)."
        : "No resolved applicable RequirementAssessments exist yet (all applicable requirements are UNDETERMINED/PARTIALLY_SATISFIED).";
  } else if (preparednessPercentage === null) {
    unavailableReason = "No resolved applicable RequirementAssessments exist yet — Preparedness cannot be calculated, though Coverage can.";
  }

  return {
    regimeId: context.regimeId,
    companyId: context.companyId,
    mode: context.mode,
    preparednessPercentage,
    coveragePercentage,
    totalAssessmentCount,
    applicableAssessmentCount,
    resolvedApplicableCount,
    satisfiedCount,
    unsatisfiedCount,
    undeterminedCount,
    partiallySatisfiedCount,
    notApplicableCount,
    preparednessNumerator,
    preparednessDenominator,
    coverageNumerator,
    coverageDenominator,
    breakdown,
    methodologyVersion,
    calculatedAt,
    unavailableReason,
  };
}

/**
 * Dispatcher analogous to getAuditPreparedness, but for the Phase 3C
 * Preparedness+Coverage result. Delegates to a registered method's
 * calculatePreparednessAndCoverage when present; otherwise returns the
 * honest "not available" result rather than fabricating one. Does not
 * replace getAuditPreparedness or REGISTERED_CALCULATION_METHODS' existing
 * calculatePreparedness path — this is an additive, parallel entry point.
 */
export function getPreparednessAndCoverage(
  regime: AuditRegime,
  companyId: string,
  requirementAssessments: RequirementAssessment[],
  mode?: PopulationMode
): PreparednessCoverageResult {
  const method = regime.calculationMethodId ? REGISTERED_CALCULATION_METHODS[regime.calculationMethodId] : undefined;

  if (!method || !method.calculatePreparednessAndCoverage) {
    return {
      regimeId: regime.id,
      companyId,
      mode,
      preparednessPercentage: null,
      coveragePercentage: null,
      totalAssessmentCount: requirementAssessments.length,
      applicableAssessmentCount: 0,
      resolvedApplicableCount: 0,
      satisfiedCount: 0,
      unsatisfiedCount: 0,
      undeterminedCount: 0,
      partiallySatisfiedCount: 0,
      notApplicableCount: 0,
      preparednessNumerator: 0,
      preparednessDenominator: 0,
      coverageNumerator: 0,
      coverageDenominator: 0,
      breakdown: {
        satisfiedRequirementIds: [],
        unsatisfiedRequirementIds: [],
        undeterminedRequirementIds: [],
        partiallySatisfiedRequirementIds: [],
        notApplicableRequirementIds: [],
      },
      methodologyVersion: TES_PREPAREDNESS_METHODOLOGY_VERSION,
      calculatedAt: new Date().toISOString(),
      unavailableReason: "No approved Preparedness+Coverage calculation methodology has been registered for this audit regime yet.",
    };
  }

  return method.calculatePreparednessAndCoverage(regime, companyId, requirementAssessments, mode);
}

/**
 * Registers the FMCSA New Entrant TES preparedness+coverage method
 * (Phase 3C section 19). Only calculatePreparednessAndCoverage is
 * implemented for this registration — calculatePreparedness is left
 * throwing to make it unmistakable that the older single-percentage path
 * was never approved for this regime; nothing in this codebase calls it
 * for FMCSA New Entrant. Registration itself is inert (a plain object
 * literal keyed by id) until a caller sets
 * AuditRegime.calculationMethodId to this id — no such assignment is made
 * to FMCSA_NEW_ENTRANT_REGIME in lib/audit-regimes/fmcsa-new-entrant.ts by
 * this phase, keeping that file (and the accepted 110-row/16-gate state it
 * carries) completely untouched. A caller wiring this up in a future phase
 * makes that one-line assignment themselves.
 */
export const FMCSA_NEW_ENTRANT_PREPAREDNESS_METHOD_ID = "fmcsa-new-entrant-tes-preparedness-v1";

REGISTERED_CALCULATION_METHODS[FMCSA_NEW_ENTRANT_PREPAREDNESS_METHOD_ID] = {
  id: FMCSA_NEW_ENTRANT_PREPAREDNESS_METHOD_ID,
  regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
  methodologyVersion: TES_PREPAREDNESS_METHODOLOGY_VERSION,
  calculatePreparedness: () => {
    throw new Error(
      "calculatePreparedness (single-percentage) is not implemented for FMCSA New Entrant — use calculatePreparednessAndCoverage instead."
    );
  },
  evaluateGateConditions: () => [],
  calculatePreparednessAndCoverage: (regime, companyId, requirementAssessments, mode) =>
    calculatePreparednessAndCoverage(requirementAssessments, {
      regimeId: regime.id,
      companyId,
      methodologyVersion: TES_PREPAREDNESS_METHODOLOGY_VERSION,
      mode,
    }),
};
