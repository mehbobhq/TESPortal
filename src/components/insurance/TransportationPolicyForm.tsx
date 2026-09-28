"use client";

import React from "react";
import { Briefcase, ShieldCheck, X } from "lucide-react";
import type { TransportationInsuranceRecord } from "@/app/companies/[id]/insurance/page";

interface TransportationPolicyFormProps {
  open: boolean;
  editingRecord: TransportationInsuranceRecord | null;
  isRenewalMode: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function TransportationPolicyForm({
  open,
  editingRecord: editingTransportation,
  isRenewalMode,
  onSubmit: handleSaveTransportation,
  onClose,
}: TransportationPolicyFormProps) {
  if (!open) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">
                  {isRenewalMode
                    ? `Renew Policy: ${editingTransportation?.policyNumber}`
                    : editingTransportation
                    ? "Edit Transportation Policy"
                    : "Add Commercial Transportation Policy"}
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

            <form onSubmit={handleSaveTransportation} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Coverage Type *</label>
                  <select
                    name="insuranceType"
                    defaultValue={editingTransportation?.insuranceType || "Auto Liability"}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  >
                    <option value="Auto Liability">Auto Liability (Primary Commercial)</option>
                    <option value="Motor Truck Cargo">Motor Truck Cargo (Broad Form)</option>
                    <option value="General Liability">Commercial General Liability (CGL)</option>
                    <option value="Physical Damage">Physical Damage (Collision/Comp)</option>
                    <option value="Umbrella / Excess">Umbrella / Excess Liability</option>
                    <option value="Trailer Interchange">Trailer Interchange / Non-Owned</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Policy Number *</label>
                  <input
                    type="text"
                    name="policyNumber"
                    defaultValue={isRenewalMode ? "" : editingTransportation?.policyNumber || ""}
                    placeholder="e.g. NBC-998201-26"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-bold text-foreground">Insurer / Underwriter *</label>
                  <input
                    type="text"
                    name="insurerName"
                    defaultValue={editingTransportation?.insurerName || ""}
                    placeholder="e.g. Northbridge General Insurance"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                  <span className="text-[10px] text-muted-foreground">Will resolve to canonical Company master.</span>
                </div>

                <div>
                  <label className="font-bold text-foreground">Coverage Limit ($ CAD) *</label>
                  <input
                    type="number"
                    name="coverageAmount"
                    defaultValue={editingTransportation?.coverageAmount || 2000000}
                    step="50000"
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
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
                    defaultValue={isRenewalMode ? editingTransportation?.expiryDate : editingTransportation?.effectiveDate || new Date().toISOString().split("T")[0]}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-foreground">Expiry Date *</label>
                  <input
                    type="date"
                    name="expiryDate"
                    defaultValue={isRenewalMode ? "" : editingTransportation?.expiryDate || ""}
                    className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    required
                  />
                </div>
              </div>

              {/* Broker Section */}
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <div className="font-bold text-foreground text-xs flex items-center gap-1.5">
                  <Briefcase className="size-3.5 text-primary" /> Brokerage Details (Optional)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-muted-foreground">Brokerage Firm</label>
                    <input
                      type="text"
                      name="brokerOrg"
                      defaultValue={editingTransportation?.broker?.organizationName || ""}
                      placeholder="e.g. Hub International Ltd."
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground">Broker Agent Name</label>
                    <input
                      type="text"
                      name="brokerAgent"
                      defaultValue={editingTransportation?.broker?.contactName || ""}
                      placeholder="e.g. Sarah Jenkins"
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold text-muted-foreground">Agent Phone</label>
                    <input
                      type="text"
                      name="brokerPhone"
                      defaultValue={editingTransportation?.broker?.contactPhone || ""}
                      placeholder="(416) 555-0199"
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground">Agent Email</label>
                    <input
                      type="email"
                      name="brokerEmail"
                      defaultValue={editingTransportation?.broker?.contactEmail || ""}
                      placeholder="agent@broker.com"
                      className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="font-bold text-foreground">Operational Notes</label>
                <textarea
                  name="notes"
                  defaultValue={editingTransportation?.notes || ""}
                  rows={2}
                  placeholder="e.g. Scheduled vehicle endorsement attached. $2,500 deductible on cargo."
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
                  {isRenewalMode ? "Save Renewal Policy" : editingTransportation ? "Update Policy" : "Save Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
