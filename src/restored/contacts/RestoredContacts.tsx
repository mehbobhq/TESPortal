"use client";

// RESTORED original Contacts workspace (ContactStats, ContactDirectory, ContactInspector, ManualContactDialog,
// ContactDocumentIntake, ContactOCRWorkspace, ContactEvidenceViewer), wired to the canonical contacts domain through ./adapter.
// The original keeps its records in browser storage; this does not: every control either persists to PostgreSQL through the
// company Contacts API and reappears after reload, or refuses and says why. Nothing here reads or writes browser storage.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Building2, Plus, UserPlus, Upload, X } from "lucide-react";

import { LoadingState, EmptyState } from "@/src/components/shared/StateDisplays";
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader";
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable";
import type { ChannelRecord } from "@/lib/contacts/types";

import { ContactStats } from "./ContactStats";
import { ContactDirectory } from "./ContactDirectory";
import { ContactInspector } from "./ContactInspector";
import { ManualContactDialog } from "./ManualContactDialog";
import { ContactDocumentIntake } from "./ContactDocumentIntake";
import { ContactOCRWorkspace } from "./ContactOCRWorkspace";
import { ContactEvidenceViewer } from "./ContactEvidenceViewer";
import type { CompanyRecord, Contact, Evidence, OCRReviewDraft } from "./types";
import { ALL_JURISDICTIONS, STANDARD_ROLES, findDuplicateContact, isWithinThreeYears } from "./contact-helpers";
import {
  ContactsRequestError,
  archiveContact,
  fetchContactsTransport,
  findMatches,
  mapContacts,
  planCreate,
  planEdit,
  planSetPrimary,
  restoreContact,
  runSteps,
  summarize,
  validateContactForm,
  type ContactsTransport,
  type EditForm,
  type ManualForm,
  type OperationReport,
  type PlannedStep,
} from "./adapter";

const EMPTY_MANUAL_FORM: ManualForm = {
  firstName: "",
  lastName: "",
  dob: "",
  dlNumber: "",
  dlState: "ON",
  dlExpiry: "",
  dlIssueDate: "",
  dlClass: "",
  dlRestrictions: "",
  email: "",
  phone: "",
  role: "Safety Manager",
  isPrimary: false,
  notes: "",
};

type DuplicateMatch = { personId: string; displayName: string; reasons: string[]; alreadyHere: boolean };

