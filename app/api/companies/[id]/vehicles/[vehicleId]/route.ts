import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { archiveVehicle, restoreVehicle } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; vehicleId: string }> }

/** The vehicle must be on the company's record (the operation answers a vehicle of another company as not found). PATCH { action: "archive" | "restore" }. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, vehicleId } = await context.params
    const body = await readJsonBody(request)
    switch (body.action) {
      case "archive":
        return NextResponse.json({ vehicle: await archiveVehicle({ organizationId, vehicleId }) }, { status: 200 })
      case "restore":
        return NextResponse.json({ vehicle: await restoreVehicle({ organizationId, vehicleId }) }, { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported vehicle action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update vehicle.")
  }
}
