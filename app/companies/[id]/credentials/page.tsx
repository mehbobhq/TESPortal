"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyCredentialsPage from "./legacy-credentials"

// One user-facing Credentials interface: the original workspace. The canonical workspace stays in ./canonical-credentials.tsx (not rendered).
export default function CredentialsWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Credentials"
      description="The original Credentials workspace saves only in this browser; it is not synchronized with the TES production database. It never saved passwords or recovery secrets."
    >
      <LegacyCredentialsPage />
    </LegacyWorkspaceGate>
  )
}
