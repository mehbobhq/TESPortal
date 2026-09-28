"use client";

import React from "react";
import { Plus, UploadCloud, CheckCircle2, Clock, Archive, RotateCcw, X, Check } from "lucide-react";
import { BusinessAnnualReturnRecord } from "@/src/types/business";

type Props = {
  visibleReturns: BusinessAnnualReturnRecord[];
  showArchivedReturns: boolean;
  showAddReturn: boolean;
  editingReturn: BusinessAnnualReturnRecord | null;
  handleSaveReturn: React.FormEventHandler<HTMLFormElement>;
  handleArchiveReturn: (record: BusinessAnnualReturnRecord, archive: boolean) => void;
  handleOpenSourcePicker: (targetLabel: string) => void;
  setShowArchivedReturns: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAddReturn: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingReturn: React.Dispatch<React.SetStateAction<BusinessAnnualReturnRecord | null>>;
};

export function AnnualReturnsSection({ visibleReturns, showArchivedReturns, showAddReturn, editingReturn, handleSaveReturn, handleArchiveReturn, handleOpenSourcePicker, setShowArchivedReturns, setShowAddReturn, setEditingReturn }: Props) {
  return (
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Annual Corporate Returns</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {visibleReturns.length} Records
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Statutory corporate filing history and compliance confirmation archive.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowArchivedReturns(!showArchivedReturns)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                showArchivedReturns
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Archive className="size-3.5" />
              {showArchivedReturns ? "Hide Archived" : "Show Archived"}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingReturn(null);
                setShowAddReturn(!showAddReturn);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              {showAddReturn ? (
                <>
                  <X className="size-3.5" /> Close
                </>
              ) : (
                <>
                  <Plus className="size-3.5" /> Add Filing
                </>
              )}
            </button>
          </div>
        </div>

        {/* Add / Edit Filing Form */}
        {(showAddReturn || editingReturn) && (
          <form
            onSubmit={handleSaveReturn}
            className="p-5 bg-muted/15 border-b border-border space-y-4"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
              {editingReturn ? "Edit Annual Filing" : "Record Annual Return Filing"}
            </h3>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Statutory Due Date <span className="text-destructive">*</span>
                </label>
                <input
                  name="dueDate"
                  type="date"
                  defaultValue={editingReturn?.dueDate || ""}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Actual Filed Date</label>
                <input
                  name="filedDate"
                  type="date"
                  defaultValue={editingReturn?.filedDate || ""}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Filed By / Agent</label>
                <input
                  name="filedBy"
                  defaultValue={editingReturn?.filedBy || ""}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Jurisdiction Filing Confirmation #
                </label>
                <input
                  name="confirmationNumber"
                  defaultValue={editingReturn?.confirmationNumber || ""}
                  placeholder="e.g. ON-CORP-2025-99812"
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  setShowAddReturn(false);
                  setEditingReturn(null);
                }}
                className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
              >
                <Check className="size-3.5" />
                {editingReturn ? "Save Changes" : "Save Filing"}
              </button>
            </div>
          </form>
        )}

        {/* Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/20 border-b border-border font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
              <tr>
                <th className="px-5 py-3">Filing ID</th>
                <th className="px-5 py-3">Due Date</th>
                <th className="px-5 py-3">Filed Date</th>
                <th className="px-5 py-3">Submitter</th>
                <th className="px-5 py-3">Confirmation #</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleReturns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No annual corporate return filings recorded yet.
                  </td>
                </tr>
              ) : (
                visibleReturns.map((rtn) => (
                  <tr
                    key={rtn.id}
                    className={`hover:bg-muted/10 transition-colors ${
                      rtn.isArchived ? "bg-muted/30 opacity-70" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-mono font-medium text-foreground">
                      {rtn.id}
                      {rtn.isArchived && (
                        <span className="ml-2 inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-foreground font-medium">{rtn.dueDate}</td>
                    <td className="px-5 py-3">
                      {rtn.filedDate ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" /> {rtn.filedDate}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <Clock className="size-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{rtn.filedBy}</td>
                    <td className="px-5 py-3 font-mono text-[11px] text-muted-foreground">
                      {rtn.confirmationNumber || "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenSourcePicker(`Annual Return ${rtn.id}`)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Preview filing document"
                        >
                          <UploadCloud className="size-3 inline mr-1" /> Select Document
                        </button>
                        {!rtn.isArchived ? (
                          <button
                            type="button"
                            onClick={() => handleArchiveReturn(rtn, true)}
                            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                            title="Archive Filing"
                          >
                            <Archive className="size-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleArchiveReturn(rtn, false)}
                            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                            title="Restore Filing"
                          >
                            <RotateCcw className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

  );
}
