import type { ReactNode } from "react"
import { ArrowUp, ArrowDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

export type TESChangeDirection = "up" | "down" | "neutral"

const DIRECTION_CLASS: Record<TESChangeDirection, string> = {
  up: "text-status-current",
  down: "text-status-critical",
  neutral: "text-status-neutral",
}

const DIRECTION_ICON: Record<TESChangeDirection, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  neutral: Minus,
}

export interface TESChangeIndicatorProps {
  /** Pre-calculated magnitude, e.g. 12 for "+12%". The TES weighting formula lives elsewhere. */
  value: number
  direction: TESChangeDirection
  /** e.g. "this week", "vs last month" */
  period?: string
  /** e.g. "Compliance progress" — rendered above the value, never hardcoded by this component */
  label?: string
  explanation?: ReactNode
  action?: ReactNode
  className?: string
}

/**
 * TESChangeIndicator — represents MOVEMENT OVER TIME, never current condition.
 *
 * Deliberately separate from TESStatusRing: a record can show a red-critical
 * ring (still unsatisfied) alongside a green "+15%" change (materially
 * improving). Never conflate the two concepts inside one component.
 */
export function TESChangeIndicator({
  value,
  direction,
  period,
  label,
  explanation,
  action,
  className,
}: TESChangeIndicatorProps) {
  const Icon = DIRECTION_ICON[direction]
  const sign = direction === "up" ? "+" : direction === "down" ? "−" : ""

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label ? <span className="text-[11px] font-medium text-muted-foreground">{label}</span> : null}
      <div className="flex items-center gap-1.5">
        <span className={cn("flex items-center gap-1 text-[13px] font-semibold tabular-nums", DIRECTION_CLASS[direction])}>
          <Icon aria-hidden="true" className="size-3.5" />
          {sign}
          {Math.abs(value)}%
        </span>
        {period ? <span className="text-[12px] text-muted-foreground">{period}</span> : null}
      </div>
      {explanation ? <div className="text-[12px] text-muted-foreground">{explanation}</div> : null}
      {action}
    </div>
  )
}
