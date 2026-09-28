"use client";

import React from "react";
import { Plus, FileText, Archive, RotateCcw, X } from "lucide-react";
import { BusinessTaxAccountRecord } from "@/src/types/business";

type Props = {
  needsUSTaxes: boolean;
  showAddEin: boolean;
  einError: string | null;
  einRecords: BusinessTaxAccountRecord[];
  handleSaveEinRecord: React.FormEventHandler<HTMLFormElement>;
  handleArchiveTaxRecord: (record: BusinessTaxAccountRecord, archive: boolean) => void;
  setShowAddEin: React.Dispatch<React.SetStateAction<boolean>>;
  setEinError: React.Dispatch<React.SetStateAction<string | null>>;
};

export function EinTaxCard({ needsUSTaxes, showAddEin, einError, einRecords, handleSaveEinRecord, handleArchiveTaxRecord, setShowAddEin, setEinError }: Props) {
  return (
    <>
        {needsUSTaxes && (
          <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col">
            <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  IRS EIN Letters (SS-4 / CP-575)
                </h3>
                <p className="text-[10px] text-muted-foreground">Federal US employer tax identity</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEinError(null);
                  setShowAddEin(!showAddEin);
                }}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                {showAddEin ? <X className="size-3" /> : <Plus className="size-3" />}
                {showAddEin ? "Cancel" : "Add"}
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col">
              {showAddEin && (
                <form onSubmit={handleSaveEinRecord} className="p-3.5 bg-muted/15 rounded-xl border border-border mb-4 space-y-3">
                  {einError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded-lg">
                      {einError}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-foreground">EIN Number (XX-XXXXXXX)</label>
                    <input
                      name="accountNo"
                      placeholder="e.g. 12-3456789"
                      required
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-mono text-foreground"
                    />
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
                    Save EIN Record
                  </button>
                </form>
              )}

              {einRecords.length === 0 ? (
                <div className="my-auto py-8 text-center text-muted-foreground text-xs">
                  <FileText className="size-8 mx-auto opacity-20 mb-2" />
                  <p>No IRS EIN records added.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 text-xs">
                  {einRecords.map((rec) => (
                    <div key={rec.id} className={`py-3 flex items-center justify-between ${rec.isArchived ? "opacity-60 bg-muted/20 px-2 rounded" : ""}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground tracking-wider">
                            {rec.accountNo}
                          </span>
                          {rec.isPrimary && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                              Active EIN
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
                              title="Archive EIN Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveTaxRecord(rec, false)}
                              className="rounded p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                              title="Restore EIN Record"
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
