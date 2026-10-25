import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { addEventAction, updateEventAction } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

/** Body: { action: "add", actionType, title, ... } | { action: "update", actionId, status, note? }. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    if (body.action === "update") {
      return NextResponse.json(await updateEventAction(id, eventId, body.actionId as string, { status: body.status as string, note: (body.note as string) ?? null, ownerLabel: (body.ownerLabel as string) ?? null, dueDate: (body.dueDate as string) ?? null }), { status: 200 })
    }
    return NextResponse.json(
      await addEventAction(id, eventId, { actionType: body.actionType as string, title: body.title as string, description: (body.description as string) ?? null, required: body.required === true, ownerLabel: (body.ownerLabel as string) ?? null, ownerActorId: (body.ownerActorId as string) ?? null, dueDate: (body.dueDate as string) ?? null }),
      { status: 201 },
    )
  } catch (error) {
    return canonicalFailure(error, "Unable to update the event actions.")
  }
}
