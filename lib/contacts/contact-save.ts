/**
 * One atomic "save this contact" for the Contacts page.
 *
 * Why this exists. The page used to turn one Save into several independent requests (name, email, phone, title, primary), each its own
 * transaction. If a later one was refused (or the browser sent the save twice, or the network dropped) the earlier ones had already
 * committed while the page reported FAILURE: a contact change that persisted but was reported as failed. A save is now ONE server call
 * and ONE transaction, and the server (not the browser) works out what actually differs from the stored record, so:
 *   - it commits entirely or not at all (the Master Register events included);
 *   - a repeated submit finds nothing left to change and is a harmless no-op (`changed` is empty) instead of an error;
 *   - the browser never needs to know which internal channel / title / assignment row to touch.
 *
 * Every step is an EXISTING contacts operation (own validation, own Master Register event); this file only decides which to call.
 * Channels are the PERSON's own (the company's phone / email lines are separate). The Primary Contact is a designation, never a title,
 * so "Primary Contact" and "Driver" are rejected as job titles. Entering details never verifies an identity.
 */
import { ContactNotFoundError, ContactStateError, ContactValidationError } from "@/lib/contacts/errors"
import * as operations from "@/lib/contacts/operations"
import type { OperationContext } from "@/lib/contacts/operations"
import type { ChannelRecord, ContactView, CreateContactResult } from "@/lib/contacts/types"

/** Words that are designations or workflows of their own, not a person's job title at the company. */
export const NON_TITLE_DESIGNATIONS = ["primary contact", "driver"] as const
export const isDesignationNotTitle = (title: string): boolean => (NON_TITLE_DESIGNATIONS as readonly string[]).includes(title.trim().toLowerCase())

export type SaveContactInput = {
  organizationId: string
  personId: string
  name?: { givenName?: string | null; familyName?: string | null }
  /** undefined = untouched; "" or null = end the person's current value. */
  email?: string | null
  phone?: string | null
  title?: string | null
  /** undefined = untouched; true = designate Primary Contact; false = end the designation. */
  primary?: boolean
}

export type SaveContactResult = { contact: ContactView; changed: string[] }

const words = (value: string) => value.toLowerCase().split(/\s+/).filter(Boolean).join(" ")
const digits = (value: string) => value.replace(/\D+/g, "")

const personEmail = (contact: ContactView): ChannelRecord | null => {
  const emails = contact.current.channels.filter((c) => c.channelType === "EMAIL")
  return emails.find((c) => c.isPreferred) ?? emails[0] ?? null
}
const personPhone = (contact: ContactView): ChannelRecord | null => contact.current.channels.find((c) => c.channelType === "PHONE") ?? null

async function currentContact(ctx: OperationContext, organizationId: string, personId: string): Promise<ContactView> {
  const view = await operations.readOrganizationContacts(ctx.client, organizationId)
  const all = view.contacts.filter((contact) => contact.person.id === personId)
  const open = all.find((contact) => contact.relationship.effectiveTo === null && contact.relationship.recordStatus === "active")
  if (!open) {
    if (all.length > 0) throw new ContactStateError("This contact has left the company; restore them before editing.")
    throw new ContactNotFoundError("Person")
  }
  return open
}

