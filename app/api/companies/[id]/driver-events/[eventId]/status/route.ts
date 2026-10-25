import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { changeEventStatus } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(await changeEventStatus(id, eventId, { to: body.to as string, reason: typeof body.reason === "string" ? body.reason : null }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to change the event status.")
  }
}
