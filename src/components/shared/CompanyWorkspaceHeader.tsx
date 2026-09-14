"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"

export interface CompanyWorkspaceHeaderProps {
  company: { id: string; name: string; kind: string; status: string }
  section: string
  description?: string
  actions?: ReactNode
}

export default function CompanyWorkspaceHeader({
  company,
  section,
  description,
  actions,
}: CompanyWorkspaceHeaderProps) {
  const router = useRouter()

  return (
    <div className="flex items-center justify-between border-b border-border bg-background px-0 py-3 mb-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>

        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground leading-tight">
            {company.name}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {company.kind}
            </span>
            <StatusBadge tone={company.status === "Active" ? "ok" : "warn"}>
              {company.status}
            </StatusBadge>
          </div>
        </div>

        <div className="mx-2 h-7 w-px bg-border shrink-0" />

        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground leading-tight">
            {section}
          </span>
          {description ? (
            <span className="text-[11px] text-muted-foreground leading-tight">
              {description}
            </span>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </div>
  )
}
