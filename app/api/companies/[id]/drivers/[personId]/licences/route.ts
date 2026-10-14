import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { correctDriverLicence, recordDriverLicence, voidDriverLicence } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; personId: string }> }

/** POST { licence: {...} }: records a licence (a same-jurisdiction licence is replaced as real-world history). */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, personId } = await context.params
    const body = await readJsonBody(request)
    return NextResponse.json({ result: await recordDriverLicence({ licence: body.licence, organizationId, personId }) }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to record the licence.")
  }
}

/** PATCH { action: "correct" | "void", licenceId, ... } */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, personId } = await context.params
    const { action, ...rest } = await readJsonBody(request)
    const input = { ...rest, organizationId, personId }
    if (action === "correct") return NextResponse.json({ result: await correctDriverLicence(input) }, { status: 200 })
    if (action === "void") return NextResponse.json({ result: await voidDriverLicence(input) }, { status: 200 })
    return NextResponse.json({ error: "Unsupported licence action." }, { status: 400 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update the licence.")
  }
}
