import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import * as operations from "@/lib/company-profile/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import type { CatalogueRule, CompanyProfileView, TaxApplicabilityComparison } from "@/lib/company-profile/types"

export * from "@/lib/company-profile/errors"
export * from "@/lib/company-profile/definitions"
export type * from "@/lib/company-profile/types"

/**
 * Company Operating Profile service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                         \-> Master Register, same transaction
 *
 * Capabilities enforced (all SYSTEM scope; there is no CUSTOMER-facing path in this foundation):
 *   COMPANY_PROFILE_READ    listRules, getCompanyProfile, compareTaxApplicabilityWithRegistrations
 *   COMPANY_PROFILE_MANAGE  everything else: operating scope, rule applicability, driver requirements
 *
 * Each capability is checked once, by the wrapper, in the same transaction as the work. The tax comparison exposes only
 * whether an ACTIVE-status registration exists (a boolean) - never a registration number, id or date.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
  }
}

// --- reads (no Master Register events) ------------------------------------------------------------------------------

/** The controlled rule catalogue. */
export async function listRules(): Promise<CatalogueRule[]> {
  return withAuthorizedSystem("COMPANY_PROFILE_READ", (client) => operations.readRules(client))
}

/** One Organization's operating scope, driver minimums and EVERY catalogued rule, current or as of a business instant. */
export async function getCompanyProfile(organizationId: string, options?: { asOf?: string }): Promise<CompanyProfileView> {
  return withAuthorizedSystem("COMPANY_PROFILE_READ", (client) => operations.readCompanyProfile(client, organizationId, options))
}

/** Tax rule applicability beside the existence of an ACTIVE-status registration for the mapped program (read-only). */
export async function compareTaxApplicabilityWithRegistrations(organizationId: string): Promise<TaxApplicabilityComparison[]> {
  return withAuthorizedSystem("COMPANY_PROFILE_READ", (client) => operations.compareTaxApplicabilityWithRegistrations(client, organizationId))
}

// --- mutations (COMPANY_PROFILE_MANAGE) -----------------------------------------------------------------------------

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("COMPANY_PROFILE_MANAGE", (client, decision) => work(context(client, decision)))
}

/** First operating scope, or a REAL-WORLD change (the previous scope stays true history). */
export const setOperatingScope = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.setOperatingScope(ctx, input))
/** CORRECTION of a wrongly recorded operating scope (the wrong period is kept and flagged). */
export const correctOperatingScope = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.correctOperatingScope(ctx, input))

/** First assertion for a rule, or a REAL-WORLD change of it. Repeating the current assertion is refused. */
export const setRuleApplicability = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.setRuleApplicability(ctx, input))
/** Ends the current assertion with no replacement: the rule is not configured again. */
export const clearRuleApplicability = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.clearRuleApplicability(ctx, input))
export const correctRuleApplicability = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.correctRuleApplicability(ctx, input))

export const setDriverRequirements = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.setDriverRequirements(ctx, input))
export const correctDriverRequirements = (input: unknown): Promise<CompanyProfileView> => manage((ctx) => operations.correctDriverRequirements(ctx, input))
