import { ShieldCheck, Plus, Briefcase, FileCheck2, Eye, AlertTriangle, Pencil, RotateCcw } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";
import { EmptyState } from "@/src/components/shared/StateDisplays";
import { getDaysRemaining, getDeadlineStatus, getDeadlineClasses } from "@/lib/deadline-engine";
import type { TransportationInsuranceRecord, InsuranceEvidence } from "@/app/companies/[id]/insurance/page";

interface TransportationPoliciesSectionProps {
  records: TransportationInsuranceRecord[];
  evidence: InsuranceEvidence[];
  onAdd: () => void;
  onEdit: (record: TransportationInsuranceRecord) => void;
  onRenew: (record: TransportationInsuranceRecord) => void;
  onEditBroker: (record: TransportationInsuranceRecord) => void;
  onArchive: (record: TransportationInsuranceRecord) => void;
  onRestore: (record: TransportationInsuranceRecord) => void;
  onViewEvidence: (evidence: InsuranceEvidence, record: TransportationInsuranceRecord) => void;
}

export function TransportationPoliciesSection({
  records: filteredTransportation,
  evidence,
  onAdd,
  onEdit,
  onRenew,
  onEditBroker,
  onArchive,
  onRestore,
  onViewEvidence,
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
              description="Upload a Certificate of Insurance (COI) or manually add an Auto Liability, Cargo, or CGL policy."
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
                const deadlineStatus = getDeadlineStatus(pol.expiryDate);
                const deadlineStyle = getDeadlineClasses(deadlineStatus);
                const daysRemaining = getDaysRemaining(pol.expiryDate);
                const linkedEvidence = pol.evidenceId ? evidence.find((e) => e.id === pol.evidenceId) : null;

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
                            {pol.groupId && (
                              <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase">
                                COI Group
                              </span>
                            )}
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
                              {deadlineStatus}
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
                          value={`$${(pol.coverageAmount || 0).toLocaleString()} CAD`}
                          badge={<span className="text-[10px] font-bold text-muted-foreground uppercase">Limit</span>}
                        />
                        <ReadOnlyField
                          label="Effective Date"
                          value={pol.effectiveDate}
                          mono
                        />
                        <ReadOnlyField
                          label="Expiry Date"
                          value={pol.expiryDate}
                          mono
                          badge={
                            pol.status !== "Archived" && daysRemaining !== null && daysRemaining <= 30 ? (
                              <span className="text-[10px] font-bold text-destructive flex items-center gap-0.5">
                                <AlertTriangle className="size-3" /> Expiry Approaching
                              </span>
                            ) : undefined
                          }
                        />
                      </div>

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

                      {/* Evidence Attachment Info */}
                      {linkedEvidence && (
                        <div className="mt-2 flex items-center justify-between rounded-xl border border-border/80 bg-card p-2.5 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileCheck2 className="size-4 text-emerald-600 shrink-0" />
                            <span className="font-semibold text-foreground truncate">{linkedEvidence.fileName}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 uppercase font-bold">
                              ({linkedEvidence.source})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onViewEvidence(linkedEvidence, pol);
                            }}
                            className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline shrink-0"
                          >
                            <Eye className="size-3.5" /> View Evidence
                          </button>
                        </div>
                      )}

                      {/* Archive Metadata if archived */}
                      {pol.status === "Archived" && pol.archiveReason && (
                        <div className="mt-2 text-[11px] text-muted-foreground bg-muted/60 p-2 rounded-lg">
                          <span className="font-bold">Archived:</span> {pol.archiveReason} ({pol.archivedAt?.split("T")[0]})
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
