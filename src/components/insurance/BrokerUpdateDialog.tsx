"use client";

import React from "react";
import { Briefcase, X } from "lucide-react";
import type { TransportationInsuranceRecord } from "@/app/companies/[id]/insurance/page";

interface BrokerUpdateDialogProps {
  open: boolean;
  record: TransportationInsuranceRecord | null;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function BrokerUpdateDialog({
  open,
  record: brokerTargetRecord,
  onSubmit,
  onClose,
}: BrokerUpdateDialogProps) {
  if (!open || !brokerTargetRecord) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Briefcase className="size-4 text-primary" /> Update Broker Details
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="font-bold text-foreground">Brokerage Firm Name *</label>
                <input
                  type="text"
                  name="brokerOrg"
                  defaultValue={brokerTargetRecord.broker?.organizationName || ""}
                  placeholder="e.g. Hub International Ltd."
                  className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-foreground">Broker Agent Name</label>
                <input
                  type="text"
                  name="brokerAgent"
                  defaultValue={brokerTargetRecord.broker?.contactName || ""}
                  placeholder="e.g. Sarah Jenkins"
                  className="mt-1 w-full h-9 rounded-xl border border-border bg-background px-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-foreground">Phone</label>
                  <input
                    type="text"
                    name="brokerPhone"
                    defaultValue={brokerTargetRecord.broker?.contactPhone || ""}
                    placeholder="(416) 555-0199"
                    className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>
                <div>
                  <label className="font-bold text-foreground">Email</label>
                  <input
                    type="email"
                    name="brokerEmail"
                    defaultValue={brokerTargetRecord.broker?.contactEmail || ""}
                    placeholder="agent@hub.com"
                    className="mt-1 w-full h-8 rounded-lg border border-border bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                </div>
              </div>

              {brokerTargetRecord.groupId && (
                <div className="mt-2 rounded-xl bg-primary/10 border border-primary/20 p-3 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    name="applyToGroup"
                    defaultChecked
                    id="applyToGroupCheckbox"
                    className="size-4 rounded border-border text-primary focus:ring-primary mt-0.5"
                  />
                  <label htmlFor="applyToGroupCheckbox" className="text-xs text-foreground cursor-pointer">
                    <span className="font-bold block">Apply to all policies in this Certificate (COI Group)</span>
                    <span className="text-muted-foreground text-[11px]">
                      Synchronizes this broker to Auto Liability, Cargo, and CGL sharing group {brokerTargetRecord.groupId}.
                    </span>
                  </label>
                </div>
              )}

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
                  Save Broker
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
