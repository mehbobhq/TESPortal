// Maps the canonical Contacts view (PostgreSQL: persons, name versions, person channels, titles, purposes and the company-person
// relationship) onto the Contact shape the Contacts page renders. Pure: no fetch, no storage. Nothing here invents data.
//
// What the canonical model has no home for is simply empty here and is disabled in the page (date of birth, driver licence details,
// free notes, identity evidence): those belong to the Drivers / evidence workflows, never to a browser-local copy.
import type { Contact, ContactEvent, Relationship } from "./types"

export type CanonicalChannel = {
  id: string
  channelType: "EMAIL" | "PHONE" | "WEBSITE"
  usage: string | null
  valueDisplay: string
  effectiveFrom: string
  effectiveTo?: string | null
  isPreferred?: boolean
}
type CanonicalPeriod = { id: string; effectiveFrom: string; effectiveTo: string | null; recordStatus?: string; changeReason?: string; createdAt?: string }
export type CanonicalContactView = {
  relationship: { id: string; organizationId?: string; personId?: string; effectiveFrom: string; effectiveTo: string | null; recordStatus?: string; createdAt?: string }
  person: { id: string; recordStatus?: string; archivedAt?: string | null; createdAt?: string }
  names?: Array<CanonicalPeriod & { givenName: string | null; familyName: string | null }>
  channels?: CanonicalChannel[]
  titles?: Array<CanonicalPeriod & { titleDisplay: string }>
  purposes?: Array<CanonicalPeriod & { purpose: string; isPrimary: boolean }>
  current: {
    name: { givenName: string | null; familyName: string | null } | null
    channels: CanonicalChannel[]
    titles: Array<{ id: string; titleDisplay: string }>
    purposes: Array<{ id: string; purpose: string; isPrimary: boolean }>
  }
}
export type CanonicalContactsView = { currentChannels: CanonicalChannel[]; channels?: CanonicalChannel[]; contacts: CanonicalContactView[] }

const day = (instant: string | null | undefined) => (instant ? String(instant).slice(0, 10) : "")

/** The title the page shows as the person's role at this company: their current title, else what the purposes say, else General Contact. */
export function roleOf(view: CanonicalContactView): string {
  const title = view.current.titles[0]?.titleDisplay
  if (title) return title
  return view.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary) ? "Primary Contact" : "General Contact"
}

export const isPrimaryContact = (view: CanonicalContactView): boolean => view.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary)

/** The person's own current email: the preferred (designated) one first. Company channels are never read here. */
export function personEmail(view: CanonicalContactView): CanonicalChannel | null {
  const emails = view.current.channels.filter((c) => c.channelType === "EMAIL")
  return emails.find((c) => c.isPreferred) ?? emails[0] ?? null
}
export const personPhone = (view: CanonicalContactView): CanonicalChannel | null => view.current.channels.find((c) => c.channelType === "PHONE") ?? null

