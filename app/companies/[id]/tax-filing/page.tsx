"use client"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"

export default function TaxFilingPage() {
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
        types: ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO", "SCAC", "CA_CARRIER_CODE"],
        statuses: ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE", "CLOSED"],
        deferredNote:
          "Tax registrations only. Filing records, the filing calendar and filing evidence are deferred: they have no canonical PostgreSQL storage yet.",
      }}
    />
  )
}
