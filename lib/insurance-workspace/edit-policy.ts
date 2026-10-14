/**
 * Composed Insurance operations for the company workspace ("edit this policy record").
 *
 * The restored Insurance interface has ONE "Edit" form per record. The canonical model distinguishes a MISTAKE (a correction: the
 * wrong rows are kept and flagged) from a REAL-WORLD change (an endorsement / a change of broker: the earlier state stays as
 * history). The operator says which one it is (`mode`), and this module applies the matching EXISTING operations
 * (correctCoverage, correctTerm, addEndorsement, correctBroker / changeBroker) in ONE transaction, each writing its own Master
 * Register events. Nothing here writes a table directly, and no new rule is introduced: every check is the existing operation's.
 *
 * If any step is refused the whole edit is rolled back by the caller's transaction (nothing is half-applied).
 *
 * No "server-only" import: plain domain logic over an OperationContext, testable under Node. The boundary is service.ts.
 */

import { isCoverageType, type CoverageType } from "@/lib/insurance/definitions"
import { InsuranceNotFoundError, InsuranceValidationError } from "@/lib/insurance/errors"
import { addEndorsement, changeBroker, correctBroker, correctCoverage, correctTerm, type OperationContext } from "@/lib/insurance/operations"
import * as repo from "@/lib/insurance/repository"
import type { PolicyView } from "@/lib/insurance/types"

export const EDIT_MODES = ["CORRECTION", "ENDORSEMENT"] as const
export type EditMode = (typeof EDIT_MODES)[number]

const KEYS = ["policyId", "organizationId", "mode", "policyNumber", "termStart", "termEnd", "coverageId", "coverage", "effectiveOn", "broker"] as const
const COVERAGE_PATCH_KEYS = ["coverageType", "limitAmount", "deductibleAmount", "currency", "limitBasis"] as const
const BROKER_KEYS = ["brokerOrganizationId", "brokerPersonId"] as const

function object(value: unknown, field: string, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InsuranceValidationError(field, `${field} must be an object.`)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new InsuranceValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
  return value as Record<string, unknown>
}

function uuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new InsuranceValidationError(field, `${field} must be a UUID.`)
}

/**
 * Edits the CURRENT (latest genuine) term of a policy, its coverage and its broker of record.
 *
 *   mode CORRECTION   the recorded values were wrong: correctCoverage (coverage fields), correctTerm (number / dates),
 *                     correctBroker (the current broker period; when the policy has none yet, changeBroker starts the first).
 *   mode ENDORSEMENT  the policy really changed on `effectiveOn`: a COVERAGE_CHANGED endorsement (limit / deductible / currency /
 *                     limit basis only; the coverage TYPE cannot change by endorsement) and changeBroker. The term's number and
 *                     dates cannot change by endorsement, so they are refused in this mode.
 *
 * The insured Organization named in the request must own the policy; otherwise the policy is reported as not found.
 */
export async function editPolicyRecord(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = object(rawInput, "input", KEYS)
  const policyId = uuid(input.policyId, "policyId")
  const organizationId = uuid(input.organizationId, "organizationId")
  if (input.mode !== "CORRECTION" && input.mode !== "ENDORSEMENT") throw new InsuranceValidationError("mode", "mode must be CORRECTION or ENDORSEMENT.")
  const mode: EditMode = input.mode

  if ((await repo.findPolicyOrganization(ctx.client, policyId)) !== organizationId) throw new InsuranceNotFoundError("Policy")

  const termFields = {
    ...(input.policyNumber !== undefined ? { policyNumber: input.policyNumber } : {}),
    ...(input.termStart !== undefined ? { termStart: input.termStart } : {}),
    ...(input.termEnd !== undefined ? { termEnd: input.termEnd } : {}),
  }
  const hasTerm = Object.keys(termFields).length > 0
  const patch = input.coverage === undefined ? null : object(input.coverage, "coverage", COVERAGE_PATCH_KEYS)
  const hasCoverage = patch !== null && Object.keys(patch).length > 0
  const broker = input.broker === undefined ? null : object(input.broker, "broker", BROKER_KEYS)
  if (!hasTerm && !hasCoverage && broker === null) throw new InsuranceValidationError("input", "Nothing to change.")

  const terms = await repo.listActiveTerms(ctx.client, policyId)
  const term = terms[terms.length - 1]
  if (!term) throw new InsuranceNotFoundError("Term")

  let view: PolicyView | null = null

  if (hasCoverage) {
    const coverageId = uuid(input.coverageId, "coverageId")
    if ((await repo.findCoverageTerm(ctx.client, coverageId)) !== term.id) throw new InsuranceNotFoundError("Coverage")
    if (mode === "CORRECTION") {
      view = await correctCoverage(ctx, { coverageId, organizationId, ...patch })
    } else {
      if (patch && patch.coverageType !== undefined) {
        const current = await repo.getCoverage(ctx.client, coverageId)
        if (!current || patch.coverageType !== current.coverageType) {
          throw new InsuranceValidationError("coverage.coverageType", "The coverage type cannot change by endorsement. Correct it if it was recorded wrongly, or record the new coverage on its own policy.")
        }
      }
      const current = await repo.getCoverage(ctx.client, coverageId)
      if (!current || current.recordStatus !== "active" || current.effectiveTo !== null) throw new InsuranceNotFoundError("Coverage")
      const type: CoverageType = isCoverageType(current.coverageType) ? current.coverageType : (() => { throw new InsuranceNotFoundError("Coverage") })()
      const pick = (key: (typeof COVERAGE_PATCH_KEYS)[number], fallback: unknown) => (patch && patch[key] !== undefined ? patch[key] : fallback)
      view = await addEndorsement(ctx, {
        termId: term.id,
        organizationId,
        kind: "COVERAGE_CHANGED",
        effectiveOn: input.effectiveOn,
        coverage: {
          coverageType: type,
          limitAmount: pick("limitAmount", current.limitAmount),
          deductibleAmount: pick("deductibleAmount", current.deductibleAmount),
          currency: pick("currency", current.currency),
          limitBasis: pick("limitBasis", current.limitBasis),
          scheduledVehiclesOnly: current.scheduledVehiclesOnly,
        },
      })
    }
  }

  if (hasTerm) {
    if (mode === "ENDORSEMENT") {
      throw new InsuranceValidationError("input", "A policy number or term date cannot be changed by endorsement. Choose the correction option if it was recorded wrongly, or record a renewal.")
    }
    view = await correctTerm(ctx, { termId: term.id, organizationId, ...termFields })
  }

  if (broker !== null) {
    const brokerOrganizationId = uuid(broker.brokerOrganizationId, "broker.brokerOrganizationId")
    const brokerPersonId = broker.brokerPersonId === undefined || broker.brokerPersonId === null ? null : uuid(broker.brokerPersonId, "broker.brokerPersonId")
    const current = await repo.getCurrentBrokerPeriod(ctx.client, policyId)
    view =
      mode === "CORRECTION" && current
        ? await correctBroker(ctx, { brokerPeriodId: current.id, organizationId, brokerOrganizationId, brokerPersonId })
        : await changeBroker(ctx, { policyId, organizationId, brokerOrganizationId, brokerPersonId })
  }

  if (view === null) throw new InsuranceValidationError("input", "Nothing to change.")
  return view
}
