"use client";

import React from "react";
import { FileText, Pencil, X, Check } from "lucide-react";
import { ReadOnlyField } from "@/src/components/shared/ReadOnlyField";

type Props = {
  company: any;
  isCanadaRegistered: boolean;
  isEditingIncorp: boolean;
  incorpDateDraft: string;
  setIncorpDateDraft: React.Dispatch<React.SetStateAction<string>>;
  setIsEditingIncorp: React.Dispatch<React.SetStateAction<boolean>>;
  handleSaveIncorp: React.FormEventHandler<HTMLFormElement>;
};

export function IncorporationSection({ company, isCanadaRegistered, isEditingIncorp, incorpDateDraft, setIncorpDateDraft, setIsEditingIncorp, handleSaveIncorp }: Props) {
  return (
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Incorporation Information</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isEditingIncorp) {
                setIncorpDateDraft(company.incorpDate || "");
              }
              setIsEditingIncorp(!isEditingIncorp);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
          >
            {isEditingIncorp ? (
              <>
                <X className="size-3.5" /> Cancel
              </>
            ) : (
              <>
                <Pencil className="size-3.5" /> Edit
              </>
            )}
          </button>
        </div>

        <div className="p-6">
          {isEditingIncorp ? (
            <form onSubmit={handleSaveIncorp} className="space-y-6">
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Record ID
                  </label>
                  <input
                    value={company.id}
                    disabled
                    className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-xs font-mono font-medium text-muted-foreground cursor-not-allowed"
                  />
                  <p className="text-[10px] text-muted-foreground">Authoritative company identifier (Locked)</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {isCanadaRegistered ? "Corporate Number" : "State File Number"}
                  </label>
                  <input
                    value={company.incorpNo || ""}
                    disabled
                    className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-muted-foreground cursor-not-allowed"
                  />
                  <p className="text-[10px] text-muted-foreground">Managed on Company Profile (Locked)</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Incorporation Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    value={incorpDateDraft}
                    onChange={(e) => setIncorpDateDraft(e.target.value)}
                    required
                    className="w-full h-9 rounded-lg border border-primary/50 bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
                  />
                  <p className="text-[10px] text-primary">Writes directly to tes_companies</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Jurisdiction
                  </label>
                  <input
                    value={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`}
                    disabled
                    className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-muted-foreground cursor-not-allowed"
                  />
                  <p className="text-[10px] text-muted-foreground">Home jurisdiction (Locked)</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIncorpDateDraft(company.incorpDate || "");
                    setIsEditingIncorp(false);
                  }}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                >
                  <Check className="size-3.5" /> Save Updates
                </button>
              </div>
            </form>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <ReadOnlyField label="Record ID" value={company.id} mono copyable />
              <ReadOnlyField
                label={isCanadaRegistered ? "Corporate Number" : "State File Number"}
                value={company.incorpNo}
                mono
                copyable
                subtext="Managed on Company Profile"
              />
              <ReadOnlyField
                label="Incorporation Date"
                value={company.incorpDate}
                subtext="Statutory legal establishment date"
              />
              <ReadOnlyField
                label="Jurisdiction"
                value={`${company.regCorpState || "Unknown"}, ${company.regCorpCountry || "Unknown"}`}
              />
            </div>
          )}

        </div>
      </div>

  );
}
