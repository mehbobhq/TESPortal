import { NextRequest, NextResponse } from "next/server"
import {
  CorporateIdentifierCollisionError,
  CorporateIdentityConflictError,
  CorporateIdentityNotFoundError,
  CorporateIdentityStateError,
  CorporateIdentityValidationError,
} from "@/lib/corporate-identity/errors"
import { CompanyDirectoryValidationError, getCompanyEditRecord, updateCompanyDirectoryRecord } from "@/lib/company-directory/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = {
  params: Promise<{ id: string }>
}

function failure(error: unknown, fallback: string) {
  if (error instanceof CompanyDirectoryValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof CorporateIdentityNotFoundError) return NextResponse.json({ error: "Company not found." }, { status: 404 })
  if (error instanceof CorporateIdentityValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
  if (error instanceof CorporateIdentityConflictError || error instanceof CorporateIdentifierCollisionError || error instanceof CorporateIdentityStateError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
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
    return NextResponse.json({ company: await updateCompanyDirectoryRecord(id, await request.json()) }, { status: 200 })
  } catch (error) {
    return failure(error, "Unable to update company.")
  }
}
