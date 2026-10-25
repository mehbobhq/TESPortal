import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getEventVersion } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; eventId: string }> }

/** ?version=N returns the immutable snapshot of that version. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id, eventId } = await context.params
    return NextResponse.json({ entries: await getEventVersion(id, eventId, Number(request.nextUrl.searchParams.get("version"))) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load that version.")
  }
}
