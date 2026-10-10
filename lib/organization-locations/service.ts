import "server-only"

import type { PoolClient } from "pg"
import { withAuthorizedCustomer } from "@/lib/auth/tes-customer-context"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import { OrganizationLocationNotFoundError } from "@/lib/organization-locations/errors"
import * as operations from "@/lib/organization-locations/operations"
import { loadCustomerOrganizationId } from "@/lib/organization-locations/repository"
import type {
  AddressChangeInput,
  AddressChangeResult,
  AssignLocationInput,
  AssignLocationResult,
  AssignmentRecord,
  CorrectAssignmentInput,
  CorrectAssignmentResult,
  CreateLocationInput,
  CreateLocationResult,
  EndAssignmentInput,
  LocationMatch,
  LocationRecord,
  OrganizationLocationsView,
} from "@/lib/organization-locations/types"
import type { AddressInput } from "@/lib/organization-locations/address-normalization"

export * from "@/lib/organization-locations/errors"
export type * from "@/lib/organization-locations/types"
export type { AddressInput } from "@/lib/organization-locations/address-normalization"

/**
 * Organization Location service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorized* (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                          \\-> Master Register, same transaction
 *
 * Capabilities enforced (no new capabilities exist for this domain):
 *   SYSTEM    ORGANIZATION_REGISTRY_READ  findLocationMatches, getOrganizationLocations
 *             ORGANIZATION_UPDATE         createLocation, assignLocation, correctAssignment, endAssignment,
 *                                         changeLocationAddress, correctLocationAddress, archiveLocation, restoreLocation
 *   CUSTOMER  ORGANIZATION_READ           readCustomerOrganizationLocations (that customer's own Organization only)
 *
 * ORGANIZATION_UPDATE operations that touch the shared Location registry (reuse of an existing Location, advisory matches,
 * archive/restore, revising a Location without naming an Organization) additionally require ORGANIZATION_REGISTRY_READ,
 * evaluated lazily on the SAME transaction/client. Without it the caller gets no cross-Organization disclosure, nothing is
 * reused silently, and a Location it has no relationship to looks exactly like one that does not exist. Creating a
 * separate Location is always allowed.
 *
 * A Location is a business / operational place. Driver residences and other personal addresses do not belong in this
 * registry; a PII-aware domain with its own access control is required for them.
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

/** SYSTEM registry lookup: advisory building-level matches for an address. Suggestions only; never an automatic merge or reuse. */
export async function findLocationMatches(address: AddressInput): Promise<LocationMatch[]> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", (client) => operations.findLocationMatches(client, address))
}

/** SYSTEM registry read of one Organization's locations, optionally as of an instant. */
export async function getOrganizationLocations(organizationId: string, options?: { asOf?: string }): Promise<OrganizationLocationsView> {
  return withAuthorizedSystem("ORGANIZATION_REGISTRY_READ", (client) =>
    operations.readOrganizationLocations(client, organizationId, options),
  )
}

/**
 * Reads the locations of the Organization behind ONE customer under that customer's authorized tenant context. The
 * customer is selected by the caller but proven by authorization. There is no customer-facing Location search or lookup.
 */
export async function readCustomerOrganizationLocations(customerId: string, options?: { asOf?: string }): Promise<OrganizationLocationsView> {
  return withAuthorizedCustomer(customerId, "ORGANIZATION_READ", async (client) => {
    const organizationId = await loadCustomerOrganizationId(client, customerId.trim().toLowerCase())
    if (!organizationId) throw new OrganizationLocationNotFoundError("Organization")
    return operations.readOrganizationLocations(client, organizationId, options)
  })
}

// --- mutations ----------------------------------------------------------------------------------------------------

export async function createLocation(input: CreateLocationInput): Promise<CreateLocationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.createLocation(context(client, decision), input))
}

/** Explicit reuse: assigns an EXISTING Location to an Organization role, replacing that role's current assignment. */
export async function assignLocation(input: AssignLocationInput): Promise<AssignLocationResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.assignLocation(context(client, decision), input))
}

/**
 * CORRECTION of a wrongly recorded assignment (the wrong row is preserved and flagged, never ended, never reported as
 * genuine history). Use endAssignment / assignLocation for a real-world change.
 */
export async function correctAssignment(input: CorrectAssignmentInput): Promise<CorrectAssignmentResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.correctAssignment(context(client, decision), input))
}

export async function endAssignment(input: EndAssignmentInput): Promise<AssignmentRecord> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.endAssignment(context(client, decision), input))
}

/** REAL-WORLD change of a Location's postal / civic address (the old address stays true history). */
export async function changeLocationAddress(input: AddressChangeInput & { effectiveFrom?: string }): Promise<AddressChangeResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.changeLocationAddress(context(client, decision), input))
}

/** CORRECTION of a wrongly recorded address (the wrong version is preserved but never reported as genuine history). */
export async function correctLocationAddress(input: AddressChangeInput): Promise<AddressChangeResult> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.correctLocationAddress(context(client, decision), input))
}

export async function archiveLocation(locationId: string): Promise<LocationRecord> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.archiveLocation(context(client, decision), locationId))
}

export async function restoreLocation(locationId: string): Promise<LocationRecord> {
  return withAuthorizedSystem("ORGANIZATION_UPDATE", (client, decision) => operations.restoreLocation(context(client, decision), locationId))
}
