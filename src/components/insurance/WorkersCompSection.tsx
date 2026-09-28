"use client";

import React from "react";
import { Briefcase, Plus } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import { getDaysRemaining, getDeadlineClasses, getDeadlineStatus } from "@/lib/deadline-engine";
import type { InsuranceEvidence, WorkersInsuranceRecord } from "@/app/companies/[id]/insurance/page";

interface WorkersCompSectionProps {
  records: WorkersInsuranceRecord[];
  evidence: InsuranceEvidence[];
  onAdd: () => void;
  onEdit: (record: WorkersInsuranceRecord) => void;
  onArchive: (record: WorkersInsuranceRecord) => void;
  onRestore: (record: WorkersInsuranceRecord) => void;
  onViewEvidence: (evidence: InsuranceEvidence, record: WorkersInsuranceRecord) => void;
}

export function WorkersCompSection({
  records,
  evidence,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  onViewEvidence,
}: WorkersCompSectionProps) {
  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Workers Compensation Boards (WCB, WSIB, WorkSafe)
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
        >
          <Plus className="size-3.5" /> Add WCB Account
        </button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-8 text-muted-foreground/60" />}
          title="No Workers Compensation Accounts Found"
          description="Add provincial/state Workers Compensation Board accounts (e.g. Ontario WSIB, WCB Alberta)."
          action={{
            label: "Add WCB Account",
            onClick: onAdd,
            icon: <Plus className="size-4" />,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {records.map((wcb) => {
            const deadlineStatus = getDeadlineStatus(wcb.expiryDate);
            const deadlineStyle = getDeadlineClasses(deadlineStatus);
            const daysRemaining = getDaysRemaining(wcb.expiryDate);
            const linkedEvidence = wcb.evidenceId ? evidence.find((e) => e.id === wcb.evidenceId) : null;

            return (
              <div
                key={wcb.id}
                className={`rounded-2xl border bg-card p-5 shadow-xs transition-all flex flex-col justify-between ${
                  wcb.status === "Archived"
                    ? "border-dashed border-border/80 opacity-75 bg-muted/20"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs font-bold">
                          {wcb.jurisdiction}
                        </span>
                        <span className="text-sm font-bold text-foreground">{wcb.providerName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Acct #: <span className="font-mono font-bold text-foreground">{wcb.accountNumber}</span>
                      </div>
                    </div>

                    {wcb.status === "Archived" ? (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                        Archived
                      </span>
                    ) : (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold flex items-center gap-1 border ${deadlineStyle.badge}`}
                      >
                        <span className={`size-1.5 rounded-full ${deadlineStyle.indicator}`} />
                        {deadlineStatus}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 py-3 text-xs">
                    <ReadOnlyField label="Effective" value={wcb.effectiveDate} mono />
                    <ReadOnlyField label="Expiry / Clearance" value={wcb.expiryDate} mono />
                  </div>

                  {linkedEvidence && (
                    <div className="mt-1 flex items-center justify-between rounded-xl border border-border bg-card p-2 text-xs">
                      <span className="truncate text-muted-foreground font-medium">{linkedEvidence.fileName}</span>
                      <button
                        type="button"
                        onClick={() => onViewEvidence(linkedEvidence, wcb)}
                        className="text-primary font-bold hover:underline shrink-0 text-[11px]"
                      >
                        View
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
                  {wcb.status !== "Archived" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(wcb)}
                        className="font-semibold text-foreground hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onArchive(wcb)}
                        className="text-[11px] font-semibold text-destructive hover:underline"
                      >
                        Archive
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRestore(wcb)}
                      className="text-emerald-600 font-bold hover:underline"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
