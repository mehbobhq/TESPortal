import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { getCompanyIdentitySummary } from "@/lib/company-directory/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/** Light identity summary (name, kind, region, status) for navigation chrome; one indexed query, no domain fan-out. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const company = await getCompanyIdentitySummary(id)
    if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 })
    return NextResponse.json({ company }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to load company.")
  }
}
