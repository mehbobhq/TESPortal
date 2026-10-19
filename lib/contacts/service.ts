import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as operations from "@/lib/contacts/operations"
import { resolveCommunicationRouting, type CommunicationRouting } from "@/lib/contacts/communication-routing"
import type { PersonDetailView } from "@/lib/contacts/operations"
import type {
  ContactView,
  CreateContactInput,
  CreateContactResult,
  FindPersonMatchesInput,
  OrganizationContactsView,
  PersonMatch,
  PersonRecord,
} from "@/lib/contacts/types"

export * from "@/lib/contacts/errors"
export type * from "@/lib/contacts/types"
export type { PersonDetailView } from "@/lib/contacts/operations"
export { CHANNEL_TYPES, CONTACT_PURPOSES, ORGANIZATION_CHANNEL_USAGES } from "@/lib/contacts/definitions"

/**
 * Contacts service: the only entry point for application code.
 *
 *   caller -> service (this file) -> withAuthorizedSystem (authorization + one transaction) -> operations -> repository -> PostgreSQL
 *                                                                          \\-> Master Register, same transaction
 *
 * Capabilities enforced (SYSTEM scope only):
 *   PERSON_REGISTRY_READ  getOrganizationContacts, getPerson, findPersonMatches
 *   CONTACT_MANAGE        every mutation
 *
 * A person is globally canonical, which is NOT global visibility. There is deliberately NO CUSTOMER-scope function in
 * this service: no customer path can reach a person or an Organization's contact data, so a customer's authorization
 * (even ORGANIZATION_READ) cannot expose contacts of its own Organization or anyone else's. A customer-facing read is a
 * separate, later design decision with its own capability.
 *
 * Mutations additionally evaluate PERSON_REGISTRY_READ lazily on the SAME transaction/client, only where it matters:
 *   - advisory duplicate matches are returned by createContact only to callers that hold it;
 *   - relating an EXISTING person to an Organization (addRelationship) requires that the caller can see that person,
 *     either through an existing relationship with this Organization or through registry read; otherwise the person is
 *     reported exactly like one that does not exist.
 * Creating a new person is always allowed for CONTACT_MANAGE.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): operations.OperationContext {
  let registryRead: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canViewRegistry: () =>
      (registryRead ??= hasAdditionalSystemCapability(client, decision, "PERSON_REGISTRY_READ")),
  }
}

const manage = <T>(work: (ctx: operations.OperationContext) => Promise<T>): Promise<T> =>
  withAuthorizedSystem("CONTACT_MANAGE", (client, decision) => work(context(client, decision)))

// --- reads and lookups (no Master Register events) ----------------------------------------------------------------

/** SYSTEM registry read of one Organization's contacts and own channels, optionally as of an instant. */
export async function getOrganizationContacts(organizationId: string, options?: { asOf?: string }): Promise<OrganizationContactsView> {
  return withAuthorizedSystem("PERSON_REGISTRY_READ", (client) => operations.readOrganizationContacts(client, organizationId, options))
}

/**
 * Who is copied on this company's communication right now (or as of an instant): the primary contact's email for operational
 * messages, kept apart from billing routing. A resolver for senders to call, not an email system. See communication-routing.ts.
 */
export async function getCommunicationRouting(organizationId: string, options?: { asOf?: string }): Promise<CommunicationRouting> {
  return resolveCommunicationRouting(await getOrganizationContacts(organizationId, options))
}

/** SYSTEM registry read of one person across Organizations. */
export async function getPerson(personId: string): Promise<PersonDetailView> {
  return withAuthorizedSystem("PERSON_REGISTRY_READ", (client) => operations.readPerson(client, personId))
}

/** ADVISORY possible-duplicate lookup for human review. Never merges, links or reuses a person. */
export async function findPersonMatches(input: FindPersonMatchesInput): Promise<PersonMatch[]> {
  return withAuthorizedSystem("PERSON_REGISTRY_READ", (client) => operations.findPersonMatches(client, input))
}

// --- mutations ----------------------------------------------------------------------------------------------------

/** Creates a NEW person with a name, an Organization relationship and optional channels, titles and purposes, atomically. */
export async function createContact(input: CreateContactInput): Promise<CreateContactResult> {
  return manage((ctx) => operations.createContact(ctx, input))
}

/** Explicit reuse: relates an EXISTING person to an Organization. */
export async function addRelationship(input: { organizationId: string; personId: string; effectiveFrom?: string }): Promise<ContactView> {
  return manage((ctx) => operations.addRelationship(ctx, input))
}
export async function endRelationship(input: { organizationId: string; relationshipId: string; effectiveTo?: string }): Promise<ContactView> {
  return manage((ctx) => operations.endRelationship(ctx, input))
}
export async function voidRelationship(input: { organizationId: string; relationshipId: string }): Promise<ContactView> {
  return manage((ctx) => operations.voidRelationship(ctx, input))
}

