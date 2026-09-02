"use client"

import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { DriverWorkspace } from "@/src/components/drivers/DriverWorkspace"
import {
  getCompany,
  loadCompanyDriverStore,
  loadDriverMasterStore,
} from "@/lib/driver-data"

import type {
  CompanyDriverStore,
  DriverMaster,
  DriverMasterStore,
} from "@/types/drivers"

type DriverPageProps = {
  params: Promise<{
    id: string
    driverId: string
  }>
}

export default function DriverPage({ params }: DriverPageProps) {
  const { id: companyId, driverId } = use(params)
  const router = useRouter()

  const [masterStore, setMasterStore] =
    useState<DriverMasterStore | null>(null)

  const [companyStore, setCompanyStore] =
    useState<CompanyDriverStore | null>(null)

  const [company, setCompany] = useState<ReturnType<typeof getCompany>>(null)

  const refresh = useCallback(() => {
    setMasterStore(loadDriverMasterStore())
    setCompanyStore(loadCompanyDriverStore(companyId))
    setCompany(getCompany(companyId))
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!masterStore || !companyStore) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading Driver record...
      </div>
    )
  }

  const master: DriverMaster | undefined =
    masterStore.drivers.find(
      (driver) =>
        driver.id === driverId ||
        driver.driverMasterId === driverId
    )

  if (!master) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Driver not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No Driver Master could be found for this record.
        </p>
      </div>
    )
  }

  const relationship =
    companyStore.relationships.find(
      (record) =>
        record.driverMasterId === master.id &&
        !record.archive.isArchived
    ) ??
    companyStore.relationships.find(
      (record) => record.driverMasterId === master.id
    )

  if (!relationship) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">
          Driver relationship not found
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          The Driver Master exists, but no relationship with this company
          could be found.
        </p>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Company not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The company record required by this Driver workspace could not be
          found.
        </p>
      </div>
    )
  }

  const applications = companyStore.applications.filter(
    (record) => record.driverMasterId === master.id
  )

  const hiringPackages = companyStore.hiringPackages.filter(
    (record) => record.driverMasterId === master.id
  )

  const taxDocs = companyStore.taxDocs.filter(
    (record) => record.driverMasterId === master.id
  )

  const screenings = companyStore.screenings.filter(
    (record) => record.driverMasterId === master.id
  )

  const trainings = companyStore.trainingRecords.filter(
    (record) => record.driverMasterId === master.id
  )

  const trainingRequirements = companyStore.trainingRequirements.filter(
    (record) => record.driverMasterId === master.id
  )

  const events = companyStore.events.filter(
    (record) => record.driverMasterId === master.id
  )

  const evidence = companyStore.evidence.filter((record) => {
    if ("driverMasterId" in record) {
      return record.driverMasterId === master.id
    }

    return true
  })

  const hosReviews = companyStore.hosReviews.filter(
    (record) => record.driverMasterId === master.id
  )

  const companyActions = companyStore.companyActions.filter(
    (record) => record.driverMasterId === master.id
  )

  const companyDeterminations = companyStore.companyDeterminations.filter(
    (record) => record.driverMasterId === master.id
  )

const allDriversCohort = companyStore.relationships
  .filter((record) => !record.archive.isArchived)
  .map((record) => {
    const driver = masterStore.drivers.find(
      (candidate) => candidate.id === record.driverMasterId
    )

    if (!driver) {
      return null
    }

    return {
      master: driver,
      relationship: record,
      events: companyStore.events.filter(
        (event) => event.driverMasterId === driver.id
      ),
      trainings: companyStore.trainingRecords.filter(
        (training) => training.driverMasterId === driver.id
      ),
    }
  })
  .filter(
    (
      record
    ): record is {
      master: DriverMaster
      relationship: typeof relationship
      events: typeof companyStore.events
      trainings: typeof companyStore.trainingRecords
    } => record !== null
  )

  return (
    <DriverWorkspace
      master={master}
      relationship={relationship}
      company={company}
      applications={applications}
      hiringPackages={hiringPackages}
      taxDocs={taxDocs}
      screenings={screenings}
      trainings={trainings}
      trainingRequirements={trainingRequirements}
      events={events}
      evidence={evidence}
      hosReviews={hosReviews}
      companyActions={companyActions}
      companyDeterminations={companyDeterminations}
      allDriversCohort={allDriversCohort}
      onBack={() => router.push(`/companies/${companyId}/drivers`)}
      onRefresh={refresh}
    />
  )
}
