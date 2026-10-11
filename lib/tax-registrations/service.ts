import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as operations from "@/lib/tax-registrations/operations"
import type {
  ChangeStatusInput,
  ChangeVersionInput,
  CheckNumberInput,
  CorrectStatusInput,
  CorrectVersionInput,
  CreateRegistrationInput,
  NumberCheckResult,
  OrganizationRegistrationsView,
  RegistrationMutationResult,
  RegistrationView,
} from "@/lib/tax-registrations/types"

export * from "@/lib/tax-registrations/errors"
export type * from "@/lib/tax-registrations/types"

/**
 * Tax Registration service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                         \-> Master Register, same transaction
 *
 * Capabilities enforced (all SYSTEM scope; there is no CUSTOMER-facing path in this foundation):
 *   TAX_REGISTRATION_READ    checkRegistrationNumber, getOrganizationRegistrations
 *   TAX_REGISTRATION_MANAGE  everything else: create, change / correct a version, change / correct the status, archive, restore
 *
 * A number collision with ANOTHER Organization blocks creation / change / correction. The colliding Organization and
 * registration are disclosed only when the actor ALSO holds TAX_REGISTRATION_READ (evaluated lazily on the SAME transaction);
 * otherwise the actor receives a generic collision result. MANAGE alone cannot read registrations.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  let registryRead: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canViewRegistry: () => (registryRead ??= hasAdditionalSystemCapability(client, decision, "TAX_REGISTRATION_READ")),
  }
}

// --- reads and lookups (no Master Register events) ----------------------------------------------------------------

/** SYSTEM registry precheck: is this number registered in its namespace, and by whom. Advisory; creation re-checks authoritatively. */
export async function checkRegistrationNumber(input: CheckNumberInput): Promise<NumberCheckResult> {
  return withAuthorizedSystem("TAX_REGISTRATION_READ", (client) => operations.checkRegistrationNumber(client, input))
}

/** SYSTEM read of one Organization's registrations, optionally as of an instant. */
export async function getOrganizationRegistrations(
  organizationId: string,
  options?: { asOf?: string },
): Promise<OrganizationRegistrationsView> {
  return withAuthorizedSystem("TAX_REGISTRATION_READ", (client) => operations.readOrganizationRegistrations(client, organizationId, options))
}

// --- mutations (TAX_REGISTRATION_MANAGE) --------------------------------------------------------------------------

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("TAX_REGISTRATION_MANAGE", (client, decision) => work(context(client, decision)))
}

export const createRegistration = (input: CreateRegistrationInput): Promise<RegistrationMutationResult> =>
  manage((ctx) => operations.createRegistration(ctx, input))

/** REAL-WORLD change (a renewed licence period; an IFTA base-jurisdiction move); the earlier version stays true history. */
export const changeRegistrationVersion = (input: ChangeVersionInput): Promise<RegistrationMutationResult> =>
  manage((ctx) => operations.changeRegistrationVersion(ctx, input))

/** CORRECTION of a wrongly recorded number, jurisdiction or date; the wrong version is preserved but never reported as history. */
export const correctRegistrationVersion = (input: CorrectVersionInput): Promise<RegistrationMutationResult> =>
  manage((ctx) => operations.correctRegistrationVersion(ctx, input))

export const changeRegistrationStatus = (input: ChangeStatusInput): Promise<RegistrationView> =>
  manage((ctx) => operations.changeRegistrationStatus(ctx, input))

export const correctRegistrationStatus = (input: CorrectStatusInput): Promise<RegistrationView> =>
  manage((ctx) => operations.correctRegistrationStatus(ctx, input))

export const archiveRegistration = (input: { organizationId: string; registrationId: string }): Promise<RegistrationView> =>
  manage((ctx) => operations.archiveRegistration(ctx, input))

export const restoreRegistration = (input: { organizationId: string; registrationId: string }): Promise<RegistrationView> =>
  manage((ctx) => operations.restoreRegistration(ctx, input))
