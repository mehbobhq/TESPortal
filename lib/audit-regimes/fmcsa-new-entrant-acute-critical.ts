/**
 * FMCSA New Entrant Safety Audit — Phase 2F.1 Acute/Critical Regulatory
 * Dataset.
 *
 * SOURCE: 49 CFR Part 385 Appendix B, VII — List of Acute and Critical
 * Regulations, as supplied by the TES operator via
 * TES_FMCSA_Appendix_B_VII_Source_Package.md (Phase 2F.1). This codebase
 * has not independently retrieved the eCFR text; before production use,
 * citations/classifications must be rechecked against the current eCFR
 * per that source package's own item 8.
 *
 * WHY THIS DATASET IS REUSED HERE: 49 CFR Part 385 Appendix A directs the
 * New Entrant Safety Audit methodology to this same Acute/Critical list
 * for determining whether a carrier has basic safety management controls.
 * Only the CLASSIFICATION dataset (citation + ACUTE/CRITICAL + Part) is
 * reused — Appendix B's own separate Compliance Review / Safety Rating
 * scoring mechanics (its 1-point general Acute rule, 10% Critical-pattern
 * rule, Part 395 2-point Critical-pattern rule, and Satisfactory/
 * Conditional/Unsatisfactory factor ratings) are NOT imported anywhere in
 * this file or elsewhere in the New Entrant path. New Entrant continues
 * using Appendix A's own arithmetic (Acute=1.5, Critical=1, Factor
 * inadequate at >=3 points) — see FMCSA_ACUTE_QUESTION_POINTS /
 * FMCSA_CRITICAL_QUESTION_POINTS / FMCSA_FACTOR_FAIL_POINTS_THRESHOLD in
 * fmcsa-new-entrant-outcome-methodology.ts, unchanged by this file.
 *
 * DESCRIPTIONS: per the source package's own instruction, this dataset
 * intentionally carries citation + classification as the controlling
 * data; no regulatory description text is included here (Option B — the
 * AuditQuestion type's description-equivalent fields are simply omitted
 * rather than reconstructed from model memory of what the cited section
 * says).
 *
 * DISTINCT CONCEPTS: each entry below is a regulatory DEFINITION (a
 * citation + its classification), not a carrier-specific finding. No
 * carrier-specific violation/instance data is created anywhere in this
 * file — see RegulatoryFinding (types/audit-preparedness.ts) for the
 * separate, carrier-specific type, and evaluateRegulatoryFinding
 * (lib/audit-preparedness-engine.ts) for how a finding would be derived
 * from this definition plus a knowledge-element determination, once real
 * carrier data exists.
 *
 * FACTOR.QUESTIONIDS IS DELIBERATELY LEFT EMPTY for Factors 1-5 (see
 * fmcsa-new-entrant-outcome-methodology.ts) even though this 110-item
 * catalog now exists: Factor.questionIds feeding directly into
 * calculateFactorMethodologyResult would sum EVERY regulation's points
 * unconditionally, which would incorrectly instant-fail every carrier
 * regardless of whether any regulation was ever actually violated.
 * Appendix A's arithmetic is "each INSTANCE of noncompliance" — i.e. only
 * regulations with an actual RegulatoryFinding (violationEstablished ===
 * true) for a specific carrier should ever be summed. Wiring that
 * carrier-specific filtering is a later task, once real findings exist;
 * doing it now would require fabricating carrier data, which this phase
 * does not do.
 */

import { FMCSA_NEW_ENTRANT_REGIME_ID } from "./fmcsa-new-entrant-ids";
import type { AuditQuestion, AuditQuestionClassification, SourceReference } from "../../types/audit-preparedness";

export const SOURCE_385_APPENDIX_B_VII: SourceReference = {
  description:
    "49 CFR Part 385 Appendix B, VII — List of Acute and Critical Regulations. Supplied directly by the TES operator via TES_FMCSA_Appendix_B_VII_Source_Package.md (Phase 2F.1). This codebase has not independently retrieved the eCFR text; citations/classifications must be rechecked against the current eCFR before production use per that source package's own instruction. Reused here only for its classification dataset — Appendix B's own Compliance Review/Safety Rating scoring methodology is not imported into this New Entrant path.",
  citation: "49 CFR Part 385 Appendix B, VII",
  retrievedAt: "2026-09-19",
  provenanceTag: "SOURCE_EXPLICIT",
};

