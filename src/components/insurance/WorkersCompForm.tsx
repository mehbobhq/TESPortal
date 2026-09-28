"use client";

import React from "react";
import { Briefcase, X } from "lucide-react";
import { JURISDICTIONS } from "@/lib/jurisdictions";
import type { WorkersInsuranceRecord } from "@/app/companies/[id]/insurance/page";

interface WorkersCompFormProps {
  open: boolean;
  editingRecord: WorkersInsuranceRecord | null;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function WorkersCompForm({
  open,
  editingRecord: editingWorkers,
  onSubmit: handleSaveWorkers,
  onClose,
}: WorkersCompFormProps) {
  if (!open) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Briefcase className="size-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {editingWorkers ? "Edit WCB Account" : "Add Workers Compensation Account"}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWorkers} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Jurisdiction *</label>
                  <select
                    name="jurisdiction"
                    defaultValue={editingWorkers?.jurisdiction || "ON"}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    {JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.code} — {j.label} ({j.country})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Account / Policy # *</label>
                  <input
                    type="text"
                    name="accountNumber"
                    defaultValue={editingWorkers?.accountNumber || ""}
                    placeholder="e.g. 9820194"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground">Provider / Board Name *</label>
                <input
                  type="text"
                  name="providerName"
                  defaultValue={editingWorkers?.providerName || "Workplace Safety and Insurance Board (WSIB)"}
                  placeholder="e.g. WSIB Ontario or WCB Alberta"
                  className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Effective Date *</label>
                  <input
                    type="date"
                    name="effectiveDate"
                    defaultValue={editingWorkers?.effectiveDate || new Date().toISOString().split("T")[0]}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Expiry / Clearance Expiry *</label>
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={editingWorkers?.expiryDate || ""}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground">Notes</label>
                <textarea
                  name="notes"
                  defaultValue={editingWorkers?.notes || ""}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  {editingWorkers ? "Update WCB Account" : "Save WCB Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
