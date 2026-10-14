"use client";

import { History } from "lucide-react";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";

/**
 * Business Audit & Change Ledger. Every canonical change made on this page is recorded in the Master Register in the same
 * transaction, but no organization-scoped read of that register exists for this workspace yet (reading it needs the
 * MASTER_REGISTER_READ capability and a decision on what a company-facing ledger may show). So the ledger keeps its place and says
 * so, instead of showing an empty list that would look like "nothing happened".
 */
export function BusinessHistory() {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      <div className="bg-muted/30 px-5 py-3.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Business Audit & Change Ledger</h3>
        </div>
        <span className="text-[11px] text-muted-foreground font-mono">events not readable here yet</span>
      </div>
      <div className="p-4 text-xs">
        <CanonicalUnavailable
          action="The change ledger"
          reason="changes made here are recorded in the Master Register, but no company-scoped read of it exists for this workspace yet, so they cannot be listed."
        />
      </div>
    </div>
  );
}