export function RestoredContacts({ companyId, transport: injected }: { companyId: string; transport?: ContactsTransport }) {
  const transport = useMemo(() => injected ?? fetchContactsTransport(companyId), [companyId, injected]);

  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [lines, setLines] = useState<ChannelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [companyMissing, setCompanyMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showOlderEvidence, setShowOlderEvidence] = useState(false);

  // Inspector & modal state
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Contact> & { companyRole?: string; isPrimary?: boolean; recordAs?: "change" | "correct" }>({});
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({});
  const [editDuplicateWarning, setEditDuplicateWarning] = useState<string | null>(null);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);

  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isSourcePickerOpen, setIsSourcePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isOCRWorkspaceOpen, setIsOCRWorkspaceOpen] = useState(false);
  const [ocrDraft, setOcrDraft] = useState<OCRReviewDraft | null>(null);
  const [ocrValidationError, setOcrValidationError] = useState<string | null>(null);

  const [previewEvidence, setPreviewEvidence] = useState<Evidence | null>(null);

  const [manualForm, setManualForm] = useState<ManualForm>(EMPTY_MANUAL_FORM);
  const [manualFormErrors, setManualFormErrors] = useState<Record<string, string>>({});
  const [manualDuplicateWarning, setManualDuplicateWarning] = useState<string | null>(null);
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);
  const acknowledgedSignature = useRef<string | null>(null);

  const deepLink = useRef<string | null>(null);

  // 1. Load the company identity and the canonical contacts.
  const reload = useCallback(
    async (name?: string) => {
      const companyName = name ?? company?.name ?? "Company";
      const view = await transport.read();
      setContacts(mapContacts(view, { id: companyId, name: companyName }));
      setLines(view.currentChannels);
    },
    [transport, companyId, company?.name],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" });
        if (response.status === 404) {
          if (!cancelled) setCompanyMissing(true);
          return;
        }
        if (!response.ok) throw new ContactsRequestError("The company could not be loaded. This is a temporary error, not a missing company.");
        const body = await response.json();
        const summary = body?.company ?? { id: companyId, name: "Company" };
        if (cancelled) return;
        setCompany(summary);
        await reload(summary.name);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Contacts could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, transport]);

  // Deep link (?contact=<canonical person id>), applied once the contacts are loaded.
  useEffect(() => {
    if (typeof window === "undefined" || contacts.length === 0 || deepLink.current !== null) return;
    deepLink.current = new URLSearchParams(window.location.search).get("contact") ?? "";
    if (deepLink.current) {
      const match = contacts.find((c) => c.canonical.personId === deepLink.current || c.canonical.relationshipId === deepLink.current);
      if (match) setSelectedPersonId(match.canonical.personId);
    }
  }, [contacts]);

  const handleSelectContact = (id: string | null) => {
    const contact = id ? contacts.find((c) => c.id === id) ?? null : null;
    setSelectedPersonId(contact ? contact.canonical.personId : null);
    setIsEditing(false);
    setEditFormErrors({});
    setEditDuplicateWarning(null);
    setEditSaveError(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (contact) url.searchParams.set("contact", contact.canonical.personId);
      else url.searchParams.delete("contact");
      window.history.replaceState({}, "", url.toString());
    }
  };

  const roleOptions = useMemo(() => {
    const extra = [...new Set(contacts.map((c) => c.role).filter((role) => role && !STANDARD_ROLES.includes(role)))];
    return [...STANDARD_ROLES, ...extra];
  }, [contacts]);

  const companyContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (!includeArchived && c.isArchived) return false;
      if (roleFilter !== "all" && c.role !== roleFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = `${c.firstName} ${c.lastName}`.toLowerCase().includes(q);
        const matchEmail = c.email.toLowerCase().includes(q);
        const matchPhone = c.phone.toLowerCase().includes(q);
        const matchRole = c.role.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone && !matchRole) return false;
      }
      return true;
    });
  }, [contacts, includeArchived, roleFilter, searchQuery]);

  // Sorted: Primary Contacts first
  const sortedCompanyContacts = useMemo(() => {
    return [...companyContacts].sort((a, b) => {
      const aPrimary = a.isPrimary && !a.isArchived ? 1 : 0;
      const bPrimary = b.isPrimary && !b.isArchived ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
  }, [companyContacts]);

  const selectedContact = useMemo(() => contacts.find((c) => c.canonical.personId === selectedPersonId) ?? null, [contacts, selectedPersonId]);
  const selectedContactRelationship = useMemo(() => {
    if (!selectedContact) return null;
    return selectedContact.relationships.find((r) => r.id === selectedContact.canonical.relationshipId) ?? selectedContact.relationships[0] ?? null;
  }, [selectedContact]);

  /** Runs canonical steps, reloads from PostgreSQL, and reports every failure (never a silent success). */
  const apply = async (steps: PlannedStep[]): Promise<OperationReport> => {
    setBusy(true);
    try {
      const report = await runSteps(transport, steps);
      try {
        await reload();
      } catch (error) {
        report.failed.push({ label: "Refresh", ok: false, message: error instanceof Error ? error.message : "The contacts could not be reloaded." });
      }
      return report;
    } finally {
      setBusy(false);
    }
  };

  const showReport = (report: OperationReport, fallbackFailure: string) => {
    const failure = summarize(report);
    setActionError(failure ? `${fallbackFailure} ${failure}` : null);
    setNotice(report.notices.length ? report.notices.join(" ") : null);
  };

  // --- Edit ---
  const handleStartEdit = (contact: Contact) => {
    setEditFormData({
      firstName: contact.firstName,
      lastName: contact.lastName,
      dob: "",
      dlNumber: "",
      dlState: "ON",
      dlExpiry: "",
      dlIssueDate: "",
      dlClass: "",
      dlRestrictions: "",
      email: contact.email,
      phone: contact.phone,
      notes: "",
      companyRole: contact.role,
      isPrimary: contact.isPrimary,
      recordAs: "change",
    });
    setEditFormErrors({});
    setEditDuplicateWarning(null);
    setEditSaveError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditFormData({});
    setEditFormErrors({});
    setEditDuplicateWarning(null);
    setEditSaveError(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedContact) return;
    const errors = validateContactForm(editFormData as EditForm, "Provide either phone or email");
    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors);
      return;
    }
    setEditFormErrors({});
    const dup = findDuplicateContact({ email: editFormData.email, phone: editFormData.phone }, contacts, selectedContact.id);
    setEditDuplicateWarning(dup.match ? `${dup.reason}: also recorded for ${dup.match.firstName} ${dup.match.lastName}. Nothing is merged.` : null);

    let steps: PlannedStep[];
    try {
      steps = planEdit(selectedContact, editFormData as EditForm);
    } catch (error) {
      setEditSaveError(error instanceof Error ? error.message : "The change could not be saved.");
      return;
    }
    if (steps.length === 0) {
      setIsEditing(false);
      setEditSaveError(null);
      return;
    }
    const report = await apply(steps);
    const failure = summarize(report);
    if (failure) {
      setEditSaveError(failure);
      return;
    }
    setEditSaveError(null);
    setActionError(null);
    setIsEditing(false);
  };

  // --- Manual add ---
  const resetManual = () => {
    setManualForm(EMPTY_MANUAL_FORM);
    setManualFormErrors({});
    setManualDuplicateWarning(null);
    setManualSaveError(null);
    setDuplicateMatches([]);
    acknowledgedSignature.current = null;
  };
  const openManual = () => {
    resetManual();
    setIsManualModalOpen(true);
  };

  const handleManualSave = async () => {
    const errors = validateContactForm(manualForm, "Provide either a phone or email address");
    if (Object.keys(errors).length > 0) {
      setManualFormErrors(errors);
      return;
    }
    setManualFormErrors({});
    setManualSaveError(null);

    let step: PlannedStep;
    try {
      step = planCreate(manualForm);
    } catch (error) {
      setManualSaveError(error instanceof Error ? error.message : "The contact could not be saved.");
      return;
    }

    setBusy(true);
    try {
      // Registry-wide ADVISORY duplicate lookup (never merges). A second press of Save confirms a new person.
      const signature = JSON.stringify([manualForm.firstName.trim(), manualForm.lastName.trim(), manualForm.email.trim(), manualForm.phone.trim()]);
      if (acknowledgedSignature.current !== signature) {
        let found: Awaited<ReturnType<typeof findMatches>> = [];
        try {
          found = await findMatches(transport, { givenName: manualForm.firstName.trim(), familyName: manualForm.lastName.trim(), email: manualForm.email.trim() || undefined, phone: manualForm.phone.trim() || undefined });
        } catch (error) {
          setManualSaveError(`The duplicate check could not run, so nothing was saved: ${error instanceof Error ? error.message : "unknown error"}`);
          return;
        }
        if (found.length > 0) {
          setDuplicateMatches(found.map((m) => ({ personId: m.personId, displayName: m.displayName, reasons: m.reasons, alreadyHere: m.organizationIds.includes(companyId) && contacts.some((c) => c.canonical.personId === m.personId && !c.isArchived) })));
          setManualDuplicateWarning("These people may already exist. Nothing is merged. Choose \"Use this person\" to associate one with this company, or press Save Contact again to create a new person.");
          acknowledgedSignature.current = signature;
          return;
        }
      }

      const report = await runSteps(transport, [step]);
      if (report.failed.length > 0) {
        setManualSaveError(report.failed[0].message ?? "The contact could not be saved.");
        return;
      }
      await reload().catch((error) => setActionError(`The contact was saved but the list could not be reloaded: ${error instanceof Error ? error.message : "unknown error"}`));
      if (report.lastView) setSelectedPersonId(report.lastView.person.id);
      setActionError(null);
      setIsManualModalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleAssociateExisting = async (personId: string) => {
    if (manualForm.dob.trim() || manualForm.dlNumber.trim() || manualForm.dlExpiry.trim() || manualForm.dlClass.trim() || manualForm.dlRestrictions.trim() || manualForm.dlIssueDate.trim()) {
      setManualSaveError(new CanonicalOperationUnavailableError("Saving date of birth and driver licence details", "the contacts record has no field for them, so nothing was saved").message);
      return;
    }
    setBusy(true);
    try {
      const report = await runSteps(transport, [{ label: "Associate existing person", payload: { action: "addRelationship", personId } }]);
      if (report.failed.length > 0 || !report.lastView) {
        setManualSaveError(report.failed[0]?.message ?? "The person could not be associated.");
        return;
      }
      const relationshipId = report.lastView.relationship.id;
      const follow: PlannedStep[] = [];
      if (manualForm.role.trim()) follow.push({ label: "Record role", payload: { action: "addTitle", relationshipId, title: manualForm.role.trim() } });
      if (manualForm.isPrimary) follow.push({ label: "Designate as Primary Contact", payload: { action: "makePrimary", relationshipId, purpose: "PRIMARY" } });
      const more = await runSteps(transport, follow);
      await reload().catch(() => undefined);
      if (more.failed.length > 0) {
        setActionError(`The person was associated with this company, but: ${summarize(more)}`);
      } else {
        setActionError(null);
      }
      setSelectedPersonId(personId);
      setIsManualModalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // --- Document intake: kept; OCR extraction and evidence storage are not available ---
  const handleFileChosen = (file: File, source: "camera" | "device" = "device") => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const blank = { value: "", confidence: null as number | null };
      setOcrDraft({
        firstName: { ...blank },
        lastName: { ...blank },
        dob: { ...blank },
        dlNumber: { ...blank },
        dlState: { value: "ON", confidence: null },
        dlExpiry: { ...blank },
        dlIssueDate: { ...blank },
        dlClass: { ...blank },
        dlRestrictions: { ...blank },
        email: { ...blank },
        phone: { ...blank },
        role: "Safety Manager",
        isPrimary: false,
        evidence: {
          id: "SOURCE-DOCUMENT",
          type: "Driver Licence",
          fileName: file.name || (source === "camera" ? "camera-id-capture.jpg" : "id-scan.jpg"),
          fileType: file.type || "image/jpeg",
          uploadedAt: new Date().toISOString(),
          status: "uploaded",
          source,
          dataUrl,
        },
      });
      setOcrValidationError(null);
      setIsOCRWorkspaceOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleOCRConfirmedSave = () => {
    // The identity document cannot be stored (no evidence link) and its licence fields have no home: refuse, store nothing.
    setOcrValidationError(
      new CanonicalOperationUnavailableError(
        "Saving an identity document",
        "OCR extraction is retired, the contacts record has no field for driver licence details and no link to stored evidence, so nothing was saved. Use Manual Add for the person, role, phone and email",
      ).message,
    );
  };

  // --- Primary / purposes / archive ---
  const handleSetPrimary = async (contact: Contact) => {
    let step: PlannedStep;
    try {
      step = planSetPrimary(contact);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The primary contact change could not be saved.");
      return;
    }
    showReport(await apply([step]), "Primary contact change was not saved.");
  };

  const handleAssignPurpose = async (contact: Contact, purpose: string) =>
    showReport(await apply([{ label: `Add purpose ${purpose}`, payload: { action: "assignPurpose", relationshipId: contact.canonical.relationshipId, purpose, primary: purpose === "PRIMARY" } }]), "The purpose was not saved.");
  const handleEndPurpose = async (contact: Contact, assignmentId: string) => {
    void contact;
    showReport(await apply([{ label: "End purpose", payload: { action: "endPurpose", assignmentId } }]), "The purpose was not ended.");
  };
  const handleMakePrimaryPurpose = async (contact: Contact, purpose: string) =>
    showReport(await apply([{ label: `Make primary for ${purpose}`, payload: { action: "makePrimary", relationshipId: contact.canonical.relationshipId, purpose } }]), "The primary was not changed.");

  const handleToggleArchive = async (contact: Contact) => {
    setBusy(true);
    try {
      const report = contact.isArchived ? await restoreContact(transport, contact, contact.role || null) : await archiveContact(transport, contact);
      try {
        await reload();
      } catch (error) {
        report.failed.push({ label: "Refresh", ok: false, message: error instanceof Error ? error.message : "The contacts could not be reloaded." });
      }
      showReport(report, contact.isArchived ? "The contact was not fully restored." : "The contact was not archived.");
    } finally {
      setBusy(false);
    }
  };

  // --- Company phone and email lines (organization channels) ---
  const handleAddLine = async (type: string, usage: string, value: string) =>
    showReport(await apply([{ label: "Add company line", payload: { action: "addChannel", channel: { type, value, usage } } }]), "The company line was not saved.");
  const handleEndLine = async (channelId: string) => showReport(await apply([{ label: "End company line", payload: { action: "endChannel", channelId } }]), "The company line was not ended.");

  // --- Render ---
  if (loading) {
    return (
      <div className="p-10">
        <LoadingState message="Loading company contacts..." />
      </div>
    );
  }

  if (companyMissing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <EmptyState icon={<Building2 className="size-10 text-muted-foreground/60" />} title="Company Not Found" description="The requested company record could not be found in the directory." />
      </div>
    );
  }

  if (loadError || !company) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-6">
        <EmptyState
          icon={<Building2 className="size-10 text-muted-foreground/60" />}
          title="Contacts could not be opened"
          description={loadError ?? "Contacts could not be loaded."}
          action={{ label: "Reload", onClick: () => window.location.reload() }}
        />
      </div>
    );
  }

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
        onClick={() => setIsSourcePickerOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
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
        description="Canonical personnel register, identity credentials, multi-company relationships, and compliance evidence."
        actions={contactsActions}
      />

      {actionError && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/10 p-3.5 text-xs font-medium text-destructive">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="hover:opacity-80 p-1" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-border bg-muted/40 p-3.5 text-xs">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="hover:opacity-80 p-1" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      )}

      <ContactStats contacts={contacts} companyId={companyId} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <ContactDirectory
          {...{
            sortedCompanyContacts,
            selectedContact,
            selectedContactId: selectedContact?.id ?? null,
            companyId,
            searchQuery,
            setSearchQuery,
            roleFilter,
            setRoleFilter,
            includeArchived,
            setIncludeArchived,
            STANDARD_ROLES: roleOptions,
            handleSelectContact,
            handleSetPrimary,
            setIsManualModalOpen: (open: boolean) => (open ? openManual() : setIsManualModalOpen(false)),
          }}
        />
        <ContactInspector
          {...{
            selectedContact,
            selectedContactRelationship,
            companyId,
            isEditing,
            editFormData,
            setEditFormData,
            editFormErrors,
            editDuplicateWarning,
            showOlderEvidence,
            setShowOlderEvidence,
            STANDARD_ROLES: roleOptions,
            ALL_JURISDICTIONS,
            isWithinThreeYears,
            handleStartEdit,
            handleToggleArchive,
            handleSelectContact,
            handleCancelEdit,
            handleSaveEdit,
          }}
          setPreviewEvidence={setPreviewEvidence}
          companyName={company.name}
          busy={busy}
          saveError={editSaveError}
          onAssignPurpose={handleAssignPurpose}
          onEndPurpose={handleEndPurpose}
          onMakePrimaryPurpose={handleMakePrimaryPurpose}
        />
      </div>

      <CompanyLinesCard lines={lines} busy={busy} onAdd={handleAddLine} onEnd={handleEndLine} />

      <ManualContactDialog
        {...{ isManualModalOpen, manualForm, setManualForm, manualFormErrors, manualDuplicateWarning, STANDARD_ROLES: roleOptions, ALL_JURISDICTIONS, setIsManualModalOpen, handleManualSave }}
        companyName={company.name}
        busy={busy}
        manualSaveError={manualSaveError}
        duplicateMatches={duplicateMatches}
        onAssociateExisting={handleAssociateExisting}
      />
      <ContactDocumentIntake {...{ isSourcePickerOpen, setIsSourcePickerOpen, isCameraOpen, setIsCameraOpen, handleFileChosen }} />
      <ContactOCRWorkspace
        {...{ isOCRWorkspaceOpen, ocrDraft, setOcrDraft, ocrValidationError, company, STANDARD_ROLES: roleOptions, ALL_JURISDICTIONS, setIsOCRWorkspaceOpen, handleOCRConfirmedSave }}
      />
      <ContactEvidenceViewer {...{ previewEvidence, setPreviewEvidence, previewEvidenceLoading: false }} />
    </div>
  );
}

