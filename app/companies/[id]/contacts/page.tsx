"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Info, Upload, UserPlus, X } from "lucide-react";

import { CompanyMissing } from "@/components/company-missing";
import { LoadingState } from "@/src/components/shared/StateDisplays";
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";
import { ContactStats } from "@/src/components/contacts/ContactStats";
import { ContactDirectory } from "@/src/components/contacts/ContactDirectory";
import { ContactInspector } from "@/src/components/contacts/ContactInspector";
import { ManualContactDialog } from "@/src/components/contacts/ManualContactDialog";
import {
  isPrimaryContact,
  personEmail,
  personPhone,
  toUiContacts,
  type CanonicalContactsView,
  type CanonicalContactView,
} from "@/src/components/contacts/canonical-adapter";
import { ALL_JURISDICTIONS, STANDARD_ROLES, findDuplicateContact, isWithinThreeYears } from "@/src/components/contacts/contact-helpers";
import type { Contact } from "@/src/components/contacts/types";
import { CompanyLines } from "./company-lines";

/** Why the identity-document fields and Document / OCR intake are switched off here (shown wherever they would have been used). */
const IDENTITY_NOT_STORED =
  "Date of birth, driver licence details and identity documents are not stored in Contacts: they belong to the Drivers and evidence workflows. Nothing is kept in this browser.";
const OCR_UNAVAILABLE =
  "Document / OCR intake is not available here yet: its scans and drafts could only be kept in this browser, and Contacts does not store identity documents.";

type Company = { id: string; name: string; kind?: string; status?: string };
type LoadState = "loading" | "ready" | "denied" | "error" | "missing";

const EMPTY_FORM = {
  firstName: "", lastName: "", dob: "", dlNumber: "", dlState: "ON", dlExpiry: "", dlIssueDate: "", dlClass: "", dlRestrictions: "",
  email: "", phone: "", role: "Safety Manager", isPrimary: false, notes: "",
};

const sameWords = (a: string, b: string) => a.toLowerCase().split(/\s+/).filter(Boolean).join(" ") === b.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

