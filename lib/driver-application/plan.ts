import { CURRENT_CATALOGUE_VERSION, getCatalogue, STAGE_ORDER } from "./catalogue"
import type { Catalogue, CollectionGate, ConsentDef, FieldDef, HrItemDef, LegalSource, MatrixRule, RequirementDef, SectionDef, Stage } from "./catalogue/types"
import { sha256Canonical, sha256Text } from "./canonical"
import { evalCond } from "./conditions"
import { involvesCanada, involvesUS, type NormalizedScope, type RequirementsProfile } from "@/lib/driver-prospects/operating-scope"

/**
 * The plan resolver: turns (the driver's operating scope, the carrier's HR configuration, the collection stage) into ONE ApplicationPlan from the
 * single catalogue. There is no per-scenario form. The plan is resolved on the SERVER at invitation time, frozen with the invitation, hashed, and
 * is the only definition of the application the applicant ever sees. Applicability that depends on answers is evaluated later, against the same
 * frozen plan, so a given plan always means the same thing.
 */

export interface PlanContext {
  scopeKind: string
  involvesUS: boolean
  involvesCA: boolean
  cmv: "YES" | "NO" | "UNKNOWN"
  cdl: "YES" | "NO" | "UNKNOWN"
  psp: boolean
  hazmat: boolean
  passengerCarrying: boolean
  dotDrugAlcohol: boolean
  historyYears: 3 | 10
  carrierCountry: "US" | "CA" | null
  hrItems: string[]
  hrBackgroundScreening: boolean
  collectSsn: boolean
  stage: Stage
}

export interface PlanField extends FieldDef {
  resolvedStage: Stage
  collection: { enabled: boolean; disabledReason?: string }
}

export interface PlanConsent extends ConsentDef {
  textSha256: string
}

export interface RegulatoryReviewRequirement {
  id: string
  text: string
  legalSource: string[]
}

export interface ApplicationPlan {
  planFormat: 1
  catalogueVersion: string
  rulesVersion: string
  scopeRulesVersion: string
  collectionStage: Stage
  context: PlanContext
  sections: SectionDef[]
  fields: PlanField[]
  consents: PlanConsent[]
  requirements: RequirementDef[]
  regulatoryReviewRequirements: RegulatoryReviewRequirement[]
  limitations: string[]
  legalSources: Record<string, LegalSource>
}

export interface HrSelection {
  enabled: boolean
  /** Required for RESTRICTED items: the carrier acknowledges the restriction and that legal review applies. */
  acknowledgedRestriction?: boolean
}
export type HrSelections = Record<string, HrSelection>

const later = (a: Stage, b: Stage): Stage => (STAGE_ORDER[a] >= STAGE_ORDER[b] ? a : b)

/** The strictest rule across the countries the driver's operations involve, at a stage. Cross-border applies both countries' rules. */
export function hrRule(item: HrItemDef, involvesUSflag: boolean, involvesCAflag: boolean, stage: Stage): MatrixRule {
  const rules: MatrixRule[] = []
  if (involvesUSflag) rules.push(item.matrix.US[stage])
  if (involvesCAflag) rules.push(item.matrix.CA[stage])
  if (rules.length === 0) rules.push(item.matrix.US[stage], item.matrix.CA[stage])
  return rules.includes("PROHIBITED") ? "PROHIBITED" : rules.includes("RESTRICTED") ? "RESTRICTED" : "ALLOWED"
}

export interface HrValidationResult {
  ok: boolean
  /** Items that may be used. */
  enabled: string[]
  errors: Array<{ itemId: string; message: string }>
}

