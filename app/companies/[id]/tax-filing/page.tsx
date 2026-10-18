"use client"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyTaxFilingPage from "./legacy-tax-filing"
import { useParams } from "next/navigation"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"

function CanonicalTaxFiling() {
  return (
    <CanonicalRegistryPanel
      config={{
        section: "Tax Filing",
        resource: "tax-registrations",
        itemsKey: "registrations",
        itemKey: "registration",
        typeField: "program",
        typeLabel: "Program",
        statusKey: "registrationStatus",
        types: ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO", "SCAC", "CA_CARRIER_CODE", "GST_HST"],
        statuses: ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE", "CLOSED"],
        deferredNote:
          "Tax registrations only. Filing records, the filing calendar and filing evidence are deferred: they have no canonical PostgreSQL storage yet.",
      }}
    />
  )
}

export default function TaxFilingWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Tax Filing"
      description="The original Tax Filing workspace (programme profiles, frequency history, filing calendar and filing records with evidence) saves only in this browser; none of it is in the TES database, and canonical tax registrations under TES records are separate. It is kept unchanged so nothing is lost. Nothing here was changed or deleted."
      canonical={<CanonicalTaxFiling />}
    >
      <LegacyTaxFilingPage />
    </LegacyWorkspaceGate>
  )
}
