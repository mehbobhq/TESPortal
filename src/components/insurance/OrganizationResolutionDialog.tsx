"use client";

import React from "react";
import { AlertTriangle, Building2 } from "lucide-react";
import type { CanonicalCompany } from "@/app/companies/[id]/insurance/page";

export interface InsuranceOrgResolutionPrompt {
  inputName: string;
  kind: "Insurance Company" | "Insurance Broker" | "Workers Insurance" | "Surety Company";
  mode: "FUZZY_CANDIDATES" | "NEW_CONFIRMATION";
  candidates: CanonicalCompany[];
  onResolve: (resolvedOrg: { id: string; name: string } | null) => void;
}

interface OrganizationResolutionDialogProps {
  prompt: InsuranceOrgResolutionPrompt | null;
  onUseExisting: (company: CanonicalCompany) => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

export function OrganizationResolutionDialog({
  prompt: orgResolutionPrompt,
  onUseExisting,
  onCreateNew,
  onCancel,
}: OrganizationResolutionDialogProps) {
  if (!orgResolutionPrompt) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 text-xs">
            {orgResolutionPrompt.mode === "FUZZY_CANDIDATES" ? (
              <>
                <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-5 shrink-0" />
                  <h3 className="text-base font-bold text-foreground">Probable Organization Match Found</h3>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  You entered &ldquo;<span className="font-bold text-foreground">{orgResolutionPrompt.inputName}</span>&rdquo;. Similar
                  canonical organizations already exist in the Company Master registry. Please select whether to reuse an
                  existing entity or register a new distinct organization:
                </p>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {orgResolutionPrompt.candidates.map((cand) => (
                    <div
                      key={cand.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                    >
                      <div>
                        <div className="font-bold text-foreground">{cand.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          ID: {cand.id} • Kind: {cand.kind || "Organization"} • Status: {cand.status || "Active"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUseExisting(cand)}
                        className="rounded-lg bg-primary px-3 py-1.5 font-bold text-primary-foreground hover:bg-primary/90 text-xs"
                      >
                        Use Existing
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <button
                    type="button"
                    onClick={onCreateNew}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Create &ldquo;{orgResolutionPrompt.inputName}&rdquo; as New Organization
                  </button>

                  <button
                    type="button"
                    onClick={() => onCancel}
                    className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 text-primary">
                  <Building2 className="size-5 shrink-0" />
                  <h3 className="text-base font-bold text-foreground">Confirm New Organization Registration</h3>
                </div>

                <p className="text-muted-foreground leading-relaxed">
                  No existing organization appears to match: &ldquo;<span className="font-bold text-foreground">{orgResolutionPrompt.inputName}</span>&rdquo;.
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Create this as a new <span className="font-bold text-foreground">{orgResolutionPrompt.kind}</span> in Company Master?
                </p>

                <div className="pt-3 border-t border-border flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => onCancel}
                    className="px-4 py-2 font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onCreateNew}
                    className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground hover:bg-primary/90 text-xs shadow-xs"
                  >
                    Create New Organization
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
  );
}
