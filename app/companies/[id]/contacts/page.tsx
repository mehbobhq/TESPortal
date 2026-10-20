"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Info, Upload, UserPlus, X } from "lucide-react";

import { CompanyMissing } from "@/components/company-missing";
import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate";
import LegacyContactsPage from "./legacy-contacts";
import { LoadingState } from "@/src/components/shared/StateDisplays";
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";
import { ContactStats } from "@/src/components/contacts/ContactStats";
import { ContactDirectory } from "@/src/components/contacts/ContactDirectory";
import { ContactInspector, type OperationalEmailControl } from "@/src/components/contacts/ContactInspector";
import { ManualContactDialog } from "@/src/components/contacts/ManualContactDialog";
import {
  toUiContacts,
  type CanonicalContactsView,
  type CanonicalContactView,
} from "@/src/components/contacts/canonical-adapter";
import { ALL_JURISDICTIONS, CANADIAN_PROVINCES, STANDARD_ROLES, findDuplicateContact, isWithinThreeYears } from "@/src/components/contacts/contact-helpers";
import type { Contact } from "@/src/components/contacts/types";

const IDENTITY_NOTE =
  "Identity stays Unverified until it is supported by verification evidence. Entering a date of birth or driver licence number records data; it does not verify identity.";
const IDENTITY_NO_PERMISSION =
  "Date of birth and driver licence details are restricted. Recording them needs both the Person Identity and Driver permissions.";
const OCR_UNAVAILABLE =
  "Document / OCR intake is not available here yet: its scans and drafts could only be kept in this browser, and Contacts does not store identity documents.";

type IdentityAccess = { read: boolean; manage: boolean; licenceRead: boolean; licenceManage: boolean };
type IdentityDetails = { personId: string; access: IdentityAccess; dateOfBirth: string | null; licence: { id: string; number: string; country: string; region: string; licenceClass: string | null; expiryDate: string | null } | null };

type Company = { id: string; name: string; kind?: string; status?: string };
type LoadState = "loading" | "ready" | "denied" | "error" | "missing";

const EMPTY_FORM = {
  firstName: "", lastName: "", dob: "", dlNumber: "", dlState: "ON", dlExpiry: "", dlIssueDate: "", dlClass: "",
  email: "", phone: "", role: "General Contact", isPrimary: false, notes: "",
};

const countryOf = (region: string) => (CANADIAN_PROVINCES.includes(region) ? "CA" : "US");

