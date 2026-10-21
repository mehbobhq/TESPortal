"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyBusinessPage from "./legacy-business"

// One user-facing Business interface: the original detailed workspace. The canonical workspace stays in ./canonical-business.tsx (not rendered).
export default function BusinessWorkspacePage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Business"
      description="The original Business workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyBusinessPage />
    </LegacyWorkspaceGate>
  )
}
