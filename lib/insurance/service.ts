import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import * as operations from "@/lib/insurance/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import type { OrganizationInsuranceView, PolicyNumberCheckResult, PolicyView } from "@/lib/insurance/types"

export * from "@/lib/insurance/errors"
export * from "@/lib/insurance/definitions"
export type * from "@/lib/insurance/types"

/**
 * Insurance service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                         \-> Master Register, same transaction
 *
 * Capabilities enforced (all SYSTEM scope; there is no CUSTOMER-facing path in this foundation):
 *   INSURANCE_READ    getOrganizationInsurance, checkPolicyNumber
 *   INSURANCE_MANAGE  everything else: policies, renewals, cancellation, endorsements, corrections, broker of record, archive
 *
 * Each capability is checked once, by the wrapper, in the same transaction as the work. A policy-number collision names the
 * colliding policy and Organization only when the caller ALSO holds INSURANCE_READ (evaluated lazily on the SAME
 * transaction); otherwise the caller receives a generic collision result.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  let readAllowed: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canReadInsurance: () => (readAllowed ??= hasAdditionalSystemCapability(client, decision, "INSURANCE_READ")),
  }
}

// --- reads (no Master Register events) ------------------------------------------------------------------------------

/** All the insurance of one Organization (as insured): policies, terms, coverages, endorsements and broker periods. */
export async function getOrganizationInsurance(organizationId: string, options?: { asOf?: string }): Promise<OrganizationInsuranceView> {
  return withAuthorizedSystem("INSURANCE_READ", (client) => operations.readOrganizationInsurance(client, organizationId, options))
}

/** The policy-number registry: is this number held within this insurer's namespace, and by whom. Advisory; creation re-checks. */
export async function checkPolicyNumber(insurerOrganizationId: string, policyNumber: string): Promise<PolicyNumberCheckResult> {
  return withAuthorizedSystem("INSURANCE_READ", (client) => operations.checkPolicyNumber(client, insurerOrganizationId, policyNumber))
}

// --- mutations (INSURANCE_MANAGE) -----------------------------------------------------------------------------------

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("INSURANCE_MANAGE", (client, decision) => work(context(client, decision)))
}

/** A policy (stable identity) with its first term, coverages and optional broker; `renewsPolicyId` makes it a new-policy renewal. */
export const createPolicy = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.createPolicy(ctx, input))
/** A renewal as a new TERM of the same policy (terms never overlap). */
export const renewPolicy = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.renewPolicy(ctx, input))
/** The one-way cancellation fact on a term. */
export const cancelTerm = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.cancelTerm(ctx, input))
/** An endorsement and the coverage transition it causes (REAL-WORLD change; the previous coverage state stays history). */
export const addEndorsement = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.addEndorsement(ctx, input))

/** CORRECTION of a wrongly recorded term (the wrong term is kept and flagged; coverages and endorsements follow). */
export const correctTerm = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.correctTerm(ctx, input))
export const correctCoverage = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.correctCoverage(ctx, input))
export const correctEndorsement = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.correctEndorsement(ctx, input))

/** REAL-WORLD change of broker of record. */
export const changeBroker = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.changeBroker(ctx, input))
export const correctBroker = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.correctBroker(ctx, input))

export const archivePolicy = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.archivePolicy(ctx, input))
export const restorePolicy = (input: unknown): Promise<PolicyView> => manage((ctx) => operations.restorePolicy(ctx, input))
