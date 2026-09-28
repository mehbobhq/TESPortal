"use client";

import React from "react";
import { Plus, FileText, Archive, RotateCcw, AlertCircle, X } from "lucide-react";
import { BusinessTaxAccountRecord } from "@/src/types/business";

type Props = {
  company: any;
  needsCanadianTaxes: boolean;
  showArchivedTaxes: boolean;
  showAddCra: boolean;
  craError: string | null;
  taxActionError: string | null;
  craRecords: BusinessTaxAccountRecord[];
  handleSaveCraRecord: React.FormEventHandler<HTMLFormElement>;
  handleArchiveTaxRecord: (record: BusinessTaxAccountRecord, archive: boolean) => void;
  setShowArchivedTaxes: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAddCra: React.Dispatch<React.SetStateAction<boolean>>;
  setCraError: React.Dispatch<React.SetStateAction<string | null>>;
};

export function CraTaxCard({ company, needsCanadianTaxes, showArchivedTaxes, showAddCra, craError, taxActionError, craRecords, handleSaveCraRecord, handleArchiveTaxRecord, setShowArchivedTaxes, setShowAddCra, setCraError }: Props) {
  return (
    <>
        {needsCanadianTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  CRA Business Number (BN9)
                </h3>
                <p className="text-[10px] text-muted-foreground">Federal Canadian tax identity</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowArchivedTaxes(!showArchivedTaxes)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Toggle archived tax accounts"
                >
                  <Archive className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCraError(null);
                    setShowAddCra(!showAddCra);
                  }}
                  className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
                >
                  {showAddCra ? <X className="size-3" /> : <Plus className="size-3" />}
                  {showAddCra ? "Cancel" : "Add"}
                </button>
              </div>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {taxActionError && (
                <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg mb-3 flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{taxActionError}</span>
                </div>
              )}
              {showAddCra && (
                <form onSubmit={handleSaveCraRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  {craError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded-lg">
                      {craError}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-foreground">9-Digit Business Number</label>
                    <input
                      name="accountNo"
                      placeholder="e.g. 123456789"
                      required
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                    />
                    <p className="text-[9px] text-muted-foreground">Synchronizes to company.businessNo in tes_companies</p>
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
                    Save & Synchronize BN
                  </button>
                </form>
              )}

              {craRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No CRA Business Number registered.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {craRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          {rec.isPrimary && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                              Master Active
                            </span>
                          )}
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
                              title="Archive Tax Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore Tax Record"
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
