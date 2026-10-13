"use client"

import { useEffect, useState } from "react"

export type CompanySummary = {
  id: string
  name: string
  kind: string
  region: string
  status: string
}

type LegacyCompany = Partial<CompanySummary> & { id?: string }

/**
 * Resolves the active company for navigation chrome from PostgreSQL (the canonical organization id in the URL).
 * Browser storage is consulted only as a read-only fallback when the id is not a canonical organization, so legacy prototype
 * records that were never imported keep their navigation; nothing is ever written or deleted.
 */
export function useCompanySummary(companyId: string | null, refreshKey?: string): CompanySummary | null {
  const [summary, setSummary] = useState<CompanySummary | null>(null)

  useEffect(() => {
    if (!companyId) {
      setSummary(null)
      return
    }
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(companyId)}/summary`, { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) return ((await response.json()) as { company: CompanySummary }).company
        if (response.status !== 404) return undefined
        try {
          const legacy = (JSON.parse(localStorage.getItem("tes_companies") || "[]") as LegacyCompany[]).find((company) => company.id === companyId)
          return legacy ? ({ id: companyId, name: legacy.name ?? "Company", kind: legacy.kind ?? "", region: legacy.region ?? "", status: legacy.status ?? "Active" } as CompanySummary) : null
        } catch {
          return null
        }
      })
      .catch(() => undefined)
      .then((found) => {
        // undefined = the lookup failed (keep what is shown); null = this id is not a known company
        if (!cancelled && found !== undefined) setSummary(found)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, refreshKey])

  return summary
}
