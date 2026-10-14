"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import RestoredCredentials from "@/src/restored/credentials/RestoredCredentials"
import LegacyCredentialsPage from "./legacy-credentials"

type Company = { id: string; name: string; kind: string; status: string }

/**
 * The restored ORIGINAL Credentials interface over the canonical credential domain (src/restored/credentials). This page only
 * resolves the company (never reporting a failed lookup as "not found") and hosts the honest list of what is not available.
 */
function CanonicalCredentials({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" })
      .then(async (response) => {
        const lookup = await readCompanyLookup<Company>(response)
        if (cancelled) return
        setCompany(lookup.company)
        setLookupFailed(lookup.failed)
      })
      .catch(() => !cancelled && setLookupFailed(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <RestoredCredentials company={company} />
      <section role="note" className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">Unavailable actions</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Storing or showing a login secret (a login secret, security-question answer, PIN or backup code): deferred until a secret-handling workflow is approved. Secrets live only in the secret manager; TES records that a slot exists and its state.</li>
          <li>Security-question text and recovery-method labels: no canonical column holds them (approved decision), so they are not saved.</li>
          <li>Portal legal name and services: the portal registry holds a name, jurisdiction, login URL and aliases only.</li>
        </ul>
      </section>
    </div>
  )
}

export default function CredentialsWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Credentials"
      description="The original Credentials workspace (portal registry, credential list, recovery details step) saves only in this browser. It never saved passwords or recovery secrets; none of it is in the TES database, and canonical credential metadata under TES records is separate. It is kept unchanged so nothing is lost. Nothing here was changed or deleted."
      canonical={<CanonicalCredentials companyId={companyId} />}
    >
      <LegacyCredentialsPage />
    </LegacyWorkspaceGate>
  )
}
