"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyDriversPage from "./legacy-drivers"

// One user-facing Drivers interface: the original detailed workspace. The canonical workspace stays in ./canonical-drivers.tsx (not rendered).
export default function DriversPage(props: { params: Promise<{ id: string }> }) {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Drivers"
      description="The original Drivers workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyDriversPage params={props.params} />
    </LegacyWorkspaceGate>
  )
}
