/**
 * FMCSA New Entrant Safety Audit — Phase 3E canonical fact resolution +
 * conditional applicability evaluation.
 *
 * Governing rule (Phase 3E section 3, "Zero-Silent-Guessing"): UNKNOWN must
 * never collapse into FALSE. Every function in this file that resolves a
 * three-valued fact ("TRUE" | "FALSE" | "UNDETERMINED") treats a missing,
 * absent, or "not yet configured" input as UNDETERMINED — never as FALSE,
 * and never by relying on a JavaScript falsy/default value standing in for
 * "the condition does not exist."
 *
 * SCOPE: this phase resolves exactly ONE ApplicabilityRule end-to-end
 * (HM Shipping Papers' hmOperation fact) — the only one of the regime's 9
 * ApplicabilityRule instances found to have both (a) a genuine canonical
 * fact source and (b) no multi-rule combination ambiguity. See the Phase
 * 3E report's Rule -> Fact Contract Matrix for why every other rule was
 * left UNRESOLVABLE this phase, including why Medical Certificate's own
 * two rules are NOT combined here despite one of them being individually
 * resolvable (Section 13 — combination semantics are not uniform between
 * the two rules, so neither is used to move the Requirement's overall
 * applicability).
 */

import type { ApplicabilityEvaluationResult } from "../../types/audit-preparedness";
import type { DriverMaster, LicenceRecord } from "../../types/drivers";
import { FMCSA_NEW_ENTRANT_REQUIREMENTS } from "./fmcsa-new-entrant";
import { buildRequirementAssessment } from "../audit-preparedness-engine";
import type { RequirementAssessment } from "../../types/audit-preparedness";

// ---------------------------------------------------------------------------
// THREE-VALUED FACT PRIMITIVE
// ---------------------------------------------------------------------------
export type ThreeValuedFact = "TRUE" | "FALSE" | "UNDETERMINED";

export interface ResolvedFact {
  result: ThreeValuedFact;
  reason: string;
}

// ---------------------------------------------------------------------------
// hmOperation FACT (HM Shipping Papers ApplicabilityRule,
// fmcsa-new-entrant.ts:848-853) — COMPANY FACT, real canonical source found
// ---------------------------------------------------------------------------
// Source: app/companies/[id]/settings/page.tsx:34,53-70,436-439. That page
// defines a company-level compliance-settings record
// (localStorage key `tes_company_compliance_settings_${companyId}`,
// STORAGE_PREFIX at line 51) with `rules: Record<string, RuleValue>` where
// RuleValue = "applies" | "does-not-apply" | "not-configured" (line 34) —
// already a three-valued vocabulary, not something invented here. The two
// relevant rule ids are "dg_canada" (line 56, defaultValue "applies") and
// "dg_us" (line 64, defaultValue "applies"): "Generate dangerous-goods/
// hazardous-material compliance requirements" for that jurisdiction. This
// is a genuine, user-affirmable, company-level fact about whether the
// carrier's compliance program treats HM/dangerous-goods requirements as
// applicable — not a proxy invented by the audit layer.
//
// This type lives in a page component file, not a shared canonical types
// module — an architecture-hygiene gap (same class of finding as the
// Insurance re-inspection, section 22 of the Phase 3E report). This file
// does not import from that page (avoiding a fragile cross-page runtime
// import); it defines its own copy of the RuleValue contract, cited above,
// and requires the caller to supply the actual stored values.
export type CompanyComplianceRuleValue = "applies" | "does-not-apply" | "not-configured";

/**
 * Three-valued OR: hazmat/dangerous-goods operations exist if EITHER
 * jurisdiction's rule is affirmatively "applies" — that dominates even if
 * the other jurisdiction's rule is unconfigured, because a confirmed "yes"
 * in one jurisdiction is sufficient to make hmOperation true regardless of
 * the other. Only resolves FALSE when BOTH are explicitly
 * "does-not-apply". Anything else (either side "not-configured", or the
 * whole settings record absent/undefined) is UNDETERMINED — never
 * defaulted to FALSE merely because a value is missing.
 */
export function resolveHmOperationFact(
  dgCanada: CompanyComplianceRuleValue | undefined,
  dgUs: CompanyComplianceRuleValue | undefined
): ResolvedFact {
  if (dgCanada === "applies" || dgUs === "applies") {
    return {
      result: "TRUE",
      reason: `Company compliance settings confirm hazardous-materials/dangerous-goods operations apply (dg_canada=${dgCanada ?? "unset"}, dg_us=${dgUs ?? "unset"}).`,
    };
  }
  if (dgCanada === "does-not-apply" && dgUs === "does-not-apply") {
    return {
      result: "FALSE",
      reason: "Company compliance settings explicitly state dangerous-goods/hazardous-materials rules do not apply in either jurisdiction (dg_canada=does-not-apply, dg_us=does-not-apply).",
    };
  }
  return {
    result: "UNDETERMINED",
    reason: `Company compliance settings for hazardous-materials/dangerous-goods are not conclusively configured (dg_canada=${dgCanada ?? "unset"}, dg_us=${dgUs ?? "unset"}) — hazmat operation status cannot be established from this fact source.`,
  };
}

