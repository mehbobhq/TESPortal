"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyInsurancePage from "./legacy-insurance"

// One user-facing Insurance interface: the original detailed workspace. The canonical workspace stays in ./canonical-insurance.tsx (not rendered).
export default function InsuranceWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Insurance"
      description="The original Insurance workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyInsurancePage />
    </LegacyWorkspaceGate>
  )
}
