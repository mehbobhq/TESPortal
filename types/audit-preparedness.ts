/**
 * TES Audit Preparedness Engine — Phase 1 Core Model.
 *
 * Represents the structure of real audit regimes generically enough to
 * support materially different methodologies — a continuous weighted
 * calculation (e.g. Alberta NSC's subject-area weighting) and a
 * gate/override calculation with automatic-failure conditions (e.g. FMCSA
 * New Entrant) — without forcing either into the other's shape.
 *
 * TYPES ONLY. No regime instance data (no actual Alberta NSC / FMCSA
 * subject areas, weights, or requirements) is defined here: no source
 * document for any of that regulatory detail was found in this repository
 * during Phase 1 discovery, and this architecture never invents one.
 *
 * Evidence ownership rule: this model never duplicates or clones evidence.
 * EvidenceRelationship links to an existing EvidenceRecord (./evidence.ts)
 * by id; the evidence continues to be owned by its natural domain (vehicle,
 * driver, company, insurance, etc).
 */

import type { ApplicabilityState } from "./applicability";
import type { EntityType } from "./entity-references";

// ---------------------------------------------------------------------------
// AUDIT REGIME
// ---------------------------------------------------------------------------

/** How a regime turns requirement assessments into an outcome. A regime may use one or both. */
export type AuditMethodologyType = "weighted" | "gate" | "hybrid";

/**
 * Checkable provenance tier for a fact this architecture encodes, without
 * needing to re-read prose reasoning later:
 *   - SOURCE_EXPLICIT: stated directly in supplied/repository source material
 *     (a regulation, official guide, or audit manual), with that material
 *     cited via `citation`/`documentId`.
 *   - TES_MODELED: TES's own decomposition of a source-explicit category
 *     into this architecture's Requirement/Evidence structure — not itself
 *     independently named by the source as a primary requirement.
 *   - OPERATOR_SUPPLIED: stated directly by the TES operator in conversation,
 *     without an underlying document this codebase has inspected.
 *   - NOT_VERIFIED: anything not confidently one of the above — never
 *     rounded up to SOURCE_EXPLICIT because it seems plausible.
 */
export type ProvenanceTag = "SOURCE_EXPLICIT" | "TES_MODELED" | "OPERATOR_SUPPLIED" | "NOT_VERIFIED";

export interface SourceReference {
  description: string;
  citation?: string;
  /** Links to an EvidenceRecord id when the source itself is a stored document (e.g. an uploaded audit manual). */
  documentId?: string;
  retrievedAt?: string;
  version?: string;
  /** Checkable in code, independent of this description's prose. See ProvenanceTag. */
  provenanceTag?: ProvenanceTag;
}

/**
 * Whether a regime's regulatory methodology has been configured in this
 * architecture (Phase 2D addition). Distinct from whether requirements
 * exist at all — a regime can have recognized capabilities/requirements
 * while still having NOT_CONFIGURED methodology, e.g. no calculation
 * method, no gates, or no factor methodology encoded yet.
 */
export type RegimeMethodologyConfigurationStatus = "CONFIGURED" | "PARTIALLY_CONFIGURED" | "NOT_CONFIGURED";

export interface AuditRegime {
  id: string;
  name: string;
  jurisdiction: string;
  authority: string;
  versionLabel?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  methodologyType: AuditMethodologyType;
  subjectAreaIds: string[];
  applicabilityRuleIds: string[];
  samplingRuleIds: string[];
  /** Resolves to a RegimeCalculationMethod (lib/audit-preparedness-engine.ts). Absent until an approved methodology exists. */
  calculationMethodId?: string;
  outcomeRuleIds: string[];
  sourceReferences: SourceReference[];
  /**
   * Reusable AuditCapabilities (see AuditCapability below) this regime
   * composes, in addition to its own regime-specific methodology/rules.
   * Shared capability does not imply shared regulatory methodology — two
   * regimes using VEHICLE_INSPECTION still each carry their own separate
   * source-backed Requirement for it.
   */
  capabilityIds?: string[];
  /** Honest self-report of how much of this regime's methodology is actually encoded — see RegimeMethodologyConfigurationStatus. */
  methodologyConfigurationStatus?: RegimeMethodologyConfigurationStatus;
}

// ---------------------------------------------------------------------------
// APPLICABILITY
// ---------------------------------------------------------------------------
// Reuses the canonical shared ApplicabilityState ("APPLIES" | "DOES_NOT_APPLY"
// | "NOT_CONFIGURED") from ./applicability.ts rather than a parallel
// APPLICABLE/NOT_APPLICABLE/UNDETERMINED enum. NOT_CONFIGURED carries the
// same "do not silently treat as satisfied" meaning as this architecture's
// UNDETERMINED concept.

export interface CarrierFact {
  /** e.g. "operationType", "vehicleWeightClass", "hazmatCarrier", "passengerOperation". */
  key: string;
  value: string | number | boolean | null;
  source?: string;
  capturedAt?: string;
  /**
   * Evidence this fact is traceable to (Phase 2G addition). Reused as the
   * generic OBSERVED FACT concept in the assessment layer (see
   * RegulatoryAssessment below) rather than inventing a parallel type —
   * "annual inspection date = X", "driver license status = disqualified",
   * etc. are all representable as a CarrierFact with evidenceIds set.
   */
  evidenceIds?: string[];
}

export interface ApplicabilityDecision {
  requirementId: string;
  state: ApplicabilityState;
  reason?: string;
  basedOnFacts: CarrierFact[];
  decidedAt?: string;
  /** "SYSTEM" or a user id — never silently assumed. */
  decidedBy?: string;
}

// ---------------------------------------------------------------------------
// SUBJECT AREA
// ---------------------------------------------------------------------------

export interface SubjectArea {
  id: string;
  regimeId: string;
  name: string;
  /**
   * Populated only when an authoritative methodology establishes a weight.
   * Absent — not zero, not an invented even split — when no approved
   * weighting exists for a regime.
   */
  officialWeight?: number;
  weightSource?: SourceReference;
  requirementIds: string[];
}

// ---------------------------------------------------------------------------
// POPULATION / SAMPLE
// ---------------------------------------------------------------------------

export type PopulationMode = "PRE_AUDIT_ELIGIBLE_POPULATION" | "ACTUAL_AUDIT_REQUESTED_SAMPLE";

/**
 * A population-size-dependent minimum sample tier (Phase 2E addition) — for
 * regimes whose minimum sample size is a stepped function of eligible
 * population size (e.g. "1 driver -> 1 file, 2 -> 2, 3+ -> 3") rather than
 * a single fixed number. Generic — not specific to any one entity type or
 * regime, so future regimes can reuse it without a new type.
 */
