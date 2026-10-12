"use client"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"

export default function AuthoritiesPage() {
  return (
    <CanonicalRegistryPanel
      config={{
        section: "Authorities",
        resource: "authorities",
        itemsKey: "authorities",
        itemKey: "authority",
        typeField: "kind",
        typeLabel: "Authority Type",
        statusKey: "authorityStatus",
        types: ["USDOT", "MC", "MVID", "RIN", "CVOR", "SAFETY_FITNESS", "IRP"],
        statuses: ["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED", "REVOKED", "CANCELED"],
        deferredNote:
          "Safety records, audit records, evidence documents and OCR intake are deferred: they have no canonical PostgreSQL storage yet.",
      }}
    />
  )
}