// =========================================================================
// CONTACTS PAGE: the company's people and the company's own phone / email lines, from the canonical PostgreSQL contacts domain.
// Authorization, tenant isolation and Master Register events are the server's; this page holds no data of its own.
// =========================================================================
export default function ContactsPage() {
  const params = useParams<{ id: string }>();
  const companyId = params?.id as string;
  const base = `/api/companies/${encodeURIComponent(companyId)}/contacts`;

  const [company, setCompany] = useState<Company | null>(null);
  const [view, setView] = useState<CanonicalContactsView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showOlderEvidence, setShowOlderEvidence] = useState(false);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Contact> & { companyRole?: string; isPrimary?: boolean }>({});
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({});
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState(EMPTY_FORM);
  const [manualFormErrors, setManualFormErrors] = useState<Record<string, string>>({});
  const [manualDuplicateWarning, setManualDuplicateWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [summary, contacts] = await Promise.all([
        fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" }),
        fetch(base, { cache: "no-store" }),
      ]);
      if (summary.status === 404) return setState("missing");
      if (summary.status === 403 || contacts.status === 403) return setState("denied");
      if (!summary.ok || !contacts.ok) return setState("error");
      setCompany((await summary.json()).company as Company);
      setView((await contacts.json()) as CanonicalContactsView);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [base, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link (?contact=<person id>) from the company profile and other workspaces.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("contact") ?? params.get("person");
    if (wanted) setSelectedContactId(wanted);
  }, []);

  const contacts = useMemo<Contact[]>(() => (view && company ? toUiContacts(view, { id: company.id, name: company.name }) : []), [view, company]);

  /** The canonical record behind a listed person (the open relationship when there is one). */
  const canonicalOf = (personId: string): CanonicalContactView | undefined => {
    const all = (view?.contacts ?? []).filter((contact) => contact.person.id === personId);
    return all.find((contact) => contact.relationship.effectiveTo === null) ?? all[all.length - 1];
  };

  /** One server action; stops at the first refusal and tells the user, never pretending a partial save completed. */
  const act = async (payload: Record<string, unknown>): Promise<{ ok: true; body: any } | { ok: false }> => {
    const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setActionError(body?.error ?? "The change could not be saved.");
      return { ok: false };
    }
    return { ok: true, body };
  };
  const run = async (work: () => Promise<boolean>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      const ok = await work();
      await load();
      return ok;
    } catch {
      setActionError("The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSelectContact = (id: string | null) => {
    setSelectedContactId(id);
    setIsEditing(false);
    setEditFormErrors({});
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("contact", id);
      else url.searchParams.delete("contact");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const companyContacts = useMemo(
    () =>
      contacts.filter((c) => {
        if (!includeArchived && c.isArchived) return false;
        if (roleFilter !== "all" && c.role !== roleFilter) return false;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || c.role.toLowerCase().includes(q);
      }),
    [contacts, includeArchived, roleFilter, searchQuery],
  );
  const sortedCompanyContacts = useMemo(
    () => [...companyContacts].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)),
    [companyContacts],
  );
  const selectedContact = useMemo(() => contacts.find((c) => c.id === selectedContactId) ?? null, [contacts, selectedContactId]);
  const selectedContactRelationship = selectedContact?.relationships[0] ?? null;

  // --- Edit -------------------------------------------------------------------------------------------------------------
  const handleStartEdit = (contact: Contact) => {
    setEditFormData({
      firstName: contact.firstName, lastName: contact.lastName, dob: "", dlNumber: "", dlState: "ON", dlExpiry: "", dlIssueDate: "", dlClass: "", dlRestrictions: "",
      email: contact.email, phone: contact.phone, notes: "", companyRole: contact.role, isPrimary: contact.isPrimary,
    });
    setEditFormErrors({});
    setIsEditing(true);
  };
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditFormData({});
    setEditFormErrors({});
  };

  const handleSaveEdit = async () => {
    if (!selectedContact) return;
    const cv = canonicalOf(selectedContact.id);
    if (!cv) return;
    const first = (editFormData.firstName ?? "").trim();
    const last = (editFormData.lastName ?? "").trim();
    if (!first && !last) return setEditFormErrors({ firstName: "A name is required" });
    const email = (editFormData.email ?? "").trim();
    const phone = (editFormData.phone ?? "").trim();
    const role = (editFormData.companyRole ?? "").trim();
    const wantsPrimary = !!editFormData.isPrimary;
    const orgPerson = { personId: cv.person.id };

    const done = await run(async () => {
      // Name: a restructure of the same words is a correction; a different name is a change. Both keep the earlier name as history.
      const current = cv.current.name;
      if (first !== (current?.givenName ?? "") || last !== (current?.familyName ?? "")) {
        const before = [current?.givenName, current?.familyName].filter(Boolean).join(" ");
        const result = await act({ action: sameWords(before, `${first} ${last}`) ? "correctName" : "changeName", ...orgPerson, givenName: first || null, familyName: last || null });
        if (!result.ok) return false;
      }
      // Email and phone are THIS PERSON's own channels (the company's lines are separate): editing one never touches the company.
      for (const [type, value, existing, preferred] of [["EMAIL", email, personEmail(cv), true], ["PHONE", phone, personPhone(cv), false]] as const) {
        if (existing && !value) {
          if (!(await act({ action: "endPersonChannel", ...orgPerson, channelId: existing.id })).ok) return false;
        } else if (!existing && value) {
          if (!(await act({ action: "addPersonChannel", ...orgPerson, channel: { type, value, preferred } })).ok) return false;
        } else if (existing && value && value.toLowerCase() !== existing.valueDisplay.toLowerCase()) {
          if (!(await act({ action: "changePersonChannel", ...orgPerson, channelId: existing.id, value })).ok) return false;
        }
      }
      if (role && role !== selectedContact.role) {
        const title = cv.current.titles[0];
        const result = title ? await act({ action: "changeTitle", titleId: title.id, title: role }) : await act({ action: "addTitle", relationshipId: cv.relationship.id, title: role });
        if (!result.ok) return false;
      }
      if (wantsPrimary !== isPrimaryContact(cv)) {
        const assignment = cv.current.purposes.find((p) => p.purpose === "PRIMARY" && p.isPrimary);
        const result = wantsPrimary ? await act({ action: "makePrimary", relationshipId: cv.relationship.id, purpose: "PRIMARY" }) : assignment ? await act({ action: "endPurpose", assignmentId: assignment.id }) : { ok: true as const, body: null };
        if (!result.ok) return false;
      }
      return true;
    });
    if (done) setIsEditing(false);
  };

  // --- Add --------------------------------------------------------------------------------------------------------------
  const openManual = () => {
    setManualForm(EMPTY_FORM);
    setManualFormErrors({});
    setManualDuplicateWarning(null);
    setIsManualModalOpen(true);
  };

  const handleManualSave = async () => {
    const first = manualForm.firstName.trim();
    const last = manualForm.lastName.trim();
    if (!first && !last) return setManualFormErrors({ firstName: "A name is required" });
    setManualFormErrors({});
    // Already on THIS company's list: refuse here. A person elsewhere with the same name is only reported afterwards, never linked or merged by name.
    const duplicate = findDuplicateContact({ firstName: first, lastName: last, dob: "", dlNumber: "", email: manualForm.email, phone: manualForm.phone }, contacts.filter((c) => !c.isArchived));
    if (duplicate.match) return setManualDuplicateWarning(`${duplicate.reason} It is already a contact of ${company?.name ?? "this company"}: open it from the list to edit it.`);
    setManualDuplicateWarning(null);

    const ok = await run(async () => {
      const email = manualForm.email.trim();
      const phone = manualForm.phone.trim();
      const created = await act({
        action: "createContact",
        name: { ...(first ? { givenName: first } : {}), ...(last ? { familyName: last } : {}) },
        titles: manualForm.role ? [manualForm.role] : [],
        channels: [...(email ? [{ type: "EMAIL", value: email, preferred: true }] : []), ...(phone ? [{ type: "PHONE", value: phone }] : [])],
      });
      if (!created.ok) return false;
      const personId: string | undefined = created.body?.contact?.person?.id;
      if (personId) setSelectedContactId(personId);
      if (manualForm.isPrimary) {
        const primary = await act({ action: "makePrimary", relationshipId: created.body.contact.relationship.id, purpose: "PRIMARY" });
        if (!primary.ok) return false;
      }
      const matches: Array<{ displayName: string }> = Array.isArray(created.body?.matches) ? created.body.matches : [];
      setNotice(matches.length > 0 ? `Possible existing people (review only; nothing was merged): ${matches.map((m) => m.displayName).join(", ")}.` : null);
      return true;
    });
    if (ok) setIsManualModalOpen(false);
  };

  // --- Primary and archive ---------------------------------------------------------------------------------------------------
  const handleSetPrimary = (contact: Contact) => {
    const cv = canonicalOf(contact.id);
    if (!cv) return;
    void run(async () => {
      const assignment = cv.current.purposes.find((p) => p.purpose === "PRIMARY" && p.isPrimary);
      const result = assignment ? await act({ action: "endPurpose", assignmentId: assignment.id }) : await act({ action: "makePrimary", relationshipId: cv.relationship.id, purpose: "PRIMARY" });
      return result.ok;
    });
  };

  const handleToggleArchive = (contact: Contact) => {
    const cv = canonicalOf(contact.id);
    if (!cv) return;
    void run(async () => {
      if (!contact.isArchived) return (await act({ action: "endRelationship", relationshipId: cv.relationship.id })).ok;
      // Restore: the SAME person is associated again (a person record is never recreated or duplicated).
      if (cv.person.recordStatus === "archived" && !(await act({ action: "restorePerson", personId: cv.person.id })).ok) return false;
      return (await act({ action: "addRelationship", personId: cv.person.id })).ok;
    });
  };

  // --- Rendering --------------------------------------------------------------------------------------------------------------
  if (state === "loading") {
    return (
      <div className="p-10">
        <LoadingState message="Loading company contacts..." />
      </div>
    );
  }
  if (state === "missing") return <CompanyMissing failed={false} />;
  if (state === "denied") return <div role="alert" className="p-10 text-center text-sm">You are not permitted to view this company&apos;s contacts.</div>;
  if (state === "error" || !company || !view) return <CompanyMissing failed />;

  const contactsActions = (
    <>
      <button
        type="button"
        onClick={openManual}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2 text-xs font-semibold hover:bg-muted text-foreground transition-colors shadow-2xs"
      >
        <UserPlus className="size-3.5" />
        Manual Add
      </button>
      <button
        type="button"
        disabled
        title={OCR_UNAVAILABLE}
        aria-label={`Document / OCR unavailable. ${OCR_UNAVAILABLE}`}
        className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground opacity-50 shadow-2xs"
      >
        <Upload className="size-3.5" />
        Document / OCR
      </button>
    </>
  );

  return (
    <div className="flex flex-col gap-6 pb-12">
      <CompanyWorkspaceHeader
        company={{ id: company.id, name: company.name, kind: String(company.kind || ""), status: String(company.status || "") }}
        section="Contacts"
        description="Personnel register, company relationships and company phone and email lines."
        actions={contactsActions}
      />

      {actionError && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          <span>{actionError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setActionError(null)} className="hover:opacity-80 p-1">
            <X className="size-4" />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="p-1 hover:opacity-80">
            <X className="size-4" />
          </button>
        </div>
      )}
      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>Identity stays Unverified until it is supported by verification evidence. {IDENTITY_NOT_STORED}</span>
      </p>

      <ContactStats contacts={contacts} companyId={companyId} />
      <CompanyLines
        channels={view.currentChannels}
        busy={busy}
        onAdd={(channel) => void run(async () => (await act({ action: "addChannel", channel })).ok)}
        onEnd={(channelId) => void run(async () => (await act({ action: "endChannel", channelId })).ok)}
      />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <ContactDirectory {...{ sortedCompanyContacts, selectedContact, selectedContactId, companyId, searchQuery, setSearchQuery, roleFilter, setRoleFilter, includeArchived, setIncludeArchived, STANDARD_ROLES, handleSelectContact, handleSetPrimary, setIsManualModalOpen: () => openManual() }} />
        <ContactInspector
          {...{ selectedContact, selectedContactRelationship, companyId, isEditing, editFormData, setEditFormData, editFormErrors, editDuplicateWarning: null, showOlderEvidence, setShowOlderEvidence, STANDARD_ROLES, ALL_JURISDICTIONS, isWithinThreeYears, handleStartEdit, handleToggleArchive, handleSelectContact, handleCancelEdit, handleSaveEdit: () => void handleSaveEdit() }}
          setPreviewEvidence={() => undefined}
          companyName={company.name}
          identityFieldsNote={IDENTITY_NOT_STORED}
        />
      </div>
      <ManualContactDialog
        {...{ isManualModalOpen, manualForm, setManualForm, manualFormErrors, manualDuplicateWarning, STANDARD_ROLES, ALL_JURISDICTIONS, setIsManualModalOpen, handleManualSave: () => void handleManualSave() }}
        companyName={company.name}
        identityFieldsNote={IDENTITY_NOT_STORED}
      />
    </div>
  );
}
