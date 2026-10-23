import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { getHrProfile, saveHrProfile } from "@/lib/driver-application/review-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** The carrier's own screening choices, checked against the legal matrix. Prohibited items cannot be enabled; restricted ones need an explicit acknowledgement. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getHrProfile(id), { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the hiring configuration.")
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json(await saveHrProfile({ organizationId: id, selections: body.selections }), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to save the hiring configuration.")
  }
}
