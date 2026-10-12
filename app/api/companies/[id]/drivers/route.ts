import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { listOrganizationDrivers } from "@/lib/operational-identity/reads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ drivers: await listOrganizationDrivers(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load drivers.")
  }
}
