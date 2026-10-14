import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { addMedicalPeriod, changeMedicalPeriod, correctMedicalPeriod, voidMedicalPeriod } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; personId: string }> }

/** POST { qualificationType, jurisdictionCountry, jurisdictionRegion?, issuedOn?, expiresOn?, effectiveFrom? } */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, personId } = await context.params
    return NextResponse.json({ result: await addMedicalPeriod({ ...(await readJsonBody(request)), organizationId, personId }) }, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to record the medical qualification period.")
  }
}

/** PATCH { action: "change" | "correct" | "void", periodId, ... }: change = renewal (real-world history), correct = the record was wrong, void = entered in error. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, personId } = await context.params
    const { action, ...rest } = await readJsonBody(request)
    const input = { ...rest, organizationId, personId }
    if (action === "change") return NextResponse.json({ result: await changeMedicalPeriod(input) }, { status: 200 })
    if (action === "correct") return NextResponse.json({ result: await correctMedicalPeriod(input) }, { status: 200 })
    if (action === "void") return NextResponse.json({ result: await voidMedicalPeriod(input) }, { status: 200 })
    return NextResponse.json({ error: "Unsupported medical period action." }, { status: 400 })
  } catch (error) {
    return canonicalFailure(error, "Unable to update the medical qualification period.")
  }
}
