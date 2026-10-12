import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { createCredential, getOrganizationCredentials } from "@/lib/company-credentials/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getOrganizationCredentials(id), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load credentials.")
  }
}

/** Credential metadata only. The body is passed to the canonical service, which has no field for a secret value. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json({ credential: await createCredential({ ...body, organizationId: id }) }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create credential.")
  }
}
