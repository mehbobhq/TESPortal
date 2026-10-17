"use client";

import React from "react";
import { Award, Plus } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import { getDaysRemaining, getDeadlineClasses, getDeadlineStatus } from "./deadline";
import { EvidenceAttachments } from "@/src/components/shared/EvidenceAttachments";
import type { BondEntry } from "./model";

interface SuretyBondsSectionProps {
  /** The company in the page URL: evidence is always read and written for it. */
  companyId: string;
  records: BondEntry[];
  today: string;
  onAdd: () => void;
  onEdit: (record: BondEntry) => void;
  onRenew: (record: BondEntry) => void;
  onArchive: (record: BondEntry) => void;
  onRestore: (record: BondEntry) => void;
}

export function SuretyBondsSection({
  companyId,
  records,
  today,
  onAdd,
  onEdit,
  onRenew,
  onArchive,
  onRestore,
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
            const deadlineStatus = getDeadlineStatus(bond.deadlineDate, today);
            const deadlineStyle = getDeadlineClasses(deadlineStatus);
            const daysRemaining = getDaysRemaining(bond.deadlineDate, today);

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
                        {bond.cancelledOn ? "Cancelled" : deadlineStatus}
                        {daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30 ? <span className="font-normal opacity-75">({daysRemaining}d)</span> : null}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 py-3 text-xs">
                    <ReadOnlyField
                      label="Bond Amount"
                      value={`$${Number(bond.bondAmount).toLocaleString()}`}
                      badge={<span className="text-[10px] font-bold text-muted-foreground">{bond.coverages[0]?.currency ?? "USD"}</span>}
                    />
                    <ReadOnlyField label="Principal" value={bond.principalName} />
                    <ReadOnlyField label="Effective" value={bond.effectiveDate} mono />
                    <ReadOnlyField label="Expiry" value={bond.cancelledOn ? `${bond.expiryDate || "Continuous"} (cancelled ${bond.cancelledOn})` : bond.expiryDate || "Continuous"} mono />
                  </div>

                  <EvidenceAttachments companyId={companyId} targetTable="insurance_policies" targetId={bond.policyId} targetLabel="policy" allowWrite={bond.status !== "Archived"} compact />
                </div>

                <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between text-xs">
                  {bond.status !== "Archived" ? (
                    <>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onEdit(bond)}
                          className="font-semibold text-foreground hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onRenew(bond)}
                          className="font-bold text-primary hover:underline"
                        >
                          Renew
                        </button>
                      </div>
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
