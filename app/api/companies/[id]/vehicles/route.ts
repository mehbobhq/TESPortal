import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { listOrganizationVehicles } from "@/lib/operational-identity/reads"
import { createVehicle, establishOrganizationVehicle } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ vehicles: await listOrganizationVehicles(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load vehicles.")
  }
}

/** Creates the vehicle identity, then the organization relationship, through the canonical operational-identity service. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const vehicle = await createVehicle({
      vehicleTypeCode: body.vehicleTypeCode as never,
      vin: typeof body.vin === "string" && body.vin.trim() ? body.vin : undefined,
      modelYear: typeof body.modelYear === "number" ? body.modelYear : undefined,
      make: typeof body.make === "string" && body.make.trim() ? body.make : undefined,
      model: typeof body.model === "string" && body.model.trim() ? body.model : undefined,
    })
    const relationship = await establishOrganizationVehicle({
      organizationId: id,
      vehicleId: vehicle.vehicleId,
      relationshipType: (body.relationshipType as never) ?? "OPERATES",
      unitNumber: typeof body.unitNumber === "string" && body.unitNumber.trim() ? body.unitNumber : undefined,
      effectiveFrom: typeof body.effectiveFrom === "string" && body.effectiveFrom ? body.effectiveFrom : new Date().toISOString(),
    })
    return NextResponse.json({ vehicle, relationship }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create vehicle.")
  }
}
