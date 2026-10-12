import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { createPolicy, getOrganizationInsurance } from "@/lib/insurance/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getOrganizationInsurance(id), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load insurance.")
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json({ policy: await createPolicy({ ...body, organizationId: id }) }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create policy.")
  }
}
