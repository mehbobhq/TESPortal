import { NextResponse } from "next/server"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { CompanyCreationCapabilityError } from "@/lib/company-directory/create-company"
import { CompanyCreationValidationError } from "@/lib/company-directory/creation-input"
import { createCompanyDirectoryRecord, listCompanyDirectory } from "@/lib/company-directory/service"

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
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 })
  }

  try {
    const created = await createCompanyDirectoryRecord(body)
    return NextResponse.json(created, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof CompanyCreationValidationError) {
      return NextResponse.json({ error: "Some submitted information could not be saved. Nothing was created.", issues: error.issues }, { status: 400 })
    }
    if (error instanceof CompanyCreationCapabilityError) {
      return NextResponse.json({ error: error.message, missingCapabilities: error.missing }, { status: 403 })
    }
    // Domain errors keep their own meaning (validation 400, number already registered 409, authorization 403); nothing else leaks.
    return canonicalFailure(error, "Unable to create company. Nothing was created.")
  }
}
