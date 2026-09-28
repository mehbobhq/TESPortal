"use client";

import React from "react";
import { Plus, FileText, Archive, RotateCcw, X } from "lucide-react";
import { BusinessTaxAccountRecord } from "@/src/types/business";

type Props = {
  needsUSTaxes: boolean;
  showAddSalesTax: boolean;
  salesTaxRecords: BusinessTaxAccountRecord[];
  handleSaveSalesTaxRecord: React.FormEventHandler<HTMLFormElement>;
  handleArchiveTaxRecord: (record: BusinessTaxAccountRecord, archive: boolean) => void;
  setShowAddSalesTax: React.Dispatch<React.SetStateAction<boolean>>;
};

export function SalesTaxCard({ needsUSTaxes, showAddSalesTax, salesTaxRecords, handleSaveSalesTaxRecord, handleArchiveTaxRecord, setShowAddSalesTax }: Props) {
  return (
    <>
        {needsUSTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  US State Sales Tax IDs
                </h3>
                <p className="text-[10px] text-muted-foreground">Jurisdiction-scoped sales tax permits</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSalesTax(!showAddSalesTax)}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {showAddSalesTax ? <X className="size-3" /> : <Plus className="size-3" />}
                {showAddSalesTax ? "Cancel" : "Add"}
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {showAddSalesTax && (
                <form onSubmit={handleSaveSalesTaxRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-foreground">State Code</label>
                      <input
                        name="jurisdiction"
                        placeholder="e.g. CA"
                        maxLength={2}
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono uppercase text-foreground"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[11px] font-bold text-foreground">Account / Permit No</label>
                      <input
                        name="accountNo"
                        placeholder="e.g. SR-CA-992182"
                        required
                        className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                      />
                    </div>
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
                    Save Sales Tax ID
                  </button>
                </form>
              )}

              {salesTaxRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No State Sales Tax IDs registered.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {salesTaxRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            {rec.jurisdiction || "State"}
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
                              title="Archive Sales Tax Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore Sales Tax Record"
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
