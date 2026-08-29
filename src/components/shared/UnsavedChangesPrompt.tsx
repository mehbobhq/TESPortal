"use client";

import React from "react";
import { AlertCircle, Check, X } from "lucide-react";

export interface UnsavedChangesPromptProps {
  hasChanges: boolean;
  isSaving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  message?: string;
}

export function UnsavedChangesPrompt({
  hasChanges,
  isSaving = false,
  onSave,
  onDiscard,
  message = "You have unsaved changes in this compliance record.",
}: UnsavedChangesPromptProps) {
  if (!hasChanges) return null;

  return (
    <div className="sticky bottom-4 z-40 mx-auto w-full max-w-2xl animate-in slide-in-from-bottom-3 duration-200">
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-card/95 p-4 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertCircle className="size-4" />
          </div>
          <div>
            <p className="text-xs font-bold text-foreground">Unsaved Changes</p>
            <p className="text-[11px] text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="size-3.5" />
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Check className="size-3.5" />
            {isSaving ? "Saving..." : "Save Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