/** The company's own phone and email lines (organization channels with a usage). Ended lines stay in history. */
function CompanyLinesCard({ lines, busy, onAdd, onEnd }: { lines: ChannelRecord[]; busy: boolean; onAdd: (type: string, usage: string, value: string) => void; onEnd: (channelId: string) => void }) {
  const [type, setType] = useState("PHONE");
  const [usage, setUsage] = useState("GENERAL");
  const [value, setValue] = useState("");
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-bold text-foreground">Company phone and email lines</h3>
        <p className="text-xs text-muted-foreground">The company&apos;s own lines (not a person&apos;s). Ending a line keeps it in history.</p>
      </div>
      {lines.length === 0 ? <p className="text-xs text-muted-foreground">No company phone or email has been recorded.</p> : null}
      {lines.map((line) => (
        <div key={line.id} className="flex items-center justify-between text-xs">
          <span>
            {line.channelType === "PHONE" ? "Phone" : "Email"} · {line.usage ?? "—"} · {line.valueDisplay}
          </span>
          <button type="button" disabled={busy} onClick={() => onEnd(line.id)} className="rounded-lg border border-border px-3 py-1 font-semibold hover:bg-muted disabled:opacity-60">
            End
          </button>
        </div>
      ))}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          onAdd(type, usage, value.trim());
          setValue("");
        }}
      >
        <select aria-label="Line type" value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
          <option value="PHONE">Phone</option>
          <option value="EMAIL">Email</option>
        </select>
        <select aria-label="Usage" value={usage} onChange={(e) => setUsage(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
          {["GENERAL", "DISPATCH", "OFFICE", "ACCOUNTING", "SAFETY"].map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Number or address" className="min-w-[200px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs" />
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-60">
          <Plus className="size-3.5" /> Add line
        </button>
      </form>
    </div>
  );
}

/** Route-level entry point: takes the company from the URL. */
export default function RestoredContactsRoute() {
  const params = useParams<{ id: string }>();
  return <RestoredContacts companyId={params.id} />;
}
