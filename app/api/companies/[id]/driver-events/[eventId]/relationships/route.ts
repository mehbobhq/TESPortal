import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { addEventRelationship, removeEventRelationship } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

/** Body: { action: "add", type, toEventId | recordRef, note? } | { action: "remove", relationshipId, reason }. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    if (body.action === "remove") return NextResponse.json(await removeEventRelationship(id, eventId, body.relationshipId as string, { reason: body.reason as string }), { status: 200 })
    return NextResponse.json(
      await addEventRelationship(id, eventId, { type: body.type as string, toEventId: (body.toEventId as string) ?? null, recordRef: (body.recordRef as string) ?? null, note: (body.note as string) ?? null }),
      { status: 201 },
    )
  } catch (error) {
    return canonicalFailure(error, "Unable to update the event relationships.")
  }
}
