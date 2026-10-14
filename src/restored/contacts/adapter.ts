// Canonical adapter for the restored Contacts UI.
//
// Hydrates the model the ORIGINAL components expect from the canonical contacts domain (PostgreSQL, through the company
// Contacts API) and implements the original component callbacks as canonical operations. Nothing here touches browser
// storage; nothing is invented:
//
//   original concept            canonical home
//   --------------------------  ---------------------------------------------------------------------------------
//   person + name               persons + person_name_versions (change = real-world, correct = recorded in error)
//   relationship with company   organization_person_relationships (ending keeps history; titles/purposes end with it)
//   role (STANDARD_ROLES)       organization_person_titles (free text with history; NOT a purpose)
//   primary contact             contact_purpose_assignments, purpose PRIMARY (single per company)
//   phone / email               person_channels (PHONE / EMAIL)
//   archived                    relationship ended (+ person archived when no other relationship is open)
//   dob / driver licence / notes / evidence / OCR     NO canonical home: shown as "Not recorded"; saving them is refused
//
// The adapter is transport-agnostic (`ContactsTransport`), so the browser uses fetch and the tests use the very same route
// dispatch in process.

import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable";
import type { ChannelRecord, ContactView, OrganizationContactsView, PersonMatch, PurposeAssignmentRecord, TitleRecord } from "@/lib/contacts/types";
import { displayCode } from "./contact-helpers";
import type { Contact, ContactEvent, Relationship } from "./types";

export type ContactsTransport = {
  read(): Promise<OrganizationContactsView>;
  act(payload: Record<string, unknown>): Promise<unknown>;
};

export class ContactsRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ContactsRequestError";
    this.status = status;
  }
}

