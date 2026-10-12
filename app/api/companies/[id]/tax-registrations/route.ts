import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { createRegistration, getOrganizationRegistrations, type CreateRegistrationInput } from "@/lib/tax-registrations/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getOrganizationRegistrations(id), { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load registrations.")
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const result = await createRegistration({ ...(body as Omit<CreateRegistrationInput, "organizationId">), organizationId: id })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return canonicalFailure(error, "Unable to create authority.")
  }
}
