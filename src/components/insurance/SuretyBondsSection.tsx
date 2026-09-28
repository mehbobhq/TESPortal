"use client";

import React from "react";
import { Award, Plus } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import { getDeadlineClasses, getDeadlineStatus } from "@/lib/deadline-engine";
import type { BondRecord, InsuranceEvidence } from "@/app/companies/[id]/insurance/page";

interface SuretyBondsSectionProps {
  records: BondRecord[];
  evidence: InsuranceEvidence[];
  onAdd: () => void;
  onEdit: (record: BondRecord) => void;
  onArchive: (record: BondRecord) => void;
  onRestore: (record: BondRecord) => void;
  onViewEvidence: (evidence: InsuranceEvidence, record: BondRecord) => void;
}

export function SuretyBondsSection({
  records,
  evidence,
  onAdd,
  onEdit,
  onArchive,
  onRestore,
  onViewEvidence,
}: SuretyBondsSectionProps) {
  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Surety Bonds (BMC-84 Freight Broker, Customs In-Transit, Performance)
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
        >
          <Plus className="size-3.5" /> Add Surety Bond
        </button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<Award className="size-8 text-muted-foreground/60" />}
          title="No Surety Bonds Found"
          description="Register continuous freight broker bonds (FMCSA BMC-84) or customs carrier bonds."
          action={{
            label: "Add Surety Bond",
            onClick: onAdd,
            icon: <Plus className="size-4" />,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {records.map((bond) => {
            const deadlineStatus = bond.expiryDate ? getDeadlineStatus(bond.expiryDate) : "No Deadline";
            const deadlineStyle = getDeadlineClasses(deadlineStatus);
            const linkedEvidence = bond.evidenceId ? evidence.find((e) => e.id === bond.evidenceId) : null;

            return (
              <div
                key={bond.id}
                className={`rounded-2xl border bg-card p-5 shadow-xs transition-all flex flex-col justify-between ${
                  bond.status === "Archived"
                    ? "border-dashed border-border/80 opacity-75 bg-muted/20"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
                    <div>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase">
                        {bond.bondType}
                      </span>
                      <div className="text-sm font-bold text-foreground mt-1">{bond.suretyName}</div>
                      <div className="text-xs text-muted-foreground">
                        Bond #: <span className="font-mono font-bold text-foreground">{bond.bondNumber}</span>
                      </div>
                    </div>

                    {bond.status === "Archived" ? (
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
                    <ReadOnlyField
                      label="Bond Amount"
                      value={`$${Number(bond.bondAmount).toLocaleString()}`}
                      badge={<span className="text-[10px] font-bold text-muted-foreground">USD</span>}
                    />
                    <ReadOnlyField label="Principal" value={bond.principalName} />
                    <ReadOnlyField label="Effective" value={bond.effectiveDate} mono />
                    <ReadOnlyField label="Expiry" value={bond.expiryDate || "Continuous"} mono />
                  </div>

                  {linkedEvidence && (
                    <div className="mt-1 flex items-center justify-between rounded-xl border border-border bg-card p-2 text-xs">
                      <span className="truncate text-muted-foreground font-medium">{linkedEvidence.fileName}</span>
                      <button
                        type="button"
                        onClick={() => onViewEvidence(linkedEvidence, bond)}
                        className="text-primary font-bold hover:underline shrink-0 text-[11px]"
                      >
                        View
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
                  {bond.status !== "Archived" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(bond)}
                        className="font-semibold text-foreground hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onArchive(bond)}
                        className="text-[11px] font-semibold text-destructive hover:underline"
                      >
                        Archive
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRestore(bond)}
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
