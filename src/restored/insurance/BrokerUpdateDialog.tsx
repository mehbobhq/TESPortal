"use client";

import React from "react";
import { Briefcase, X } from "lucide-react";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";
import type { TransportationRecord } from "./model";

interface BrokerUpdateDialogProps {
  open: boolean;
  record: TransportationRecord | null;
  busy?: boolean;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
}

export function BrokerUpdateDialog({
  open,
  record: brokerTargetRecord,
  busy = false,
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

              <div className="mt-2 rounded-xl bg-primary/10 border border-primary/20 p-3 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  name="applyToGroup"
                  disabled
                  id="applyToGroupCheckbox"
                  className="size-4 rounded border-border text-primary focus:ring-primary mt-0.5"
                />
                <label htmlFor="applyToGroupCheckbox" className="text-xs text-foreground">
                  <span className="font-bold block">Apply to all policies in this Certificate (COI Group)</span>
                  <CanonicalUnavailable className="mt-1" action="Certificate groups" reason="a certificate (COI) group has no canonical home yet, so the change applies to this policy only." />
                </label>
              </div>

              <label className="flex items-start gap-2 cursor-pointer rounded-xl border border-border bg-muted/20 p-3">
                <input type="checkbox" name="isCorrection" className="size-4 rounded border-border text-primary focus:ring-primary mt-0.5" />
                <span>
                  <span className="font-bold text-foreground block">The recorded broker was a mistake</span>
                  <span className="text-muted-foreground text-[11px]">Corrects the current broker period (the wrong one is kept, flagged corrected). Leave unchecked when the broker really changed: the previous broker stays as history.</span>
                </span>
              </label>

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
                  Save Broker
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
