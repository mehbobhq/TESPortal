/**
 * Default recipients for company communication, derived from the canonical contacts record. Pure: it reads an OrganizationContactsView
 * and decides nothing that is not already recorded there.
 *
 * Rules (approved product decisions):
 *  - OPERATIONAL email: the designated PRIMARY contact's own email is included in every operational message, as To (when the message
 *    has no other To) or CC, by default.
 *  - Four separate concepts, never conflated: (1) contact IDENTITY (the person and their name), (2) contact DETAILS (their own email and
 *    phone), (3) the PRIMARY CONTACT designation (a PRIMARY purpose assignment) and (4) OPERATIONAL EMAIL INCLUSION (whether the
 *    primary contact is copied). Changing a person's email, ending their company relationship, changing the primary contact and
 *    excluding an address from operational email are DISTINCT operations; none is a workaround for another.
 *  - (4) is recorded in public.organization_person_operational_email_exclusions (migration 0035): an audited, effective-dated
 *    instruction (source, reference, optional evidence, actor in the Master Register) that stops the primary contact being copied on
 *    OPERATIONAL email WITHOUT touching the person, their email, their relationship or the PRIMARY designation. Only exclusions are
 *    stored; inclusion is the default. Ending the exclusion resumes the default. It is read here "as of" any date like every other
 *    contacts fact. An excluded primary contact is reported as the gap PRIMARY_CONTACT_EXCLUDED (never silently dropped).
 *  - Changing or ending the PRIMARY designation (an authorized CONTACT_MANAGE change, history and actor kept in the Master Register,
 *    readable "as of" a date) changes WHO is the primary contact and so who the default routes to; it is not an exclusion.
 *  - BILLING routing is separate: it is the company's billing (ACCOUNTING) email line and the BILLING-purpose contacts. The primary
 *    contact is never added to a billing message by this rule, and the billing line is never used as the primary contact's email.
 *    Exclusions never apply to billing.
 *  - Changing the primary contact changes ONLY this routing. The Contract Signatory and the Service Decision Authority are customer
 *    authority assignments in the contracts domain; nothing here reads or writes them.
 *
 * ENFORCEMENT: this module is the single place that answers "who is copied". It is NOT an email system and it does not claim that any
 * integration applies it: no outbound email integration is connected in TES today, so nothing here proves an email was sent,
 * delivered or acknowledged (recorded, confirmed, verified, delivered and acknowledged are different facts). A sender must call
 * applyOperationalRouting.
 */
import type { ChannelRecord, ContactView, OperationalEmailExclusionRecord, OrganizationContactsView } from "@/lib/contacts/types"

export type RoutedRecipient = {
  address: string
  /** The role the address takes when it is added to a message that already has a To. */
  role: "CC"
  reason: "PRIMARY_CONTACT"
  personId: string
  /** The person's display name as recorded. */
  name: string
  /** When the person was designated primary (the effective date of the current designation). */
  designatedSince: string
}

export type RoutingGap = "NO_PRIMARY_CONTACT" | "PRIMARY_CONTACT_HAS_NO_EMAIL" | "PRIMARY_CONTACT_EXCLUDED"

export type CommunicationRouting = {
  operational: {
    recipients: RoutedRecipient[]
    gap: RoutingGap | null
    /** The primary contact an exclusion currently keeps off operational email, with the recorded instruction. */
    excluded: { personId: string; name: string; since: string; source: OperationalEmailExclusionRecord["instructionSource"]; exclusionId: string } | null
  }
  billing: { companyAddresses: string[]; contactAddresses: Array<{ address: string; personId: string; name: string }> }
  /** Always the same words: callers and reviewers can see this is a resolver, not a delivery guarantee. */
  enforcement: "RESOLVER_ONLY"
}

