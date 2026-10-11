import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import * as operations from "@/lib/customer-relationship/operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import type { AgreementRecord, CustomerRelationshipView, EngagementView, EstablishResult } from "@/lib/customer-relationship/types"

export * from "@/lib/customer-relationship/errors"
export * from "@/lib/customer-relationship/definitions"
export type * from "@/lib/customer-relationship/types"

/**
 * Customer Relationship service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                         \-> Master Register, same transaction
 *
 * Capabilities enforced (all SYSTEM scope; there is no CUSTOMER-facing path in this foundation):
 *   CUSTOMER_ESTABLISH            establishCustomerRelationship  (establish a Customer, or re-engage a returning one, and
 *                                 begin an Engagement - atomically; it runs under SYSTEM scope because the Customer does
 *                                 not exist yet when authorization begins)
 *   CUSTOMER_RELATIONSHIP_READ    getCustomerRelationship, getEngagement
 *   CUSTOMER_RELATIONSHIP_MANAGE  everything else: stages, ending an Engagement, scope, responsibility, agreements
 *
 * Each capability is checked once, by the wrapper, in the same transaction as the work. Nothing here exposes agreements,
 * stages or responsibility decisions to CUSTOMER context.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
  }
}

// --- establishment --------------------------------------------------------------------------------------------------

export async function establishCustomerRelationship(input: unknown): Promise<EstablishResult> {
  return withAuthorizedSystem("CUSTOMER_ESTABLISH", (client, decision) => operations.establishCustomerRelationship(context(client, decision), input))
}

// --- reads (no Master Register events) ------------------------------------------------------------------------------

export async function getCustomerRelationship(organizationId: string, options?: { asOf?: string }): Promise<CustomerRelationshipView> {
  return withAuthorizedSystem("CUSTOMER_RELATIONSHIP_READ", (client) => operations.readCustomerRelationship(client, organizationId, options))
}

export async function getEngagement(engagementId: string, options?: { asOf?: string }): Promise<EngagementView> {
  return withAuthorizedSystem("CUSTOMER_RELATIONSHIP_READ", (client) => operations.readEngagement(client, engagementId, options))
}

// --- mutations (CUSTOMER_RELATIONSHIP_MANAGE) -----------------------------------------------------------------------

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("CUSTOMER_RELATIONSHIP_MANAGE", (client, decision) => work(context(client, decision)))
}

/** REAL-WORLD stage change (the previous stage stays true history). */
export const changeStage = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.changeStage(ctx, input))
/** CORRECTION of a wrongly recorded stage (the wrong row is kept and flagged). */
export const correctStage = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.correctStage(ctx, input))
/** Ends the Engagement (the one authoritative termination), its dependents, and starts the ENDED stage. */
export const endEngagement = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.endEngagement(ctx, input))

/** CORRECTS the termination of an already-ended Engagement (date and/or reason). It never reopens the Engagement. */
export const correctEngagementTermination = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.correctEngagementTermination(ctx, input))

export const addScope = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.addScope(ctx, input))
export const endScope = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.endScope(ctx, input))
export const correctScope = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.correctScope(ctx, input))
export const voidScope = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.voidScope(ctx, input))

export const assumeResponsibility = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.assumeResponsibility(ctx, input))
export const endResponsibility = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.endResponsibility(ctx, input))
export const correctResponsibility = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.correctResponsibility(ctx, input))
export const voidResponsibility = (input: unknown): Promise<EngagementView> => manage((ctx) => operations.voidResponsibility(ctx, input))

export const createAgreement = (input: unknown): Promise<AgreementRecord> => manage((ctx) => operations.createAgreement(ctx, input))
export const amendAgreement = (input: unknown): Promise<AgreementRecord> => manage((ctx) => operations.amendAgreement(ctx, input))
export const correctAgreementVersion = (input: unknown): Promise<AgreementRecord> => manage((ctx) => operations.correctAgreementVersion(ctx, input))
export const endAgreement = (input: unknown): Promise<AgreementRecord> => manage((ctx) => operations.endAgreement(ctx, input))
export const archiveAgreement = (input: unknown): Promise<AgreementRecord> => manage((ctx) => operations.archiveAgreement(ctx, input))
export const restoreAgreement = (input: unknown): Promise<AgreementRecord> => manage((ctx) => operations.restoreAgreement(ctx, input))
