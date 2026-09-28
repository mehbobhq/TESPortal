"use client";
import React from "react";
import { ChevronRight, Plus, Search, ShieldCheck, Star, Users } from "lucide-react";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import type { Contact } from "./types";

interface ContactDirectoryProps {
  sortedCompanyContacts: Contact[];
  selectedContact: Contact | null;
  selectedContactId: string | null;
  companyId: string | undefined;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  includeArchived: boolean;
  setIncludeArchived: (value: boolean) => void;
  STANDARD_ROLES: string[];
  handleSelectContact: (id: string | null) => void;
  handleSetPrimary: (contact: Contact) => void;
  setIsManualModalOpen: (value: boolean) => void;
}

export function ContactDirectory({
  sortedCompanyContacts, selectedContact, selectedContactId, companyId, searchQuery, setSearchQuery, roleFilter, setRoleFilter,
  includeArchived, setIncludeArchived, STANDARD_ROLES, handleSelectContact, handleSetPrimary, setIsManualModalOpen,
}: ContactDirectoryProps) {
  return (
    <>
        {/* LEFT / MAIN TABLE AREA (7 or 8 columns) */}
        <div className={`flex flex-col gap-4 ${selectedContact ? "lg:col-span-7" : "lg:col-span-12"}`}>
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border rounded-xl p-3 shadow-2xs">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, role, email, phone, licence..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground font-medium focus:border-primary focus:outline-hidden"
              >
                <option value="all">All Roles</option>
                {STANDARD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none px-2">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-0 size-3.5"
                />
                Archived
              </label>
            </div>
          </div>

          {/* Contact Table / Card Register */}
          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            {sortedCompanyContacts.length === 0 ? (
              <div className="p-8 text-center">
                <EmptyState
                  icon={<Users className="size-8 text-muted-foreground/60" />}
                  title="No Contacts Found"
                  description={
                    searchQuery
                      ? "No personnel records match your search filter."
                      : "No contact records have been associated with this company yet."
                  }
                  action={{
                    label: "Add First Contact",
                    onClick: () => setIsManualModalOpen(true),
                    icon: <Plus className="size-3.5" />,
                  }}
                />
              </div>
            ) : (
              <div className="divide-y divide-border overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider font-semibold border-b border-border">
                    <tr>
                      <th className="px-4 py-3">Personnel / Canonical ID</th>
                      <th className="px-4 py-3">Company Role</th>
                      <th className="px-4 py-3">Communications</th>
                      <th className="px-4 py-3">Driver Licence</th>
                      <th className="px-4 py-3">Evidence</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedCompanyContacts.map((contact) => {
                      const rel = contact.relationships.find((r) => r.companyId === companyId);
                      const isPrimary = !!rel?.isPrimary;
                      const isSelected = contact.id === selectedContactId;

                      return (
                        <tr
                          key={contact.id}
                          onClick={() => handleSelectContact(contact.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-primary/5 border-l-4 border-l-primary"
                              : "hover:bg-muted/30"
                          } ${contact.isArchived ? "opacity-60 bg-muted/20" : ""}`}
                        >
                          {/* Name & Canonical ID */}
                          <td className="px-4 py-3">
                            <div className="flex items-start gap-2.5">
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[11px] mt-0.5">
                                {contact.firstName?.[0]}
                                {contact.lastName?.[0]}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="font-bold text-foreground text-xs truncate">
                                    {contact.firstName} {contact.lastName}
                                  </p>
                                  {isPrimary && (
                                    <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                                      <Star className="size-2.5 fill-current" /> Primary
                                    </span>
                                  )}
                                  {contact.isArchived && (
                                    <span className="rounded bg-muted px-1.5 py-0.2 text-[9px] font-medium text-muted-foreground">
                                      Archived
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                                  {contact.id} • {contact.globalId}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                              {rel?.role || contact.role || "General Contact"}
                            </span>
                          </td>

                          {/* Communications */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <p className="text-foreground font-medium truncate">{contact.phone || "—"}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{contact.email || "—"}</p>
                            </div>
                          </td>

                          {/* Driver Licence */}
                          <td className="px-4 py-3">
                            {contact.dlNumber ? (
                              <div className="flex flex-col gap-0.5">
                                <p className="font-mono font-semibold text-foreground text-[11px]">
                                  {contact.dlNumber}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {contact.dlState} {contact.dlExpiry ? `• Exp: ${contact.dlExpiry}` : ""}
                                </p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">—</span>
                            )}
                          </td>

                          {/* Evidence Count */}
                          <td className="px-4 py-3">
                            {contact.evidence?.length > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                <ShieldCheck className="size-3.5" />
                                {contact.evidence.length} Doc{contact.evidence.length > 1 ? "s" : ""}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">No Docs</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleSetPrimary(contact)}
                                title={isPrimary ? "Remove Primary Status" : "Designate as Primary Contact"}
                                className={`flex size-7 items-center justify-center rounded-lg border transition-colors ${
                                  isPrimary
                                    ? "border-emerald-500/40 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
                                    : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <Star className={`size-3.5 ${isPrimary ? "fill-current" : ""}`} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSelectContact(contact.id)}
                                title="Inspect Contact"
                                className="flex size-7 items-center justify-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ChevronRight className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
    </>
  );
}
