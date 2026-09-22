"use client"

import { cn } from "@/lib/utils"

export type TESFilterPill = {
  value: string
  label: string
  count?: number
}

export function FilterPills({
  items,
  value,
  onValueChange,
  className,
}: {
  items: TESFilterPill[]
  value: string
  onValueChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="group" aria-label="Filters">
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
              active ? "bg-accent text-primary" : "bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                  active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