// =========================================================================
// CONTACTS PAGE: the company's people and the company's own phone / email lines, from the canonical PostgreSQL contacts domain.
// Authorization, tenant isolation and Master Register events are the server's; this page holds no data of its own.
// =========================================================================
function CanonicalContactsPage() {
  const params = useParams<{ id: string }>();
  const companyId = params?.id as string;
  const base = `/api/companies/${encodeURIComponent(companyId)}/contacts`;

  const [company, setCompany] = useState<Company | null>(null);
  const [view, setView] = useState<CanonicalContactsView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [identityAccess, setIdentityAccess] = useState<IdentityAccess | null>(null);
  const [identity, setIdentity] = useState<IdentityDetails | null>(null);
  const [identityNonce, setIdentityNonce] = useState(0);

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

  const identityUrl = `${base}/identity`;
  // What THIS actor may do with identity details (the server enforces it again on every write).
  useEffect(() => {
    fetch(identityUrl, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as IdentityDetails) : null))
      .then((body) => setIdentityAccess(body?.access ?? null))
      .catch(() => setIdentityAccess(null));
  }, [identityUrl]);

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
    // A save already in flight is never repeated (a double click used to send the same change twice and report the second as a failure).
    if (busy) return false;
    setBusy(true);
    setActionError(null);
    try {
      const ok = await work();
      await load();
      setIdentityNonce((n) => n + 1);
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
  const baseSelected = useMemo(() => contacts.find((c) => c.id === selectedContactId) ?? null, [contacts, selectedContactId]);
  useEffect(() => {
    setIdentity(null);
    if (!selectedContactId) return;
    let cancelled = false;
    fetch(`${identityUrl}?personId=${encodeURIComponent(selectedContactId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as IdentityDetails) : null))
      .then((body) => !cancelled && setIdentity(body))
      .catch(() => !cancelled && setIdentity(null));
    return () => {
      cancelled = true;
    };
  }, [selectedContactId, identityUrl, identityNonce]);
  // The canonical identity record (date of birth, licence) is laid over the listed contact; nothing is guessed when it is restricted or empty.
  const selectedContact = useMemo<Contact | null>(() => {
    if (!baseSelected) return null;
    if (!identity || !identity.access.read) return baseSelected;
    return {
      ...baseSelected,
      dob: identity.dateOfBirth ?? "",
      dlNumber: identity.licence?.number ?? "",
      dlState: identity.licence?.region ?? "",
      dlExpiry: identity.licence?.expiryDate ?? "",
      dlClass: identity.licence?.licenceClass ?? "",
    };
  }, [baseSelected, identity]);
  const selectedContactRelationship = selectedContact?.relationships[0] ?? null;

  // --- Edit -------------------------------------------------------------------------------------------------------------
  const handleStartEdit = (contact: Contact) => {
    setEditFormData({
      firstName: contact.firstName, lastName: contact.lastName, dob: contact.dob, dlNumber: contact.dlNumber, dlState: contact.dlState || "ON", dlExpiry: contact.dlExpiry, dlIssueDate: "", dlClass: contact.dlClass,
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

  /** What the identity fields of a form ask for, compared with the stored record: only a difference is sent, so an untouched field is never rewritten. */
  const identityChange = (form: { dob?: string; dlNumber?: string; dlState?: string; dlExpiry?: string; dlClass?: string }, stored: Contact | null) => {
    if (!identityAccess?.licenceManage) return undefined;
    const out: { dateOfBirth?: string | null; licence?: unknown } = {};
    const dob = (form.dob ?? "").trim();
    if (dob !== (stored?.dob ?? "")) out.dateOfBirth = dob || null;
    const number = (form.dlNumber ?? "").trim();
    const region = form.dlState || "ON";
    const expiry = (form.dlExpiry ?? "").trim();
    const klass = (form.dlClass ?? "").trim();
    const changed = number !== (stored?.dlNumber ?? "") || (number && (region !== (stored?.dlState || "ON") || expiry !== (stored?.dlExpiry ?? "") || klass !== (stored?.dlClass ?? "")));
    if (changed) out.licence = number ? { number, country: countryOf(region), region, licenceClass: klass || null, expiryDate: expiry || null } : null;
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const handleSaveEdit = async () => {
    if (!selectedContact) return;
    const first = (editFormData.firstName ?? "").trim();
    const last = (editFormData.lastName ?? "").trim();
    if (!first && !last) return setEditFormErrors({ firstName: "A name is required" });
    const role = (editFormData.companyRole ?? "").trim();
    // ONE request, ONE transaction: the server compares with the stored record and applies only what differs. It commits entirely or not at
    // all, so a failure here means nothing was changed (and a repeated save finds nothing left to do).
    const done = await run(async () => {
      const saved = await act({
        action: "saveContact",
        personId: selectedContact.id,
        name: { givenName: first || null, familyName: last || null },
        email: (editFormData.email ?? "").trim(),
        phone: (editFormData.phone ?? "").trim(),
        ...(role && role !== selectedContact.role ? { title: role } : {}),
        primary: !!editFormData.isPrimary,
        identity: identityChange(editFormData, selectedContact),
      });
      if (!saved.ok) return false;
      setNotice(null);
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
      const created = await act({
        action: "createContactFull",
        name: { ...(first ? { givenName: first } : {}), ...(last ? { familyName: last } : {}) },
        email: manualForm.email.trim(),
        phone: manualForm.phone.trim(),
        ...(manualForm.role && manualForm.role !== "General Contact" ? { title: manualForm.role } : {}),
        primary: manualForm.isPrimary,
        identity: identityChange(manualForm, null),
      });
      if (!created.ok) return false;
      const personId: string | undefined = created.body?.contact?.person?.id;
      if (personId) setSelectedContactId(personId);
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
      // Restore: the SAME person is associated again (a person record is never recreated or duplicated), in one transaction.
      return (await act({ action: "restoreContact", personId: cv.person.id })).ok;
    });
  };

  const operationalEmail: OperationalEmailControl | null = (() => {
    // Exclusions need migration 0035 COMPLETE: otherwise the control is not offered (the server would refuse with an explanation).
    if (!selectedContact || selectedContact.isArchived || view?.features?.operationalEmailExclusions === false) return null;
    const relationshipId = canonicalOf(selectedContact.id)?.relationship.id;
    if (!relationshipId) return null;
    const exclusion = (view?.operationalEmailExclusions ?? []).find((row) => row.relationshipId === relationshipId && row.recordStatus === "active" && row.effectiveTo === null);
    return {
      excluded: !!exclusion,
      since: exclusion?.effectiveFrom,
      source: exclusion?.instructionSource,
      canManage: true,
      onExclude: ({ source, reference }) => void run(async () => (await act({ action: "excludeFromOperationalEmail", relationshipId, source, reference })).ok),
      onResume: () => void run(async () => (await act({ action: "resumeOperationalEmail", exclusionId: exclusion?.id })).ok),
    };
  })();

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
        description="Personnel register and company relationships."
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
        <span>{IDENTITY_NOTE}</span>
      </p>

      <ContactStats contacts={contacts} companyId={companyId} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <ContactDirectory {...{ sortedCompanyContacts, selectedContact, selectedContactId, companyId, searchQuery, setSearchQuery, roleFilter, setRoleFilter, includeArchived, setIncludeArchived, STANDARD_ROLES, handleSelectContact, handleSetPrimary, setIsManualModalOpen: () => openManual() }} />
        <ContactInspector
          {...{ selectedContact, selectedContactRelationship, companyId, isEditing, editFormData, setEditFormData, editFormErrors, editDuplicateWarning: null, showOlderEvidence, setShowOlderEvidence, STANDARD_ROLES, ALL_JURISDICTIONS, isWithinThreeYears, handleStartEdit, handleToggleArchive, handleSelectContact, handleCancelEdit, handleSaveEdit: () => void handleSaveEdit() }}
          setPreviewEvidence={() => undefined}
          companyName={company.name}
          identityFieldsNote={identityAccess?.licenceManage ? undefined : IDENTITY_NO_PERMISSION}
          identityReadable={identityAccess?.read !== false}
          operationalEmail={operationalEmail}
          auditHref={`/companies/${encodeURIComponent(companyId)}/record-of-events`}
          busy={busy}
        />
      </div>
      <ManualContactDialog
        {...{ isManualModalOpen, manualForm, setManualForm, manualFormErrors, manualDuplicateWarning, STANDARD_ROLES, ALL_JURISDICTIONS, setIsManualModalOpen, handleManualSave: () => void handleManualSave() }}
        companyName={company.name}
        identityFieldsNote={identityAccess?.licenceManage ? undefined : IDENTITY_NO_PERMISSION}
      />
    </div>
  );
}

export default function ContactsPage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Contacts"
      description="The original Contacts workspace (directory, manual entry, document and OCR review, inspector and history) saves only in this browser. It is testing/prototype data, not canonical Production records, and it is separate from the canonical contacts under TES records. Changing the company's sensitive contact lines (its website, phone or email), designating a Primary Contact and every other canonical contact action stay in the TES records tab, where authorization, evidence confirmation, the change ledger and the Master Register apply. Nothing here was changed or deleted."
      canonical={<CanonicalContactsPage />}
    >
      <LegacyContactsPage />
    </LegacyWorkspaceGate>
  )
}
