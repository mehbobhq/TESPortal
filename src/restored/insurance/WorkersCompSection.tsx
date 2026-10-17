"use client";

import React from "react";
import { Briefcase, Plus } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import { getDaysRemaining, getDeadlineClasses, getDeadlineStatus } from "./deadline";
import { EvidenceAttachments } from "@/src/components/shared/EvidenceAttachments";
import type { WorkersRecord } from "./model";

interface WorkersCompSectionProps {
  /** The company in the page URL: evidence is always read and written for it. */
  companyId: string;
  records: WorkersRecord[];
  today: string;
  onAdd: () => void;
  onEdit: (record: WorkersRecord) => void;
  onRenew: (record: WorkersRecord) => void;
  onArchive: (record: WorkersRecord) => void;
  onRestore: (record: WorkersRecord) => void;
}

export function WorkersCompSection({
  companyId,
  records,
  today,
  onAdd,
  onEdit,
  onRenew,
  onArchive,
  onRestore,
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
            const deadlineStatus = getDeadlineStatus(wcb.deadlineDate, today);
            const deadlineStyle = getDeadlineClasses(deadlineStatus);
            const daysRemaining = getDaysRemaining(wcb.deadlineDate, today);

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
                          {wcb.jurisdiction || "Not recorded"}
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
                        {wcb.cancelledOn ? "Cancelled" : deadlineStatus}
                        {daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30 ? <span className="font-normal opacity-75">({daysRemaining}d)</span> : null}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 py-3 text-xs">
                    <ReadOnlyField label="Effective" value={wcb.effectiveDate} mono />
                    <ReadOnlyField label="Expiry / Clearance" value={wcb.cancelledOn ? `${wcb.expiryDate || "—"} (cancelled ${wcb.cancelledOn})` : wcb.expiryDate} mono />
                  </div>

                  <EvidenceAttachments companyId={companyId} targetTable="insurance_policies" targetId={wcb.policyId} targetLabel="policy" allowWrite={wcb.status !== "Archived"} compact />
                </div>

                <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
                  {wcb.status !== "Archived" ? (
                    <>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onEdit(wcb)}
                          className="font-semibold text-foreground hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onRenew(wcb)}
                          className="font-bold text-primary hover:underline"
                        >
                          Renew
                        </button>
                      </div>
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
