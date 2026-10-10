import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { withAuthorizedCustomer } from "@/lib/auth/tes-customer-context"
import { CorporateIdentityNotFoundError } from "@/lib/corporate-identity/errors"
import type { CorporateIdentifierInput } from "@/lib/corporate-identity/identifier-definitions"
import * as operations from "@/lib/corporate-identity/operations"
import { loadCustomerOrganizationId, loadOrganization } from "@/lib/corporate-identity/repository"
import type {
  AliasInput,
  ClassificationInput,
  CreateOrganizationInput,
  CreateOrganizationResult,
  MutationResult,
  OrganizationRecord,
  UpdateLegalIdentityInput,
} from "@/lib/corporate-identity/types"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"

export * from "@/lib/corporate-identity/errors"
export type * from "@/lib/corporate-identity/types"
export type {
  CorporateIdentifierInput,
  CorporateIdentifierKind,
} from "@/lib/corporate-identity/identifier-definitions"

/**
 * Corporate Identity service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorized* (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                          \\-> Master Register, same transaction
 *
 * Capabilities enforced:
 *   SYSTEM    ORGANIZATION_REGISTRY_READ  getOrganization
 *             ORGANIZATION_CREATE         createOrganization
 *             ORGANIZATION_UPDATE         updateLegalIdentity, identifiers, aliases, classifications
 *             ORGANIZATION_ARCHIVE        archiveOrganization, restoreOrganization
 *   CUSTOMER  ORGANIZATION_READ           readCustomerOrganization (that customer's own Organization only)
 *
 * ORGANIZATION_CREATE / _UPDATE detect collisions but do not by themselves disclose the matched Organization: a secondary
 * ORGANIZATION_REGISTRY_READ check on the same transaction decides that, and only when a collision actually occurs.
 *
 * Inputs are semantic. There is no parameter through which a caller can supply identifier_type, namespace, normalization
 * rule, Organization status, merge target, or a CMP legacy id.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  let registryRead: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canViewRegistry: () =>
      (registryRead ??= hasAdditionalSystemCapability(client, decision, "ORGANIZATION_REGISTRY_READ")),
  }
}

// --- reads (no Master Register events) ----------------------------------------------------------------------------

/** SYSTEM registry read of any Organization by canonical UUID. */
export async function getOrganization(organizationId: string): Promise<OrganizationRecord> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", (client) =>
    operations.readOrganization(client, organizationId),
  )
}

/**
 * Reads the Organization behind ONE customer, under that customer's authorized tenant context. The customer is selected
 * by the caller but proven by authorization: an actor without ORGANIZATION_READ for exactly this customer is denied, and
 * row-level security means no other tenant's rows are visible on this connection.
 */
export async function readCustomerOrganization(customerId: string): Promise<OrganizationRecord> {
  return withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async (client) => {
    const organizationId = await loadCustomerOrganizationId(client, customerId.trim().toLowerCase())
    if (!organizationId) throw new CorporateIdentityNotFoundError()
    const organization = await loadOrganization(client, organizationId)
    if (!organization) throw new CorporateIdentityNotFoundError()
    return organization
  })
}

// --- mutations ----------------------------------------------------------------------------------------------------

export async function createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
  return withAuthorizedSystem("ORGANIZATION_CREATE", (client, decision) =>
    operations.createOrganization(context(client, decision), input),
  )
}

export async function updateLegalIdentity(organizationId: string, input: UpdateLegalIdentityInput): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.updateLegalIdentity(context(client, decision), organizationId, input),
  )
}

export async function addIdentifier(
  organizationId: string,
  identifier: CorporateIdentifierInput,
): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.addIdentifier(context(client, decision), organizationId, identifier),
  )
}

export async function correctIdentifier(
  organizationId: string,
  identifierId: string,
  replacement: CorporateIdentifierInput,
): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.correctIdentifier(context(client, decision), organizationId, identifierId, replacement),
  )
}

export async function supersedeIdentifier(organizationId: string, identifierId: string): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.supersedeIdentifier(context(client, decision), organizationId, identifierId),
  )
}

export async function addAlias(
  organizationId: string,
  alias: AliasInput,
): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.addAlias(context(client, decision), organizationId, alias),
  )
}

export async function deactivateAlias(organizationId: string, aliasId: string): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.deactivateAlias(context(client, decision), organizationId, aliasId),
  )
}

export async function addClassification(
  organizationId: string,
  classification: ClassificationInput,
): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.addClassification(context(client, decision), organizationId, classification),
  )
}

export async function endClassification(organizationId: string, classificationId: string): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.endClassification(context(client, decision), organizationId, classificationId),
  )
}

export async function setPrimaryClassification(organizationId: string, classificationId: string): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) =>
    operations.setPrimaryClassification(context(client, decision), organizationId, classificationId),
  )
}

export async function archiveOrganization(organizationId: string, options?: { reason?: string }): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_ARCHIVE", (client, decision) =>
    operations.archiveOrganization(context(client, decision), organizationId, options),
  )
}

export async function restoreOrganization(organizationId: string, options?: { reason?: string }): Promise<MutationResult> {
  return withAuthorizedSystem("ORGANIZATION_ARCHIVE", (client, decision) =>
    operations.restoreOrganization(context(client, decision), organizationId, options),
  )
}
