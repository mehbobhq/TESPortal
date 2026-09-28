"use client";

import React from "react";
import { Archive } from "lucide-react";

export interface InsuranceArchiveTarget {
  family: "transportation" | "workers" | "bonds";
  recordId: string;
  label: string;
}

interface InsuranceArchiveDialogProps {
  target: InsuranceArchiveTarget | null;
  reason: string;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function InsuranceArchiveDialog({
  target: archiveTarget,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: InsuranceArchiveDialogProps) {
  if (!archiveTarget) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center gap-3 text-destructive">
              <Archive className="size-6 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-foreground">Archive Insurance Record</h3>
                <p className="text-xs text-muted-foreground">{archiveTarget.label}</p>
              </div>
            </div>

            <p className="text-muted-foreground leading-relaxed">
              Archived records are retained permanently and remain available for authorized historical review.
            </p>

            <div>
              <label className="font-bold text-foreground block mb-1">Reason for Archival *</label>
              <textarea
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                placeholder="e.g. Policy superseded by annual renewal, carrier replaced, or vehicle removed."
                rows={3}
                className="w-full rounded-xl border border-border bg-background p-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded-xl bg-destructive px-5 py-2 font-bold text-destructive-foreground shadow-sm hover:bg-destructive/90 transition-colors"
              >
                Archive Record
              </button>
            </div>
          </div>
        </div>
  );
}
