"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyAuthoritiesPage from "./legacy-authorities"

// One user-facing Authorities interface: the original detailed workspace. The canonical workspace stays in ./canonical-authorities.tsx (not rendered).
export default function AuthoritiesWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Authorities"
      description="The original Authorities workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyAuthoritiesPage />
    </LegacyWorkspaceGate>
  )
}
