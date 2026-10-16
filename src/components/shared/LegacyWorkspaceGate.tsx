"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { Building2, Hourglass } from "lucide-react"

import { EmptyState, LoadingState } from "@/src/components/shared/StateDisplays"

type Resolution = "loading" | "canonical" | "not-canonical" | "error"

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
 * Gate in front of a workspace whose original implementation keeps its data in this browser's storage.
 *
 * CONTAINMENT: the original (browser-local) implementation is PRESERVED in the repository as recoverable source, but it is
 * never rendered. `children` is accepted so that the pages that pass it, and the restored canonical workspaces that will replace
 * it, keep their call shape; it is deliberately not placed in the output. Consequently, from this gate:
 *   - no operational data can be entered into a browser-local workspace;
 *   - nothing is written to localStorage, sessionStorage or IndexedDB, and no `tes_companies` entry (or any other key) is created;
 *   - the legacy credentials workspace, its portal registry and its recovery-detail entry are unreachable.
 *
 * What the user sees instead:
 *   - a canonical company with a canonical (PostgreSQL-backed) workspace: that workspace, alone;
 *   - a canonical company whose module has no canonical workspace yet: the deferred-workspace explanation;
 *   - an id that is not a canonical company: a plain "not a TES record" explanation (nothing is read from, or written to, browser storage);
 *   - a failed lookup: reported as a failure, never as "not found".
 */
export function LegacyWorkspaceGate({
  companyId,
  title,
  canonical,
}: {
  companyId: string
  title: string
  /** Retained for the call shape of existing pages; describes the preserved browser-local implementation, which is not shown. */
  description?: string
  /** The canonical (PostgreSQL-backed) workspace, when one exists. */
  canonical?: React.ReactNode
  /** The preserved browser-local implementation. Intentionally NOT rendered (see above). */
  children?: React.ReactNode
}) {
  const [state, setState] = useState<Resolution>("loading")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState("loading")
    fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" })
      .then((response) => {
        if (cancelled) return
        if (response.ok) setState("canonical")
        else setState(response.status === 404 ? "not-canonical" : "error")
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
  if (state === "not-canonical") {
    return (
      <div className="p-6">
        <EmptyState
          title="This company is not a TES record"
          description={`${title} is available only for companies held in the TES database. Browser-local prototype workspaces are not available.`}
        />
        <div className="mt-4 text-center">
          <Link href="/companies" className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline">
            <Building2 className="size-3.5" /> Back to companies
          </Link>
        </div>
      </div>
    )
  }
  if (canonical) return <>{canonical}</>
  return (
    <DeferredWorkspace
      companyId={companyId}
      title={title}
      description="The earlier version of this workspace stored its records only in the browser, so it is not available for operational use. It is being rebuilt on the TES database; nothing has been deleted or changed."
    />
  )
}
