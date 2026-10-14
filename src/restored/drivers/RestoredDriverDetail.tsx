"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { CanonicalCompany } from "@/types/drivers"
import { DriverWorkspace } from "./components/DriverWorkspace"
import { CanonicalRequestError, getDriver, type CanonicalDriverDetail } from "./canonical-client"
import { toDriverMaster, toMedicalScreenings, toRelationship } from "./mapping"

/**
 * The ORIGINAL driver detail workspace (profile, qualifications, documents, evaluation, screening, training, performance), restored
 * over the canonical record of ONE driver (the person id from the Drivers list). Canonical: name, email, phone, licences, the
 * Organization relationship and medical qualification periods. Every other collection starts empty and its controls refuse honestly
 * (see driver-data.ts); nothing is read from or written to browser storage.
 */
export function RestoredDriverDetail({ companyId, personId, company }: { companyId: string; personId: string; company: CanonicalCompany }) {
  const router = useRouter()
  const [detail, setDetail] = useState<CanonicalDriverDetail | null>(null)
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null)

  const load = useCallback(async () => {
    try {
      setDetail(await getDriver(companyId, personId))
      setError(null)
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Unable to load the driver.", notFound: e instanceof CanonicalRequestError && e.status === 404 })
    }
  }, [companyId, personId])

  useEffect(() => {
    void load()
  }, [load])

  const model = useMemo(() => {
    if (!detail) return null
    const master = toDriverMaster(detail)
    const relationship = toRelationship(companyId, detail)
    return relationship ? { master, relationship, screenings: toMedicalScreenings(companyId, detail) } : null
  }, [detail, companyId])

  if (error && !detail) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">{error.notFound ? "Driver not found" : "The driver could not be loaded"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.notFound ? "No driver with this id has a relationship with this company." : error.message}</p>
        {!error.notFound ? (
          <button type="button" className="mt-3 rounded-md border px-3 py-1.5 text-sm" onClick={() => void load()}>
            Try again
          </button>
        ) : null}
      </div>
    )
  }
  if (!detail) return <div className="p-6 text-sm text-muted-foreground">Loading Driver record...</div>
  if (!model) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Driver relationship not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The driver exists, but no genuine relationship with this company could be found.</p>
      </div>
    )
  }

  return (
    <DriverWorkspace
      master={model.master}
      relationship={model.relationship}
      company={company}
      applications={[]}
      hiringPackages={[]}
      taxDocs={[]}
      screenings={model.screenings}
      trainings={[]}
      trainingRequirements={[]}
      events={[]}
      evidence={[]}
      hosReviews={[]}
      companyActions={[]}
      companyDeterminations={[]}
      performanceInvestigations={[]}
      eventRelationships={[]}
      allDriversCohort={[]}
      onBack={() => router.push(`/companies/${companyId}/drivers`)}
      onRefresh={load}
    />
  )
}
