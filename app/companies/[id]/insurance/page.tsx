"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import { RestoredInsurance } from "@/src/restored/insurance/RestoredInsurance"
import LegacyInsurancePage from "./legacy-insurance"

type Company = { id: string; name: string; kind: string; status: string }

/**
 * The original Insurance interface (transportation / workers compensation / surety bond tabs, summary cards, renewal, edit,
 * broker update, archive with reason, organization matching) over the canonical PostgreSQL insurance records. The restored UI and
 * its canonical adapter live in src/restored/insurance; this page only resolves the company and hosts it.
 */
function CanonicalInsurance() {
  const params = useParams()
  const companyId = params.id as string
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const profile = await fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" })
        const lookup = await readCompanyLookup<Company>(profile)
        if (!active) return
        setCompany(lookup.company)
        setLookupFailed(lookup.failed)
      } catch {
        if (active) setLookupFailed(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [companyId])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-4">
      <RestoredInsurance companyId={companyId} company={company} />
      <section className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground" aria-label="Unavailable actions">
        <p className="font-semibold text-foreground">Unavailable actions (deferred: no canonical PostgreSQL storage or operation yet)</p>
        <ul className="mt-1 list-disc pl-5 space-y-0.5">
          <li>Document / OCR intake and certificate evidence: legacy OCR is retired and a policy has no link to an uploaded document, so nothing can be attached, previewed or extracted.</li>
          <li>Policy notes, certificate (COI) groups and the WCB jurisdiction: no canonical home; a value typed for them is refused, never dropped.</li>
          <li>Changing the insurer / surety / provider of a recorded policy, removing a broker, and the Trailer Interchange coverage type: no canonical operation or type.</li>
          <li>Scheduled vehicles, endorsement corrections and policy-number lookups exist in the domain but have no control in this workspace.</li>
        </ul>
      </section>
    </div>
  )
}

export default function InsuranceWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Insurance"
      description="The original Insurance workspace (transportation, workers compensation and surety bond forms, broker update, evidence and OCR intake, renewal lineage) saves only in this browser; none of it is in the TES database, and canonical policies under TES records are separate. It is kept unchanged so nothing is lost. Nothing here was changed or deleted."
      canonical={<CanonicalInsurance />}
    >
      <LegacyInsurancePage />
    </LegacyWorkspaceGate>
  )
}