/** Transport over the company Contacts API (browser). The company id is in the URL; the body never names a company. */
export function fetchContactsTransport(companyId: string): ContactsTransport {
  const base = `/api/companies/${encodeURIComponent(companyId)}/contacts`;
  return {
    async read() {
      let response: Response;
      try {
        response = await fetch(base, { cache: "no-store" });
      } catch {
        throw new ContactsRequestError("Contacts could not be loaded. This is a temporary error, not an empty list.");
      }
      if (response.status === 403) throw new ContactsRequestError("You are not permitted to view this company's contacts.", 403);
      if (!response.ok) throw new ContactsRequestError("Contacts could not be loaded. This is a temporary error, not an empty list.", response.status);
      return (await response.json()) as OrganizationContactsView;
    },
    async act(payload) {
      let response: Response;
      try {
        response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      } catch {
        throw new ContactsRequestError("The change could not be saved (the request did not complete).");
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new ContactsRequestError(body?.error ?? "The change could not be saved.", response.status);
      return body;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// canonical -> original model
// ---------------------------------------------------------------------------------------------------------------------

const NOT_RECORDED_DATE = "";
const dateOnly = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : NOT_RECORDED_DATE);
const genuine = <T extends { recordStatus: string }>(rows: T[]): T[] => rows.filter((row) => row.recordStatus === "active");
const byRecent = <T extends { effectiveFrom: string; createdAt: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (b.effectiveFrom === a.effectiveFrom ? b.createdAt.localeCompare(a.createdAt) : b.effectiveFrom.localeCompare(a.effectiveFrom)));

const fullName = (given: string | null | undefined, family: string | null | undefined) => [given, family].filter(Boolean).join(" ");

function eventsOf(view: ContactView, companyName: string): ContactEvent[] {
  const events: ContactEvent[] = [];
  const add = (id: string, timestamp: string, action: ContactEvent["action"], summary: string) =>
    events.push({ id, timestamp, action, summary, actor: "Recorded in the Master Register" });

  add(`rel-${view.relationship.id}`, view.relationship.createdAt, "RELATIONSHIP_ADDED", `Associated with ${companyName} (effective ${dateOnly(view.relationship.effectiveFrom)}).`);
  if (view.relationship.effectiveTo) add(`rel-end-${view.relationship.id}`, view.relationship.effectiveTo, "STATUS_CHANGED", `Contact ended at ${companyName} (kept in history).`);
  if (view.person.archivedAt) add(`archived-${view.person.id}`, view.person.archivedAt, "ARCHIVED", "Person record archived (kept in history).");

  const lifecycle = (kind: string, id: string, row: { changeReason: string; recordStatus: string; createdAt: string; correctedAt: string | null; effectiveTo: string | null }, what: string, action: ContactEvent["action"]) => {
    if (row.recordStatus !== "active") {
      add(`${kind}-${id}-wrong`, row.correctedAt ?? row.createdAt, action, `${what} was recorded in error (kept in history, flagged ${row.recordStatus}).`);
      return;
    }
    const verb = row.changeReason === "INITIAL" ? "recorded" : row.changeReason === "CHANGE" ? "changed to" : "corrected to";
    add(`${kind}-${id}`, row.createdAt, action, row.changeReason === "CHANGE" ? `Changed to ${what}.` : row.changeReason === "CORRECTION" ? `Corrected to ${what}.` : `${what} ${verb}.`);
    if (row.effectiveTo) add(`${kind}-${id}-end`, row.effectiveTo, action, `${what} ended (kept in history).`);
  };
  for (const name of view.names) lifecycle("name", name.id, name, `Name "${fullName(name.givenName, name.familyName)}"`, name.changeReason === "INITIAL" ? "CREATED" : "CONTACT_UPDATED");
  for (const channel of view.channels) lifecycle("channel", channel.id, channel, `${channel.channelType === "PHONE" ? "Phone" : "Email"} ${channel.valueDisplay}`, "CONTACT_UPDATED");
  for (const title of view.titles) lifecycle("title", title.id, title, `Role "${title.titleDisplay}"`, "ROLE_UPDATED");
  for (const purpose of view.purposes) lifecycle("purpose", purpose.id, purpose, `Purpose ${purpose.purpose}${purpose.isPrimary ? " (primary)" : ""}`, purpose.isPrimary ? "PRIMARY_CHANGED" : "ROLE_UPDATED");
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function roleTitle(view: ContactView): TitleRecord | null {
  const current = byRecent(view.current.titles)[0];
  if (current) return current;
  // An ended contact keeps its last genuine title as history; show it, but it is not a current title.
  const ended = genuine(view.titles).sort((a, b) => (b.effectiveTo ?? "").localeCompare(a.effectiveTo ?? ""))[0];
  return ended ?? null;
}

function mapOne(view: ContactView, all: ContactView[], company: { id: string; name: string }): Contact {
  const ended = view.relationship.effectiveTo !== null;
  const name = view.current.name;
  const phone = byRecent(view.current.channels.filter((c: ChannelRecord) => c.channelType === "PHONE"))[0];
  const email = byRecent(view.current.channels.filter((c: ChannelRecord) => c.channelType === "EMAIL"))[0];
  const title = roleTitle(view);
  const primary = view.current.purposes.find((p: PurposeAssignmentRecord) => p.purpose === "PRIMARY" && p.isPrimary) ?? null;
  const isArchived = ended || view.person.recordStatus === "archived";

  const relationships: Relationship[] = all.map((v) => ({
    id: v.relationship.id,
    companyId: company.id,
    companyName: company.name,
    role: roleTitle(v)?.titleDisplay ?? "",
    isPrimary: v.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary),
    status: v.relationship.effectiveTo === null ? "active" : "ended",
    startDate: dateOnly(v.relationship.effectiveFrom),
    endDate: v.relationship.effectiveTo ? dateOnly(v.relationship.effectiveTo) : undefined,
    source: "system",
  }));

  return {
    id: displayCode("CNT", view.relationship.id),
    globalId: displayCode("PER", view.person.id),
    firstName: name?.givenName ?? "",
    lastName: name?.familyName ?? "",
    dob: "",
    dlNumber: "",
    dlState: "",
    dlExpiry: "",
    dlIssueDate: "",
    dlClass: "",
    dlRestrictions: "",
    email: email?.valueDisplay ?? "",
    phone: phone?.valueDisplay ?? "",
    role: title?.titleDisplay ?? "",
    isPrimary: primary !== null,
    isArchived,
    notes: "",
    identityStatus: "unverified",
    relationships,
    evidence: [],
    events: all.flatMap((v) => eventsOf(v, company.name)).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    createdAt: view.person.createdAt,
    updatedAt: view.person.createdAt,
    canonical: {
      relationshipId: view.relationship.id,
      personId: view.person.id,
      relationshipEnded: ended,
      personArchived: view.person.recordStatus === "archived",
      phone: phone ? { channelId: phone.id, value: phone.valueDisplay } : null,
      email: email ? { channelId: email.id, value: email.valueDisplay } : null,
      title: !ended && title ? { id: title.id, text: title.titleDisplay } : null,
      titles: byRecent(view.current.titles).map((t) => ({ id: t.id, text: t.titleDisplay })),
      purposes: view.current.purposes.map((p) => ({ id: p.id, purpose: p.purpose, isPrimary: p.isPrimary })),
      primaryAssignmentId: primary?.id ?? null,
      givenName: name?.givenName ?? "",
      familyName: name?.familyName ?? "",
    },
  };
}

/**
 * One displayed contact per person at this company: the open relationship when there is one, otherwise the most recent
 * ended one (a restored contact has a new relationship; the earlier, ended one stays in its history). Voided relationships
 * (entered in error) are not contacts.
 */
export function mapContacts(view: OrganizationContactsView, company: { id: string; name: string }): Contact[] {
  const byPerson = new Map<string, ContactView[]>();
  for (const contact of view.contacts) {
    if (contact.relationship.recordStatus !== "active") continue;
    byPerson.set(contact.person.id, [...(byPerson.get(contact.person.id) ?? []), contact]);
  }
  const contacts: Contact[] = [];
  for (const group of byPerson.values()) {
    const open = group.find((v) => v.relationship.effectiveTo === null);
    const chosen = open ?? [...group].sort((a, b) => (b.relationship.effectiveTo ?? "").localeCompare(a.relationship.effectiveTo ?? ""))[0];
    contacts.push(mapOne(chosen, group, company));
  }
  return contacts;
}

// ---------------------------------------------------------------------------------------------------------------------
// planned operations
// ---------------------------------------------------------------------------------------------------------------------

export type PlannedStep = { label: string; payload: Record<string, unknown> };
export type StepResult = { label: string; ok: boolean; message?: string };
export type OperationReport = {
  results: StepResult[];
  failed: StepResult[];
  /** Informational, non-error outcomes (for example "the person was not archived because ...") */
  notices: string[];
  /** The response of the last successful step that returned a contact view (used to select a new contact). */
  lastView: ContactView | null;
};

export type RecordAs = "change" | "correct";

export type EditForm = {
  firstName?: string;
  lastName?: string;
  dob?: string;
  dlNumber?: string;
  dlState?: string;
  dlExpiry?: string;
  dlIssueDate?: string;
  dlClass?: string;
  dlRestrictions?: string;
  email?: string;
  phone?: string;
  notes?: string;
  companyRole?: string;
  isPrimary?: boolean;
  /** How edits to name, phone, email and role are recorded: a real-world change keeps history; a correction flags the wrong value. */
  recordAs?: RecordAs;
};

export type ManualForm = {
  firstName: string;
  lastName: string;
  dob: string;
  dlNumber: string;
  dlState: string;
  dlExpiry: string;
  dlIssueDate: string;
  dlClass: string;
  dlRestrictions: string;
  email: string;
  phone: string;
  role: string;
  isPrimary: boolean;
  notes: string;
};

const trim = (value: string | undefined | null) => (value ?? "").trim();

export const NO_HOME_REASON =
  "the contacts record has no field for date of birth, driver licence details or notes (driver licence and date of birth belong to the driver record, which is not connected to contacts), so nothing was saved";

/** Original licence-section field labels, for the unavailable message. The jurisdiction default ("ON") alone is not an entry. */
function noHomeFields(form: Partial<Pick<ManualForm, "dob" | "dlNumber" | "dlState" | "dlExpiry" | "dlIssueDate" | "dlClass" | "dlRestrictions" | "notes">>, initialJurisdiction: string): string[] {
  const out: string[] = [];
  if (trim(form.dob)) out.push("Date of Birth");
  if (trim(form.dlNumber)) out.push("Driver Licence #");
  if (trim(form.dlExpiry)) out.push("Licence Expiry");
  if (trim(form.dlIssueDate)) out.push("Licence Issue Date");
  if (trim(form.dlClass)) out.push("Licence Class");
  if (trim(form.dlRestrictions)) out.push("Restrictions");
  if (trim(form.notes)) out.push("Notes");
  if (trim(form.dlState) && trim(form.dlState) !== initialJurisdiction && out.length === 0) out.push("Licence Jurisdiction");
  return out;
}

export function assertNoUnrecordableFields(form: Parameters<typeof noHomeFields>[0], initialJurisdiction = "ON"): void {
  const fields = noHomeFields(form, initialJurisdiction);
  if (fields.length > 0) throw new CanonicalOperationUnavailableError(`Saving ${fields.join(", ")}`, NO_HOME_REASON);
}

/** Validation the original forms performed. Returns field errors (empty when valid). */
export function validateContactForm(form: { firstName?: string; lastName?: string; phone?: string; email?: string }, phoneMessage: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!trim(form.firstName)) errors.firstName = "First name is required";
  if (!trim(form.lastName)) errors.lastName = "Last name is required";
  if (!trim(form.phone) && !trim(form.email)) errors.phone = phoneMessage;
  return errors;
}

/** The canonical request for the original Manual Add form. Refuses (before anything is written) what has no canonical home. */
export function planCreate(form: ManualForm): PlannedStep {
  assertNoUnrecordableFields(form);
  const channels = [
    trim(form.phone) ? { type: "PHONE", value: trim(form.phone) } : null,
    trim(form.email) ? { type: "EMAIL", value: trim(form.email) } : null,
  ].filter(Boolean);
  return {
    label: "Create contact",
    payload: {
      action: "createContact",
      name: { givenName: trim(form.firstName), familyName: trim(form.lastName) },
      titles: trim(form.role) ? [trim(form.role)] : [],
      purposes: form.isPrimary ? [{ purpose: "PRIMARY", primary: true }] : [],
      channels,
    },
  };
}

/** The canonical steps behind the original Edit form. Refuses (before anything is written) what has no canonical home. */
export function planEdit(contact: Contact, form: EditForm): PlannedStep[] {
  const ref = contact.canonical;
  if (ref.relationshipEnded || contact.isArchived) throw new CanonicalOperationUnavailableError("Editing an archived contact", "restore the contact first; an ended relationship cannot be edited");
  assertNoUnrecordableFields(form, "ON");

  const recordAs: RecordAs = form.recordAs ?? "change";
  const steps: PlannedStep[] = [];

  const given = trim(form.firstName);
  const family = trim(form.lastName);
  if (given !== ref.givenName || family !== ref.familyName) {
    steps.push({ label: recordAs === "correct" ? "Correct name" : "Change name", payload: { action: recordAs === "correct" ? "correctName" : "changeName", personId: ref.personId, givenName: given, familyName: family } });
  }

  const channelStep = (type: "PHONE" | "EMAIL", wanted: string, current: { channelId: string; value: string } | null): void => {
    const label = type === "PHONE" ? "phone" : "email";
    if (wanted === (current?.value ?? "")) return;
    if (!current) steps.push({ label: `Add ${label}`, payload: { action: "addPersonChannel", personId: ref.personId, channel: { type, value: wanted } } });
    else if (wanted === "") steps.push({ label: recordAs === "correct" ? `Remove ${label} (recorded in error)` : `End ${label}`, payload: { action: recordAs === "correct" ? "voidPersonChannel" : "endPersonChannel", personId: ref.personId, channelId: current.channelId } });
    else steps.push({ label: recordAs === "correct" ? `Correct ${label}` : `Change ${label}`, payload: { action: recordAs === "correct" ? "correctPersonChannel" : "changePersonChannel", personId: ref.personId, channelId: current.channelId, value: wanted } });
  };
  channelStep("PHONE", trim(form.phone), ref.phone);
  channelStep("EMAIL", trim(form.email), ref.email);

  const role = trim(form.companyRole);
  const currentRole = ref.title?.text ?? "";
  if (role !== currentRole) {
    if (!ref.title) steps.push({ label: "Add role", payload: { action: "addTitle", relationshipId: ref.relationshipId, title: role } });
    else if (role === "") steps.push({ label: recordAs === "correct" ? "Remove role (recorded in error)" : "End role", payload: { action: recordAs === "correct" ? "voidTitle" : "endTitle", titleId: ref.title.id } });
    else steps.push({ label: recordAs === "correct" ? "Correct role" : "Change role", payload: { action: recordAs === "correct" ? "correctTitle" : "changeTitle", titleId: ref.title.id, title: role } });
  }

  if (!!form.isPrimary !== contact.isPrimary) {
    if (form.isPrimary) steps.push({ label: "Designate as Primary Contact", payload: { action: "makePrimary", relationshipId: ref.relationshipId, purpose: "PRIMARY" } });
    else if (ref.primaryAssignmentId) steps.push({ label: "Remove Primary Contact designation", payload: { action: "endPurpose", assignmentId: ref.primaryAssignmentId } });
  }
  return steps;
}

export function planSetPrimary(contact: Contact): PlannedStep {
  const ref = contact.canonical;
  if (ref.relationshipEnded) throw new CanonicalOperationUnavailableError("Changing the Primary Contact of an archived contact", "restore the contact first");
  if (contact.isPrimary && ref.primaryAssignmentId) return { label: "Remove Primary Contact designation", payload: { action: "endPurpose", assignmentId: ref.primaryAssignmentId } };
  return { label: "Designate as Primary Contact", payload: { action: "makePrimary", relationshipId: ref.relationshipId, purpose: "PRIMARY" } };
}

// ---------------------------------------------------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------------------------------------------------

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

const isContactView = (value: unknown): value is ContactView => Boolean(value && typeof value === "object" && "relationship" in value && "person" in value);

/**
 * Runs steps in order, each as its own canonical operation (its own transaction and Master Register event). A failing step is
 * reported and the remaining steps still run: the steps are independent facts, so one refusal must not hide or block the
 * others. Nothing is reported as saved unless its operation succeeded.
 */
export async function runSteps(transport: ContactsTransport, steps: PlannedStep[]): Promise<OperationReport> {
  const report: OperationReport = { results: [], failed: [], notices: [], lastView: null };
  for (const step of steps) {
    try {
      const body = await transport.act(step.payload);
      const created = body && typeof body === "object" && "contact" in body ? (body as { contact: unknown }).contact : body;
      if (isContactView(created)) report.lastView = created;
      report.results.push({ label: step.label, ok: true });
    } catch (error) {
      const failure = { label: step.label, ok: false, message: message(error, "The change could not be saved.") };
      report.results.push(failure);
      report.failed.push(failure);
    }
  }
  return report;
}

export const summarize = (report: OperationReport): string | null =>
  report.failed.length === 0 ? null : `${report.failed.length} of ${report.results.length} change${report.results.length === 1 ? "" : "s"} could not be saved: ${report.failed.map((r) => `${r.label} (${r.message})`).join("; ")}. ${report.results.length - report.failed.length} saved.`;

/**
 * Archive = the contact's relationship with this company ENDS (its titles and purposes end with it) and, when the person has
 * no other open relationship, the person record is archived. Both are history-keeping; nothing is deleted. When the person is
 * still a contact elsewhere, archiving the person is refused by the domain and reported as a notice, not an error.
 */
export async function archiveContact(transport: ContactsTransport, contact: Contact): Promise<OperationReport> {
  const ref = contact.canonical;
  const report = await runSteps(transport, [{ label: "Archive contact (end relationship)", payload: { action: "endRelationship", relationshipId: ref.relationshipId } }]);
  if (report.failed.length > 0) return report;
  try {
    await transport.act({ action: "archivePerson", personId: ref.personId });
    report.results.push({ label: "Archive person record", ok: true });
  } catch (error) {
    report.notices.push(`The contact was ended at this company. The person record stays active: ${message(error, "it could not be archived")}`);
  }
  return report;
}

/**
 * Restore = the person is restored if archived, then explicitly related to this company again (a NEW relationship; the ended
 * one stays in history) and the last role is re-recorded as a title. Purposes (including Primary) are not re-assigned: they
 * are separate facts that may have moved on, so they are left for the user to set again.
 */
export async function restoreContact(transport: ContactsTransport, contact: Contact, lastRole: string | null): Promise<OperationReport> {
  const ref = contact.canonical;
  const steps: PlannedStep[] = [];
  if (ref.personArchived) steps.push({ label: "Restore person record", payload: { action: "restorePerson", personId: ref.personId } });
  const head = await runSteps(transport, steps);
  if (head.failed.length > 0) return head;
  const relate = await runSteps(transport, [{ label: "Restore contact (relate to this company again)", payload: { action: "addRelationship", personId: ref.personId } }]);
  const report: OperationReport = { results: [...head.results, ...relate.results], failed: relate.failed, notices: [], lastView: relate.lastView };
  if (report.failed.length > 0 || !relate.lastView) return report;
  if (lastRole) {
    const role = await runSteps(transport, [{ label: "Re-record role", payload: { action: "addTitle", relationshipId: relate.lastView.relationship.id, title: lastRole } }]);
    report.results.push(...role.results);
    report.failed.push(...role.failed);
  }
  report.notices.push("Purposes, including Primary Contact, were not re-assigned; set them again if they still apply.");
  return report;
}

export async function findMatches(transport: ContactsTransport, query: { givenName?: string; familyName?: string; email?: string; phone?: string }): Promise<PersonMatch[]> {
  const body = (await transport.act({ action: "findMatches", query })) as { matches?: PersonMatch[] };
  return Array.isArray(body?.matches) ? body.matches : [];
}

export type { OrganizationContactsView };
