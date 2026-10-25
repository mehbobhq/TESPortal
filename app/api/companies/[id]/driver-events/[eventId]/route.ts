import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { getEvent, reviseEvent } from "@/lib/driver-events/service"
import type { EventInput } from "@/lib/driver-events/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    return NextResponse.json(await getEvent(id, eventId), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the driver event.")
  }
}

/** A correction: the full corrected record, the version it was based on and the reason. The earlier version stays in the history. */
export async function PUT(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(
      await reviseEvent(id, eventId, { expectedVersion: Number(body.expectedVersion), event: body.event as EventInput, reason: typeof body.reason === "string" ? body.reason : null }),
      { status: 200 },
    )
  } catch (error) {
    return canonicalFailure(error, "Unable to correct the driver event.")
  }
}