export interface SampleSizeTier {
  /** Inclusive lower bound of eligible population size for this tier. */
  minPopulationSize: number;
  /** Inclusive upper bound, or undefined for "and above" (e.g. the 3+ tier). */
  maxPopulationSize?: number;
  requiredEntitySampleSize: number;
  /** Only set when the regime source pairs a records-per-tier minimum with the entity minimum (e.g. FMCSA HOS: 1 driver + 30 records). */
  requiredRecordSampleSize?: number;
}

/** A source-stated priority for which eligible entities/records to select first. Never a TES-invented priority. */
export interface SamplingSelectionPriority {
  /** Rank order, 1 = highest priority, per the regime's own source-stated list. */
  rank: number;
  description: string;
}

export interface PopulationRule {
  id: string;
  requirementId: string;
  /** e.g. "All drivers active during the audit period", "Selected HOS days from audit request letter". */
  description: string;
  scopeEntityType: EntityType;
  mode: PopulationMode;
  /**
   * Regime/methodology parameter, left undefined unless an authoritative
   * source establishes a general sample-size rule. A count observed in one
   * example audit (e.g. "this carrier's audit sampled 2 drivers") is never
   * a valid basis for a default here — it describes that one audit's
   * result, not a general regime rule.
   */
  targetSampleSize?: number;
  /**
   * How many days back from "now" the population's members are drawn from
   * (e.g. an accident register's audit lookback window). Distinct from
   * EvidenceRequirement.recencyRequirementDays, which governs how current
   * a single piece of evidence must be, not which members are in scope.
   * Left undefined unless a source establishes a specific lookback window.
   */
  lookbackDays?: number;
  /**
   * Set only when this rule's minimum sample size is population-size-
   * dependent (Phase 2E addition) — e.g. FMCSA's DQ file / Part 382 / HOS
   * tiers. Distinct from targetSampleSize (a flat number) and from any
   * other PopulationRule's own tiers — each rule instance defines its own
   * tiers independently, even where two rules happen to share a number.
   */
  sampleSizeTiers?: SampleSizeTier[];
  /**
   * Free-text description of the review/test period this rule's minimums
   * apply to, when that period is itself part of the sampling rule (e.g.
   * "1-2 months selected from the previous 6 months") rather than a single
   * lookback window. Distinct from lookbackDays.
   */
  reviewPeriodDescription?: string;
  /** Source-stated selection priority order, when the source specifies one. */
  selectionPriority?: SamplingSelectionPriority[];
  /**
   * Provenance for this sampling/population rule's own definition (Phase 2E
   * addition — every other definition-time construct in this architecture
   * already carries one; this was the one remaining gap). Distinct from
   * Population.sourceReference below, which is for an assessment-time
   * instance's provenance.
   */
  sourceReference?: SourceReference;
}

export interface Population {
  id: string;
  populationRuleId: string;
  mode: PopulationMode;
  memberEntityType: EntityType;
  /** The actual carrier population/sample this instance covers. */
  memberEntityIds: string[];
  periodStart?: string;
  periodEnd?: string;
  determinedAt: string;
  /**
   * A Population in ACTUAL_AUDIT_REQUESTED_SAMPLE mode must never silently
   * overwrite a PRE_AUDIT_ELIGIBLE_POPULATION Population for the same
   * requirement — both are retained as distinct records.
   */
  sourceReference?: SourceReference;
  /**
   * Count of actual examined RECORDS (Phase 2E addition), distinct from
   * memberEntityIds (actual selected ENTITIES) — e.g. FMCSA HOS samples
   * both a driver count and a separate record count per driver.
   */
  examinedRecordCount?: number;
  /**
   * True when the minimum required sample (per this Population's own
   * PopulationRule) could not be fully reviewed/selected. An incomplete
   * sample must never be silently treated as a complete one.
   */
  isIncomplete?: boolean;
  incompleteReason?: string;
  /**
   * Phase 3C safeguard: true only when whoever assembled this Population
   * affirmatively confirms it represents the full eligible universe (e.g.
   * cross-checked against a roster/system-of-record), not merely that no
   * one flagged it incomplete. Absence of this flag (undefined) must be
   * treated as "completeness not confirmed" by evaluatePopulationAdequacy
   * (lib/audit-preparedness-engine.ts), never silently promoted to
   * COMPLETE — see that Phase 3C task's own section 16 finding: a
   * Population record having been successfully assembled
   * (memberEntityIds + determinedAt) is not the same claim as "this is
   * known to be everyone," and the absence of isIncomplete alone
   * previously conflated the two. This field is additive and optional so
   * existing Population data is never invalidated by its absence — it
   * simply now resolves to UNDETERMINED rather than COMPLETE until this
   * flag is set.
   */
  completenessConfirmed?: boolean;
}

// ---------------------------------------------------------------------------
// REQUIRED-EVENT/DAY COMPARISON (Phase 2E addition)
// ---------------------------------------------------------------------------
// For regimes that assess "was a required record prepared for each
// qualifying day/event" rather than a simple entity/document sample — e.g.
// FMCSA's DVIR review (days a DVIR was required vs. records actually
// prepared/retained). Generic — not specific to Driver or Vehicle, so
// future regimes with an analogous required-record-per-period pattern can
// reuse it.

export interface RequiredEventDayComparison {
  id: string;
  requirementId: string;
  /** The entity sample (e.g. vehicles) this comparison covers, when applicable. */
  populationId?: string;
  reviewPeriodDescription: string;
  /** null when not yet determined — never assumed complete. */
  requiredDayCount: number | null;
  recordsPresentCount: number | null;
  /** requiredDayCount - recordsPresentCount; null whenever either input is null. */
  missingRecordCount: number | null;
  sourceReference?: SourceReference;
}

// ---------------------------------------------------------------------------
// REQUIREMENT / AUDIT TEST — the primary assessment unit
// ---------------------------------------------------------------------------

export interface EvidenceRequirement {
  id: string;
  requirementId: string;
  /** Domain-specific document/category type, sourced from the regime's own requirement text — never invented here. */
  evidenceType: string;
  necessity: "required" | "conditional";
  /** Free-text description of the condition, when necessity is "conditional". */
  conditionalOn?: string;
  /** Only set when the regime source states an actual minimum. */
  minimumCount?: number;
  recencyRequirementDays?: number;
  entityScope: EntityType;
  /** Alternate evidenceTypes that satisfy the same requirement, when the source allows substitution. */
  alternatives?: string[];
  /** Provenance for this specific evidence expectation — may differ from its parent Requirement's (e.g. a TES-modeled decomposition of a source-explicit requirement). */
  sourceReference?: SourceReference;
  /**
   * Names of physical combination-unit types (e.g. "Tractor", "Semitrailer",
   * "Full Trailer", "Converter Dolly") that each independently require their
   * own evidence under this requirement, when the source establishes that a
   * combination vehicle isn't satisfied by one unit's evidence alone. This
   * is a structural "which units need their own evidence" list, drawn
   * verbatim from source terminology — never a components/systems checklist
   * (brakes, lights, tires, etc.) invented beyond what the source names.
   */
  requiresPerCombinationUnit?: string[];
}

