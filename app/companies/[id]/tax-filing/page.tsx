"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyTaxFilingPage from "./legacy-tax-filing"

// One user-facing Tax Filing interface: the original detailed workspace. The canonical workspace stays in ./canonical-tax-filing.tsx (not rendered).
export default function TaxFilingWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Tax Filing"
      description="The original Tax Filing workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyTaxFilingPage />
    </LegacyWorkspaceGate>
  )
}
