"use client";

import React, { useState } from "react";
import { FileCheck2, Paperclip } from "lucide-react";
import { CanonicalUnavailable } from "@/src/components/shared/CanonicalUnavailable";

export const EVIDENCE_GAP =
  "a policy has no canonical link to an uploaded document yet (the evidence lifecycle stores company documents, not policy attachments), so nothing can be attached to or previewed from this record. Nothing was uploaded.";

/**
 * The original evidence row of a record. Evidence cannot be linked to a canonical policy yet, so the control stays visible with its
 * label and says exactly what is missing; it never claims a document was saved.
 */
export function EvidenceNote({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`mt-2 rounded-xl border border-dashed border-border/80 ${compact ? "p-2" : "p-2.5"} text-xs`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 text-muted-foreground">
          <FileCheck2 className="size-4 shrink-0" />
          <span className="font-semibold truncate">Evidence: not recorded</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline shrink-0"
        >
          <Paperclip className="size-3.5" /> Attach Evidence
        </button>
      </div>
      {open ? <CanonicalUnavailable className="mt-1.5" action="Attaching evidence" reason={EVIDENCE_GAP} /> : null}
    </div>
  );
}
