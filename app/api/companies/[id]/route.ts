import { NextRequest, NextResponse } from "next/server"
import {
  CorporateIdentifierCollisionError,
  CorporateIdentityConflictError,
  CorporateIdentityNotFoundError,
  CorporateIdentityStateError,
  CorporateIdentityValidationError,
} from "@/lib/corporate-identity/errors"
import { canonicalFailure } from "@/lib/api/canonical-response"
import { CompanyCreationCapabilityError } from "@/lib/company-directory/create-company"
import { CompanyCreationValidationError } from "@/lib/company-directory/creation-input"
import { CompanyDirectoryValidationError, editCompany, getCompanyEditRecord } from "@/lib/company-directory/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = {
  params: Promise<{ id: string }>
}

function failure(error: unknown, fallback: string) {
  if (error instanceof CompanyDirectoryValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof CompanyCreationValidationError) {
    return NextResponse.json({ error: "Some submitted information could not be saved. Nothing was changed.", issues: error.issues }, { status: 400 })
  }
  if (error instanceof CompanyCreationCapabilityError) return NextResponse.json({ error: error.message, missingCapabilities: error.missing }, { status: 403 })
  if (error instanceof CorporateIdentityNotFoundError) return NextResponse.json({ error: "Company not found." }, { status: 404 })
  if (error instanceof CorporateIdentityValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
  if (error instanceof CorporateIdentityConflictError || error instanceof CorporateIdentifierCollisionError || error instanceof CorporateIdentityStateError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  return canonicalFailure(error, fallback)
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ company: await getCompanyEditRecord(id) }, { status: 200 })
  } catch (error) {
    return failure(error, "Unable to load company.")
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await editCompany(id, await request.json()), { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return failure(error, "Unable to update company.")
  }
}
