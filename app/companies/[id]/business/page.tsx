"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import RestoredBusiness from "@/src/restored/business/RestoredBusiness"
import type { ProfileForBusiness } from "@/src/restored/business/adapter"
import LegacyBusinessPage from "./legacy-business"

/**
 * The restored ORIGINAL Business & Corporate Records interface over the canonical corporate-identity domain
 * (src/restored/business). This page resolves the company (a failed lookup is never reported as "not found") and hosts the
 * honest list of what is not available.
 */
const DEFERRED = [
  "Incorporation date (no canonical column yet)",
  "Directors and shareholders with ownership percentages (no canonical record yet)",
  "Annual returns (no canonical record yet)",
  "GST/HST program accounts and state sales-tax registrations (no canonical registration program)",
  "Corporate-paper classification, registry requests, OCR and source-fact review (only the evidence upload and secure view are canonical)",
  "Carrier audit cases (no canonical domain)",
  "Business change ledger (no company-scoped read of the Master Register yet)",
]

function CanonicalBusiness({ companyId }: { companyId: string }) {
  const [profile, setProfile] = useState<ProfileForBusiness | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" })
      .then(async (response) => {
        const lookup = await readCompanyLookup<ProfileForBusiness>(response)
        if (cancelled) return
        setProfile(lookup.company)
        setLookupFailed(lookup.failed)
      })
      .catch(() => !cancelled && setLookupFailed(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!profile) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <RestoredBusiness profile={profile} />
      <section role="note" className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">Unavailable actions</p>
        <p className="mb-2">These have no canonical PostgreSQL storage or operation yet and are intentionally deferred (nothing is kept in the browser):</p>
        <ul className="list-disc space-y-1 pl-5">
          {DEFERRED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default function BusinessWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Business"
      description="The original Business workspace (incorporation, corporate documents, shareholders, annual returns, CRA/EIN/GST/sales-tax cards, history and audit cases) saves only in this browser, keyed by company id; none of it is in the TES database, and canonical corporate identity under TES records is separate. It is kept unchanged so nothing is lost. Nothing here was changed or deleted."
      canonical={<CanonicalBusiness companyId={companyId} />}
    >
      <LegacyBusinessPage />
    </LegacyWorkspaceGate>
  )
}
