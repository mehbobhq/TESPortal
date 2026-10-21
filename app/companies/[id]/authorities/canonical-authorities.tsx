"use client"

import { useParams } from "next/navigation"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"

/**
 * The canonical (PostgreSQL-backed) Authorities workspace. Kept intact (mechanical export change only) but NOT rendered by the Authorities route
 * (see ./page.tsx) and not a route itself. Its API, services, tables and records are unchanged. Re-mounting it is a deliberate product decision.
 */
export function CanonicalAuthorities() {
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
