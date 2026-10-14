"use client";
import React from "react";
import { Archive, FileCheck2, FolderOpen, History, Pencil, RefreshCw, Shield, ShieldCheck, Star, X } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { ISODateInput } from "@/src/components/shared/ISODateInput";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import type { Contact, Evidence, Relationship } from "./types";

type EditFormData = Partial<Contact> & { companyRole?: string; isPrimary?: boolean; recordAs?: "change" | "correct" };

/** The six canonical contact purposes (contact_purpose_types). A purpose is separate from the role/title. */
const CONTACT_PURPOSES = ["PRIMARY", "BILLING", "SAFETY", "OPERATIONS", "COMPLIANCE", "EMERGENCY"] as const;

const NOT_RECORDED = "Not recorded";
const NO_HOME = "Driver licence and date of birth are not recorded in contacts (they belong to the driver record)";

interface ContactInspectorProps {
  selectedContact: Contact | null;
  selectedContactRelationship: Relationship | null;
  companyId: string | undefined;
  isEditing: boolean;
  editFormData: EditFormData;
  setEditFormData: (value: EditFormData) => void;
  editFormErrors: Record<string, string>;
  editDuplicateWarning: string | null;
  showOlderEvidence: boolean;
  setShowOlderEvidence: (value: boolean) => void;
  STANDARD_ROLES: string[];
  ALL_JURISDICTIONS: string[];
  isWithinThreeYears: (dateString?: string) => boolean;
  handleStartEdit: (contact: Contact) => void;
  handleToggleArchive: (contact: Contact) => void;
  handleSelectContact: (id: string | null) => void;
  handleCancelEdit: () => void;
  handleSaveEdit: () => void;
  setPreviewEvidence: (evidence: Evidence) => void;
  companyName: string;
  /** Canonical additions: purposes, busy state and the result of the last save. */
  busy?: boolean;
  saveError?: string | null;
  onAssignPurpose?: (contact: Contact, purpose: string) => void;
  onEndPurpose?: (contact: Contact, assignmentId: string) => void;
  onMakePrimaryPurpose?: (contact: Contact, purpose: string) => void;
}