/** Deterministic Factor-id mapping, exactly as stated in the source package. Part 393 has no listed rows in this dataset (not an omission — the source simply lists none). */
const FACTOR_BY_PART: Record<string, string> = {
  "387": "fmcsa-ne-factor-1-general",
  "390": "fmcsa-ne-factor-1-general",
  "382": "fmcsa-ne-factor-2-driver",
  "383": "fmcsa-ne-factor-2-driver",
  "391": "fmcsa-ne-factor-2-driver",
  "392": "fmcsa-ne-factor-3-operational",
  "395": "fmcsa-ne-factor-3-operational",
  "393": "fmcsa-ne-factor-4-vehicle",
  "396": "fmcsa-ne-factor-4-vehicle",
  "171": "fmcsa-ne-factor-5-hazmat",
  "172": "fmcsa-ne-factor-5-hazmat", // source nuance: Appendix B VII itself lists Part 172 — preserved, not discarded
  "173": "fmcsa-ne-factor-5-hazmat", // source nuance: Appendix B VII itself lists Part 173 — preserved, not discarded
  "177": "fmcsa-ne-factor-5-hazmat",
  "180": "fmcsa-ne-factor-5-hazmat",
  "397": "fmcsa-ne-factor-5-hazmat",
};

/** The 7 citations the source package's Knowledge-Element Isolation Set explicitly names. See RegulatoryFinding/evaluateRegulatoryFinding for how this is honored at assessment time. */
const KNOWLEDGE_ELEMENT_CITATIONS = new Set<string>([
  "§ 382.201",
  "§ 382.213(c)",
  "§ 382.215",
  "§ 383.37(a)",
  "§ 383.37(b)",
  "§ 383.37(c)",
  "§ 383.51(a)",
]);

