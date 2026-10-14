import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { checkExistingDriver } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * Existing-driver check. The only canonical identity signal is the licence (country + jurisdiction + normalized number,
 * migrations 0021/0022). Names, email and phone are advisory and are not used to identify a driver.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id: organizationId } = await context.params
    return NextResponse.json({ match: await checkExistingDriver(organizationId, await readJsonBody(request)) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to check for an existing driver.")
  }
}
