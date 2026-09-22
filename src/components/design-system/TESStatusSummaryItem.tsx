import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { TESStatusRing, type TESStatusTone } from "./TESStatusRing"

export interface TESStatusSummaryItemProps {
  label: string
  /** Omit when the fact being summarized has no single current-condition tone. */
  tone?: TESStatusTone
  primaryValue: ReactNode
  secondaryValue?: ReactNode
  onClick?: () => void
  className?: string
}

/**
 * One compact fact inside a TESStatusSummaryStrip, e.g.:
 *
 *   ○ Registration
 *     Current
 *     Expires Dec 31, 2026
 *
 * Receives already-computed values only — it never determines status itself.
 */
export function TESStatusSummaryItem({
  label,
  tone,
  primaryValue,
  secondaryValue,
  onClick,
  className,
}: TESStatusSummaryItemProps) {
  const Wrapper = onClick ? "button" : "div"

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-left",
        onClick && "transition-colors hover:bg-muted/40",
        className
      )}
    >
      <span className="flex items-center gap-1.5">
        {tone ? <TESStatusRing tone={tone} hideLabel size="sm" /> : null}
        <span className="truncate text-[12px] font-medium text-muted-foreground">{label}</span>
      </span>
      <span className="truncate text-[13px] font-semibold text-foreground">{primaryValue}</span>
      {secondaryValue ? (
        <span className="truncate text-[12px] text-muted-foreground">{secondaryValue}</span>
      ) : null}
    </Wrapper>
  )
}
