import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { TESStatusRing, type TESStatusTone } from "@/components/tes-status"

export function EntityHeader({
  title,
  statusLabel,
  statusTone = "neutral",
  media,
  description,
  metadata,
  actions,
  insight,
  className,
}: {
  title: ReactNode
  statusLabel?: ReactNode
  statusTone?: TESStatusTone
  media?: ReactNode
  description?: ReactNode
  metadata?: ReactNode
  actions?: ReactNode
  insight?: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-4">
        {media ? <div className="shrink-0">{media}</div> : null}
        <div className="min-w-0 pt-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[28px] leading-8 font-extrabold tracking-[-0.035em] text-foreground">{title}</h1>
            <TESStatusRing tone={statusTone} size="lg" />
            {statusLabel ? (
              <Badge className="border-0 bg-emerald-50 px-3 text-status-current hover:bg-emerald-50">
                {statusLabel}
              </Badge>
            ) : null}
          </div>
          {description ? <div className="mt-2 text-[13px] text-muted-foreground">{description}</div> : null}
          {metadata ? <div className="mt-4 text-[13px] text-muted-foreground">{metadata}</div> : null}
        </div>
      </div>

      {actions || insight ? (
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:flex-row sm:items-start lg:flex-col">
          {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
          {insight}
        </div>
      ) : null}
    </section>
  )
}
