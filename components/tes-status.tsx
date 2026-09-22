import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type TESStatusTone = "current" | "attention" | "critical" | "neutral" | "info"
export type TESStatusRingSize = "sm" | "md" | "lg"

const toneClasses: Record<TESStatusTone, string> = {
  current: "text-status-current",
  attention: "text-status-attention",
  critical: "text-status-critical",
  neutral: "text-status-neutral",
  info: "text-primary",
}

const sizeClasses: Record<TESStatusRingSize, string> = {
  sm: "size-4 border-2",
  md: "size-5 border-2",
  lg: "size-6 border-[2.5px]",
}

export function TESStatusRing({
  tone = "neutral",
  size = "md",
  className,
}: {
  tone?: TESStatusTone
  size?: TESStatusRingSize
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full border-current bg-transparent",
        toneClasses[tone],
        sizeClasses[size],
        className
      )}
    />
  )
}

export function TESStatusIndicator({
  tone = "neutral",
  size = "sm",
  children,
  className,
}: {
  tone?: TESStatusTone
  size?: TESStatusRingSize
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px] font-medium", toneClasses[tone], className)}>
      <TESStatusRing tone={tone} size={size} />
      <span>{children}</span>
    </span>
  )
}

export function TESChangeIndicator({
  direction,
  children,
  className,
}: {
  direction: "positive" | "negative" | "neutral"
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold",
        direction === "positive" && "bg-emerald-50 text-emerald-700",
        direction === "negative" && "bg-red-50 text-red-700",
        direction === "neutral" && "bg-secondary text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  )
}