export interface Requirement {
  id: string;
  regimeId: string;
  subjectAreaId: string;
  name: string;
  description: string;
  regulatoryReference?: string;
  populationRuleId?: string;
  evidenceRequirementIds: string[];
  /**
   * Whether this requirement, if unsatisfied, is eligible to independently
   * trigger a GateCondition rather than only reducing a weighted score.
   * Does not itself carry gate logic — see GateRule below.
   */
  canTriggerGate: boolean;
  /** Free text describing how the regime source says this is assessed (e.g. "document review", "physical inspection", "record sampling"). */
  assessmentMethod?: string;
  sourceReference?: SourceReference;
  /**
   * Reusable AuditCapability ids this Requirement implements (Phase 2D
   * addition). A Capability is a reusable domain/audit function; this
   * Requirement remains its own separate, regime-specific, source-backed
   * regulatory test — tagging it with a capability never merges it with
   * another regime's requirement for the same capability.
   */
  capabilityIds?: string[];
}

// ---------------------------------------------------------------------------
// EVIDENCE RELATIONSHIP — links existing evidence to a requirement
// ---------------------------------------------------------------------------
// AUDIT RELEVANCE DOES NOT EQUAL OWNERSHIP: this record is a relationship,
// never a copy. The referenced evidence keeps living in its natural domain.

export interface EvidenceRelationship {
  id: string;
  requirementId: string;
  evidenceRequirementId: string;
  /** References an existing EvidenceRecord.id (./evidence.ts). Never a copy. */
  evidenceId: string;
  entityType: EntityType;
  entityId: string;
  linkedAt: string;
  linkedBy?: string;
}

// ---------------------------------------------------------------------------
// EVIDENCE ASSESSMENT
// ---------------------------------------------------------------------------

export type AuditEvidenceAssessmentState =
  | "MISSING"
  | "SUBMITTED"
  | "VALID"
  | "VERIFIED"
  | "EXPIRED"
  | "EXPIRING"
  | "CONFLICTED"
  | "REVIEW_REQUIRED";

export interface EvidenceAssessment {
  id: string;
  evidenceRelationshipId: string;
  state: AuditEvidenceAssessmentState;
  reasons: string[];
  assessedAt: string;
  /** "SYSTEM" or a user id. */
  assessedBy?: string;
  // Deliberately no numeric weight/value field here. If an approved
  // methodology later assigns evidence-state contributions to a
  // calculation, that mapping belongs in the regime's own calculation
  // method (lib/audit-preparedness-engine.ts) — not on the assessment
  // record itself. This keeps "what state is this evidence in" separate
  // from any regime's opinion about what that state is worth.
}

// ---------------------------------------------------------------------------
// REQUIREMENT ASSESSMENT
// ---------------------------------------------------------------------------

export type RequirementAssessmentState =
  | "SATISFIED"
  | "PARTIALLY_SATISFIED"
  | "UNSATISFIED"
  // Excluded from a regime's calculation denominator wherever that regime's
  // methodology requires exclusion (Y/N/N/A semantics) — never treated as
  // satisfied, and never allowed to lower preparedness by being counted as
  // unsatisfied either.
  | "NOT_APPLICABLE"
  | "UNDETERMINED";

export interface RequirementAssessment {
  id: string;
  requirementId: string;
  /** Which Population/Sample this assessment scopes to, when applicable. */
  populationId?: string;
  entityType?: EntityType;
  entityId?: string;
  state: RequirementAssessmentState;
  reasons: string[];
  evidenceRelationshipIds: string[];
  assessedAt: string;
  assessmentMethod?: string;
  /** 0-1 confidence in the assessment itself — never a readiness/preparedness percentage. */
  confidence?: number;
  reviewRequired: boolean;
  methodologyVersion?: string;
}

// ---------------------------------------------------------------------------
// GATE / OUTCOME RULES — a dimension separate from preparedness %
// ---------------------------------------------------------------------------

export type GateOutcomeType =
  | "AUTOMATIC_FAILURE"
  | "BLOCKING_DEFICIENCY"
  | "MANDATORY_REVIEW"
  | "CRITICAL_UNRESOLVED_REQUIREMENT";

/**
 * How a gate is mechanically triggered (Phase 2C addition). Left undefined
 * on a GateRule that has no machine-evaluable trigger yet — never defaulted
 * to one of these to make a rule look more complete than it is.
 */
export type GateTriggerType = "SINGLE_OCCURRENCE" | "VIOLATION_RATE_THRESHOLD";

export type ThresholdComparison = ">=" | ">" | "<=" | "<" | "==";

export interface GateThreshold {
  /** e.g. "violating examined records". */
  numeratorDescription: string;
  /** e.g. "total examined records". */
  denominatorDescription: string;
  comparison: ThresholdComparison;
  /**
   * The regulatory threshold preserved in its original percentage form
   * (e.g. 51 for "51% or more"), never silently converted to a 0-1
   * fraction in a way that could obscure the regulatory representation.
   */
  thresholdPercent: number;
}

export interface GateRule {
  id: string;
  regimeId: string;
  name: string;
  description: string;
  outcomeType: GateOutcomeType;
  /** Requirements whose UNSATISFIED/UNDETERMINED state can trigger this rule. */
  triggeringRequirementIds: string[];
  sourceReference?: SourceReference;
  /** Exact regulatory citation this gate encodes (Phase 2C addition), e.g. "§ 395.8(a)". */
  regulatoryReference?: string;
  triggerType?: GateTriggerType;
  /** Required when triggerType is VIOLATION_RATE_THRESHOLD; absent otherwise. */
  threshold?: GateThreshold;
}

