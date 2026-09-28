"use client";
import React from "react";
import { Archive, FileCheck2, FolderOpen, History, Pencil, RefreshCw, Shield, ShieldCheck, Star, X } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { ISODateInput } from "@/src/components/shared/ISODateInput";
import type { Contact, Evidence, Relationship } from "./types";

type EditFormData = Partial<Contact> & { companyRole?: string; isPrimary?: boolean };

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
}

export function ContactInspector({
  selectedContact, selectedContactRelationship, companyId, isEditing, editFormData, setEditFormData, editFormErrors,
  editDuplicateWarning, showOlderEvidence, setShowOlderEvidence, STANDARD_ROLES, ALL_JURISDICTIONS, isWithinThreeYears,
  handleStartEdit, handleToggleArchive, handleSelectContact, handleCancelEdit, handleSaveEdit, setPreviewEvidence, companyName,
}: ContactInspectorProps) {
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
                          value={editFormData.companyRole || "Safety Manager"}
                          onChange={(e) => setEditFormData({ ...editFormData, companyRole: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs mt-1"
                        >
                          {STANDARD_ROLES.map((r) => (
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
                        onClick={handleSaveEdit}
                        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
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
                          {selectedContactRelationship?.role || selectedContact.role}
                        </span>
                      </div>
                    </div>

                    {/* 2. Identity & Credential ReadOnlyFields */}
                    <div className="grid grid-cols-2 gap-3">
                      <ReadOnlyField label="First Name" value={selectedContact.firstName} />
                      <ReadOnlyField label="Last Name" value={selectedContact.lastName} />
                      <ReadOnlyField label="Date of Birth" value={selectedContact.dob} mono />
                      <ReadOnlyField
                        label="Driver Licence #"
                        value={selectedContact.dlNumber}
                        copyable
                        mono
                      />
                      <ReadOnlyField label="Licence Jurisdiction" value={selectedContact.dlState} />
                      <ReadOnlyField label="Licence Expiry" value={selectedContact.dlExpiry} mono />
                      <ReadOnlyField label="Licence Class" value={selectedContact.dlClass} />
                      <ReadOnlyField label="Restrictions" value={selectedContact.dlRestrictions} />
                      <ReadOnlyField label="Phone Number" value={selectedContact.phone} copyable mono />
                      <ReadOnlyField label="Email Address" value={selectedContact.email} copyable />
                    </div>

                    {/* 3. Multi-Company Relationships Register */}
                    <div className="flex flex-col gap-2 pt-3 border-t border-border">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Associated Companies ({selectedContact.relationships?.length || 1})
                      </span>
                      <div className="divide-y divide-border border border-border rounded-lg bg-background overflow-hidden">
                        {selectedContact.relationships?.map((rel) => (
                          <div key={rel.id} className="p-2.5 flex items-center justify-between text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">{rel.companyName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                Role: {rel.role} {rel.startDate ? `• Since ${rel.startDate}` : ""}
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
