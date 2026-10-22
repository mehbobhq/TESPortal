import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getProspectSubmission } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    return NextResponse.json(await getProspectSubmission({ organizationId: id, prospectId }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the application.")
  }
}
