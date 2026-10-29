import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { establishPresentationJurisdiction, getPresentationContext, readCompanyOperatingFacts } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * The company's recorded operating facts (registration country, operating scope, Cargo Information, rule applicability), read from the canonical
 * Profile records. Nothing is stored for onboarding. `presentation` is kept for existing callers.
 */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const facts = await readCompanyOperatingFacts(id)
    return NextResponse.json({ presentation: facts.registration, facts }, { status: 200 })
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
