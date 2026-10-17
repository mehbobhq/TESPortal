import { ShieldCheck, Plus, Briefcase, FileCheck2, Eye, AlertTriangle, Pencil, RotateCcw } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import { getDaysRemaining, getDeadlineStatus, getDeadlineClasses } from "./deadline";
import { EvidenceAttachments } from "@/src/components/shared/EvidenceAttachments";
import type { TransportationRecord } from "./model";

interface TransportationPoliciesSectionProps {
  /** The company in the page URL: evidence is always read and written for it. */
  companyId: string;
  records: TransportationRecord[];
  /** The canonical as-of date (YYYY-MM-DD) every deadline is read against. */
  today: string;
  onAdd: () => void;
  onEdit: (record: TransportationRecord) => void;
  onRenew: (record: TransportationRecord) => void;
  onEditBroker: (record: TransportationRecord) => void;
  onArchive: (record: TransportationRecord) => void;
  onRestore: (record: TransportationRecord) => void;
}

export function TransportationPoliciesSection({
  companyId,
  records: filteredTransportation,
  today,
  onAdd,
  onEdit,
  onRenew,
  onEditBroker,
  onArchive,
  onRestore,
}: TransportationPoliciesSectionProps) {
  return (
    <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Commercial Transportation Policies (Auto, Cargo, CGL, Umbrella)
            </h2>
            <span className="text-xs text-muted-foreground">
              {filteredTransportation.length} {filteredTransportation.length === 1 ? "policy" : "policies"} listed
            </span>
          </div>

          {filteredTransportation.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-8 text-muted-foreground/60" />}
              title="No Transportation Policies Found"
              description="Manually add an Auto Liability, Cargo, or CGL policy (Certificate of Insurance upload / OCR is unavailable; see the notice above)."
              action={{
                label: "Add Transportation Policy",
                onClick: () => {
                  onAdd();
                },
                icon: <Plus className="size-4" />,
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredTransportation.map((pol) => {
                const deadlineStatus = getDeadlineStatus(pol.deadlineDate, today);
                const deadlineStyle = getDeadlineClasses(deadlineStatus);
                const daysRemaining = getDaysRemaining(pol.deadlineDate, today);

                return (
                  <div
                    key={pol.id}
                    className={`rounded-2xl border bg-card p-5 shadow-xs transition-all flex flex-col justify-between ${
                      pol.status === "Archived"
                        ? "border-dashed border-border/80 opacity-75 bg-muted/20"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div>
                      {/* Card Header: Type, Status, Actions */}
                      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground">{pol.insuranceType}</span>
                            {pol.previousRecordId && (
                              <span className="rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-0.5 text-[10px] font-bold">
                                Renewed Lineage
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Policy #: <span className="font-mono font-bold text-foreground">{pol.policyNumber}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {pol.status === "Archived" ? (
                            <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-bold text-muted-foreground">
                              Archived
                            </span>
                          ) : (
                            <span
                              className={`rounded-md px-2.5 py-1 text-[11px] font-bold flex items-center gap-1.5 border ${deadlineStyle.badge}`}
                            >
                              <span className={`size-1.5 rounded-full ${deadlineStyle.indicator}`} />
                              {pol.cancelledOn ? "Cancelled" : deadlineStatus}
                              {daysRemaining !== null && (
                                <span className="opacity-75 font-normal">
                                  ({daysRemaining < 0 ? `${Math.abs(daysRemaining)}d ago` : `${daysRemaining}d`})
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Document Presentation Standard: VIEW = RECORD */}
                      <div className="grid grid-cols-2 gap-3 py-3 text-xs">
                        <ReadOnlyField label="Insurer / Underwriter" value={pol.insurerName} />
                        <ReadOnlyField
                          label="Coverage Limit"
                          value={`$${(pol.coverageAmount || 0).toLocaleString()} ${pol.coverages[0]?.currency ?? "CAD"}`}
                          badge={<span className="text-[10px] font-bold text-muted-foreground uppercase">Limit</span>}
                        />
                        <ReadOnlyField
                          label="Effective Date"
                          value={pol.effectiveDate}
                          mono
                        />
                        <ReadOnlyField
                          label="Expiry Date"
                          value={pol.cancelledOn ? `${pol.expiryDate || "Continuous"} (cancelled ${pol.cancelledOn})` : pol.expiryDate}
                          mono
                          badge={
                            pol.status !== "Archived" && !pol.cancelledOn && daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 30 ? (
                              <span className="text-[10px] font-bold text-destructive flex items-center gap-0.5">
                                <AlertTriangle className="size-3" /> Expiry Approaching
                              </span>
                            ) : undefined
                          }
                        />
                      </div>

                      {pol.coverages.length > 1 && (
                        <div className="mb-2 rounded-xl bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
                          <span className="font-bold uppercase tracking-wider text-[10px]">Coverages on this policy</span>
                          <ul className="mt-1 space-y-0.5">
                            {pol.coverages.map((coverage) => (
                              <li key={coverage.id} className="flex justify-between gap-2">
                                <span className="text-foreground font-medium">{coverage.label}</span>
                                <span className="font-mono">{coverage.limitAmount ? `$${Number(coverage.limitAmount).toLocaleString()} ${coverage.currency ?? ""}` : "—"}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Broker Section */}
                      {pol.broker && (
                        <div className="mt-2 rounded-xl bg-muted/40 p-3 border border-border/60 text-xs">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                              <Briefcase className="size-3" /> Brokerage Firm & Agent
                            </span>
                            {pol.status !== "Archived" && (
                              <button
                                type="button"
                                onClick={() => {
                                  onEditBroker(pol);
                                }}
                                className="text-[11px] font-semibold text-primary hover:underline"
                              >
                                Edit Broker
                              </button>
                            )}
                          </div>
                          <div className="font-semibold text-foreground">{pol.broker.organizationName}</div>
                          {pol.broker.contactName && (
                            <div className="text-muted-foreground mt-0.5">
                              Agent: <span className="text-foreground">{pol.broker.contactName}</span>
                              {pol.broker.contactPhone && <span> • {pol.broker.contactPhone}</span>}
                              {pol.broker.contactEmail && <span> • {pol.broker.contactEmail}</span>}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Evidence Attachment Info: no canonical link between a policy and a document yet */}
                      <EvidenceAttachments companyId={companyId} targetTable="insurance_policies" targetId={pol.policyId} targetLabel="policy" allowWrite={pol.status !== "Archived"} />

                      {/* Archive Metadata if archived (the reason is kept in the audit trail, not on the record) */}
                      {pol.status === "Archived" && (
                        <div className="mt-2 text-[11px] text-muted-foreground bg-muted/60 p-2 rounded-lg">
                          <span className="font-bold">Archived</span>
                          {pol.archivedAt ? ` (${pol.archivedAt.split("T")[0]})` : ""} — reason: not recorded on the record (kept in the audit trail).
                        </div>
                      )}
                    </div>

                    {/* Card Actions Footer */}
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {pol.status !== "Archived" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                onEdit(pol);
                              }}
                              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-semibold text-foreground hover:bg-muted transition-colors"
                            >
                              <Pencil className="size-3 text-muted-foreground" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onRenew(pol);
                              }}
                              className="flex items-center gap-1 rounded-lg bg-primary/10 text-primary border border-primary/20 px-2.5 py-1.5 font-bold hover:bg-primary/20 transition-colors"
                            >
                              <RotateCcw className="size-3" /> Renew Policy
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRestore(pol)}
                            className="flex items-center gap-1 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2.5 py-1.5 font-bold hover:bg-emerald-500/20 transition-colors"
                          >
                            <RotateCcw className="size-3" /> Restore Policy
                          </button>
                        )}
                      </div>

                      {pol.status !== "Archived" && (
                        <button
                          type="button"
                          onClick={() =>
                            onArchive(pol)
                          }
                          className="text-[11px] font-semibold text-destructive hover:underline"
                        >
                          Archive
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