export interface GateCondition {
  id: string;
  gateRuleId: string;
  regimeId: string;
  companyId: string;
  triggeredByRequirementAssessmentIds: string[];
  status: "OPEN" | "RESOLVED";
  detectedAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

// ---------------------------------------------------------------------------
// GATE EVALUATION (Phase 2C addition)
// ---------------------------------------------------------------------------
// Distinct from GateCondition above: GateCondition is the record of an
// ALREADY-DETECTED trigger's lifecycle (OPEN/RESOLVED). GateRuleEvaluation
// is the result of ATTEMPTING to evaluate a gate at all, including the
// outcomes "not yet evaluated," "evaluated and not triggered," and
// "evaluated but the facts needed are unknown" — none of which have a
// GateCondition, since no condition exists unless one is TRIGGERED.

export type GateEvaluationResult = "NOT_EVALUATED" | "NOT_TRIGGERED" | "TRIGGERED" | "UNDETERMINED";

export interface GateRuleEvaluationInput {
  /** For SINGLE_OCCURRENCE gates. null/undefined = fact unknown — must resolve to UNDETERMINED, never NOT_TRIGGERED. */
  occurrenceKnown?: boolean | null;
  /** For VIOLATION_RATE_THRESHOLD gates — the actual examined sample, never an invented one. */
  violatingRecordCount?: number | null;
  totalExaminedRecordCount?: number | null;
}

export interface GateRuleEvaluation {
  gateRuleId: string;
  regimeId: string;
  companyId: string;
  result: GateEvaluationResult;
  reason: string;
  /** Present only for VIOLATION_RATE_THRESHOLD gates once evaluated with known counts. */
  computedRatePercent?: number | null;
  evaluatedAt: string;
  methodologyVersion?: string;
}

// ---------------------------------------------------------------------------
// THE THREE SEPARATE METRICS
// ---------------------------------------------------------------------------
// Intentionally distinct types with no shared numeric field between them:
//   - EvidenceCompleteness: are the currently-required evidence items present
//   - AuditPreparedness: the regime-methodology-derived readiness measure
//   - PreparednessChange: movement between two AuditPreparedness snapshots

export interface EvidenceCompleteness {
  /** Set when scoped to one requirement rather than the whole regime. */
  scopeRequirementId?: string;
  requiredCount: number;
  suppliedCount: number;
  missingEvidenceRequirementIds: string[];
  calculatedAt: string;
}

export interface AuditPreparedness {
  regimeId: string;
  companyId: string;
  /**
   * null means "cannot be legitimately calculated yet" — e.g. no approved
   * calculationMethod registered for this regime, or required
   * RequirementAssessments are UNDETERMINED. This is a correct terminal
   * state, not a placeholder awaiting a future default value.
   */
  percentage: number | null;
  /** Required context whenever percentage is null. */
  unavailableReason?: string;
  subjectAreaResults?: Array<{
    subjectAreaId: string;
    percentage: number | null;
    unavailableReason?: string;
  }>;
  methodologyVersion?: string;
  calculatedAt: string;
}

export interface PreparednessChange {
  regimeId: string;
  companyId: string;
  currentSnapshotId: string;
  comparisonSnapshotId: string;
  /** e.g. "7-day", "30-day". */
  periodLabel: string;
  /** null whenever either snapshot's percentage is null — movement cannot be derived from an unavailable baseline. */
  pointsChange: number | null;
  direction?: "up" | "down" | "flat";
}

// ---------------------------------------------------------------------------
// HISTORICAL STATE
// ---------------------------------------------------------------------------

export interface PreparednessSnapshot {
  id: string;
  regimeId: string;
  companyId: string;
  entityScope?: { entityType: EntityType; entityId: string };
  preparedness: AuditPreparedness;
  gateConditionIds: string[];
  methodologyVersion?: string;
  /** Snapshots are append-only; a past snapshot is never rewritten in place. */
  takenAt: string;
}

// ---------------------------------------------------------------------------
// UI OUTPUT CONTRACT — independent, nullable slots
// ---------------------------------------------------------------------------
// Never fabricate a value just to fill a slot. If the engine cannot
// legitimately calculate something, the corresponding field is null and
// the UI omits it.

export interface AuditPreparednessUIOutput {
  regimeId: string;
  companyId: string;
  /**
   * Phase 1: no approved mapping from requirement assessments to a single
   * status tone has been established for any regime, so this is always
   * null in this phase. The tone vocabulary intentionally matches the
   * existing four-tone TESStatusRing semantics (current/attention/critical/
   * neutral) for whenever that mapping is later approved — this type does
   * not import the UI component, to keep this file free of a components
   * dependency.
   */
  currentCondition: { tone: "current" | "attention" | "critical" | "neutral"; reason: string } | null;
  evidenceCompleteness: EvidenceCompleteness | null;
  auditPreparedness: AuditPreparedness | null;
  preparednessChange: PreparednessChange | null;
  gateConditions: GateCondition[];
  attentionItems: RequirementAssessment[];
  missingRequirements: RequirementAssessment[];
  reviewRequiredItems: RequirementAssessment[];
}

// ---------------------------------------------------------------------------
// HOS QUANTITATIVE SAMPLE TEST (Phase 2 addition)
// ---------------------------------------------------------------------------
// Some regimes assess Hours of Service through a day/sample quantitative
// test rather than document-completeness checking. This represents that
// result shape generically; it holds no regime-specific thresholds or
// rates — those are audit RESULTS for one carrier's one sample, never
// regulatory rules, and are never hardcoded here.

export interface HOSSampleTestCategory {
  /** Regime-defined violation category (e.g. "Fatigue", "Form and Manner") — not a fixed enum, since categories are methodology-specific. */
  category: string;
  daysWithViolations: number;
}

export interface HOSSampleTestResult {
  id: string;
  requirementId: string;
  /** The sampled-days Population this result was computed over. */
  populationId: string;
  totalDays: number;
  daysWithViolations: number;
  /** null when totalDays is 0 — a rate cannot be derived from an empty sample. */
  violationRate: number | null;
  categories: HOSSampleTestCategory[];
  assessedAt: string;
  methodologyVersion?: string;
  /** Clarifies this is one carrier's audit result, not a regulatory threshold. */
  sourceReference?: SourceReference;
}

// ---------------------------------------------------------------------------
// APPLICABILITY RULE (Phase 2B.1 addition) — machine-evaluable applicability
// ---------------------------------------------------------------------------
// Additive: consumed by existing Requirement definitions via requirementId,
// without changing Requirement's own shape or how it's assessed elsewhere.
// Deliberately small — this is not a rules engine. It records WHAT FACTS a
// regime's own source material says determine applicability, and lets a
// caller mechanically detect when required facts are missing (→
// UNDETERMINED). It does not itself encode the conditional logic that would
// turn present facts into APPLICABLE vs. NOT_APPLICABLE — that logic is
// regime-specific regulatory judgment deferred to a later phase, not
// something this structure invents to look more complete than it is.

export type ApplicabilityEvaluationResult = "APPLICABLE" | "NOT_APPLICABLE" | "UNDETERMINED";

export interface ApplicabilityFactRequirement {
  /** e.g. "vehicleGVWR", "operationType", "hmOperation". Matches CarrierFact.key when a fact is supplied. */
  factKey: string;
  description: string;
}

export interface ApplicabilityRule {
  id: string;
  requirementId: string;
  /** Human-readable statement of the condition(s), from the regime's own source material. */
  description: string;
  factsRequired: ApplicabilityFactRequirement[];
  sourceReference?: SourceReference;
}

export interface ApplicabilityRuleEvaluation {
  ruleId: string;
  result: ApplicabilityEvaluationResult;
  reason: string;
  missingFactKeys: string[];
}

// ---------------------------------------------------------------------------
// RETENTION REQUIREMENT (Phase 2B.1 addition)
// ---------------------------------------------------------------------------
// Distinct from EvidenceRequirement.recencyRequirementDays (how CURRENT a
// piece of evidence must be) — this represents how LONG a record must
// continue to be kept/available after some reference point. Conflating the
// two would misrepresent a "must still exist" rule as a "must be recent"
// rule or vice versa.

export interface RetentionRequirement {
  id: string;
  requirementId: string;
  /** Narrows to a specific EvidenceRequirement when a requirement has more than one retention rule (e.g. HM shipping papers vs. hazardous waste shipping papers). */
  evidenceRequirementId?: string;
  retentionPeriodDays: number;
  /** What the retention period counts from — e.g. "record creation", "shipment acceptance". */
  retentionAnchor: string;
  /** Distinguishes multiple retention rules attached to the same requirement/evidence. */
  appliesWhen?: string;
  sourceReference?: SourceReference;
}

// ---------------------------------------------------------------------------
// FACTOR METHODOLOGY (Phase 2C addition)
// ---------------------------------------------------------------------------
// A regulatory scoring methodology distinct from TES Audit Preparedness —
// e.g. FMCSA eFOTM's Acute/Critical question points and Factor-failure
// count. These are regulatory constants when a regime's authoritative
// source states them; this architecture never invents a classification or
// point value that isn't cited to a source.

export type AuditQuestionClassification = "ACUTE" | "CRITICAL" | "OTHER" | "NON_SCORING";

export interface AuditQuestion {
  id: string;
  regimeId: string;
  /** Links to an existing Requirement, when the question corresponds to one. */
  requirementId?: string;
  /** Which Factor this question belongs to — undefined until source-confirmed. */
  factorId?: string;
  /** Undefined (not "OTHER" by default) until an authoritative source classifies this specific question. */
  classification?: AuditQuestionClassification;
  /** Undefined until classification is source-confirmed; never inferred from classification alone. */
  points?: number;
  /** Exact CFR citation for this question (Phase 2F.1 addition), e.g. "§ 382.201". */
  regulatoryReference?: string;
  /** Regulatory Part number, e.g. "382" (Phase 2F.1 addition). */
  regulatoryPart?: string;
  /**
   * True when this regulation's own text requires a knowledge element
   * (known/knowingly/should reasonably have known) rather than being
   * satisfied merely by the underlying prohibited condition occurring
   * (Phase 2F.1 addition). See RegulatoryFinding below for how that
   * distinction is preserved at assessment time.
   */
  requiresKnowledgeElement?: boolean;
  sourceReference?: SourceReference;
}

// ---------------------------------------------------------------------------
// REGULATORY FINDING (Phase 2F.1 addition) — carrier-specific, kept
// structurally separate from the regulatory definition (AuditQuestion)
// ---------------------------------------------------------------------------
// Some Acute/Critical regulations require a knowledge element ("known,"
// "knowingly," "should reasonably have known") in addition to an
// underlying prohibited condition. Collapsing these into one fact would
// let the underlying condition alone silently manufacture a violation the
// regulation doesn't actually establish. This type keeps them separate and
// derives violationEstablished only through evaluateRegulatoryFinding
// (lib/audit-preparedness-engine.ts) — never by setting it directly.
//
// No instances of this type are created in this codebase yet: doing so
// would require a real carrier-specific finding, which this phase
// explicitly does not fabricate.

export type KnowledgeElementStatus = "NOT_REQUIRED" | "ESTABLISHED" | "UNRESOLVED" | "NEGATED";

export interface RegulatoryFinding {
  id: string;
  companyId: string;
  /** Links to the AuditQuestion (regulatory definition) this finding concerns. */
  auditQuestionId: string;
  /** Whether the underlying prohibited condition itself is established, independent of any knowledge requirement. null = unknown. */
  underlyingConditionEstablished: boolean | null;
  /** NOT_REQUIRED when the regulation carries no knowledge element (AuditQuestion.requiresKnowledgeElement is false/undefined). */
  knowledgeElementStatus: KnowledgeElementStatus;
  evidenceIds?: string[];
  /**
   * Derived, never set directly: true only when the underlying condition
   * is established AND (no knowledge element is required OR it is itself
   * ESTABLISHED). Never true merely because the underlying condition
   * occurred while a required knowledge element remains UNRESOLVED.
   */
  violationEstablished: boolean | null;
  determinedAt: string;
  determinedBy?: string;
}

// ---------------------------------------------------------------------------
// REGULATORY ASSESSMENT (Phase 2G addition) — the bridge between evidence
// and a RegulatoryFinding
// ---------------------------------------------------------------------------
// EVIDENCE/OBSERVED FACTS -> REGULATORY ASSESSMENT -> REGULATORY FINDING ->
// ACUTE/CRITICAL DEFINITION (AuditQuestion) -> FACTOR CALCULATION.
//
// Reuses ApplicabilityEvaluationResult, KnowledgeElementStatus, and
// CarrierFact (as the observed-fact representation) rather than duplicating
// them. A regulation existing in the catalog never implies a violation —
// this record is what actually determines, for one entity, whether one
// exists, and evaluateRegulatoryAssessmentResult (the only function
// permitted to set `result`) reuses evaluateRegulatoryFinding underneath
// so the knowledge-element logic verified in Phase 2F.1 is never
// re-implemented a second, possibly-divergent way.

export type RegulatoryAssessmentResult = "COMPLIANT" | "NONCOMPLIANT" | "REVIEW_REQUIRED" | "NOT_APPLICABLE";

/** Independent from the final finding — see section 6 of the Phase 2G task: "driver disqualified" (condition) does not by itself mean "§383.37(b) violation" (finding), because a knowledge element may still be required. */
export type UnderlyingConditionStatus = "ESTABLISHED" | "NOT_ESTABLISHED" | "UNDETERMINED";

/** How this assessment's result was actually determined (Phase 2G §15) — no per-regulation detector is implied by any of these three values. */
export type RegulatoryAssessmentSource = "DETERMINISTIC_SYSTEM" | "HUMAN_REVIEW" | "EXTERNAL_CONFIRMED";

export interface RegulatoryAssessment {
  id: string;
  /** Links to the AuditQuestion (Appendix B VII regulatory definition) being assessed. */
  auditQuestionId: string;
  /** Denormalized for readability/traceability; mirrors AuditQuestion.regulatoryReference at assessment time. */
  regulatoryReference: string;
  entityType: EntityType;
  entityId: string;
  applicability: ApplicabilityEvaluationResult;
  underlyingConditionStatus: UnderlyingConditionStatus;
  /** NOT_REQUIRED when the regulation carries no knowledge element. */
  knowledgeElementStatus: KnowledgeElementStatus;
  /** Observed facts (CarrierFact) supporting this assessment — never itself ACUTE/CRITICAL/a Factor point/a violation. */
  observedFacts: CarrierFact[];
  evidenceIds?: string[];
  /** Derived only via evaluateRegulatoryAssessmentResult — never set ad hoc. */
  result: RegulatoryAssessmentResult;
  reasons: string[];
  assessedAt: string;
  assessedBy?: string;
  assessmentSource: RegulatoryAssessmentSource;
  methodologyVersion?: string;
  sourceReference?: SourceReference;
}

/**
 * A Factor-level performance test (Phase 2E addition) — for Factors that
 * aren't purely question-point based (e.g. FMCSA Factor 4's inspection-data
 * performance component, Factor 6's accident rate). Threshold is left
 * undefined whenever no source-confirmed value exists — never invented.
 */
export interface FactorPerformanceTest {
  /** e.g. "Recordable Accident Rate per Million Miles", "Vehicle inspection performance for the previous 12 months". */
  metricDescription: string;
  threshold?: number;
  thresholdUnit?: string;
  sourceReference?: SourceReference;
}

/**
 * A carrier's challenge to a computed performance-test result on
 * preventability grounds (Phase 2F addition — e.g. FMCSA Factor 6: a New
 * Entrant may contest the accident-factor evaluation with compelling
 * evidence that the raw recordable rate isn't a fair measure). This is
 * purely a representable challenge/review record — nothing here ever
 * auto-decides preventability or removes an accident from the raw rate
 * calculation.
 */
export interface AccidentRatePreventabilityChallenge {
  id: string;
  companyId: string;
  raisedAt: string;
  /** The carrier's own compelling-evidence argument. Never auto-generated. */
  challengeBasis: string;
  reviewStatus: "PENDING" | "ACCEPTED" | "REJECTED";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
}

/** Result of evaluating a FactorPerformanceTest. Pure arithmetic/comparison only — no regulatory judgment beyond what the test itself states. */
export interface FactorPerformanceResult {
  factorId: string;
  companyId: string;
  /** Raw inputs behind the computed metric, kept transparent rather than collapsed (e.g. { recordableAccidentCount: 2, totalMilesTraveled: 1200000 }). */
  metricInputs: Record<string, number | null>;
  /**
   * Raw computed value — e.g. the raw recordable accident rate. Never
   * adjusted for a preventability challenge (Phase 2F): preventability is
   * tracked separately via preventabilityChallengeIds, not by mutating
   * this value.
   */
  computedMetricValue: number | null;
  /** null means no source-confirmed threshold exists yet, or none applies to this evaluation (e.g. an inapplicable performance test) — result must then be UNDETERMINED. */
  threshold: number | null;
  /**
   * NOT_APPLICABLE (Phase 2F.1 addition) is distinct from UNDETERMINED:
   * UNDETERMINED means the needed facts are unknown; NOT_APPLICABLE means
   * the facts ARE known and affirmatively show this test's minimum
   * population/trigger condition isn't met (e.g. fewer than the minimum
   * qualifying inspections) — a known, not a missing, fact. Both
   * contribute 0 points/no-inadequate, but must remain distinguishable so
   * "we don't know" is never confused with "this doesn't apply."
   */
  result: "FAIL" | "PASS" | "UNDETERMINED" | "NOT_APPLICABLE";
  unavailableReason?: string;
  /**
   * Preventability challenges raised against this result (Phase 2F
   * addition), when applicable. Their existence never changes `result` or
   * `computedMetricValue` automatically — only an explicit, separately
   * recorded regulatory/human determination could ever do that, and this
   * architecture does not implement that determination step itself.
   */
  preventabilityChallengeIds?: string[];
  calculatedAt: string;
  sourceReference?: SourceReference;
}

export interface Factor {
  id: string;
  regimeId: string;
  name: string;
  questionIds: string[];
  /**
   * Regulatory Parts this Factor covers (e.g. ["387", "390"] for a
   * "General" factor), when the regime's own source establishes the
   * mapping. Not itself a claim about which AuditQuestions exist for
   * those Parts.
   */
  regulatoryParts?: string[];
  /**
   * Present only for Factors assessed (in whole or in part) via a
   * performance metric rather than purely question points — e.g. Factor 4
   * (vehicle inspection data) or Factor 6 (accident rate). A Factor may
   * have both questionIds AND a performanceTest.
   */
  performanceTest?: FactorPerformanceTest;
  sourceReference?: SourceReference;
}

export interface FactorResult {
  factorId: string;
  companyId: string;
  /** null when the questions belonging to this Factor aren't fully classified/scored yet. */
  totalPoints: number | null;
  /** null whenever totalPoints is null — never guessed from a partial total. */
  failed: boolean | null;
  unavailableReason?: string;
  /**
   * Explicit, unmistakable completeness signal (Phase 2G addition).
   * Deliberately a SEPARATE field from `failed` rather than relying on
   * `failed === null` alone to carry this meaning — a careless consumer
   * doing truthy/falsy comparisons could otherwise conflate `null`
   * (unknown) and `false` (confidently not inadequate). true only when
   * every regulation in this Factor's required scope has a definitive
   * assessment (COMPLIANT/NONCOMPLIANT/NOT_APPLICABLE, never
   * REVIEW_REQUIRED or simply unassessed). "Zero established violations
   * found" and "zero violations found because scope is incomplete" must
   * never look the same to a caller checking this field.
   */
  assessmentScopeComplete?: boolean;
  calculatedAt: string;
  methodologyVersion?: string;
}

export interface FactorMethodologyResult {
  regimeId: string;
  companyId: string;
  /** Points-based Factors only (e.g. FMCSA Factors 1-5). */
  factorResults: FactorResult[];
  /**
   * A performance-only Factor's result (Phase 2F addition — e.g. FMCSA
   * Factor 6, accident rate), kept structurally separate from
   * factorResults because it is never points-based and must not be forced
   * into the FactorResult shape.
   */
  factorSixResult?: FactorPerformanceResult;
  /** null when any underlying FactorResult (or factorSixResult) is itself null/undetermined. */
  failedFactorCount: number | null;
  overallResult: "FAIL" | "PASS" | "UNDETERMINED";
  unavailableReason?: string;
  methodologyVersion?: string;
  calculatedAt: string;
}

// ---------------------------------------------------------------------------
// THREE-OUTPUT CONTRACT (Phase 2C addition)
// ---------------------------------------------------------------------------
// auditPreparedness, factorMethodologyResult, and automaticFailureGateStatus
// are structurally independent fields, each computed by its own unrelated
// function (see lib/audit-preparedness-engine.ts). None is derived from or
// capable of overriding another — a high auditPreparedness.percentage can
// never suppress, hide, or visually cancel a TRIGGERED gate, because
// nothing in this type or its construction lets one field read another.

export type AutomaticFailureGateStatus = "NO_GATES_TRIGGERED" | "GATE_TRIGGERED" | "UNDETERMINED";

export interface AuditOutcomeOutput {
  regimeId: string;
  companyId: string;
  auditPreparedness: AuditPreparedness;
  factorMethodologyResult: FactorMethodologyResult;
  automaticFailureGateStatus: AutomaticFailureGateStatus;
  triggeredGates: GateRuleEvaluation[];
  undeterminedGates: GateRuleEvaluation[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// AUDIT CAPABILITY (Phase 2D addition) — reusable domain/audit function
// ---------------------------------------------------------------------------
// A Capability is a reusable domain function (e.g. VEHICLE_INSPECTION,
// HOS_RECORD_REVIEW) that multiple audit regimes can compose. It is NOT a
// regulatory requirement itself and carries no methodology, weight, or
// evidence obligation of its own — those stay on each regime's own
// Requirement (see Requirement.capabilityIds above). A capability exists
// in this codebase only once at least one already-implemented Requirement
// actually uses it (see lib/audit-capabilities.ts for the traceable list).

export interface AuditCapability {
  id: string;
  name: string;
  description: string;
  /** Broad domain grouping, e.g. "driver", "vehicle", "hos", "safety", "carrier". Not a regime's own SubjectArea. */
  domain: string;
  version?: string;
  sourceReference?: SourceReference;
}

// ---------------------------------------------------------------------------
// NOT-YET-CONFIGURED REGIME REPORT (Phase 2D addition)
// ---------------------------------------------------------------------------
// The honest fallback for a regime whose evidence domains/capabilities TES
// recognizes but whose regulatory methodology isn't encoded yet. Never
// carries a percentage, pass/fail, or outcome — only recognition/gap
// reporting, per RegimeMethodologyConfigurationStatus.

export interface UnconfiguredRegimeReport {
  regimeId: string;
  companyId: string;
  methodologyConfigurationStatus: RegimeMethodologyConfigurationStatus;
  recognizedCapabilityIds: string[];
  availableEvidenceRelationshipIds: string[];
  missingRequestedEvidenceRequirementIds: string[];
  unmappedRequirementIds: string[];
  reviewRequired: boolean;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// POPULATION ADEQUACY (Phase 3B addition)
// ---------------------------------------------------------------------------
// Answers "do we know the eligible universe this audit test/sample must be
// evaluated against?" — never "did the carrier comply?". Kept structurally
// separate from RequirementAssessment: a Requirement's own state is derived
// from this result (see buildRequirementAssessment,
// lib/audit-preparedness-engine.ts), never computed a second, possibly-
// divergent way inline.
//
// No existing type already represents this tri-state — Population.isIncomplete
// is a boolean with no UNDETERMINED ("no Population record exists yet")
// state, so this is additive, not a duplicate of something already present.

export type PopulationAdequacyState = "COMPLETE" | "INCOMPLETE" | "UNDETERMINED";

export interface PopulationAdequacyResult {
  populationRuleId: string;
  mode: PopulationMode;
  scopeEntityType: EntityType;
  /** The determined population's own id, when one exists. Absent when no Population record has been assembled yet. */
  populationId?: string;
  /** Known population size (memberEntityIds.length), or null when not yet determined. */
  populationSize: number | null;
  state: PopulationAdequacyState;
  reason: string;
  sourceReference?: SourceReference;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// SAMPLE ADEQUACY (Phase 3B addition)
// ---------------------------------------------------------------------------
// Distinct from PopulationAdequacy: a sample can only be judged ADEQUATE
// against a population already known to be COMPLETE. An INCOMPLETE or
// UNDETERMINED population adequacy must never let a nominally-sufficient
// sample count resolve to ADEQUATE — see evaluateSampleAdequacy
// (lib/audit-preparedness-engine.ts), which is the only function permitted
// to set this state.

export type SampleAdequacyState = "ADEQUATE" | "INADEQUATE" | "UNDETERMINED" | "NOT_APPLICABLE";

export interface SampleAdequacyResult {
  populationRuleId: string;
  /** The population-adequacy input this result was evaluated against — preserved for traceability, never recomputed independently. */
  populationAdequacy: PopulationAdequacyResult;
  /** Null when no sampleSizeTiers exist on the rule (e.g. DVIR) — see NOT_APPLICABLE below. */
  requiredEntitySampleSize: number | null;
  requiredRecordSampleSize?: number | null;
  actualEntitySampleSize: number | null;
  actualRecordSampleSize?: number | null;
  state: SampleAdequacyState;
  reason: string;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// REQUIRED-EVENT-DAY ADEQUACY (Phase 3B addition)
// ---------------------------------------------------------------------------
// A separate, deliberately NOT tier-based result shape for regimes whose
// sample-adequacy question is "was a required record prepared for each
// qualifying day" (e.g. FMCSA DVIR via RequiredEventDayComparison) rather
// than "was a minimum entity count sampled from a population." Reuses
// SampleAdequacyState (the same ADEQUATE/INADEQUATE/UNDETERMINED/
// NOT_APPLICABLE vocabulary) rather than inventing a parallel one, but does
// not force this shape into SampleAdequacyResult's population-tier fields,
// which do not apply to a day/record comparison.

export interface RequiredEventDayAdequacyResult {
  requirementId: string;
  state: SampleAdequacyState;
  requiredDayCount: number | null;
  recordsPresentCount: number | null;
  missingRecordCount: number | null;
  reason: string;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// EVIDENCE VALIDITY FOR A TEST PERIOD (Phase 3B addition)
// ---------------------------------------------------------------------------
// Minimal additive representation of "expired today vs. valid during the
// audited/tested period" (Phase 3A gap). Deliberately does NOT modify
// EvidenceRecord (types/evidence.ts) or EvidenceAssessment — this is an
// audit-assessment-time CONTEXT a caller supplies when it independently
// knows an evidence item's effective/expiration dates (e.g. from the
// domain record the evidence relates to), never a field fabricated here.
// When those dates aren't available, the evaluator returns UNDETERMINED
// rather than assuming either validity or invalidity.

export interface EvidencePeriodValidityContext {
  /** When this assessment is being performed. Defaults to "now" if omitted by the evaluator. */
  assessmentAsOf?: string;
  /** Start of the audit/test period this evidence is being evaluated against, when the assessment concerns a historical period rather than current-state. */
  testPeriodStart?: string;
  /** End of the audit/test period. */
  testPeriodEnd?: string;
}

export interface EvidencePeriodValidityInput {
  currentState: AuditEvidenceAssessmentState;
  /** Known validity start date for this evidence item, from its own domain record — never invented. */
  validFrom?: string;
  /** Known expiration date for this evidence item, from its own domain record — never invented. */
  validUntil?: string;
}

export type EvidencePeriodValidityResult = "VALID_NOW" | "VALID_FOR_PERIOD" | "INVALID_FOR_PERIOD" | "UNDETERMINED";

export interface EvidencePeriodValidityEvaluation {
  result: EvidencePeriodValidityResult;
  reason: string;
}

// ---------------------------------------------------------------------------
// REQUIREMENT ASSESSMENT BUILDER — INPUT SHAPES (Phase 3B addition)
// ---------------------------------------------------------------------------
// Reuses RequirementAssessment (defined above, Phase 1) as its output type —
// no FMCSA-specific or regime-specific duplicate is created. These input
// shapes exist only to describe what buildRequirementAssessment
// (lib/audit-preparedness-engine.ts) accepts; they carry no calculation
// logic of their own.

export interface RequirementAssessmentEvidenceRelationshipInput {
  relationship: EvidenceRelationship;
  /** Null when no EvidenceAssessment has been recorded yet for this relationship — distinct from an assessment that exists and states MISSING. */
  assessment: EvidenceAssessment | null;
  /**
   * Only meaningful when assessment.state is "EXPIRED" — the result of
   * separately evaluating this evidence item's validity against the
   * relevant test period (see EvidencePeriodValidityResult above). Absent
   * when no period-validity evaluation was performed, in which case an
   * EXPIRED item cannot be treated as valid-for-period and cannot be
   * confidently rejected either — see buildRequirementAssessment's
   * documented treatment of this case.
   */
  periodValidity?: EvidencePeriodValidityResult;
}

export interface RequirementAssessmentEvidenceInput {
  evidenceRequirementId: string;
  necessity: "required" | "conditional";
  relationships: RequirementAssessmentEvidenceRelationshipInput[];
}

export interface RequirementAssessmentBuildInput {
  requirement: Requirement;
  entityType?: EntityType;
  entityId?: string;
  applicability: ApplicabilityEvaluationResult;
  applicabilityReason?: string;
  /** One entry per EvidenceRequirement belonging to this Requirement that the caller has information about. A requirement with no evidence requirements at all supplies an empty array. */
  evidenceInputs: RequirementAssessmentEvidenceInput[];
  populationId?: string;
  /** Supplied only when this Requirement's population/sample was actually evaluated (see evaluatePopulationAdequacy/evaluateSampleAdequacy) — never computed inline by the builder itself. */
  populationAdequacy?: PopulationAdequacyResult;
  sampleAdequacy?: SampleAdequacyResult;
  /**
   * RegulatoryAssessments already filtered by the caller to the ones
   * relevant to this Requirement (e.g. via AuditQuestion.requirementId) —
   * the builder does not itself resolve which AuditQuestions belong to
   * which Requirement, since that mapping is regime-specific catalog data.
   */
  regulatoryAssessments?: RegulatoryAssessment[];
  methodologyVersion?: string;
  assessedAt?: string;
}

// ---------------------------------------------------------------------------
// PREPAREDNESS + COVERAGE (Phase 3C addition)
// ---------------------------------------------------------------------------
// Two deliberately separate measurements, both derived only from
// RequirementAssessment.state (never from document counts, EvidenceRequirement
// counts, Acute/Critical points, or Factor totals). See
// calculatePreparednessAndCoverage (lib/audit-preparedness-engine.ts) — the
// only function permitted to produce this result. Kept as an entirely
// separate type from AuditPreparedness (Phase 1) rather than reshaping that
// type: AuditPreparedness.percentage is a single field already consumed by
// AuditPreparednessUIOutput and RegimeCalculationMethod.calculatePreparedness
// elsewhere in this file, and forcing two percentages plus a full breakdown
// into that one field would break those existing contracts. This type does
// not replace AuditPreparedness; a regime may still return an
// AuditPreparedness via the pre-existing path if it never needs Coverage.

export interface PreparednessCoverageBreakdown {
  satisfiedRequirementIds: string[];
  unsatisfiedRequirementIds: string[];
  undeterminedRequirementIds: string[];
  partiallySatisfiedRequirementIds: string[];
  notApplicableRequirementIds: string[];
}

export interface PreparednessCoverageResult {
  regimeId: string;
  companyId: string;
  /** Which population mode this result was computed against — never presented as the auditor's actual selected sample when this is PRE_AUDIT_ELIGIBLE_POPULATION. */
  mode?: PopulationMode;
  /**
   * (S / R) * 100 where R = S + U, or null when R = 0. null means "no
   * resolved applicable scope exists yet to calculate from" — never
   * conflated with 0, which means "resolved scope exists and none of it
   * is satisfied."
   */
  preparednessPercentage: number | null;
  /** (R / A) * 100 where A = S + U + D + P, or null when A = 0 (e.g. every requirement is NOT_APPLICABLE, or no assessments were supplied at all). */
  coveragePercentage: number | null;
  /** Every RequirementAssessment considered, including NOT_APPLICABLE ones. */
  totalAssessmentCount: number;
  /** A = S + U + D + P (excludes NOT_APPLICABLE). */
  applicableAssessmentCount: number;
  /** R = S + U. */
  resolvedApplicableCount: number;
  satisfiedCount: number;
  unsatisfiedCount: number;
  undeterminedCount: number;
  partiallySatisfiedCount: number;
  notApplicableCount: number;
  /** Always S, even when preparednessPercentage is null (R = 0) — never hidden. */
  preparednessNumerator: number;
  /** Always R, even when 0. */
  preparednessDenominator: number;
  /** Always R. */
  coverageNumerator: number;
  /** Always A, even when 0. */
  coverageDenominator: number;
  breakdown: PreparednessCoverageBreakdown;
  /** TES's own preparedness-methodology version (see TES_PREPAREDNESS_METHODOLOGY_VERSION) — never an FMCSA regulatory version. */
  methodologyVersion: string;
  calculatedAt: string;
  /** Set whenever either percentage is null, explaining which case applies (no resolved scope vs. no applicable scope at all). */
  unavailableReason?: string;
}