/** REAL-WORLD name change; the previous name stays true history. */
export async function changePersonName(input: { organizationId: string; personId: string; givenName?: string | null; familyName?: string | null; effectiveFrom?: string }): Promise<ContactView> {
  return manage((ctx) => operations.changePersonName(ctx, input))
}
/** CORRECTION of a wrongly recorded name. */
export async function correctPersonName(input: { organizationId: string; personId: string; givenName?: string | null; familyName?: string | null }): Promise<ContactView> {
  return manage((ctx) => operations.correctPersonName(ctx, input))
}

export async function addPersonChannel(input: unknown): Promise<ContactView> {
  return manage((ctx) => operations.addPersonChannel(ctx, input))
}
export async function changePersonChannel(input: unknown): Promise<ContactView> {
  return manage((ctx) => operations.changePersonChannel(ctx, input))
}
export async function correctPersonChannel(input: unknown): Promise<ContactView> {
  return manage((ctx) => operations.correctPersonChannel(ctx, input))
}
export async function endPersonChannel(input: unknown): Promise<ContactView> {
  return manage((ctx) => operations.endPersonChannel(ctx, input))
}
export async function voidPersonChannel(input: unknown): Promise<ContactView> {
  return manage((ctx) => operations.voidPersonChannel(ctx, input))
}

export async function addOrganizationChannel(input: unknown): Promise<OrganizationContactsView> {
  return manage((ctx) => operations.addOrganizationChannel(ctx, input))
}
export async function changeOrganizationChannel(input: unknown): Promise<OrganizationContactsView> {
  return manage((ctx) => operations.changeOrganizationChannel(ctx, input))
}
export async function correctOrganizationChannel(input: unknown): Promise<OrganizationContactsView> {
  return manage((ctx) => operations.correctOrganizationChannel(ctx, input))
}
export async function endOrganizationChannel(input: unknown): Promise<OrganizationContactsView> {
  return manage((ctx) => operations.endOrganizationChannel(ctx, input))
}
export async function voidOrganizationChannel(input: unknown): Promise<OrganizationContactsView> {
  return manage((ctx) => operations.voidOrganizationChannel(ctx, input))
}

export async function addTitle(input: { organizationId: string; relationshipId: string; title: string; effectiveFrom?: string }): Promise<ContactView> {
  return manage((ctx) => operations.addTitle(ctx, input))
}
/** REAL-WORLD change (a promotion). */
export async function changeTitle(input: { organizationId: string; titleId: string; title: string; effectiveFrom?: string }): Promise<ContactView> {
  return manage((ctx) => operations.changeTitle(ctx, input))
}
/** CORRECTION of a wrongly recorded title. */
export async function correctTitle(input: { organizationId: string; titleId: string; title: string }): Promise<ContactView> {
  return manage((ctx) => operations.correctTitle(ctx, input))
}
export async function endTitle(input: { organizationId: string; titleId: string; effectiveTo?: string }): Promise<ContactView> {
  return manage((ctx) => operations.endTitle(ctx, input))
}
export async function voidTitle(input: { organizationId: string; titleId: string }): Promise<ContactView> {
  return manage((ctx) => operations.voidTitle(ctx, input))
}

export async function assignPurpose(input: { organizationId: string; relationshipId: string; purpose: string; primary?: boolean; effectiveFrom?: string }): Promise<ContactView> {
  return manage((ctx) => operations.assignPurpose(ctx, input))
}
export async function makePrimary(input: { organizationId: string; relationshipId: string; purpose: string; effectiveFrom?: string }): Promise<ContactView> {
  return manage((ctx) => operations.makePrimary(ctx, input))
}
export async function endPurpose(input: { organizationId: string; assignmentId: string; effectiveTo?: string }): Promise<ContactView> {
  return manage((ctx) => operations.endPurpose(ctx, input))
}
export async function voidPurpose(input: { organizationId: string; assignmentId: string }): Promise<ContactView> {
  return manage((ctx) => operations.voidPurpose(ctx, input))
}

export async function archivePerson(input: { organizationId: string; personId: string }): Promise<PersonRecord> {
  return manage((ctx) => operations.archivePerson(ctx, input))
}
export async function restorePerson(input: { organizationId: string; personId: string }): Promise<PersonRecord> {
  return manage((ctx) => operations.restorePerson(ctx, input))
}
export { applyOperationalRouting, resolveCommunicationRouting } from "@/lib/contacts/communication-routing"
export type { CommunicationRouting, OutgoingMessage, RoutedRecipient } from "@/lib/contacts/communication-routing"