/** Revision events derived from the canonical history rows (the Master Register holds the actor and authority of each change). */
export function eventsOf(view: CanonicalContactView, companyName: string): ContactEvent[] {
  const events: ContactEvent[] = []
  const add = (id: string, at: string | undefined | null, action: ContactEvent["action"], summary: string) => events.push({ id, timestamp: at || "", action, summary, actor: "Recorded in the Master Register" })
  for (const name of view.names ?? []) {
    const label = [name.givenName, name.familyName].filter(Boolean).join(" ")
    const corrected = name.recordStatus && name.recordStatus !== "active"
    add(`name-${name.id}`, name.effectiveFrom, name.changeReason === "INITIAL" ? "CREATED" : "CONTACT_UPDATED", `${name.changeReason === "INITIAL" ? "Recorded" : name.changeReason === "CORRECTION" ? "Corrected" : "Changed"} name: ${label}${corrected ? " (superseded)" : ""}.`)
  }
  for (const p of view.purposes ?? []) {
    if (p.purpose !== "PRIMARY" || !p.isPrimary) continue
    add(`primary-${p.id}-from`, p.effectiveFrom, "PRIMARY_CHANGED", `Designated Primary Contact for ${companyName} (effective ${day(p.effectiveFrom)}).`)
    if (p.effectiveTo) add(`primary-${p.id}-to`, p.effectiveTo, "PRIMARY_CHANGED", `Primary Contact designation for ${companyName} ended (${day(p.effectiveTo)}).`)
  }
  for (const t of view.titles ?? []) add(`title-${t.id}`, t.effectiveFrom, "ROLE_UPDATED", `Role recorded: ${t.titleDisplay}${t.effectiveTo ? ` (until ${day(t.effectiveTo)})` : ""}.`)
  for (const c of view.channels ?? []) add(`channel-${c.id}`, c.effectiveFrom, "CONTACT_UPDATED", `${c.channelType === "PHONE" ? "Phone" : "Email"} recorded: ${c.valueDisplay}${c.effectiveTo ? ` (ended ${day(c.effectiveTo)})` : ""}.`)
  add(`rel-${view.relationship.id}`, view.relationship.effectiveFrom, "RELATIONSHIP_ADDED", `Associated with ${companyName} (since ${day(view.relationship.effectiveFrom)}).`)
  if (view.relationship.effectiveTo) add(`rel-${view.relationship.id}-end`, view.relationship.effectiveTo, "ARCHIVED", `Association with ${companyName} ended (${day(view.relationship.effectiveTo)}); kept in history.`)
  return events.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""))
}

/**
 * One UI contact per person. A person who left and rejoined has two relationship periods: the open one wins; otherwise the most
 * recent ended one is shown (as archived), so nothing in history disappears from the list.
 */
export function toUiContacts(view: CanonicalContactsView, company: { id: string; name: string }): Contact[] {
  const byPerson = new Map<string, CanonicalContactView>()
  for (const contact of view.contacts) {
    const existing = byPerson.get(contact.person.id)
    const open = contact.relationship.effectiveTo === null
    const existingOpen = existing ? existing.relationship.effectiveTo === null : false
    if (!existing || (open && !existingOpen) || (open === existingOpen && contact.relationship.effectiveFrom > existing.relationship.effectiveFrom)) byPerson.set(contact.person.id, contact)
  }
  return [...byPerson.values()].map((cv) => {
    const role = roleOf(cv)
    const primary = isPrimaryContact(cv) && cv.relationship.effectiveTo === null
    const email = personEmail(cv)
    const phone = personPhone(cv)
    const ended = cv.relationship.effectiveTo !== null
    const relationship: Relationship = {
      id: cv.relationship.id,
      companyId: company.id,
      companyName: company.name,
      role,
      isPrimary: primary,
      status: ended ? "ended" : "active",
      startDate: day(cv.relationship.effectiveFrom),
      ...(ended ? { endDate: day(cv.relationship.effectiveTo) } : {}),
      source: "system",
    }
    return {
      id: cv.person.id,
      globalId: cv.person.id,
      firstName: cv.current.name?.givenName ?? "",
      lastName: cv.current.name?.familyName ?? "",
      // No canonical home in Contacts: identity documents belong to the Drivers / evidence workflows. Empty, never guessed.
      dob: "", dlNumber: "", dlState: "", dlExpiry: "", dlIssueDate: "", dlClass: "", dlRestrictions: "", notes: "",
      email: email?.valueDisplay ?? "",
      phone: phone?.valueDisplay ?? "",
      role,
      isPrimary: primary,
      isArchived: ended,
      // Identity stays Unverified until verification evidence is supported; Contacts never marks a person verified on its own.
      identityStatus: "unverified",
      relationships: [relationship],
      evidence: [],
      events: eventsOf(cv, company.name),
      createdAt: cv.person.createdAt ?? cv.relationship.createdAt ?? cv.relationship.effectiveFrom,
      updatedAt: cv.relationship.effectiveTo ?? cv.relationship.effectiveFrom,
    } satisfies Contact
  })
}
