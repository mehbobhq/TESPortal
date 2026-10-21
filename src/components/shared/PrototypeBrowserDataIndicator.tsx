import React from "react"

export const BROWSER_DATA_NOTE = "Records in this workspace are stored in this browser and are not synchronized with the TES production database."

/** Compact, truthful data-source indicator for an original workspace whose records live only in this browser. */
export function PrototypeBrowserDataIndicator() {
  return (
    <span
      role="note"
      tabIndex={0}
      title={BROWSER_DATA_NOTE}
      aria-label={`Prototype workspace · Browser data. ${BROWSER_DATA_NOTE}`}
      className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 align-middle text-[10px] font-medium text-muted-foreground"
    >
      Prototype workspace · Browser data
    </span>
  )
}
