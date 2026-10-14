"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Building2, Hourglass } from "lucide-react"

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

type CanonicalCompany = { id: string; name: string; kind?: string; region?: string; status?: string }

/**
 * Makes a canonical company visible to the existing browser-local workspaces, which find their company in
 * `tes_companies`. It only ADDS a missing entry (marked `source: "canonical-projection"`); an existing entry is never changed,
 * and nothing is ever deleted or copied back to PostgreSQL. The identity projected is the canonical one.
 */
function projectCanonicalCompany(company: CanonicalCompany): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    const list = Array.isArray(raw) ? raw : []
    if (list.some((entry: { id?: string }) => entry?.id === company.id)) return false
    list.push({
      id: company.id,
      name: company.name,
      companyName: company.name,
      kind: company.kind ?? "",
      region: company.region ?? "",
      status: company.status ?? "Active",
      source: "canonical-projection",
    })
    localStorage.setItem("tes_companies", JSON.stringify(list))
    return true
  } catch {
    // Browser storage unavailable: the legacy workspace simply reports that it cannot find the company.
    return false
  }
}

/**
 * Removes ONLY the marked projection this view added (never a user's own entry, never any other key), so the browser never keeps a
 * second, stale copy of canonical company identity once the old workspace is closed.
 */
function removeCanonicalProjection(companyId: string): void {
  try {
    const raw = JSON.parse(localStorage.getItem("tes_companies") || "[]")
    if (!Array.isArray(raw)) return
    const kept = raw.filter((entry: { id?: string; source?: string }) => !(entry?.id === companyId && entry?.source === "canonical-projection"))
    if (kept.length !== raw.length) localStorage.setItem("tes_companies", JSON.stringify(kept))
  } catch {
    // nothing to clean up
  }
}

/** The existing workspace, unchanged, opened for a canonical company, with its integration boundary stated above it. */
function BrowserLocalWorkspace({ company, title, boundary, children }: { company: CanonicalCompany; title: string; boundary: string; children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const added = projectCanonicalCompany(company)
    setReady(true)
    // Also on a hard navigation or tab close (React cleanup does not run then).
    const onHide = () => {
      if (added) removeCanonicalProjection(company.id)
    }
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      onHide()
    }
  }, [company])
  return (
    <div className="flex flex-col">
      <div role="note" className="mx-6 mt-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold text-foreground">{title}: browser-local workspace (not the TES database)</p>
          <p className="mt-1 text-muted-foreground">{boundary}</p>
        </div>
      </div>
      {ready ? children : <div className="p-10"><LoadingState message={`Loading ${title}...`} /></div>}
    </div>
  )
}

/**
 * Gate for a workspace whose existing implementation still keeps its data in this browser's storage.
 *
 * - The existing workspace is NEVER removed or replaced. For a canonical company it opens unchanged, under a banner that says its
 *   records live only in this browser and are not canonical production data.
 * - When a canonical (PostgreSQL) workspace exists it is the default tab, and the existing workspace stays one click away.
 * - An id that is not a canonical organization renders the existing component directly (legacy prototype data stays readable;
 *   nothing is migrated, merged or deleted).
 * - A failed lookup is reported as a failure, never as "not found".
 */
export function LegacyWorkspaceGate({
  companyId,
  title,
  description,
  canonical,
  children,
}: {
  companyId: string
  title: string
  /** The integration boundary: what is browser-local about this workspace. */
  description: string
  /** The canonical (PostgreSQL-backed) workspace, when one exists. */
  canonical?: React.ReactNode
  children: React.ReactNode
}) {
  const [state, setState] = useState<Resolution>("loading")
  const [company, setCompany] = useState<CanonicalCompany | null>(null)
  const [tab, setTab] = useState<"canonical" | "local">("canonical")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState("loading")
    fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return
        if (response.ok) {
          const body = await response.json().catch(() => null)
          setCompany(body?.company ?? { id: companyId, name: "Company" })
          setState("canonical")
        } else {
          setState(response.status === 404 ? "legacy" : "error")
        }
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
  if (state === "legacy" || !company) return <>{children}</>

  const local = (
    <BrowserLocalWorkspace company={company} title={title} boundary={description}>
      {children}
    </BrowserLocalWorkspace>
  )
  if (!canonical) return local
  return (
    <div>
      <div role="tablist" className="mx-6 mt-4 flex gap-2 text-sm">
        <button role="tab" aria-selected={tab === "canonical"} onClick={() => setTab("canonical")} className={`rounded-md border px-3 py-1.5 ${tab === "canonical" ? "bg-primary text-primary-foreground" : ""}`}>
          {title} (TES records)
        </button>
        <button role="tab" aria-selected={tab === "local"} onClick={() => setTab("local")} className={`rounded-md border px-3 py-1.5 ${tab === "local" ? "bg-primary text-primary-foreground" : ""}`}>
          {title} (browser-local workspace)
        </button>
      </div>
      {tab === "canonical" ? canonical : local}
    </div>
  )
}
