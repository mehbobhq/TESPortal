import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { listEventFacts } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** Contract v1 analytical facts: one row per current, non-duplicate event. NULL means not collected, never zero. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const q = request.nextUrl.searchParams
    return NextResponse.json({ contract: "driver-event-fact/1", facts: await listEventFacts(id, { from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, categoryCode: q.get("category") ?? undefined, limit: q.get("limit") ? Number(q.get("limit")) : undefined }) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load driver event facts.")
  }
}
