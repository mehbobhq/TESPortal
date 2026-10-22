import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { convertProspectToCompanyDriver } from "@/lib/driver-prospects/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; prospectId: string }> }
const text = (v: unknown) => (typeof v === "string" ? v : "")

/** Full onboarding requirements apply here (date of birth, start date, licence). The result is ONBOARDING, never ACTIVE. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id, prospectId } = await context.params
    const body = await readJsonBody(request)
    const licence = (body.licence && typeof body.licence === "object" ? body.licence : {}) as Record<string, unknown>
    const type = ["EMPLOYEE", "CONTRACTOR", "OWNER_OPERATOR"].find((t) => t === body.relationshipType)
    if (!type) return NextResponse.json({ error: "Choose the driver relationship type." }, { status: 400 })
    const result = await convertProspectToCompanyDriver({
      organizationId: id,
      prospectId,
      relationshipType: type as "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR",
      relationshipStartDate: text(body.relationshipStartDate),
      dateOfBirth: text(body.dateOfBirth),
      driverNumber: text(body.driverNumber) || undefined,
      licence: { country: text(licence.country), region: text(licence.region), number: text(licence.number), licenceClass: text(licence.licenceClass) || undefined, effectiveFrom: text(licence.effectiveFrom) },
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to onboard the prospect as a company driver.")
  }
}
