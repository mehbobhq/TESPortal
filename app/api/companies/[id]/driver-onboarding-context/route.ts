import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { establishPresentationJurisdiction, getPresentationContext } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** The company's primary presentation jurisdiction (what staff see first). Presentation only: it never decides regulatory applicability. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ presentation: await getPresentationContext(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the company's jurisdiction context.")
  }
}

/** Explicitly establishes the primary presentation jurisdiction (needed for dual-registered companies or when it cannot be derived). */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    await establishPresentationJurisdiction({ organizationId: id, country: body.country })
    return NextResponse.json({ presentation: await getPresentationContext(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to save the company's primary jurisdiction.")
  }
}
