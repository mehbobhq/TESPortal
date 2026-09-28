"use client";

import React from "react";
import { Plus, Archive, RotateCcw, Pencil, AlertCircle, X, Check } from "lucide-react";
import { BusinessShareholderRecord } from "@/src/types/business";

type Props = {
  totalActiveOwnership: number;
  activeShareholders: BusinessShareholderRecord[];
  visibleShareholders: BusinessShareholderRecord[];
  showArchivedShareholders: boolean;
  showAddShareholder: boolean;
  editingShareholder: BusinessShareholderRecord | null;
  shareholderError: string | null;
  handleSaveShareholder: React.FormEventHandler<HTMLFormElement>;
  handleArchiveShareholder: (record: BusinessShareholderRecord, archive: boolean) => void;
  setShowArchivedShareholders: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAddShareholder: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingShareholder: React.Dispatch<React.SetStateAction<BusinessShareholderRecord | null>>;
  setShareholderError: React.Dispatch<React.SetStateAction<string | null>>;
};

export function ShareholdersSection({ totalActiveOwnership, activeShareholders, visibleShareholders, showArchivedShareholders, showAddShareholder, editingShareholder, shareholderError, handleSaveShareholder, handleArchiveShareholder, setShowArchivedShareholders, setShowAddShareholder, setEditingShareholder, setShareholderError }: Props) {
  return (
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Directors & Shareholders</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                {activeShareholders.length} Active
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Corporate equity distribution, statutory directors, and officer registry.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowArchivedShareholders(!showArchivedShareholders)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                showArchivedShareholders
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Toggle historical archived shareholders"
            >
              <Archive className="size-3.5" />
              {showArchivedShareholders ? "Hide Archived" : "Show Archived"}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingShareholder(null);
                setShareholderError(null);
                setShowAddShareholder(!showAddShareholder);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              {showAddShareholder ? (
                <>
                  <X className="size-3.5" /> Close
                </>
              ) : (
                <>
                  <Plus className="size-3.5" /> Add Record
                </>
              )}
            </button>
          </div>
        </div>

        {/* Add / Edit Form Drawer */}
        {(showAddShareholder || editingShareholder) && (
          <form
            onSubmit={handleSaveShareholder}
            className="p-5 bg-muted/15 border-b border-border space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                {editingShareholder ? "Edit Corporate Person" : "Add Director / Shareholder"}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                Current recorded equity:{" "}
                <span className="font-bold text-foreground">{totalActiveOwnership.toFixed(1)}%</span>
              </span>
            </div>

            {shareholderError && (
              <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{shareholderError}</span>
              </div>
            )}

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Full Legal Name <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  defaultValue={editingShareholder?.name || ""}
                  placeholder="e.g. Eleanor Vance"
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Role / Position</label>
                <select
                  name="role"
                  defaultValue={editingShareholder?.role || "Shareholder"}
                  className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                >
                  <option value="Shareholder">Shareholder (Equity Owner)</option>
                  <option value="Director">Director (Board Member)</option>
                  <option value="Officer">Officer (Executive)</option>
                  <option value="Director & Shareholder">Director & Shareholder</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Percent Equity Ownership (%) <span className="text-destructive">*</span>
                </label>
                <input
                  name="shares"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={editingShareholder?.shares ?? 50}
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Available remaining equity: {(100 - (totalActiveOwnership - (editingShareholder?.shares || 0))).toFixed(1)}%
                </p>
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-xs font-bold text-foreground">
                  Service / Registered Address <span className="text-destructive">*</span>
                </label>
                <input
                  name="address"
                  defaultValue={editingShareholder?.address || ""}
                  placeholder="e.g. 100 King St W, Suite 4000, Toronto, ON M5X 1A9"
                  required
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  setShowAddShareholder(false);
                  setEditingShareholder(null);
                  setShareholderError(null);
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
                {editingShareholder ? "Save Changes" : "Save Record"}
              </button>
            </div>
          </form>
        )}

        {/* Table Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/20 border-b border-border font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
              <tr>
                <th className="px-5 py-3">Record ID</th>
                <th className="px-5 py-3">Name & Role</th>
                <th className="px-5 py-3">Ownership</th>
                <th className="px-5 py-3">Address</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleShareholders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No active shareholder or director records found. Click &quot;Add Record&quot; to establish ownership.
                  </td>
                </tr>
              ) : (
                visibleShareholders.map((shr) => (
                  <tr
                    key={shr.id}
                    className={`hover:bg-muted/10 transition-colors ${
                      shr.isArchived ? "bg-muted/30 opacity-70" : ""
                    }`}
                  >
                    <td className="px-5 py-3 font-mono font-medium text-foreground">
                      {shr.id}
                      {shr.isArchived && (
                        <span className="ml-2 inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-foreground">{shr.name}</div>
                      <div className="text-[10px] text-muted-foreground">{shr.role}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-bold text-foreground">{shr.shares}%</span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground max-w-xs truncate" title={shr.address}>
                      {shr.address}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {!shr.isArchived ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingShareholder(shr);
                                setShowAddShareholder(false);
                              }}
                              className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Edit Record"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchiveShareholder(shr, true)}
                              className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Archive Record"
                            >
                              <Archive className="size-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleArchiveShareholder(shr, false)}
                            className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-primary"
                            title="Restore Record"
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
