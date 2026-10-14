"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { CompanyMissing } from "@/components/company-missing"
import { readCompanyLookup } from "@/lib/company-lookup"
import { DeferredWorkspace, LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import RestoredVehicles from "@/src/restored/vehicles/RestoredVehicles"

type Company = { id: string; name: string; kind: string; status: string }

/**
 * The original Vehicles workspace (list, filters, hero and compliance strip, Profile / Ownership / Registration / Permits /
 * Maintenance / Activity / Settings tabs and their dialogs), restored over the canonical PostgreSQL records. The company comes
 * from the URL; the vehicles are read from and changed through /api/companies/[id]/vehicles/... only.
 */
function CanonicalVehicles({ companyId }: { companyId: string }) {
  const [company, setCompany] = useState<Company | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${encodeURIComponent(companyId)}/profile`, { cache: "no-store" })
      .then(async (profile) => {
        const lookup = await readCompanyLookup<Company>(profile)
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
      <RestoredVehicles companyId={companyId} company={company} />
      <p className="text-xs text-muted-foreground">
        Unavailable actions: vehicle documents and OCR, ownership records, permits, inspections, maintenance and repair bills, per-unit
        settings, the activity trail, and editing a vehicle's type, VIN, year, make or model are deferred: they have no canonical
        PostgreSQL record or approved operation yet. Those controls stay visible and say so when used; nothing is saved to this browser.
      </p>
    </div>
  )
}

export default function VehiclesPage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Vehicles"
      description="The earlier browser-local Vehicles workspace stored vehicle documents in this browser, which the approved evidence rules do not allow, so it is not mounted here. Nothing in it was changed or deleted."
      canonical={<CanonicalVehicles companyId={companyId} />}
    >
      <DeferredWorkspace
        companyId={companyId}
        title="Vehicles (browser-local)"
        description="The browser-local Vehicles workspace is not mounted: it kept vehicle documents in this browser, which the approved evidence rules do not allow. The TES records tab holds the vehicle records."
      />
    </LegacyWorkspaceGate>
  )
}
