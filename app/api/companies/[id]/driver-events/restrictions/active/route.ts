import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { listActiveEventRestrictions } from "@/lib/driver-events/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** ?personId= | ?driverRelationshipId= | ?vehicleId= : the active safety restrictions a workflow must honour before using that driver or vehicle. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const q = request.nextUrl.searchParams
    const restrictions = await listActiveEventRestrictions(id, { personId: q.get("personId") ?? undefined, driverRelationshipId: q.get("driverRelationshipId") ?? undefined, vehicleId: q.get("vehicleId") ?? undefined })
    return NextResponse.json({ restricted: restrictions.some((r) => r.mandatory), restrictions }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the active restrictions.")
  }
}
