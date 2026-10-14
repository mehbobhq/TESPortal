import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { changeVehicleRegistration, correctVehicleRegistration, voidVehicleRegistration } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; registrationId: string }> }

/**
 * The registration must belong to the company in the URL (a registration of another company is answered as not found).
 * PATCH { action: "change" | "correct" | "void", ... }: change = a real-world change from a date (history kept), correct = a mistaken value
 * (the mistaken row is flagged and kept), void = a record that should never have existed (flagged and kept).
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, registrationId } = await context.params
    const body = await readJsonBody(request)
    const fields = {
      registrationKind: body.registrationKind as never,
      registrationNumber: body.registrationNumber as never,
      plate: body.plate as never,
      jurisdictionCountry: body.jurisdictionCountry as never,
      jurisdictionRegion: body.jurisdictionRegion as never,
      effectiveFrom: body.effectiveFrom as never,
      effectiveTo: body.effectiveTo as never,
    }
    switch (body.action) {
      case "change":
        return NextResponse.json(await changeVehicleRegistration({ organizationId, registrationId, ...fields }), { status: 200 })
      case "correct":
        return NextResponse.json(await correctVehicleRegistration({ organizationId, registrationId, ...fields }), { status: 200 })
      case "void":
        return NextResponse.json(await voidVehicleRegistration({ organizationId, registrationId }), { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported registration action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update registration.")
  }
}
