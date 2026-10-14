"use client"

import { useState } from "react"
import { useParams } from "next/navigation"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"
import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import RestoredTaxFiling from "@/src/restored/tax-filing/RestoredTaxFiling"
import LegacyTaxFilingPage from "./legacy-tax-filing"

const REGISTRY_CONFIG = {
  section: "Tax Filing",
  resource: "tax-registrations",
  itemsKey: "registrations",
  itemKey: "registration",
  typeField: "program",
  typeLabel: "Program",
  statusKey: "registrationStatus",
  types: ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO", "SCAC", "CA_CARRIER_CODE"],
  statuses: ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE", "CLOSED"],
  deferredNote:
    "Tax registrations only. Filing records, the filing calendar and filing evidence are deferred: they have no canonical PostgreSQL storage yet.",
} as const

/**
 * The restored original Tax Filing workspace over the canonical PostgreSQL tax registrations and company-profile tax
 * applicability (primary experience), with the plain "TES records" registry list (which also shows SCAC and the CA carrier code)
 * kept one click away as a simplified fallback. The restored workspace reads and writes through
 * /api/companies/[id]/tax-registrations (see src/restored/tax-filing/adapter.ts) and never touches browser storage.
 *
 * Unavailable actions (deferred, no canonical storage yet): filing obligations and calendar, filing frequency history, filing
 * records, tax evidence, verification details, notes and Form 2290. Those controls stay visible and refuse.
 */
function CanonicalTaxFiling({ companyId }: { companyId: string }) {
  const [showList, setShowList] = useState(false)
  return (
    <div>
      <RestoredTaxFiling companyId={companyId} />
      <details className="mx-6 mb-6" onToggle={(event) => setShowList(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Simplified TES records list (every canonical registration incl. SCAC and CA carrier code, plain table)</summary>
        {showList ? <CanonicalRegistryPanel config={REGISTRY_CONFIG} /> : null}
      </details>
    </div>
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
      canonical={<CanonicalTaxFiling companyId={companyId} />}
    >
      <LegacyTaxFilingPage />
    </LegacyWorkspaceGate>
  )
}
