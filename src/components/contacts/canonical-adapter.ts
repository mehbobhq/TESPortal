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
  changeReason?: string
  createdAt?: string
  recordStatus?: string
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
export type CanonicalExclusion = {
  id: string
  relationshipId: string
  effectiveFrom: string
  effectiveTo: string | null
  instructionSource: string
  recordStatus: string
}
export type CanonicalContactsView = {
  currentChannels: CanonicalChannel[]
  channels?: CanonicalChannel[]
  contacts: CanonicalContactView[]
  operationalEmailExclusions?: CanonicalExclusion[]
  features?: { operationalEmailExclusions: boolean; migration0035?: string }
}

const day = (instant: string | null | undefined) => (instant ? String(instant).slice(0, 10) : "")

/**
 * "Primary Contact" is a DESIGNATION (its own checkbox), never a job title: a title that was saved with that word before this was
 * enforced is shown as a General Contact so it can never contradict the designation badge.
 */
const isDesignationWord = (title: string) => title.trim().toLowerCase() === "primary contact"

/** The job title the page shows as the person's role at this company: their current title, else General Contact. Never the designation. */
export function roleOf(view: CanonicalContactView): string {
  const title = view.current.titles.map((t) => t.titleDisplay).find((t) => !isDesignationWord(t))
  return title ?? "General Contact"
}

export const isPrimaryContact = (view: CanonicalContactView): boolean => view.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary)

/** The person's own current email: the preferred (designated) one first. Company channels are never read here. */
export function personEmail(view: CanonicalContactView): CanonicalChannel | null {
  const emails = view.current.channels.filter((c) => c.channelType === "EMAIL")
  return emails.find((c) => c.isPreferred) ?? emails[0] ?? null
}
export const personPhone = (view: CanonicalContactView): CanonicalChannel | null => view.current.channels.find((c) => c.channelType === "PHONE") ?? null

const GROUP_WINDOW_MS = 1500
const ms = (instant: string) => new Date(instant).getTime()
const person = (n: { givenName: string | null; familyName: string | null } | null | undefined) => [n?.givenName, n?.familyName].filter(Boolean).join(" ")

/**
 * Business operations derived from the canonical history rows. The Master Register keeps every technical event (one per row written);
 * what a person reads here is the OPERATION: creating a contact writes a person, a name, a relationship, an email, a title and a
 * Primary Contact designation, and shows as ONE "Contact Created" entry. Rows written in the same transaction share their creation
 * time; a change and the end of the row it replaces are one operation; separate saves stay separate entries. A save that touched several
 * things shows as one "Contact Updated" entry that lists them. The actor and authority of each change are in the Master Register.
 */
