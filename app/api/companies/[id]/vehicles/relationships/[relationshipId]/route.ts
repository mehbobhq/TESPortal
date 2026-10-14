import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { changeVehicleUnitNumber, correctVehicleUnitNumber, endVehicleRelationship } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; relationshipId: string }> }

/**
 * The relationship must belong to the company in the URL (another company's is answered as not found).
 * PATCH { action: "end" | "change-unit" | "correct-unit", ... }: end keeps the row with its end date; change-unit is a real renumbering
 * (history kept); correct-unit fixes a mistyped number (the mistaken row is flagged and kept).
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, relationshipId } = await context.params
    const body = await readJsonBody(request)
    switch (body.action) {
      case "end":
        return NextResponse.json(await endVehicleRelationship({ organizationId, relationshipId, effectiveTo: body.effectiveTo as never }), { status: 200 })
      case "change-unit":
        return NextResponse.json(await changeVehicleUnitNumber({ organizationId, relationshipId, unitNumber: body.unitNumber as never }), { status: 200 })
      case "correct-unit":
        return NextResponse.json(await correctVehicleUnitNumber({ organizationId, relationshipId, unitNumber: body.unitNumber as never }), { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported relationship action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update the vehicle relationship.")
  }
}