/** Checks a carrier's HR selections against the legal matrix. A PROHIBITED item can never be enabled; a RESTRICTED one needs an explicit acknowledgement. */
export function validateHrSelections(selections: HrSelections, scope: { involvesUS: boolean; involvesCA: boolean }, stage: Stage, catalogue: Catalogue = getCatalogue(CURRENT_CATALOGUE_VERSION)): HrValidationResult {
  const errors: HrValidationResult["errors"] = []
  const enabled: string[] = []
  const known = new Map(catalogue.hrItems.map((i) => [i.id, i]))
  for (const [id, sel] of Object.entries(selections)) {
    const item = known.get(id)
    if (!item) {
      errors.push({ itemId: id, message: "Unknown screening item." })
      continue
    }
    if (!sel.enabled) continue
    const rule = hrRule(item, scope.involvesUS, scope.involvesCA, stage)
    if (rule === "PROHIBITED") errors.push({ itemId: id, message: `${item.title} cannot be used for this operation at this stage.` })
    else if (rule === "RESTRICTED" && sel.acknowledgedRestriction !== true) errors.push({ itemId: id, message: `${item.title} is restricted for this operation at this stage: acknowledge the restriction and confirm legal review.` })
    else enabled.push(id)
  }
  return { ok: errors.length === 0, enabled: enabled.sort(), errors }
}

export interface ResolveInput {
  scope: NormalizedScope
  profile: RequirementsProfile
  carrierCountry: "US" | "CA" | null
  hrSelections: HrSelections
  collectionStage?: Stage
  /** Sensitive-identifier gates, decided by deployment configuration. Absent gates keep those fields OFF. */
  gates: { vaultReady: boolean; approvedSensitiveFields: string[] }
  catalogueVersion?: string
  /** Open items derived from the company's recorded facts (for example an unknown Cargo Information). They are added to the plan's review requirements; they never remove content. */
  needsAttention?: Array<{ id: string; text: string }>
}

