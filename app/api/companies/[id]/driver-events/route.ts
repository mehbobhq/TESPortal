import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { createEvent, listEvents } from "@/lib/driver-events/service"
import type { EventInput } from "@/lib/driver-events/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const q = request.nextUrl.searchParams
    const limit = q.get("limit")
    const events = await listEvents(id, {
      category: q.get("category") ?? undefined,
      status: q.get("status") ?? undefined,
      driverRelationshipId: q.get("driverRelationshipId") ?? undefined,
      vehicleId: q.get("vehicleId") ?? undefined,
      from: q.get("from") ?? undefined,
      to: q.get("to") ?? undefined,
      before: q.get("before") ?? undefined,
      limit: limit ? Number(limit) : undefined,
    })
    return NextResponse.json({ events }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load driver events.")
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    // The company comes from the path, never from the body.
    return NextResponse.json(await createEvent(id, body as unknown as EventInput), { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to save the driver event.")
  }
}
