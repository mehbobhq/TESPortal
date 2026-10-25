import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import type { ConsequenceInput } from "@/lib/driver-events/operations"
import { recordEventConsequence } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(await recordEventConsequence(id, eventId, body as unknown as ConsequenceInput), { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to record the consequence.")
  }
}