export function resolvePlan(input: ResolveInput): ApplicationPlan {
  const catalogue = getCatalogue(input.catalogueVersion ?? CURRENT_CATALOGUE_VERSION)
  const stage: Stage = input.collectionStage ?? "PRE_OFFER"
  const us = involvesUS(input.scope)
  const ca = involvesCanada(input.scope)
  const hr = validateHrSelections(input.hrSelections, { involvesUS: us, involvesCA: ca }, stage, catalogue)
  const ch = input.scope.characteristics
  const context: PlanContext = {
    scopeKind: input.scope.kind,
    involvesUS: us,
    involvesCA: ca,
    cmv: ch.cmvOperation,
    cdl: ch.cdlRequired,
    psp: input.profile.sections.psp,
    hazmat: ch.hazmat,
    passengerCarrying: ch.passengerCarrying,
    dotDrugAlcohol: input.profile.sections.dotDrugAlcoholHistory,
    historyYears: input.profile.employmentHistoryYears,
    carrierCountry: input.carrierCountry,
    hrItems: hr.enabled,
    hrBackgroundScreening: hr.enabled.includes("background_screening"),
    collectSsn: us && ch.cmvOperation === "YES",
    stage,
  }
  const scope = { ctx: context as unknown as Record<string, unknown>, ans: null }

  const reviews: RegulatoryReviewRequirement[] = []
  const fields: PlanField[] = []
  for (const f of catalogue.fields) {
    const resolvedStage = ca && f.stageWhenCanada ? later(f.stage, f.stageWhenCanada) : f.stage
    if (resolvedStage !== stage) continue
    if (evalCond(f.appliesWhen, scope) === "F") continue
    const hrItemId = f.carrierPolicyRef?.startsWith("hr:") ? f.carrierPolicyRef.slice(3) : null
    if (hrItemId && !hr.enabled.includes(hrItemId)) continue
    let collection: PlanField["collection"] = { enabled: true }
    if (f.collectionGates?.length) {
      const missing: CollectionGate[] = []
      if (f.collectionGates.includes("VAULT_KEY") && !input.gates.vaultReady) missing.push("VAULT_KEY")
      if (f.collectionGates.includes("LEGAL_APPROVAL") && !input.gates.approvedSensitiveFields.includes(f.id)) missing.push("LEGAL_APPROVAL")
      if (missing.length) {
        collection = { enabled: false, disabledReason: `Collection is off until: ${missing.map((m) => (m === "VAULT_KEY" ? "encrypted storage is configured" : "the legal purpose and wording are approved")).join(" and ")}.` }
        if (f.purpose === "REGULATORY") reviews.push({ id: `sensitive_collection_disabled.${f.id}`, text: `${f.label} is a regulatory application item but is not being collected (${collection.disabledReason}). The requirement remains open until collection is enabled.`, legalSource: f.legalSource })
      }
    }
    fields.push({ ...f, resolvedStage, collection })
  }
  const usedSections = new Set(fields.map((f) => f.section))

  const consents: PlanConsent[] = catalogue.consents
    .filter((c) => c.stage === stage && evalCond(c.appliesWhen, scope) !== "F")
    .map((c) => ({ ...c, textSha256: sha256Text(c.text) }))
  if (consents.some((c) => c.legalStatus === "PENDING_LEGAL_REVIEW")) {
    reviews.push({ id: "consent_text_pending_legal_review", text: "One or more authorization texts in this application are pending legal review. They are recorded as presented, but no verification may rely on them until approved.", legalSource: [] })
  }
  if (us && ca) reviews.push({ id: "cross_border_applicability", text: "Cross-border operations: which U.S. and Canadian requirements apply to this driver and carrier combination needs jurisdiction-specific legal confirmation.", legalSource: ["US_391_21", "CA_PROV_CARRIER_RULES"] })
  if (input.scope.kind === "US_INTRASTATE" || input.scope.components.includes("US_INTRASTATE")) reviews.push({ id: "us_intrastate_state_rules", text: `Intrastate rules of ${input.scope.usJurisdictions.join(", ") || "the state"} (adoption of federal rules, exemptions, age and medical standards) are not evaluated by TES and need verification.`, legalSource: ["US_391_21"] })
  if (ca) reviews.push({ id: "canada_provincial_rules", text: "Provincial or territorial driver-file, employment-history and screening rules are not evaluated by TES beyond the 3-year baseline and need verification.", legalSource: ["CA_PROV_CARRIER_RULES"] })

  for (const n of input.needsAttention ?? []) reviews.push({ id: n.id, text: n.text, legalSource: [] })

  const requirements = catalogue.requirements.filter((r) => r.stage === stage && evalCond(r.appliesWhen, scope) !== "F")

  const cited = new Set<string>()
  for (const f of fields) f.legalSource.forEach((s) => cited.add(s))
  for (const c of consents) c.legalSource.forEach((s) => cited.add(s))
  for (const r of requirements) r.legalSource.forEach((s) => cited.add(s))
  const legalSources: Record<string, LegalSource> = {}
  for (const k of [...cited].sort()) if (catalogue.legalSources[k]) legalSources[k] = catalogue.legalSources[k]

  return {
    planFormat: 1,
    catalogueVersion: catalogue.version,
    rulesVersion: catalogue.rulesVersion,
    scopeRulesVersion: input.profile.version,
    collectionStage: stage,
    context,
    sections: catalogue.sections.filter((s) => usedSections.has(s.id) || (s.id === "authorizations" && consents.length > 0)),
    fields: fields.sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order),
    consents,
    requirements,
    regulatoryReviewRequirements: reviews,
    limitations: [
      "The plan decides which questions, authorizations and checks are issued. It does not establish that the driver or carrier is compliant or that the driver is qualified.",
      "Every legal source cited is unverified by counsel. Jurisdiction-specific requirements listed as review requirements remain open.",
    ],
    legalSources,
  }
}

/** The hash that identifies a frozen plan. Stored with the invitation and the application. */
export const planSha256 = (plan: ApplicationPlan) => sha256Canonical(plan)
