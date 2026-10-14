import { NextResponse } from "next/server"
import { CorporateIdentifierCollisionError, CorporateIdentityConflictError, CorporateIdentityValidationError } from "@/lib/corporate-identity/errors"
import { TesAuthorizationDeniedError } from "@/lib/auth/tes-authorization"
import { CompanyDirectoryValidationError, createCompanyDirectoryRecord, listCompanyDirectory } from "@/lib/company-directory/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const companies = await listCompanyDirectory()
    return NextResponse.json({ companies }, { status: 200 })
  } catch {
    return NextResponse.json({ error: "Unable to load companies." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const company = await createCompanyDirectoryRecord(await request.json())
    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    if (error instanceof TesAuthorizationDeniedError) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 })
    }
    if (error instanceof CorporateIdentityConflictError || error instanceof CorporateIdentifierCollisionError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof CorporateIdentityValidationError || error instanceof CompanyDirectoryValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: "Unable to create company." }, { status: 500 })
  }
}
