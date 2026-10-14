"use client"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyAuthoritiesPage from "./legacy-authorities"
import { useParams } from "next/navigation"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"

function CanonicalAuthorities() {
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

export default function AuthoritiesWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      companyId={companyId}
      title="Authorities"
      description="The original Authorities workspace (authority cards, safety and audit records, history, OCR and evidence) saves only in this browser; none of it is in the TES database, and canonical authorities under TES records are separate. It is kept unchanged so nothing is lost. Nothing here was changed or deleted."
      canonical={<CanonicalAuthorities />}
    >
      <LegacyAuthoritiesPage />
    </LegacyWorkspaceGate>
  )
}