export function evaluateHmShippingPapersApplicability(hmFact: ResolvedFact): { result: ApplicabilityEvaluationResult; reason: string } {
  if (hmFact.result === "TRUE") return { result: "APPLICABLE", reason: `HM Shipping Papers requirement applies: ${hmFact.reason}` };
  if (hmFact.result === "FALSE") return { result: "NOT_APPLICABLE", reason: `HM Shipping Papers requirement does not apply: ${hmFact.reason}` };
  return { result: "UNDETERMINED", reason: `HM Shipping Papers applicability cannot be resolved: ${hmFact.reason}` };
}

const HM_SHIPPING_PAPERS_REQUIREMENT_ID = "fmcsa-ne-hm-shipping-papers";

/**
 * Produces the RequirementAssessment for HM Shipping Papers using ONLY
 * resolved applicability — no evidence wiring is attempted this phase
 * (Phase 3E section 27: this phase targets the applicability bottleneck,
 * not evidence expansion). An APPLICABLE result does not fall through to
 * SATISFIED merely because no EvidenceRelationship was supplied — that
 * would misrepresent "evidence not yet assessed" as "confirmed complete."
 * It is explicitly returned as UNDETERMINED with a reason that keeps
 * "applicability is resolved" and "evidence is unassessed" distinguishable
 * from each other, never conflated.
 */
export function buildHmShippingPapersRequirementAssessment(
  input: { dgCanada: CompanyComplianceRuleValue | undefined; dgUs: CompanyComplianceRuleValue | undefined },
  assessedAt: string
): RequirementAssessment {
  const requirement = FMCSA_NEW_ENTRANT_REQUIREMENTS.find((r) => r.id === HM_SHIPPING_PAPERS_REQUIREMENT_ID)!;
  const hmFact = resolveHmOperationFact(input.dgCanada, input.dgUs);
  const applicability = evaluateHmShippingPapersApplicability(hmFact);

  if (applicability.result !== "APPLICABLE") {
    return buildRequirementAssessment(`ra-${HM_SHIPPING_PAPERS_REQUIREMENT_ID}`, {
      requirement,
      applicability: applicability.result,
      applicabilityReason: applicability.reason,
      evidenceInputs: [],
    });
  }

  return {
    id: `ra-${HM_SHIPPING_PAPERS_REQUIREMENT_ID}`,
    requirementId: requirement.id,
    state: "UNDETERMINED",
    reasons: [
      `Applicability resolved to APPLICABLE: ${applicability.reason}`,
      "No production evidence wiring exists yet for HM Shipping Papers (Phase 3E scope is applicability resolution only) — evidence assessment has not been performed, which is a distinct condition from applicability itself being uncertain.",
    ],
    evidenceRelationshipIds: [],
    assessedAt,
    assessmentMethod: requirement.assessmentMethod,
    reviewRequired: true,
  };
}

// ---------------------------------------------------------------------------
// MEDICAL CERTIFICATE — ONE resolvable fact, deliberately NOT used to
// resolve the Requirement's overall applicability (Section 13 STOP)
// ---------------------------------------------------------------------------
// fmcsa-new-entrant.ts:836-841 (farm/beekeeper exception, needs
// driverExceptionCategory — no canonical field found anywhere in
// types/drivers.ts; confirmed by repository-wide search, Phase 3E report
// section 4) and fmcsa-new-entrant.ts:842-847 (Canadian Class 5/Ontario
// Class G needing additional evidence, needs driverLicenseJurisdictionClass)
// are semantically DIFFERENT kinds of rule: the first is a genuine
// applicability exclusion (exempt drivers need no medical certificate at
// all); the second is not actually an applicability exclusion — it is a
// "which evidence form satisfies this already-applicable requirement"
// rule, modeled as an ApplicabilityRule in Phase 2B.1 without a matching
// consumption code path. Combining a real exclusion rule with a
// mis-modeled evidence-form rule via AND/OR would produce a fabricated
// combination the regime definition never specifies (Phase 3E section 13:
// "If rule-combination semantics are not encoded sufficiently to make the
// decision safely: STOP for that Requirement and report the ambiguity").
// This function resolves the SECOND rule's own fact only, for a future
// phase's evidence-form disambiguation use — it must NOT be wired into
// Medical Certificate's Requirement-level applicability.
export function resolveDriverLicenseJurisdictionClassFact(licence: LicenceRecord | undefined): ResolvedFact {
  if (!licence) {
    return { result: "UNDETERMINED", reason: "No current licence record is available to determine jurisdiction/class." };
  }
  return {
    result: "TRUE",
    reason: `Driver's current licence: jurisdiction=${licence.jurisdiction}, class=${licence.class ?? "unset"}.`,
  };
}

