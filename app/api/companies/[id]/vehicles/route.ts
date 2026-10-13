import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { listOrganizationVehicles } from "@/lib/operational-identity/reads"
import { createVehicleForOrganization } from "@/lib/operational-identity/service"

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

/** Creates the vehicle identity and the organization relationship in ONE transaction (no orphan vehicle if the second step fails). */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const created = await createVehicleForOrganization(
      {
        vehicleTypeCode: body.vehicleTypeCode as never,
        vin: typeof body.vin === "string" && body.vin.trim() ? body.vin : undefined,
        modelYear: typeof body.modelYear === "number" ? body.modelYear : undefined,
        make: typeof body.make === "string" && body.make.trim() ? body.make : undefined,
        model: typeof body.model === "string" && body.model.trim() ? body.model : undefined,
      },
      {
        organizationId: id,
        relationshipType: (body.relationshipType as never) ?? "OPERATES",
        unitNumber: typeof body.unitNumber === "string" && body.unitNumber.trim() ? body.unitNumber : undefined,
        effectiveFrom: typeof body.effectiveFrom === "string" && body.effectiveFrom ? body.effectiveFrom : new Date().toISOString(),
      },
    )
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create vehicle.")
  }
}