export async function saveContactChanges(ctx: OperationContext, input: SaveContactInput): Promise<SaveContactResult> {
  const { organizationId, personId } = input
  const changed: string[] = []
  let contact = await currentContact(ctx, organizationId, personId)

  if (input.title !== undefined && input.title !== null && input.title.trim() !== "" && isDesignationNotTitle(input.title) && words(input.title) !== words(contact.current.titles[0]?.titleDisplay ?? "")) {
    throw new ContactValidationError("title", "Primary Contact and Driver are not job titles: Primary Contact is designated with its own checkbox, and Drivers are managed in Drivers.")
  }

  if (input.name) {
    const first = (input.name.givenName ?? "").trim()
    const last = (input.name.familyName ?? "").trim()
    if (!first && !last) throw new ContactValidationError("name", "A name is required.")
    const current = contact.current.name
    if (first !== (current?.givenName ?? "") || last !== (current?.familyName ?? "")) {
      const before = [current?.givenName, current?.familyName].filter(Boolean).join(" ")
      // A restructure of the same words ("Riley Hart" -> "Riley" + "Hart") fixes how it was recorded; a different name is a real change.
      const same = words(before) === words(`${first} ${last}`)
      contact = same
        ? await operations.correctPersonName(ctx, { organizationId, personId, givenName: first || null, familyName: last || null })
        : await operations.changePersonName(ctx, { organizationId, personId, givenName: first || null, familyName: last || null })
      changed.push("name")
    }
  }

  for (const [type, value, existing, preferred] of [
    ["EMAIL", input.email, personEmail(contact), true],
    ["PHONE", input.phone, personPhone(contact), false],
  ] as const) {
    if (value === undefined) continue
    const next = (value ?? "").trim()
    const same = existing && (type === "EMAIL" ? next.toLowerCase() === existing.valueDisplay.toLowerCase() : digits(next) === digits(existing.valueDisplay))
    if (existing && !next) {
      contact = await operations.endPersonChannel(ctx, { organizationId, personId, channelId: existing.id })
      changed.push(type === "EMAIL" ? "email" : "phone")
    } else if (!existing && next) {
      contact = await operations.addPersonChannel(ctx, { organizationId, personId, channel: { type, value: next, preferred } })
      changed.push(type === "EMAIL" ? "email" : "phone")
    } else if (existing && next && !same) {
      contact = await operations.changePersonChannel(ctx, { organizationId, personId, channelId: existing.id, value: next })
      changed.push(type === "EMAIL" ? "email" : "phone")
    }
  }

  if (input.title !== undefined) {
    const next = (input.title ?? "").trim()
    const existing = contact.current.titles[0]
    if (existing && !next) {
      contact = await operations.endTitle(ctx, { organizationId, titleId: existing.id })
      changed.push("title")
    } else if (next && (!existing || words(existing.titleDisplay) !== words(next))) {
      contact = existing
        ? await operations.changeTitle(ctx, { organizationId, titleId: existing.id, title: next })
        : await operations.addTitle(ctx, { organizationId, relationshipId: contact.relationship.id, title: next })
      changed.push("title")
    }
  }

  if (input.primary !== undefined) {
    const assignment = contact.current.purposes.find((p) => p.purpose === "PRIMARY" && p.isPrimary)
    if (input.primary && !assignment) {
      contact = await operations.makePrimary(ctx, { organizationId, relationshipId: contact.relationship.id, purpose: "PRIMARY" })
      changed.push("primary")
    } else if (!input.primary && assignment) {
      contact = await operations.endPurpose(ctx, { organizationId, assignmentId: assignment.id })
      changed.push("primary")
    }
  }

  return { contact, changed }
}

export type CreateContactAtomicInput = {
  organizationId: string
  name: { givenName?: string; familyName?: string }
  email?: string
  phone?: string
  title?: string
  primary?: boolean
}

/** Creates the person, relationship, channels and title, and (optionally) the Primary Contact designation, as one operation. */
export async function createContactChanges(ctx: OperationContext, input: CreateContactAtomicInput): Promise<CreateContactResult> {
  const title = (input.title ?? "").trim()
  if (title && isDesignationNotTitle(title)) {
    throw new ContactValidationError("title", "Primary Contact and Driver are not job titles: Primary Contact is designated with its own checkbox, and Drivers are managed in Drivers.")
  }
  const email = (input.email ?? "").trim()
  const phone = (input.phone ?? "").trim()
  const created = await operations.createContact(ctx, {
    organizationId: input.organizationId,
    name: input.name,
    titles: title ? [title] : [],
    channels: [...(email ? [{ type: "EMAIL", value: email, preferred: true }] : []), ...(phone ? [{ type: "PHONE", value: phone }] : [])],
  })
  if (!input.primary) return created
  const contact = await operations.makePrimary(ctx, { organizationId: input.organizationId, relationshipId: created.contact.relationship.id, purpose: "PRIMARY" })
  return { contact, matches: created.matches }
}
