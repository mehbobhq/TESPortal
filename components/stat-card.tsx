import type { LucideIcon } from "lucide-react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
}: {
  label: string
  value: string
  hint?: string
  icon: LucideIcon
  trend?: { value: string; direction: "up" | "down"; positive?: boolean }
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm font-medium">{label}</span>
          <span className="bg-secondary text-muted-foreground flex size-8 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          {trend ? (
            <span
              className={cn(
                "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                trend.positive ? "bg-chart-3/15 text-chart-3" : "bg-destructive/10 text-destructive",
              )}
            >
              {trend.direction === "up" ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {trend.value}
            </span>
          ) : null}
        </div>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  )
}
