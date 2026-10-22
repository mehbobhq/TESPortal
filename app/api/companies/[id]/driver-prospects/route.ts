import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { createProspect, listProspects } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ prospects: await listProspects(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load driver prospects.")
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const created = await createProspect({
      organizationId: id,
      fullName: typeof body.fullName === "string" ? body.fullName : "",
      email: typeof body.email === "string" ? body.email : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to save the driver prospect.")
  }
}
