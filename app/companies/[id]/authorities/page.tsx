"use client"

import { useState } from "react"
import { useParams } from "next/navigation"

import CanonicalRegistryPanel from "@/src/components/canonical/CanonicalRegistryPanel"
import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import RestoredAuthorities from "@/src/restored/authorities/RestoredAuthorities"
import LegacyAuthoritiesPage from "./legacy-authorities"

const REGISTRY_CONFIG = {
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
} as const

/**
 * The restored original Authorities workspace over the canonical PostgreSQL authorities (primary experience), with the plain
 * "TES records" registry list kept one click away as a simplified fallback. The restored workspace reads and writes through
 * /api/companies/[id]/authorities (see src/restored/authorities/adapter.ts) and never touches browser storage.
 *
 * Unavailable actions (deferred, no canonical storage yet): safety snapshots, audit records, supporting documents and OCR
 * extraction, issuing-authority text, notes, archive reasons and the MCS-150 / UCR / PHMSA / Other record types. Those controls
 * stay visible and refuse.
 */
function CanonicalAuthorities({ companyId }: { companyId: string }) {
  const [showList, setShowList] = useState(false)
  return (
    <div>
      <RestoredAuthorities companyId={companyId} />
      <details className="mx-6 mb-6" onToggle={(event) => setShowList(event.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Simplified TES records list (every canonical authority, plain table)</summary>
        {showList ? <CanonicalRegistryPanel config={REGISTRY_CONFIG} /> : null}
      </details>
    </div>
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
      canonical={<CanonicalAuthorities companyId={companyId} />}
    >
      <LegacyAuthoritiesPage />
    </LegacyWorkspaceGate>
  )
}