/** [id-suffix, citation, classification, regulatoryPart] — one row per source-package table row, in source order, including all three distinct §172.800(b) rows. */
const RAW_ROWS: Array<[string, string, AuditQuestionClassification, string]> = [
  ["382-115-a", "§ 382.115(a)", "ACUTE", "382"],
  ["382-115-b", "§ 382.115(b)", "ACUTE", "382"],
  ["382-201", "§ 382.201", "ACUTE", "382"],
  ["382-211", "§ 382.211", "ACUTE", "382"],
  ["382-213-c", "§ 382.213(c)", "ACUTE", "382"],
  ["382-215", "§ 382.215", "ACUTE", "382"],
  ["382-301-a", "§ 382.301(a)", "CRITICAL", "382"],
  ["382-303-a", "§ 382.303(a)", "CRITICAL", "382"],
  ["382-303-b", "§ 382.303(b)", "CRITICAL", "382"],
  ["382-305-a", "§ 382.305(a)", "ACUTE", "382"],
  ["382-305-b-1", "§ 382.305(b)(1)", "CRITICAL", "382"],
  ["382-305-b-2", "§ 382.305(b)(2)", "CRITICAL", "382"],
  ["382-309", "§ 382.309", "ACUTE", "382"],
  ["382-503", "§ 382.503", "CRITICAL", "382"],
  ["382-505-a", "§ 382.505(a)", "ACUTE", "382"],
  ["382-605", "§ 382.605", "CRITICAL", "382"],
  ["383-23-a", "§ 383.23(a)", "CRITICAL", "383"],
  ["383-37-a", "§ 383.37(a)", "ACUTE", "383"],
  ["383-37-b", "§ 383.37(b)", "ACUTE", "383"],
  ["383-37-c", "§ 383.37(c)", "ACUTE", "383"],
  ["383-51-a", "§ 383.51(a)", "ACUTE", "383"],
  ["387-7-a", "§ 387.7(a)", "ACUTE", "387"],
  ["387-7-d", "§ 387.7(d)", "CRITICAL", "387"],
  ["387-31-a", "§ 387.31(a)", "ACUTE", "387"],
  ["387-31-d", "§ 387.31(d)", "CRITICAL", "387"],
  ["390-15-b-2", "§ 390.15(b)(2)", "CRITICAL", "390"],
  ["390-35", "§ 390.35", "ACUTE", "390"],
  ["391-11-b-4", "§ 391.11(b)(4)", "ACUTE", "391"],
  ["391-15-a", "§ 391.15(a)", "ACUTE", "391"],
  ["391-45-a", "§ 391.45(a)", "CRITICAL", "391"],
  ["391-45-b", "§ 391.45(b)", "CRITICAL", "391"],
  ["391-51-a", "§ 391.51(a)", "CRITICAL", "391"],
  ["391-51-b-2", "§ 391.51(b)(2)", "CRITICAL", "391"],
  ["391-51-b-6", "§ 391.51(b)(6)", "CRITICAL", "391"],
  ["392-2", "§ 392.2", "CRITICAL", "392"],
  ["392-4-b", "§ 392.4(b)", "ACUTE", "392"],
  ["392-5-b-1", "§ 392.5(b)(1)", "ACUTE", "392"],
  ["392-5-b-2", "§ 392.5(b)(2)", "ACUTE", "392"],
  ["392-6", "§ 392.6", "CRITICAL", "392"],
  ["392-9-a-1", "§ 392.9(a)(1)", "CRITICAL", "392"],
  ["395-1-h-1-i-A", "§ 395.1(h)(1)(i)(A)", "CRITICAL", "395"],
  ["395-1-h-1-i-B", "§ 395.1(h)(1)(i)(B)", "CRITICAL", "395"],
  ["395-1-h-1-i-C", "§ 395.1(h)(1)(i)(C)", "CRITICAL", "395"],
  ["395-1-h-1-i-D", "§ 395.1(h)(1)(i)(D)", "CRITICAL", "395"],
  ["395-1-h-2-i", "§ 395.1(h)(2)(i)", "CRITICAL", "395"],
  ["395-1-h-2-ii", "§ 395.1(h)(2)(ii)", "CRITICAL", "395"],
  ["395-1-h-2-iii", "§ 395.1(h)(2)(iii)", "CRITICAL", "395"],
  ["395-1-h-2-iv", "§ 395.1(h)(2)(iv)", "CRITICAL", "395"],
  ["395-1-o", "§ 395.1(o)", "CRITICAL", "395"],
  ["395-3-a-1", "§ 395.3(a)(1)", "CRITICAL", "395"],
  ["395-3-a-2", "§ 395.3(a)(2)", "CRITICAL", "395"],
  ["395-3-a-3-i", "§ 395.3(a)(3)(i)", "CRITICAL", "395"],
  ["395-3-a-3-ii", "§ 395.3(a)(3)(ii)", "CRITICAL", "395"],
  ["395-3-b-1", "§ 395.3(b)(1)", "CRITICAL", "395"],
  ["395-3-b-2", "§ 395.3(b)(2)", "CRITICAL", "395"],
  ["395-5-a-1", "§ 395.5(a)(1)", "CRITICAL", "395"],
  ["395-5-a-2", "§ 395.5(a)(2)", "CRITICAL", "395"],
  ["395-5-b-1", "§ 395.5(b)(1)", "CRITICAL", "395"],
  ["395-5-b-2", "§ 395.5(b)(2)", "CRITICAL", "395"],
  ["395-8-a-1", "§ 395.8(a)(1)", "CRITICAL", "395"],
  ["395-8-a-2-ii", "§ 395.8(a)(2)(ii)", "CRITICAL", "395"],
  ["395-8-e-1", "§ 395.8(e)(1)", "CRITICAL", "395"],
  ["395-8-e-2-or-3", "§ 395.8(e)(2) or (3)", "ACUTE", "395"],
  ["395-8-k-1", "§ 395.8(k)(1)", "CRITICAL", "395"],
  ["395-11-b", "§ 395.11(b)", "CRITICAL", "395"],
  ["395-11-c", "§ 395.11(c)", "CRITICAL", "395"],
  ["395-11-e", "§ 395.11(e)", "CRITICAL", "395"],
  ["395-11-f", "§ 395.11(f)", "CRITICAL", "395"],
  ["395-30-f", "§ 395.30(f)", "ACUTE", "395"],
  ["396-3-b", "§ 396.3(b)", "CRITICAL", "396"],
  ["396-9-c-2", "§ 396.9(c)(2)", "ACUTE", "396"],
  ["396-11-a", "§ 396.11(a)", "CRITICAL", "396"],
  ["396-11-a-3", "§ 396.11(a)(3)", "ACUTE", "396"],
  ["396-17-a", "§ 396.17(a)", "CRITICAL", "396"],
  ["396-17-g", "§ 396.17(g)", "ACUTE", "396"],
  ["397-5-a", "§ 397.5(a)", "ACUTE", "397"],
  ["397-7-a-1", "§ 397.7(a)(1)", "CRITICAL", "397"],
  ["397-7-b", "§ 397.7(b)", "CRITICAL", "397"],
  ["397-13-a", "§ 397.13(a)", "CRITICAL", "397"],
  ["397-19-a", "§ 397.19(a)", "CRITICAL", "397"],
  ["397-67-d", "§ 397.67(d)", "CRITICAL", "397"],
  ["171-15", "§ 171.15", "CRITICAL", "171"],
  ["171-16", "§ 171.16", "CRITICAL", "171"],
  ["172-313-a", "§ 172.313(a)", "ACUTE", "172"],
  ["172-704-a-4", "§ 172.704(a)(4)", "CRITICAL", "172"],
  ["172-704-a-5", "§ 172.704(a)(5)", "CRITICAL", "172"],
  ["172-800-b-1", "§ 172.800(b) [1]", "ACUTE", "172"],
  ["172-800-b-2", "§ 172.800(b) [2]", "ACUTE", "172"],
  ["172-800-b-3", "§ 172.800(b) [3]", "ACUTE", "172"],
  ["173-24-b-1", "§ 173.24(b)(1)", "ACUTE", "173"],
  ["173-421", "§ 173.421", "ACUTE", "173"],
  ["173-431-a", "§ 173.431(a)", "ACUTE", "173"],
  ["173-431-b", "§ 173.431(b)", "ACUTE", "173"],
  ["173-441-a", "§ 173.441(a)", "ACUTE", "173"],
  ["173-442-b", "§ 173.442(b)", "ACUTE", "173"],
  ["173-443-a", "§ 173.443(a)", "ACUTE", "173"],
  ["177-800-c", "§ 177.800(c)", "CRITICAL", "177"],
  ["177-801", "§ 177.801", "ACUTE", "177"],
  ["177-835-a", "§ 177.835(a)", "ACUTE", "177"],
  ["177-835-c", "§ 177.835(c)", "ACUTE", "177"],
  ["177-835-j", "§ 177.835(j)", "ACUTE", "177"],
  ["177-817-a", "§ 177.817(a)", "CRITICAL", "177"],
  ["177-817-e", "§ 177.817(e)", "CRITICAL", "177"],
  ["177-823-a", "§ 177.823(a)", "CRITICAL", "177"],
  ["177-841-e", "§ 177.841(e)", "ACUTE", "177"],
  ["180-407-a", "§ 180.407(a)", "CRITICAL", "180"],
  ["180-407-c", "§ 180.407(c)", "CRITICAL", "180"],
  ["180-415", "§ 180.415", "CRITICAL", "180"],
  ["180-417-a-1", "§ 180.417(a)(1)", "CRITICAL", "180"],
  ["180-417-a-2", "§ 180.417(a)(2)", "CRITICAL", "180"],
];

export const FMCSA_ACUTE_CRITICAL_POINTS: Record<AuditQuestionClassification, number> = {
  ACUTE: 1.5,
  CRITICAL: 1,
  OTHER: 0,
  NON_SCORING: 0,
};

export const FMCSA_NE_ACUTE_CRITICAL_QUESTIONS: AuditQuestion[] = RAW_ROWS.map(([idSuffix, citation, classification, part]) => ({
  id: `fmcsa-ne-ac-${idSuffix}`,
  regimeId: FMCSA_NEW_ENTRANT_REGIME_ID,
  factorId: FACTOR_BY_PART[part],
  classification,
  points: FMCSA_ACUTE_CRITICAL_POINTS[classification],
  regulatoryReference: citation,
  regulatoryPart: part,
  requiresKnowledgeElement: KNOWLEDGE_ELEMENT_CITATIONS.has(citation) || undefined,
  sourceReference: SOURCE_385_APPENDIX_B_VII,
}));
