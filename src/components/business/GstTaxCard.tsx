"use client";

import React from "react";
import { Plus, FileText, Archive, RotateCcw, X } from "lucide-react";
import { BusinessTaxAccountRecord } from "@/src/types/business";

type Props = {
  company: any;
  needsCanadianTaxes: boolean;
  showAddGst: boolean;
  gstError: string | null;
  gstRecords: BusinessTaxAccountRecord[];
  handleSaveGstRecord: React.FormEventHandler<HTMLFormElement>;
  handleArchiveTaxRecord: (record: BusinessTaxAccountRecord, archive: boolean) => void;
  setShowAddGst: React.Dispatch<React.SetStateAction<boolean>>;
  setGstError: React.Dispatch<React.SetStateAction<string | null>>;
};

export function GstTaxCard({ company, needsCanadianTaxes, showAddGst, gstError, gstRecords, handleSaveGstRecord, handleArchiveTaxRecord, setShowAddGst, setGstError }: Props) {
  return (
    <>
        {needsCanadianTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  GST / HST Program Accounts (RT0001)
                </h3>
                <p className="text-[10px] text-muted-foreground">Consumption tax account registration</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGstError(null);
                  setShowAddGst(!showAddGst);
                }}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {showAddGst ? <X className="size-3" /> : <Plus className="size-3" />}
                {showAddGst ? "Cancel" : "Add"}
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {showAddGst && (
                <form onSubmit={handleSaveGstRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  {gstError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded-lg">
                      {gstError}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-foreground">Program Account No</label>
                    <input
                      name="accountNo"
                      placeholder={`e.g. ${company?.businessNo || "123456789"}RT0001`}
                      defaultValue={company?.businessNo ? `${company.businessNo}RT0001` : ""}
                      required
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                    />
                    <p className="text-[9px] text-muted-foreground">9-digit root BN + RT + 4-digit sequence</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained Date</label>
                      <input
                        name="obtainedDate"
                        type="date"
                        defaultValue={new Date().toISOString().split("T")[0]}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Obtained By</label>
                      <input
                        name="obtainedBy"
                        defaultValue="System Administrator"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
                  >
                    Save GST/HST Account
                  </button>
                </form>
              )}

              {gstRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No GST/HST accounts registered.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {gstRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            RT Program
                          </span>
                          {rec.isArchived && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground">{rec.id}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-[11px] text-muted-foreground">
                          <p>{rec.obtainedDate}</p>
                          <p>{rec.obtainedBy}</p>
                        </div>
                        <div>
                          {!rec.isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, true)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive GST/HST Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore GST/HST Record"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

    </>
  );
}
