import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { establishOperatingScope } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

/** Establishes or changes the driver's intended operating scope. Company and prospect come from the path only. A change revokes any open application. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    const body = await readJsonBody(request)
    const scope = body.scope && typeof body.scope === "object" ? (body.scope as never) : ({ kind: "" } as never)
    return NextResponse.json(await establishOperatingScope({ organizationId: id, prospectId, scope }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to save the operating scope.")
  }
}