export function eventsOf(view: CanonicalContactView, companyName: string, exclusions: CanonicalExclusion[] = []): ContactEvent[] {
  type Part = { at: string; text: string; kind: "create" | "name" | "email" | "phone" | "role" | "primary" | "relation-start" | "relation-end" | "operational-email" }
  const parts: Part[] = []
  const add = (at: string | null | undefined, kind: Part["kind"], text: string) => at && parts.push({ at, kind, text })
  const names = (view.names ?? []).filter((n) => !n.recordStatus || n.recordStatus === "active")

  for (const n of names) {
    if (n.changeReason === "INITIAL") add(n.createdAt ?? n.effectiveFrom, "create", `Contact created: ${person(n)}`)
    else {
      const previous = names.find((o) => o.effectiveTo && o.effectiveTo === n.effectiveFrom)
      add(n.createdAt ?? n.effectiveFrom, "name", n.changeReason === "CORRECTION" ? `Name corrected to ${person(n)}` : `Name changed${previous ? ` from ${person(previous)}` : ""} to ${person(n)}`)
    }
  }
  const channels = (view.channels ?? []).filter((c) => !c.recordStatus || c.recordStatus === "active")
  for (const c of channels) {
    const kind = c.channelType === "PHONE" ? "phone" : "email"
    const noun = kind === "phone" ? "phone" : "email"
    const successor = channels.find((o) => o.channelType === c.channelType && c.effectiveTo && o.effectiveFrom === c.effectiveTo)
    const predecessor = channels.find((o) => o.channelType === c.channelType && o.effectiveTo && o.effectiveTo === c.effectiveFrom)
    add(c.createdAt ?? c.effectiveFrom, kind, c.changeReason === "CORRECTION" ? `${noun[0].toUpperCase()}${noun.slice(1)} corrected` : predecessor ? `${noun[0].toUpperCase()}${noun.slice(1)} changed` : `${noun[0].toUpperCase()}${noun.slice(1)} recorded`)
    if (c.effectiveTo && !successor) add(c.effectiveTo, kind, `${noun[0].toUpperCase()}${noun.slice(1)} removed (kept in history)`)
  }
  const titles = (view.titles ?? []).filter((t) => !t.recordStatus || t.recordStatus === "active")
  for (const t of titles) {
    if (isDesignationWord(t.titleDisplay)) continue
    const predecessor = titles.find((o) => o.effectiveTo && o.effectiveTo === t.effectiveFrom)
    add(t.createdAt ?? t.effectiveFrom, "role", `Role ${predecessor ? "changed" : "set"} to ${t.titleDisplay}`)
    if (t.effectiveTo && !titles.some((o) => o.effectiveFrom === t.effectiveTo)) add(t.effectiveTo, "role", "Role cleared")
  }
  for (const p of (view.purposes ?? []).filter((x) => x.purpose === "PRIMARY" && x.isPrimary && (!x.recordStatus || x.recordStatus === "active"))) {
    add(p.createdAt ?? p.effectiveFrom, "primary", `Designated Primary Contact for ${companyName}`)
    if (p.effectiveTo) add(p.effectiveTo, "primary", `Primary Contact designation ended`)
  }
  add(view.relationship.createdAt ?? view.relationship.effectiveFrom, "relation-start", `Associated with ${companyName}`)
  if (view.relationship.effectiveTo) add(view.relationship.effectiveTo, "relation-end", `Association with ${companyName} ended (kept in history)`)
  for (const x of exclusions.filter((e) => e.relationshipId === view.relationship.id && e.recordStatus === "active")) {
    add(x.effectiveFrom, "operational-email", `Stopped copying on operational email (${x.instructionSource.toLowerCase().replace(/_/g, " ")})`)
    if (x.effectiveTo) add(x.effectiveTo, "operational-email", "Copying on operational email resumed")
  }

  // Cluster rows written together (same transaction or the same save) into one operation.
  parts.sort((a, b) => ms(a.at) - ms(b.at))
  const groups: Part[][] = []
  for (const part of parts) {
    const last = groups[groups.length - 1]
    // A creation event may only absorb details from that initial creation; never merge a later
    // update into "Contact Created" just because the operator saved again within 1.5 seconds.
    const lastIsCreation = last?.some((entry) => entry.kind === "create") ?? false
    const partIsCreation = part.kind === "create"
    const isCreationDetail = part.kind === "relation-start" || part.kind === "email" || part.kind === "phone" || part.kind === "role" || part.kind === "primary"
    const canJoinCreation = !lastIsCreation || (isCreationDetail && !partIsCreation)
    if (last && canJoinCreation && ms(part.at) - ms(last[last.length - 1].at) <= GROUP_WINDOW_MS) last.push(part)
    else groups.push([part])
  }
  const events: ContactEvent[] = groups.map((group, index) => {
    const kinds = new Set(group.map((p) => p.kind))
    const only = (...allowed: Part["kind"][]) => [...kinds].every((k) => allowed.includes(k))
    let label = "Contact Updated"
    let action: ContactEvent["action"] = "CONTACT_UPDATED"
    let summary = group.map((p) => p.text).join("; ") + "."
    if (kinds.has("create")) {
      label = "Contact Created"
      action = "CREATED"
      const extras = group.filter((p) => p.kind !== "create" && p.kind !== "relation-start").map((p) => p.text.replace(/ recorded$/, "").replace(/^Role set to /, "role ").replace(/^Designated Primary Contact.*/, "Primary Contact").toLowerCase())
      summary = `${group.find((p) => p.kind === "create")!.text.replace("Contact created: ", "")} was added${extras.length ? ` with ${extras.join(", ")}` : ""}.`
    } else if (only("primary")) { label = "Primary Contact Changed"; action = "PRIMARY_CHANGED" }
    else if (only("relation-end")) { label = "Contact Archived"; action = "ARCHIVED" }
    else if (only("relation-start")) { label = "Contact Restored"; action = "RESTORED" }
    else if (only("operational-email")) { label = "Operational Email Preference Changed"; action = "CONTACT_UPDATED" }
    else if (only("role")) { label = "Role Updated"; action = "ROLE_UPDATED" }
    return { id: `op-${group[0].at}-${index}`, timestamp: group[group.length - 1].at, action, label, summary, actor: "Recorded in the Master Register" }
  })
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
      events: eventsOf(cv, company.name, view.operationalEmailExclusions),
      createdAt: cv.person.createdAt ?? cv.relationship.createdAt ?? cv.relationship.effectiveFrom,
      updatedAt: cv.relationship.effectiveTo ?? cv.relationship.effectiveFrom,
    } satisfies Contact
  })
}
