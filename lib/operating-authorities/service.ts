import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedCustomer } from "@/lib/auth/tes-customer-context"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { OperatingAuthorityNotFoundError } from "@/lib/operating-authorities/errors"
import * as operations from "@/lib/operating-authorities/operations"
import { loadCustomerOrganizationId } from "@/lib/operating-authorities/repository"
import type {
  AuthorityMutationResult,
  AuthorityView,
  ChangeStatusInput,
  ChangeVersionInput,
  CheckNumberInput,
  CorrectStatusInput,
  CorrectVersionInput,
  CreateAuthorityInput,
  NumberCheckResult,
  OrganizationAuthoritiesView,
  ReactivateInput,
} from "@/lib/operating-authorities/types"

export * from "@/lib/operating-authorities/errors"
export type * from "@/lib/operating-authorities/types"

/**
 * Operating Authority service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorized* (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                          \\-> Master Register, same transaction
 *
 * Capabilities enforced (no new capabilities exist for this domain):
 *   SYSTEM    ORGANIZATION_REGISTRY_READ  checkAuthorityNumber, getOrganizationAuthorities
 *             ORGANIZATION_UPDATE         createAuthority, changeAuthorityVersion, correctAuthorityVersion,
 *                                         changeAuthorityStatus, reactivateAuthority, correctAuthorityStatus,
 *                                         archiveAuthority, restoreAuthority
 *   CUSTOMER  ORGANIZATION_READ           readCustomerOrganizationAuthorities (that customer's own Organization only)
 *
 * A number collision with ANOTHER Organization blocks creation / correction. The colliding Organization and authority are
 * disclosed only when the caller also holds ORGANIZATION_REGISTRY_READ (evaluated lazily on the SAME transaction); otherwise
 * the caller receives a generic collision result.
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

// --- reads and lookups (no Master Register events) ----------------------------------------------------------------

/** SYSTEM registry precheck: is this number registered in its namespace, and by whom. Advisory; creation re-checks authoritatively. */
export async function checkAuthorityNumber(input: CheckNumberInput): Promise<NumberCheckResult> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", (client) => operations.checkAuthorityNumber(client, input))
}

/** SYSTEM registry read of one Organization's authorities, optionally as of an instant. */
export async function getOrganizationAuthorities(
  organizationId: string,
  options?: { asOf?: string },
): Promise<OrganizationAuthoritiesView> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", (client) =>
    operations.readOrganizationAuthorities(client, organizationId, options),
  )
}

/** Reads the authorities of the Organization behind ONE customer under that customer's authorized tenant context. */
export async function readCustomerOrganizationAuthorities(
  customerId: string,
  options?: { asOf?: string },
): Promise<OrganizationAuthoritiesView> {
  return withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async (client) => {
    const organizationId = await loadCustomerOrganizationId(client, customerId.trim().toLowerCase())
    if (!organizationId) throw new OperatingAuthorityNotFoundError("Organization")
    return operations.readOrganizationAuthorities(client, organizationId, options)
  })
}

// --- mutations ----------------------------------------------------------------------------------------------------

export async function createAuthority(input: CreateAuthorityInput): Promise<AuthorityMutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.createAuthority(context(client, decision), input))
}

/** REAL-WORLD change of number / jurisdiction (e.g. an IRP base move); the earlier version stays true history. */
export async function changeAuthorityVersion(input: ChangeVersionInput): Promise<AuthorityMutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.changeAuthorityVersion(context(client, decision), input))
}

/** CORRECTION of a wrongly recorded number or jurisdiction; the wrong version is preserved but never reported as history. */
export async function correctAuthorityVersion(input: CorrectVersionInput): Promise<AuthorityMutationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.correctAuthorityVersion(context(client, decision), input))
}

export async function changeAuthorityStatus(input: ChangeStatusInput): Promise<AuthorityView> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.changeAuthorityStatus(context(client, decision), input))
}

/** The SAME authority returns to ACTIVE; never a new authority. */
export async function reactivateAuthority(input: ReactivateInput): Promise<AuthorityView> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.reactivateAuthority(context(client, decision), input))
}

export async function correctAuthorityStatus(input: CorrectStatusInput): Promise<AuthorityView> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.correctAuthorityStatus(context(client, decision), input))
}

export async function archiveAuthority(input: { organizationId: string; authorityId: string }): Promise<AuthorityView> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.archiveAuthority(context(client, decision), input))
}

export async function restoreAuthority(input: { organizationId: string; authorityId: string }): Promise<AuthorityView> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.restoreAuthority(context(client, decision), input))
}
