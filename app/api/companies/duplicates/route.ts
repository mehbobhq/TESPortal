import { NextResponse } from "next/server"
import { findCompanyNameCandidates } from "@/lib/company-directory/service"
import { CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { TesAuthorizationDeniedError } from "@/lib/auth/tes-authorization"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Read-only authorized candidate lookup. Creation still rechecks within its transaction. */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? ""
  if (name.trim().length < 3) {
    return NextResponse.json({ matches: [] }, { status: 200 })
  }
  try {
    const matches = await findCompanyNameCandidates(name)
    return NextResponse.json({ matches }, { status: 200 })
  } catch (error) {
    if (error instanceof TesAuthorizationDeniedError) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 })
    }
    if (error instanceof CorporateIdentityValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Unable to check company identity." }, { status: 500 })
  }
}
