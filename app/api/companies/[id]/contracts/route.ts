import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { applyContractsAction, getContractsWorkspace } from "@/lib/contracts/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getContractsWorkspace(id), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load contracts.")
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await applyContractsAction(id, await readJsonBody(request)), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update contracts.")
  }
}
