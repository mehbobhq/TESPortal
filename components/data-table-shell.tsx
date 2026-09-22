import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { SectionHeader } from "@/components/section-header"

export function DataTableShell({
  title,
  description,
  actions,
  toolbar,
  children,
  footer,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="space-y-3 p-4">
        <SectionHeader title={title} description={description} actions={actions} />
        {toolbar}
      </div>
      <div className="overflow-hidden border-y border-border/80">{children}</div>
      {footer ? <div className="flex min-h-12 items-center px-4 py-2">{footer}</div> : null}
    </Card>
  )
}
