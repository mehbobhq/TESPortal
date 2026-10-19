import "server-only"

import type { PoolClient } from "pg"
import { hasAdditionalSystemCapability, requireAdditionalSystemCapability, withAuthorizedSystem, type SystemAuthorizationDecision } from "@/lib/auth/tes-system-context"
import { enterSystemCapability, runDeferredChecks } from "@/lib/company-directory/capability-context"
import { createContactChanges, saveContactChanges, type CreateContactAtomicInput, type SaveContactInput } from "@/lib/contacts/contact-save"
import { ContactNotFoundError, ContactValidationError } from "@/lib/contacts/errors"
import type { OperationContext } from "@/lib/contacts/operations"
import { personRelatedToOrganization } from "@/lib/contacts/repository"
import type { ContactView, CreateContactResult } from "@/lib/contacts/types"
import { PostgresMasterRegisterRepository } from "@/lib/master-register/postgres-repository"
import * as identity from "@/lib/contact-identity/identity-details"

/**
 * The Contacts page's save and read of ONE contact, including its restricted identity details, as a single authorized unit.
 *
 *   caller -> this service -> withAuthorizedSystem("CONTACT_MANAGE" | "PERSON_REGISTRY_READ") -> contacts operations (+ identity details)
 *
 * It lives outside lib/contacts on purpose: the Contacts slice carries no driver or identity data (migration 0014), so the one place
 * that composes the two is this separate, explicit service. Capabilities (all SYSTEM scope, each re-proven here on the same
 * transaction; CONTACT_MANAGE alone never reaches identity data and a job title never grants anything):
 *   PERSON_IDENTITY_READ    see date of birth and the licence record
 *   PERSON_IDENTITY_MANAGE  record / correct a date of birth
 *   DRIVER_READ / DRIVER_MANAGE  additionally needed for the licence, which is the canonical Driver licence record
 * Entering these details never verifies an identity.
 */

function context(client: PoolClient, decision: SystemAuthorizationDecision): OperationContext {
  let registryRead: Promise<boolean> | undefined
  return {
    client,
    actor: { id: decision.actor.id, actorType: decision.actor.actorType },
    masterRegister: new PostgresMasterRegisterRepository(client),
    canViewRegistry: () => (registryRead ??= hasAdditionalSystemCapability(client, decision, "PERSON_REGISTRY_READ")),
  }
}

export type ContactIdentityView = {
  personId: string
  /** What THIS actor may do: the UI disables what is not allowed, and the server enforces it again on every write. */
  access: { read: boolean; manage: boolean; licenceRead: boolean; licenceManage: boolean }
  dateOfBirth: string | null
  licence: identity.LicenceDetails | null
  /** Always the same words: entering these details never establishes a verified identity. */
  verification: "NOT_VERIFIED"
}

/**
 * Applies identity details on the SAME transaction as the contact save, so a save is one all-or-nothing unit. A missing capability throws
 * and the whole save (the contact changes included) rolls back, so nothing is half-applied.
 */
async function applyIdentity(client: PoolClient, decision: SystemAuthorizationDecision, ctx: OperationContext, organizationId: string, personId: string, input: identity.IdentityInput): Promise<string[]> {
  const changed: string[] = []
  if (input.dateOfBirth === undefined && input.licence === undefined) return changed
  await requireAdditionalSystemCapability(client, decision, "PERSON_IDENTITY_MANAGE")
  const identityCtx: identity.IdentityContext = { client, actor: ctx.actor, masterRegister: ctx.masterRegister }
  if (input.dateOfBirth !== undefined) {
    await runDeferredChecks(client)
    await enterSystemCapability(client, "PERSON_IDENTITY_MANAGE")
    if ((await identity.setDateOfBirth(identityCtx, organizationId, personId, input.dateOfBirth)) !== "unchanged") changed.push("dateOfBirth")
  }
  if (input.licence !== undefined) {
    await requireAdditionalSystemCapability(client, decision, "DRIVER_MANAGE")
    await runDeferredChecks(client)
    await enterSystemCapability(client, "DRIVER_MANAGE")
    if ((await identity.setLicence(identityCtx, organizationId, personId, input.licence)) !== "unchanged") changed.push("licence")
  }
  await runDeferredChecks(client)
  await enterSystemCapability(client, "CONTACT_MANAGE")
  return changed
}

export type SaveContactServiceInput = SaveContactInput & { identity?: identity.IdentityInput }
export type CreateContactServiceInput = CreateContactAtomicInput & { identity?: identity.IdentityInput }

/** ONE transaction: the contact's name, own email / phone, title and Primary Contact designation, and (when permitted) identity details. */
export async function saveContact(input: SaveContactServiceInput): Promise<{ contact: ContactView; changed: string[] }> {
  return withAuthorizedSystem("CONTACT_MANAGE", async (client, decision) => {
    const ctx = context(client, decision)
    const result = await saveContactChanges(ctx, input)
    const changedIdentity = input.identity ? await applyIdentity(client, decision, ctx, input.organizationId, input.personId, input.identity) : []
    return { contact: result.contact, changed: [...result.changed, ...changedIdentity] }
  })
}

/** ONE transaction: a NEW person with relationship, own channels, title, optional Primary Contact designation and identity details. */
export async function createContactWithDetails(input: CreateContactServiceInput): Promise<CreateContactResult & { changed: string[] }> {
  return withAuthorizedSystem("CONTACT_MANAGE", async (client, decision) => {
    const ctx = context(client, decision)
    const created = await createContactChanges(ctx, input)
    const changed = input.identity ? await applyIdentity(client, decision, ctx, input.organizationId, created.contact.person.id, input.identity) : []
    return { ...created, changed }
  })
}

/**
 * The restricted identity details of one contact of this company. Tenant isolation: the person must be a contact of THIS organization,
 * otherwise it looks exactly like a person that does not exist. Without PERSON_IDENTITY_READ nothing is returned (only the access flags);
 * the licence additionally needs DRIVER_READ. With no person it only reports what the actor may do.
 */
export async function getContactIdentity(organizationId: string, personId: string | null): Promise<ContactIdentityView> {
  if (personId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) throw new ContactValidationError("personId", "personId must be a UUID.")
  return withAuthorizedSystem("PERSON_REGISTRY_READ", async (client, decision) => {
    if (personId !== null && !(await personRelatedToOrganization(client, organizationId, personId))) throw new ContactNotFoundError("Person")
    const [read, manage, driverRead, driverManage] = await Promise.all([
      hasAdditionalSystemCapability(client, decision, "PERSON_IDENTITY_READ"),
      hasAdditionalSystemCapability(client, decision, "PERSON_IDENTITY_MANAGE"),
      hasAdditionalSystemCapability(client, decision, "DRIVER_READ"),
      hasAdditionalSystemCapability(client, decision, "DRIVER_MANAGE"),
    ])
    const view: ContactIdentityView = {
      personId: personId ?? "",
      access: { read, manage, licenceRead: read && driverRead, licenceManage: manage && driverManage },
      dateOfBirth: null,
      licence: null,
      verification: "NOT_VERIFIED",
    }
    if (!read || personId === null) return view
    await enterSystemCapability(client, "PERSON_IDENTITY_READ")
    view.dateOfBirth = (await identity.readBirthDate(client, personId))?.value ?? null
    if (driverRead) {
      await enterSystemCapability(client, "DRIVER_READ")
      view.licence = await identity.readLicence(client, personId)
    }
    return view
  })
}
