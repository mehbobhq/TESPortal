"use client";

import React from "react";
import { Award, X } from "lucide-react";
import type { BondEntry } from "./model";

interface SuretyBondFormProps {
  open: boolean;
  editingRecord: BondEntry | null;
  isRenewalMode?: boolean;
  busy?: boolean;
  today: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function SuretyBondForm({
  open,
  editingRecord: editingBond,
  isRenewalMode = false,
  busy = false,
  today,
  onSubmit: handleSaveBond,
  onClose,
}: SuretyBondFormProps) {
  if (!open) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Award className="size-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {isRenewalMode ? `Renew Surety Bond: ${editingBond?.bondNumber}` : editingBond ? "Edit Surety Bond" : "Add Surety Bond"}
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

            <form onSubmit={handleSaveBond} className="p-6 space-y-4 text-xs">
              {editingBond && !isRenewalMode ? (
                <p className="rounded-xl border border-border bg-muted/20 p-3 text-muted-foreground">
                  Edits are recorded as <span className="font-semibold text-foreground">corrections</span>: the earlier values are kept as history, flagged corrected. For a real new period use Renew.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Bond Type *</label>
                  <select
                    name="bondType"
                    defaultValue={editingBond?.bondType || "BMC-84 (Freight Broker)"}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    <option value="BMC-84 (Freight Broker)">BMC-84 (Freight Broker $75K)</option>
                    <option value="Customs / In-Transit Bond">Customs / In-Transit Carrier Bond</option>
                    <option value="Performance Bond">Performance Bond</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Bond Number *</label>
                  <input
                    type="text"
                    name="bondNumber"
                    defaultValue={editingBond?.bondNumber || ""}
                    placeholder="e.g. BND-88301-A"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Surety Organization *</label>
                  <input
                    type="text"
                    name="suretyName"
                    defaultValue={editingBond?.suretyName || ""}
                    placeholder="e.g. Travelers Casualty and Surety Company"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Bond Amount ($ {editingBond?.coverages[0]?.currency ?? "USD"}) *</label>
                  <input
                    type="number"
                    name="bondAmount"
                    defaultValue={editingBond?.bondAmount || 75000}
                    step="any"
                    min="0"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Effective Date *</label>
                  <input
                    type="date"
                    name="effectiveDate"
                    defaultValue={isRenewalMode ? editingBond?.cancelledOn ?? editingBond?.expiryDate : editingBond?.effectiveDate || today}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Expiry Date (Optional / Continuous)</label>
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={isRenewalMode ? "" : editingBond?.expiryDate || ""}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>
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
                  disabled={busy}
                  className="disabled:opacity-60 rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  {isRenewalMode ? "Save Renewal" : editingBond ? "Update Bond" : "Save Bond"}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
