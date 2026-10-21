"use client"

import { useParams } from "next/navigation"

import { LegacyWorkspaceGate } from "@/src/components/shared/LegacyWorkspaceGate"
import LegacyVehiclesPage from "./legacy-vehicles"

// One user-facing Vehicles interface: the original detailed workspace. The canonical register stays in ./canonical-vehicles.tsx (not rendered).
export default function VehiclesPage() {
  const params = useParams()
  const companyId = params.id as string
  return (
    <LegacyWorkspaceGate
      single
      companyId={companyId}
      title="Vehicles"
      description="The original Vehicles workspace saves only in this browser; it is not synchronized with the TES production database."
    >
      <LegacyVehiclesPage />
    </LegacyWorkspaceGate>
  )
}
