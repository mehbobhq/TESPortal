"use client";
import React from "react";
import { ShieldAlert, UserPlus, X } from "lucide-react";
import { ISODateInput } from "@/src/components/shared/ISODateInput";

export interface ManualContactFormState {
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
}

interface ManualContactDialogProps {
  isManualModalOpen: boolean;
  manualForm: ManualContactFormState;
  setManualForm: (value: ManualContactFormState) => void;
  manualFormErrors: Record<string, string>;
  manualDuplicateWarning: string | null;
  STANDARD_ROLES: string[];
  ALL_JURISDICTIONS: string[];
  setIsManualModalOpen: (value: boolean) => void;
  handleManualSave: () => void;
  companyName: string;
}

export function ManualContactDialog({
  isManualModalOpen, manualForm, setManualForm, manualFormErrors, manualDuplicateWarning, STANDARD_ROLES,
  ALL_JURISDICTIONS, setIsManualModalOpen, handleManualSave, companyName,
}: ManualContactDialogProps) {
  return (
    <>
      {/* MODAL 1: MANUAL ADD CONTACT */}
      {/* ========================================================================= */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-in fade-in duration-150">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">Add Contact Manually</h3>
                <p className="text-xs text-muted-foreground">
                  Enter personnel information to register or associate with {companyName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {manualDuplicateWarning && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-300">
                <p className="font-bold">Existing Identity Detected:</p>
                <p className="mt-0.5">{manualDuplicateWarning}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  First Name *
                </label>
                <input
                  type="text"
                  value={manualForm.firstName}
                  onChange={(e) => setManualForm({ ...manualForm, firstName: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
                {manualFormErrors.firstName && (
                  <p className="text-[10px] text-destructive mt-0.5">{manualFormErrors.firstName}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Last Name *
                </label>
                <input
                  type="text"
                  value={manualForm.lastName}
                  onChange={(e) => setManualForm({ ...manualForm, lastName: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
                {manualFormErrors.lastName && (
                  <p className="text-[10px] text-destructive mt-0.5">{manualFormErrors.lastName}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Date of Birth (YYYY-MM-DD)
                </label>
                <div className="mt-1">
                  <ISODateInput
                    value={manualForm.dob}
                    onValueChange={(value) => setManualForm({ ...manualForm, dob: value })}
                    className="text-xs"
                    aria-label="Date of Birth"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Company Role *
                </label>
                <select
                  value={manualForm.role}
                  onChange={(e) => setManualForm({ ...manualForm, role: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                >
                  {STANDARD_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Driver Licence Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. D1234-56789-01234"
                  value={manualForm.dlNumber}
                  onChange={(e) => setManualForm({ ...manualForm, dlNumber: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono focus:border-primary focus:outline-hidden mt-1"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Licence Jurisdiction
                </label>
                <select
                  value={manualForm.dlState}
                  onChange={(e) => setManualForm({ ...manualForm, dlState: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
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
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="(XXX) XXX-XXXX"
                  value={manualForm.phone}
                  onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
                {manualFormErrors.phone && (
                  <p className="text-[10px] text-destructive mt-0.5">{manualFormErrors.phone}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="contact@example.com"
                  value={manualForm.email}
                  onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs focus:border-primary focus:outline-hidden mt-1"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="manual-primary"
                checked={manualForm.isPrimary}
                onChange={(e) => setManualForm({ ...manualForm, isPrimary: e.target.checked })}
                className="rounded border-border text-primary focus:ring-0 size-4"
              />
              <label htmlFor="manual-primary" className="text-xs font-semibold text-foreground cursor-pointer">
                Designate as Primary Contact for {companyName}
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-muted text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleManualSave}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Save Contact
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
