import { NextResponse } from "next/server"
import { findCompanyIdentifierConflicts } from "@/lib/company-directory/service"
import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { TesAuthorizationDeniedError } from "@/lib/auth/tes-authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Read-only authorized preflight. POST avoids putting tax identifiers in URLs or browser history. */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid identifier request." }, { status: 400 })
    }
    const fields = body as Record<string, unknown>
    const values = ["incorpNo", "businessNo", "ein", "regCorpCountry", "regCorpState"] as const
    for (const field of values) {
      if (fields[field] !== undefined && (typeof fields[field] !== "string" || fields[field].length > 100)) {
        return NextResponse.json({ error: "Invalid identifier request." }, { status: 400 })
      }
    }
    const matches = await findCompanyIdentifierConflicts({
      incorpNo: fields.incorpNo as string | undefined,
      businessNo: fields.businessNo as string | undefined,
      ein: fields.ein as string | undefined,
      regCorpCountry: fields.regCorpCountry as string | undefined,
      regCorpState: fields.regCorpState as string | undefined,
    })
    return NextResponse.json({ matches }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof TesAuthorizationDeniedError) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 })
    }
    if (error instanceof CorporateIdentityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Unable to check corporate identifiers." }, { status: 500 })
  }
}
