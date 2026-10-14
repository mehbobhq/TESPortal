import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getOrganizationVehicleWorkspace } from "@/lib/operational-identity/vehicle-workspace-reads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** The Vehicles workspace read model: this company's vehicles (archived included) with its registration periods and relationship history. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ vehicles: await getOrganizationVehicleWorkspace(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load vehicles.")
  }
}
