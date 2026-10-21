"use client"

import { useParams } from "next/navigation"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"

/**
 * The canonical (PostgreSQL-backed) Tax Filing workspace. Kept intact (mechanical export change only) but NOT rendered by the Tax Filing route
 * (see ./page.tsx) and not a route itself. Its API, services, tables and records are unchanged. Re-mounting it is a deliberate product decision.
 */
export function CanonicalTaxFiling() {
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
