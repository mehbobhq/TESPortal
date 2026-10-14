import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { isAuthorityKind } from "@/lib/operating-authorities/definitions"
import { checkAuthorityNumber, type CheckNumberInput } from "@/lib/operating-authorities/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

/**
 * Advisory registry precheck for the Add / Edit forms: is this number already registered in its namespace. It is the existing
 * SYSTEM registry lookup (ORGANIZATION_REGISTRY_READ); the company in the URL only scopes the page, and creation / correction
 * still re-check authoritatively inside their own transaction.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    await context.params
    const body = await readJsonBody(request)
    if (!isAuthorityKind(body.kind)) return NextResponse.json({ error: "A valid authority kind is required." }, { status: 400 })
    const result = await checkAuthorityNumber({ kind: body.kind, number: body.number, jurisdiction: body.jurisdiction } as CheckNumberInput)
    return NextResponse.json({ registered: result.registered, match: result.match }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to check the authority number.")
  }
}
