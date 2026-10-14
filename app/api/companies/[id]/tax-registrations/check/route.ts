import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { isProgramCode } from "@/lib/tax-registrations/definitions"
import { checkRegistrationNumber, type CheckNumberInput } from "@/lib/tax-registrations/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * Advisory registry precheck for the tax profile form: is this account number already registered in its namespace. It is the
 * existing SYSTEM registry lookup (TAX_REGISTRATION_READ); saving still re-checks authoritatively inside its own transaction.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    await context.params
    const body = await readJsonBody(request)
    if (!isProgramCode(body.program)) return NextResponse.json({ error: "A valid tax program is required." }, { status: 400 })
    const result = await checkRegistrationNumber({ program: body.program, number: body.number, jurisdiction: body.jurisdiction } as CheckNumberInput)
    return NextResponse.json({ registered: result.registered, match: result.match }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to check the account number.")
  }
}