/** Selects the current (non-superseded) licence record — same selection rule as lib/driver-data.ts:513 (`currentLicence`), duplicated here rather than importing that module to avoid pulling in its localStorage-touching exports. */
export function currentLicenceRecord(driver: DriverMaster): LicenceRecord | undefined {
  return [...driver.licenceHistory].filter((x) => !x.effectiveTo).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

// ---------------------------------------------------------------------------
// SCENARIO J DEMONSTRATION — a real ambiguous optional-boolean field found
// in this repository (VEHICLE FACT), NOT used in production wiring
// ---------------------------------------------------------------------------
// src/components/vehicles/settings/SettingsTab.tsx:13-41: `VehicleSettings`
// has `carriesHazmat: boolean`, and `defaultVehicleSettings()` (line 31-41)
// always sets `carriesHazmat: false` when no stored settings exist yet
// (`loadVehicleSettings`, line 43-55: `raw ? {...} : defaultVehicleSettings()`).
// This means that module's own accessor makes "vehicle settings never
// configured" and "carrier explicitly confirmed this vehicle does not
// carry hazmat" indistinguishable to any caller of loadVehicleSettings —
// exactly the trap Phase 3E section 3/28A warns about. This file does NOT
// consume that lossy accessor for hmOperation (it uses the company-level
// three-valued rule above instead, which does not have this problem). This
// function exists only to prove, against that real field, that a correctly
// built evaluator keeps "record present, value false" and "record absent"
// distinguishable — it is never called by buildFmcsaNewEntrantRequirementAssessments.
export function resolveVehicleHazmatSettingFact(settingsRecordFound: boolean, carriesHazmat: boolean | undefined): ResolvedFact {
  if (!settingsRecordFound) {
    return {
      result: "UNDETERMINED",
      reason: "No VehicleSettings record has ever been saved for this vehicle — carriesHazmat cannot be read as a real answer, only as that module's own default placeholder.",
    };
  }
  if (carriesHazmat === undefined) {
    return { result: "UNDETERMINED", reason: "VehicleSettings record exists but carriesHazmat is not set." };
  }
  return carriesHazmat
    ? { result: "TRUE", reason: "VehicleSettings record explicitly confirms carriesHazmat=true." }
    : { result: "FALSE", reason: "VehicleSettings record explicitly confirms carriesHazmat=false (a real saved answer, not a default)." };
}

// ---------------------------------------------------------------------------
// REGIME-LEVEL APPLICABILITY — refined finding, behavior unchanged
// ---------------------------------------------------------------------------
// Phase 3D's evaluateFmcsaNewEntrantRegimeApplicability (unchanged this
// phase — see fmcsa-new-entrant-production-mapping.ts) always returns
// UNDETERMINED. Phase 3E re-inspected for a canonical New Entrant/authority
// date source and found one candidate that Phase 3D did not have:
// app/companies/[id]/authorities/page.tsx:157-188 `AuthorityRecord` has
// optional `issueDate`/`effectiveDate` fields, generic across
// `AuthorityType` (which includes a USDOT authority type — confirmed at
// that file's authority-type handling, e.g. line 749-800). This means the
// MINIMUM fact TES would need — when a carrier's USDOT operating authority
// became effective — has a plausible future home. It does NOT resolve
// regime-level applicability today, for two independent reasons: (1) the
// field is optional and not populated in any fixture/seed data found this
// phase, and (2) even if populated, computing "is this carrier within its
// New Entrant window" requires a regulatory window-length constant (the
// real FMCSA rule is 18 months from new operating authority) that is not
// established anywhere in this codebase's own FMCSA New Entrant source
// material (lib/audit-regimes/fmcsa-new-entrant.ts's closed list of 11
// source-explicit categories does not include this figure) — inventing
// that number here would violate section 35's "regulatory interpretation
// would need to be invented" prohibition. This finding refines, but does
// not change, Phase 3D's UNDETERMINED conclusion.
export const NEW_ENTRANT_REGIME_APPLICABILITY_MINIMUM_FACT_REQUIREMENT =
  "AuthorityRecord.effectiveDate (or issueDate) for the carrier's USDOT authority record, populated, PLUS a source-confirmed New-Entrant-window duration added to this regime's own constants — neither exists in this codebase today.";
