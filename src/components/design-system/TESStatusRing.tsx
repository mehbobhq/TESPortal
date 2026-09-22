import { cn } from "@/lib/utils"

/**
 * The four semantic status tones used everywhere in TES. Domain logic
 * (expiry, compliance, deadlines, propagation, verification) decides which
 * tone applies — this file only knows how to render one once it's told.
 */
export type TESStatusTone = "current" | "attention" | "critical" | "neutral"

const RING_TONE_CLASS: Record<TESStatusTone, string> = {
  current: "border-status-current",
  attention: "border-status-attention",
  critical: "border-status-critical",
  neutral: "border-status-neutral",
}

const RING_SIZE_CLASS = {
  sm: "size-2",
  md: "size-2.5",
} as const

export interface TESStatusRingProps {
  /** Semantic tone. Callers pass the tone that already-computed domain logic selected. */
  tone: TESStatusTone
  /**
   * Visible text shown next to the ring (e.g. "Current", "Expiring Soon").
   * Also used as the accessible name when no separate label is already
   * present in the surrounding UI — pass `hideLabel` if the text is
   * rendered elsewhere and the ring would otherwise duplicate it visually.
   */
  label?: string
  hideLabel?: boolean
  size?: "sm" | "md"
  className?: string
  labelClassName?: string
}

/**
 * TESStatusRing — the only semantic status marker in TES.
 *
 * Always an empty, outlined circle with a transparent center. Never a
 * filled dot, never a traffic-light icon, never a checkmark. This is a
 * presentational primitive: it renders a tone, it does not calculate one.
 */
export function TESStatusRing({
  tone,
  label,
  hideLabel = false,
  size = "sm",
  className,
  labelClassName,
}: TESStatusRingProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block shrink-0 rounded-full border-[1.5px] bg-transparent",
          RING_SIZE_CLASS[size],
          RING_TONE_CLASS[tone]
        )}
      />
      {label && !hideLabel ? (
        <span className={cn("text-[13px] font-medium text-foreground", labelClassName)}>{label}</span>
      ) : null}
      {label && hideLabel ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}
