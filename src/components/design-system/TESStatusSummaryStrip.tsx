import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface TESStatusSummaryStripProps {
  children: ReactNode
  className?: string
}

/**
 * A single restrained horizontal strip of TESStatusSummaryItem facts,
 * separated by hairline dividers. This deliberately replaces the
 * "large colorful KPI card grid" pattern found across the portal today —
 * no per-item card, no background color, no icon boxes.
 *
 * Supports any number of items via children; wraps on narrow viewports
 * rather than forcing horizontal scroll.
 */
export function TESStatusSummaryStrip({ children, className }: TESStatusSummaryStripProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap divide-y divide-border rounded-xl border border-border bg-card sm:flex-nowrap sm:divide-x sm:divide-y-0",
        className
      )}
    >
      {children}
    </div>
  )
}
