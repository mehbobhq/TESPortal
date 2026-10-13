"use client"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyBusinessPage from "./legacy-business"

import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Company = { id: string; name: string; kind: string; status: string }
type Identity = {
  companyName: string
  dba: string
  incorpNo: string
  businessNo: string
  ein: string
  formationCountry: string | null
  formationRegion: string | null
}

const DEFERRED = [
  "Corporate documents and document evidence",
  "Shareholders and corporate roles",
  "Annual returns",
  "CRA / EIN / GST / sales-tax programme account cards",
  "Business history and audit cases",
]

function CanonicalBusiness() {
  const params = useParams()
  const companyId = params.id as string
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const base = `/api/companies/${encodeURIComponent(companyId)}`
    Promise.all([fetch(`${base}/profile`, { cache: "no-store" }), fetch(base, { cache: "no-store" })])
      .then(async ([profile, edit]) => {
        if (cancelled) return
        {
          const lookup = await readCompanyLookup<Company>(profile)
          setCompany(lookup.company)
          setLookupFailed(lookup.failed)
        }
        setIdentity(edit.ok ? (await edit.json()).company : null)
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  const rows: Array<[string, string]> = identity
    ? [
        ["Legal name", identity.companyName],
        ["DBA", identity.dba],
        ["Formation jurisdiction", [identity.formationRegion, identity.formationCountry].filter(Boolean).join(", ")],
        ["Incorporation number", identity.incorpNo],
        ["Business number (CRA BN)", identity.businessNo],
        ["EIN (IRS)", identity.ein],
      ]
    : []

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader company={company} section="Business" />
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Corporate identity</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid sm:grid-cols-2 gap-x-8 gap-y-4">
          {rows.map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
              <p className="text-sm font-medium mt-0.5">{value || "—"}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Not yet available</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-xs text-muted-foreground">
          <p className="mb-2">These have no canonical PostgreSQL storage yet and are intentionally deferred (not kept in the browser):</p>
          <ul className="list-disc pl-5 space-y-1">
            {DEFERRED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
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
      canonical={<CanonicalBusiness />}
    >
      <LegacyBusinessPage />
    </LegacyWorkspaceGate>
  )
}