/** What is true for a contact now, or as of the instant the view was read at (the view carries both; as-of rows never include corrected or voided ones). */
function stateOf(view: ContactView) {
  const state = view.asOf
    ? { open: view.asOf.relationshipInForce, name: view.asOf.name, channels: view.asOf.channels, purposes: view.asOf.purposes }
    : { open: view.relationship.effectiveTo === null, name: view.current.name, channels: view.current.channels, purposes: view.current.purposes }
  return { ...state, label: [state.name?.givenName, state.name?.familyName].filter(Boolean).join(" ") }
}

/** The person's own email: the preferred (designated) one first. A company channel is never a person's email. */
export function personalEmail(view: ContactView): ChannelRecord | null {
  const emails = stateOf(view).channels.filter((channel) => channel.channelType === "EMAIL" && channel.ownerType === "PERSON")
  return emails.find((channel) => channel.isPreferred) ?? emails[0] ?? null
}

export function resolveCommunicationRouting(view: OrganizationContactsView): CommunicationRouting {
  const primary = view.contacts.find((contact) => {
    const state = stateOf(contact)
    return state.open && state.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary)
  })
  let recipients: RoutedRecipient[] = []
  let gap: RoutingGap | null = "NO_PRIMARY_CONTACT"
  let excluded: CommunicationRouting["operational"]["excluded"] = null
  if (primary) {
    const state = stateOf(primary)
    const email = personalEmail(primary)
    const designation = state.purposes.find((p) => p.purpose === "PRIMARY" && p.isPrimary)
    const at = primary.asOf ? primary.asOf.at : new Date().toISOString()
    const exclusion = (view.operationalEmailExclusions ?? []).find(
      (row) => row.relationshipId === primary.relationship.id && row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo),
    )
    if (exclusion) {
      excluded = { personId: primary.person.id, name: state.label, since: exclusion.effectiveFrom, source: exclusion.instructionSource, exclusionId: exclusion.id }
      gap = "PRIMARY_CONTACT_EXCLUDED"
    } else if (email && designation) {
      recipients = [{ address: email.valueDisplay, role: "CC", reason: "PRIMARY_CONTACT", personId: primary.person.id, name: state.label, designatedSince: designation.effectiveFrom }]
      gap = null
    } else gap = "PRIMARY_CONTACT_HAS_NO_EMAIL"
  }
  const companyChannels = view.asOfChannels ?? view.currentChannels
  const companyAddresses = companyChannels.filter((channel) => channel.channelType === "EMAIL" && channel.usage === "ACCOUNTING").map((channel) => channel.valueDisplay)
  const contactAddresses = view.contacts
    .filter((contact) => {
      const state = stateOf(contact)
      return state.open && state.purposes.some((p) => p.purpose === "BILLING")
    })
    .flatMap((contact) => {
      const email = personalEmail(contact)
      return email ? [{ address: email.valueDisplay, personId: contact.person.id, name: stateOf(contact).label }] : []
    })
  return { operational: { recipients, gap, excluded }, billing: { companyAddresses, contactAddresses }, enforcement: "RESOLVER_ONLY" }
}

export type OutgoingMessage = { to: string[]; cc: string[] }

/**
 * Adds the default recipients to an OPERATIONAL message: the primary contact becomes To when the message has none, otherwise CC; an
 * address already present is not repeated. A BILLING message is returned unchanged. Returns a new message; the input is not modified.
 */
export function applyOperationalRouting(message: OutgoingMessage, routing: CommunicationRouting, kind: "OPERATIONAL" | "BILLING"): OutgoingMessage {
  const result: OutgoingMessage = { to: [...message.to], cc: [...message.cc] }
  if (kind === "BILLING") return result
  const present = new Set([...result.to, ...result.cc].map((address) => address.trim().toLowerCase()))
  for (const recipient of routing.operational.recipients) {
    const key = recipient.address.trim().toLowerCase()
    if (present.has(key)) continue
    present.add(key)
    if (result.to.length === 0) result.to.push(recipient.address)
    else result.cc.push(recipient.address)
  }
  return result
}
