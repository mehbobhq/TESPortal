"use client"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyDriversPage from "./legacy-drivers"
import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import CompanyWorkspaceHeader from "@/src/components/shared/CompanyWorkspaceHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type DriverRow = {
  relationshipId: string
  personId: string
  relationshipType: string
  driverNumber: string | null
  status: string
  givenName: string | null
  familyName: string | null
  licence: { jurisdictionCountry: string; jurisdictionRegion: string; number: string; licenceClass: string | null; expiryDate: string | null } | null
}
type Company = { id: string; name: string; kind: string; status: string }

function CanonicalDrivers() {
  const params = useParams()
  const companyId = params.id as string
  const base = `/api/companies/${encodeURIComponent(companyId)}`
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetch(`${base}/profile`, { cache: "no-store" }), fetch(`${base}/drivers`, { cache: "no-store" })])
      .then(async ([profile, list]) => {
        if (cancelled) return
        {
          const lookup = await readCompanyLookup<Company>(profile)
          setCompany(lookup.company)
          setLookupFailed(lookup.failed)
        }
        if (list.ok) setDrivers((await list.json()).drivers ?? [])
        else setError((await list.json().catch(() => null))?.error ?? "Unable to load drivers.")
      })
      .catch(() => !cancelled && setError("Unable to load drivers."))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [base])

  if (loading) return <div className="p-10 text-center">Loading...</div>
  if (!company) return <CompanyMissing failed={lookupFailed} />

  return (
    <div className="flex flex-col gap-6 pb-10">
      <CompanyWorkspaceHeader company={company} section="Drivers" description="Driver compliance records" />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader className="bg-muted/30 py-3 border-b">
          <CardTitle className="text-sm">Drivers on record</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {drivers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No drivers yet.</p>
          ) : (
            <div className="flex flex-col divide-y">
              {drivers.map((row) => (
                <div key={row.relationshipId} className="py-3">
                  <p className="text-sm font-semibold">
                    {[row.givenName, row.familyName].filter(Boolean).join(" ") || row.personId}
                    {row.driverNumber ? ` · #${row.driverNumber}` : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {row.relationshipType} · {row.status}
                    {row.licence
                      ? ` · Licence ${row.licence.number} (${row.licence.jurisdictionRegion}, ${row.licence.jurisdictionCountry}${row.licence.licenceClass ? `, class ${row.licence.licenceClass}` : ""}${row.licence.expiryDate ? `, expires ${row.licence.expiryDate}` : ""})`
                      : " · No licence on record"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Adding a driver is deferred: there is no canonical service that creates a standalone Person yet (a driver is a role of a
        Person). Date of birth, addresses, performance events, citations, training, screening and driver evidence are also deferred:
        they have no canonical PostgreSQL storage yet.
      </p>
    </div>
  )
}

export default function DriversPage(props: { params: Promise<{ id: string }> }) {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Drivers"
      description="The original driver register (Add Driver, existing-driver check, licence, filters, driver detail with qualifications, training, screening and performance) saves only in this browser; its drivers are separate from the canonical drivers listed under TES records and none of it is in the TES database. It is kept unchanged so nothing is lost. Nothing here was changed or deleted."
      canonical={<CanonicalDrivers />}
    >
      <LegacyDriversPage params={props.params} />
    </LegacyWorkspaceGate>
  )
}
