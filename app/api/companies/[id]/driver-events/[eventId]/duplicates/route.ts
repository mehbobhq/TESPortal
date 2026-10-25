import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { findEventDuplicates } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    return NextResponse.json({ possibleDuplicates: await findEventDuplicates(id, eventId) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to look for duplicates.")
  }
}
