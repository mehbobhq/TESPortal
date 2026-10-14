"use client";

import React, { useState } from "react";
import { Briefcase, ShieldCheck, X } from "lucide-react";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import type { TransportationRecord } from "./model";

interface TransportationPolicyFormProps {
  open: boolean;
  editingRecord: TransportationRecord | null;
  isRenewalMode: boolean;
  busy?: boolean;
  /** The canonical as-of date (YYYY-MM-DD), used for default dates. */
  today: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function TransportationPolicyForm({
  open,
  editingRecord: editingTransportation,
  isRenewalMode,
  busy = false,
  today,
  onSubmit: handleSaveTransportation,
  onClose,
}: TransportationPolicyFormProps) {
  const [editMode, setEditMode] = useState<"CORRECTION" | "ENDORSEMENT">("CORRECTION");
  if (!open) return null;

  const isEdit = Boolean(editingTransportation) && !isRenewalMode;
  const currency = editingTransportation?.coverages[0]?.currency ?? "CAD";

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
              {isEdit ? (
                <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                  <div className="font-bold text-foreground">What kind of change is this?</div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="editMode" value="CORRECTION" checked={editMode === "CORRECTION"} onChange={() => setEditMode("CORRECTION")} className="mt-0.5" />
                    <span>
                      <span className="font-semibold text-foreground">Correct a recording mistake</span>
                      <span className="block text-muted-foreground">The earlier values are kept as history, flagged corrected.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="editMode" value="ENDORSEMENT" checked={editMode === "ENDORSEMENT"} onChange={() => setEditMode("ENDORSEMENT")} className="mt-0.5" />
                    <span>
                      <span className="font-semibold text-foreground">The policy really changed (endorsement)</span>
                      <span className="block text-muted-foreground">Changes the coverage limit and/or broker from a date; the earlier state stays as history. Number and term dates cannot change this way.</span>
                    </span>
                  </label>
                  {editMode === "ENDORSEMENT" ? (
                    <div>
                      <label className="font-bold text-foreground">Effective date of the change *</label>
                      <input
                        type="date"
                        name="endorsementDate"
                        defaultValue={today}
                        className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-mono font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                        required
                      />
                    </div>
                  ) : null}
                  {(editingTransportation?.coverages.length ?? 0) > 1 ? (
                    <CanonicalUnavailable
                      action="Editing the other coverages of this policy"
                      reason={`this policy carries ${editingTransportation?.coverages.length} coverages (${editingTransportation?.coverages.map((c) => c.label).join(", ")}); this form changes the first one (${editingTransportation?.coverages[0]?.label}) only.`}
                    />
                  ) : null}
                </div>
              ) : null}

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
                    <option value="Reefer Breakdown">Reefer Breakdown</option>
                    <option value="Trailer Interchange">Trailer Interchange / Non-Owned</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-foreground">Policy Number *</label>
                  <input
                    type="text"
                    name="policyNumber"
                    defaultValue={isRenewalMode ? editingTransportation?.policyNumber || "" : editingTransportation?.policyNumber || ""}
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
                  <span className="text-[10px] text-muted-foreground">Will resolve to the canonical company record.</span>
                </div>

                <div>
                  <label className="font-bold text-foreground">Coverage Limit ($ {currency}) *</label>
                  <input
                    type="number"
                    name="coverageAmount"
                    defaultValue={editingTransportation?.coverageAmount || 2000000}
                    step="any"
                    min="0"
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
                    defaultValue={isRenewalMode ? editingTransportation?.cancelledOn ?? editingTransportation?.expiryDate : editingTransportation?.effectiveDate || today}
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
                  defaultValue=""
                  rows={2}
                  placeholder="e.g. Scheduled vehicle endorsement attached. $2,500 deductible on cargo."
                  className="mt-1 w-full rounded-xl border border-border bg-background p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
                <CanonicalUnavailable className="mt-1" action="Saving notes" reason="policy notes have no canonical home yet. Leave this empty; text typed here is refused rather than dropped." />
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
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {isRenewalMode ? "Save Renewal Policy" : editingTransportation ? "Update Policy" : "Save Policy"}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
