import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import type { OperationContext } from "@/lib/company-credentials/operations"
import * as scoped from "@/lib/company-credentials/scoped-operations"
import type { CredentialView, SystemView } from "@/lib/company-credentials/types"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"

/**
 * Company-scoped entry points for the restored Credentials workspace.
 *
 * The same canonical operations as lib/company-credentials/service.ts (which stays exactly the designed surface), but each id
 * must belong to the Organization named by the route: a mismatch is "not found". Every function runs in ONE
 * CREDENTIAL_MANAGE transaction (authorization, scope check, change and Master Register event commit or roll back together).
 *
 * SYSTEM scope only, like the credentials service: customers have no access. No function accepts, returns or reveals a secret value;
 * the only thing that can be linked to a slot is a Secret Manager resource NAME.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): OperationContext {
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
  }
}

function manage<T>(work: (ctx: OperationContext) => Promise<T>): Promise<T> {
  return withAuthorizedSystem("CREDENTIAL_MANAGE", (client, decision) => work(context(client, decision)))
}

/** A new credential plus the secret slots its recovery details declare (kinds only), atomically. */
export const createCredentialWithRecoverySlots = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.createCredentialWithRecoverySlots(ctx, organizationId, input))
/** A changed or wrongly entered login: a new credential replaces this one, which is archived with its history intact. */
export const replaceCompanyCredential = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.replaceCredentialInOrganization(ctx, organizationId, input))
export const updateCompanyCredentialMetadata = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.updateCredentialMetadataInOrganization(ctx, organizationId, input))
/** CORRECTION of the current status (the wrong period is kept and flagged). */
export const correctCompanyCredentialStatus = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.correctCredentialStatusInOrganization(ctx, organizationId, input))
/** A verification entered in error is voided (kept, flagged). */
export const voidCompanyVerification = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.voidVerificationInOrganization(ctx, organizationId, input))
/** Declares that a secret of this kind exists (state only). */
export const declareCompanySecretSlot = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.declareSecretSlotInOrganization(ctx, organizationId, input))
export const retireCompanySecretSlot = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.retireSecretSlotInOrganization(ctx, organizationId, input))
/** Links a slot to a Secret Manager resource NAME (never a value). */
export const linkCompanySlotToSecretManager = (organizationId: string, input: unknown): Promise<CredentialView> => manage((ctx) => scoped.linkSlotToSecretManagerInOrganization(ctx, organizationId, input))
/** Retires an alias, only if it belongs to the system in the URL. */
export const retireAliasOfCredentialSystem = (systemId: string, input: unknown): Promise<SystemView> => manage((ctx) => scoped.retireAliasOfSystem(ctx, systemId, input))
