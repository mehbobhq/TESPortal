import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import * as operations from "@/lib/company-credentials/operations"
import * as scoped from "@/lib/company-credentials/scoped-operations"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import type { CredentialView, OrganizationCredentialsView, SystemView } from "@/lib/company-credentials/types"

export * from "@/lib/company-credentials/errors"
export * from "@/lib/company-credentials/definitions"
export type * from "@/lib/company-credentials/types"

/**
 * Company Credentials service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                         \-> Master Register, same transaction
 *
 * Capabilities enforced (SYSTEM scope only; customers have NO access to credentials):
 *   CREDENTIAL_READ     listSystems, getSystem, getOrganizationCredentials (metadata, status and verification history, and
 *                       secret SLOT STATE - never a secret value and never a secret-store reference)
 *   CREDENTIAL_MANAGE   everything else, through the one manage() helper
 *
 * There is no secret store integration yet: every slot is UNRESOLVED until a reference to a Secret Manager resource name is
 * attached. No function here accepts, stores, returns or reveals a secret value, and no capability exists to do so.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
  }
}

// --- reads (no Master Register events) ------------------------------------------------------------------------------

export async function listSystems(options?: { includeArchived?: boolean }): Promise<SystemView[]> {
  return withAuthorizedSystem("CREDENTIAL_READ", (client) => operations.readSystems(client, options))
}

export async function getSystem(systemId: string): Promise<SystemView> {
  return withAuthorizedSystem("CREDENTIAL_READ", (client) => operations.readSystem(client, systemId))
}

export async function getOrganizationCredentials(organizationId: string, options?: { asOf?: string }): Promise<OrganizationCredentialsView> {
  return withAuthorizedSystem("CREDENTIAL_READ", (client) => operations.readOrganizationCredentials(client, organizationId, options))
}

// --- mutations (CREDENTIAL_MANAGE) ----------------------------------------------------------------------------------

function manage<T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("CREDENTIAL_MANAGE", (client, decision) => work(context(client, decision)))
}

// system registry
export const createSystem = (input: unknown): Promise<SystemView> => manage((ctx) => operations.createSystem(ctx, input))
export const updateSystem = (input: unknown): Promise<SystemView> => manage((ctx) => operations.updateSystem(ctx, input))
export const addAlias = (input: unknown): Promise<SystemView> => manage((ctx) => operations.addAlias(ctx, input))
export const retireAlias = (input: unknown): Promise<SystemView> => manage((ctx) => operations.retireAlias(ctx, input))
export const archiveSystem = (input: unknown): Promise<SystemView> => manage((ctx) => operations.archiveSystem(ctx, input))
export const restoreSystem = (input: unknown): Promise<SystemView> => manage((ctx) => operations.restoreSystem(ctx, input))

// credentials
export const createCredential = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.createCredential(ctx, input))
/** A changed or wrongly entered login: a new credential replaces the old one, which is archived with its history intact. */
export const replaceCredential = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.replaceCredential(ctx, input))
export const updateCredentialMetadata = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.updateCredentialMetadata(ctx, input))
export const archiveCredential = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.archiveCredential(ctx, input))
export const restoreCredential = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.restoreCredential(ctx, input))

// status
/** REAL-WORLD status change (the previous status stays true history). */
export const changeCredentialStatus = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.changeCredentialStatus(ctx, input))
/** CORRECTION of the current status (the wrong period is kept and flagged). */
export const correctCredentialStatus = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.correctCredentialStatus(ctx, input))

// verification
/** Records who verified what, when. The actor is the authenticated TES actor. It never changes the status. */
export const recordVerification = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.recordVerification(ctx, input))
export const voidVerification = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.voidVerification(ctx, input))

// secret slots (state and opaque reference only)
export const addSecretSlot = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.addSecretSlot(ctx, input))
export const attachSecretReference = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.attachSecretReference(ctx, input))
export const retireSecretSlot = (input: unknown): Promise<CredentialView> => manage((ctx) => operations.retireSecretSlot(ctx, input))

// --- company-scoped entry points (scoped-operations.ts) -------------------------------------------------------------------
// The same operations, but each id must belong to the Organization named by the route; a mismatch is "not found". All run in
// the one CREDENTIAL_MANAGE transaction, so the scope check and the change commit or roll back together.

export const createCredentialWithRecoverySlots = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.createCredentialWithRecoverySlots(ctx, organizationId, input))
export const replaceCompanyCredential = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.replaceCredentialInOrganization(ctx, organizationId, input))
export const updateCompanyCredentialMetadata = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.updateCredentialMetadataInOrganization(ctx, organizationId, input))
export const correctCompanyCredentialStatus = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.correctCredentialStatusInOrganization(ctx, organizationId, input))
export const voidCompanyVerification = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.voidVerificationInOrganization(ctx, organizationId, input))
export const declareCompanySecretSlot = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.declareSecretSlotInOrganization(ctx, organizationId, input))
export const retireCompanySecretSlot = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.retireSecretSlotInOrganization(ctx, organizationId, input))
/** Links a slot to a Secret Manager resource NAME (never a value). */
export const linkCompanySlotToSecretManager = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.linkSlotToSecretManagerInOrganization(ctx, organizationId, input))
export const retireAliasOfCredentialSystem = (systemId: string, input: unknown): Promise<SystemView> => manage((ctx) => scoped.retireAliasOfSystem(ctx, systemId, input))
