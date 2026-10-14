import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { addVehicleRegistration } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; vehicleId: string }> }

/** Adds a registration / plate period to a vehicle of this company. The company comes from the URL, never from the body. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, vehicleId } = await context.params
    const body = await readJsonBody(request)
    const created = await addVehicleRegistration({
      organizationId,
      vehicleId,
      registrationKind: body.registrationKind as never,
      registrationNumber: body.registrationNumber as never,
      plate: body.plate as never,
      jurisdictionCountry: body.jurisdictionCountry as never,
      jurisdictionRegion: body.jurisdictionRegion as never,
      effectiveFrom: body.effectiveFrom as never,
      effectiveTo: body.effectiveTo as never,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to add registration.")
  }
}