export function ContactInspector({
  selectedContact, selectedContactRelationship, companyId, isEditing, editFormData, setEditFormData, editFormErrors,
  editDuplicateWarning, showOlderEvidence, setShowOlderEvidence, STANDARD_ROLES, ALL_JURISDICTIONS, isWithinThreeYears,
  handleStartEdit, handleToggleArchive, handleSelectContact, handleCancelEdit, handleSaveEdit, setPreviewEvidence, companyName,
  busy = false, saveError = null, onAssignPurpose, onEndPurpose, onMakePrimaryPurpose,
}: ContactInspectorProps) {
  const [purposeToAdd, setPurposeToAdd] = React.useState("");
  // A role the canonical record holds that is not one of the standard roles stays selectable (it is a free-text title).
  const roleOptions = selectedContact && selectedContact.role && !STANDARD_ROLES.includes(selectedContact.role) ? [...STANDARD_ROLES, selectedContact.role] : STANDARD_ROLES;
  return (
    <>
        {/* RIGHT COLUMN: Contact Inspector / Multi-Company Drawer */}
        {selectedContact && (
          <div className="lg:col-span-5 flex flex-col gap-4 sticky top-6">
            <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-start justify-between p-4 border-b border-border bg-muted/20">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {selectedContact.firstName?.[0]}
                    {selectedContact.lastName?.[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground">
                        {selectedContact.firstName} {selectedContact.lastName}
                      </h2>
                      {selectedContactRelationship?.isPrimary && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          Primary
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">
                      {selectedContact.id} • {selectedContact.globalId}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => handleStartEdit(selectedContact)}
                      title="Edit Contact"
                      className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleToggleArchive(selectedContact)}
                    title={selectedContact.isArchived ? "Restore Contact" : "Archive Contact"}
                    className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {selectedContact.isArchived ? (
                      <RefreshCw className="size-3.5" />
                    ) : (
                      <Archive className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectContact(null)}
                    className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Inspector Body */}
              <div className="p-4 flex flex-col gap-5 max-h-[calc(100vh-220px)] overflow-y-auto">
                {isEditing ? (
                  /* ========================================================================= */
                  /* EDIT CONTACT FORM VIEW */
                  /* ========================================================================= */
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                      <span className="text-xs font-bold text-foreground">Edit Personnel Details</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{selectedContact.id}</span>
                    </div>

                    {editDuplicateWarning && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400">
                        {editDuplicateWarning}
                      </div>
                    )}

                    {saveError && (
                      <div role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                        {saveError}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          First Name *
                        </label>
                        <input
                          type="text"
                          value={editFormData.firstName || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs mt-1 ${
                            editFormErrors.firstName ? "border-destructive" : "border-border bg-background"
                          }`}
                        />
                        {editFormErrors.firstName && (
                          <p className="text-[10px] text-destructive mt-0.5">{editFormErrors.firstName}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Last Name *
                        </label>
                        <input
                          type="text"
                          value={editFormData.lastName || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs mt-1 ${
                            editFormErrors.lastName ? "border-destructive" : "border-border bg-background"
                          }`}
                        />
                        {editFormErrors.lastName && (
                          <p className="text-[10px] text-destructive mt-0.5">{editFormErrors.lastName}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Date of Birth
                        </label>
                        <div className="mt-1">
                          <ISODateInput
                            value={editFormData.dob || ""}
                            onValueChange={(value) => setEditFormData({ ...editFormData, dob: value })}
                            className="text-xs"
                            aria-label="Date of Birth"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Driver Licence #
                        </label>
                        <input
                          type="text"
                          value={editFormData.dlNumber || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlNumber: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Licence Jurisdiction
                        </label>
                        <select
                          value={editFormData.dlState || "ON"}
                          onChange={(e) => setEditFormData({ ...editFormData, dlState: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        >
                          {ALL_JURISDICTIONS.map((j) => (
                            <option key={j} value={j}>
                              {j}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Licence Expiry
                        </label>
                        <div className="mt-1">
                          <ISODateInput
                            value={editFormData.dlExpiry || ""}
                            onValueChange={(value) => setEditFormData({ ...editFormData, dlExpiry: value })}
                            className="text-xs"
                            aria-label="Licence Expiry Date"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Licence Class
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Class A / AZ"
                          value={editFormData.dlClass || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlClass: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Restrictions
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Corrective Lenses"
                          value={editFormData.dlRestrictions || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, dlRestrictions: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div className="col-span-2">
                        <CanonicalUnavailable action="Saving date of birth and driver licence details" reason={`${NO_HOME}. These fields stay on the form; entering a value here refuses the whole save so nothing is silently dropped.`} />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          placeholder="+1 (555) 000-0000"
                          value={editFormData.phone || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-1.5 text-xs mt-1 ${
                            editFormErrors.phone ? "border-destructive" : "border-border bg-background"
                          }`}
                        />
                        {editFormErrors.phone && (
                          <p className="text-[10px] text-destructive mt-0.5">{editFormErrors.phone}</p>
                        )}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Email Address
                        </label>
                        <input
                          type="email"
                          placeholder="person@company.com"
                          value={editFormData.email || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        />
                      </div>

                      <div className="col-span-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Assigned Role at {companyName}
                        </label>
                        <select
                          value={editFormData.companyRole ?? ""}
                          onChange={(e) => setEditFormData({ ...editFormData, companyRole: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        >
                          <option value="">{NOT_RECORDED}</option>
                          {roleOptions.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-span-2 flex items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          id="edit-is-primary"
                          checked={!!editFormData.isPrimary}
                          onChange={(e) => setEditFormData({ ...editFormData, isPrimary: e.target.checked })}
                          className="rounded border-border text-primary focus:ring-0 size-4"
                        />
                        <label htmlFor="edit-is-primary" className="text-xs font-semibold text-foreground cursor-pointer">
                          Designate as Primary Contact for {companyName}
                        </label>
                      </div>
                    </div>

                    <fieldset className="rounded-lg border border-border p-3 text-xs">
                      <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">How should name, phone, email and role edits be recorded?</legend>
                      <label className="flex items-start gap-2 py-0.5">
                        <input type="radio" name="record-as" checked={(editFormData.recordAs ?? "change") === "change"} onChange={() => setEditFormData({ ...editFormData, recordAs: "change" })} className="mt-0.5" />
                        <span>A real-world change (the earlier value stays as history)</span>
                      </label>
                      <label className="flex items-start gap-2 py-0.5">
                        <input type="radio" name="record-as" checked={editFormData.recordAs === "correct"} onChange={() => setEditFormData({ ...editFormData, recordAs: "correct" })} className="mt-0.5" />
                        <span>A correction (the recorded value was wrong; it is kept and flagged)</span>
                      </label>
                    </fieldset>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSaveEdit}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 1. Company Assignment & Role */}
                    <div className="rounded-lg border border-border bg-muted/10 p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Company Assignment
                        </span>
                        <span className="text-xs font-semibold text-primary">{companyName}</span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-border/60">
                        <span className="text-xs text-muted-foreground">Assigned Role</span>
                        <span className="text-xs font-bold text-foreground">
                          {selectedContact.role || NOT_RECORDED}
                        </span>
                      </div>
                      {selectedContact.canonical.titles.length > 1 && (
                        <p className="text-[10px] text-muted-foreground">
                          Other current titles: {selectedContact.canonical.titles.slice(1).map((t) => t.text).join(", ")}
                        </p>
                      )}
                    </div>

                    {selectedContact.isArchived && (
                      <p role="note" className="text-[11px] text-muted-foreground rounded-lg border border-dashed border-border p-2">
                        This contact is archived: the relationship with {companyName} has ended and is kept in history. Restore relates the person to the company again as a new relationship.
                      </p>
                    )}

                    {/* 2. Identity & Credential ReadOnlyFields */}
                    <div className="grid grid-cols-2 gap-3">
                      <ReadOnlyField label="First Name" value={selectedContact.firstName} />
                      <ReadOnlyField label="Last Name" value={selectedContact.lastName} />
                      <ReadOnlyField label="Date of Birth" value={NOT_RECORDED} />
                      <ReadOnlyField label="Driver Licence #" value={NOT_RECORDED} />
                      <ReadOnlyField label="Licence Jurisdiction" value={NOT_RECORDED} />
                      <ReadOnlyField label="Licence Expiry" value={NOT_RECORDED} />
                      <ReadOnlyField label="Licence Class" value={NOT_RECORDED} />
                      <ReadOnlyField label="Restrictions" value={NOT_RECORDED} />
                      <ReadOnlyField label="Phone Number" value={selectedContact.phone} copyable mono />
                      <ReadOnlyField label="Email Address" value={selectedContact.email} copyable />
                    </div>
                    <CanonicalUnavailable action="Date of birth and driver licence details" reason={`${NO_HOME}.`} />

                    {/* 2b. Contact purposes (canonical): separate from the role, with the single PRIMARY per company */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Contact Purposes</span>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedContact.canonical.purposes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No purpose recorded.</span>
                        ) : (
                          selectedContact.canonical.purposes.map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px]">
                              {p.isPrimary ? `${p.purpose} (primary)` : p.purpose}
                              {!p.isPrimary && !selectedContact.isArchived && (
                                <button type="button" disabled={busy} className="underline text-[10px]" onClick={() => onMakePrimaryPurpose?.(selectedContact, p.purpose)}>
                                  make primary
                                </button>
                              )}
                              {!selectedContact.isArchived && (
                                <button type="button" disabled={busy} className="underline text-[10px]" onClick={() => onEndPurpose?.(selectedContact, p.id)}>
                                  end
                                </button>
                              )}
                            </span>
                          ))
                        )}
                      </div>
                      {!selectedContact.isArchived && (
                        <div className="flex items-center gap-2">
                          <select
                            value={purposeToAdd}
                            onChange={(e) => setPurposeToAdd(e.target.value)}
                            aria-label="Add purpose"
                            className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs"
                          >
                            <option value="">Add a purpose…</option>
                            {CONTACT_PURPOSES.filter((p) => !selectedContact.canonical.purposes.some((a) => a.purpose === p)).map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={busy || !purposeToAdd}
                            onClick={() => {
                              onAssignPurpose?.(selectedContact, purposeToAdd);
                              setPurposeToAdd("");
                            }}
                            className="rounded-lg border border-border px-3 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 3. Multi-Company Relationships Register */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Associated Companies ({selectedContact.relationships?.length || 1})
                      </span>
                      <p className="text-[10px] text-muted-foreground">Shows this person&apos;s relationships with {companyName} only; other companies are not loaded here.</p>
                      <div className="divide-y divide-border border border-border rounded-lg bg-background overflow-hidden">
                        {selectedContact.relationships?.map((rel) => (
                          <div key={rel.id} className="p-2.5 flex items-center justify-between text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">{rel.companyName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                Role: {rel.role || NOT_RECORDED} {rel.startDate ? `• Since ${rel.startDate}` : ""}{rel.endDate ? ` • Ended ${rel.endDate}` : ""}
                              </p>
                            </div>
                            {rel.isPrimary && (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                                Primary
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 4. Evidence Attachments & 3-Year Operational Filter */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Attached Evidence ({selectedContact.evidence?.length || 0})
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowOlderEvidence(!showOlderEvidence)}
                          className="text-[10px] text-primary hover:underline font-medium"
                        >
                          {showOlderEvidence ? "Hide Older Docs" : "Show All History"}
                        </button>
                      </div>

                      {(selectedContact.evidence?.length || 0) === 0 ? (
                        <div className="p-3 text-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                          No identity evidence attached.
                          <CanonicalUnavailable
                            className="mt-2 justify-center text-left"
                            action="Attaching and previewing identity evidence"
                            reason="the contacts record has no link to stored evidence documents yet, and the earlier browser-based document store is retired. Nothing can be attached here."
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {(selectedContact.evidence || [])
                            .filter((ev) => showOlderEvidence || isWithinThreeYears(ev.documentDate || ev.uploadedAt))
                            .map((ev) => (
                              <div
                                key={ev.id}
                                onClick={() => setPreviewEvidence(ev)}
                                className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileCheck2 className="size-4 text-emerald-500 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{ev.fileName}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {ev.type} • {ev.documentDate || ev.uploadedAt?.split("T")[0]}
                                    </p>
                                  </div>
                                </div>
                                <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                  {ev.confidence ? `${ev.confidence}%` : "Verified"}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* 5. Revision Audit Timeline */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Revision Events ({selectedContact.events?.length || 0})
                      </span>
                      <p className="text-[10px] text-muted-foreground">Built from the recorded history of this contact. Corrections are kept and flagged, never overwritten.</p>
                      <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto">
                        {selectedContact.events?.map((ev) => (
                          <div key={ev.id} className="text-xs p-2 rounded bg-muted/20 border border-border/50">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="font-bold text-foreground">{ev.action}</span>
                              <span>{ev.timestamp ? new Date(ev.timestamp).toLocaleDateString() : ""}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{ev.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
    </>
  );
}
