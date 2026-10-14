import React from "react"
import { Info } from "lucide-react"

/**
 * Inline, honest marker for a restored control that has no canonical operation yet. The control stays visible with its original
 * label; this note says what is missing. It never implies the action was saved.
 */
export function CanonicalUnavailable({ action, reason, className = "" }: { action: string; reason: string; className?: string }) {
  return (
    <p role="note" data-canonical-unavailable className={`flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 ${className}`}>
      <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>
        <strong>{action}</strong> is not available yet: {reason}
      </span>
    </p>
  )
}
