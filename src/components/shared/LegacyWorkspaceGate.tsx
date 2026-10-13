"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { Building2, Hourglass } from "lucide-react"

import { EmptyState, LoadingState } from "@/src/components/shared/StateDisplays"

type Resolution = "loading" | "canonical" | "legacy" | "error"

/**
 * Explains a workspace that has no canonical (PostgreSQL) implementation yet.
 * It makes no claim that the company has no data: it says the module is not connected.
 */
export function DeferredWorkspace({ companyId, title, description }: { companyId: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-4 p-6">
      <EmptyState
        icon={<Hourglass className="size-10 text-muted-foreground/60" />}
        title={`${title} is not connected to the canonical records yet`}
        description={description}
      />
      <div className="text-center">
        <Link href={`/companies/${companyId}/profile`} className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">
          <Building2 className="size-3.5" /> Back to the company profile
        </Link>
      </div>
    </div>
  )
}

/**
 * Gate for a workspace whose implementation still keeps its data in this browser's storage under a LEGACY company id.
 *
 * - A canonical organization (the id resolves in PostgreSQL) gets the explicit deferred notice, and the legacy component is
 *   never mounted, so it cannot write browser-local "records" under a canonical company id that would look real but belong
 *   to one browser only.
 * - An id that is not a canonical organization renders the legacy component unchanged (legacy prototype data stays
 *   readable and nothing is migrated, merged or deleted).
 * - A failed lookup is reported as a failure, never as "not found".
 */
export function LegacyWorkspaceGate({
  companyId,
  title,
  description,
  children,
}: {
  companyId: string
  title: string
  description: string
  children: React.ReactNode
}) {
  const [state, setState] = useState<Resolution>("loading")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState("loading")
    fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" })
      .then((response) => {
        if (cancelled) return
        setState(response.ok ? "canonical" : response.status === 404 ? "legacy" : "error")
      })
      .catch(() => {
        if (!cancelled) setState("error")
      })
    return () => {
      cancelled = true
    }
  }, [companyId, attempt])

  if (state === "loading") return <div className="p-10"><LoadingState message={`Loading ${title}...`} /></div>
  if (state === "error") {
    return (
      <div className="p-6">
        <EmptyState
          title={`${title} could not be opened`}
          description="The company lookup failed. This is a temporary error, not a missing company."
          action={{ label: "Try again", onClick: () => setAttempt((n) => n + 1) }}
        />
      </div>
    )
  }
  if (state === "canonical") return <DeferredWorkspace companyId={companyId} title={title} description={description} />
  return <>{children}</>
}
