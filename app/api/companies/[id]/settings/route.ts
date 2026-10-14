import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { clearRuleApplicability, getCompanyProfile, setDriverRequirements, setOperatingScope, setRuleApplicability } from "@/lib/company-profile/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getCompanyProfile(id), { status: 200, headers: NO_STORE })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the company settings.")
  }
}

/** Operating scope, rule applicability and driver minimums for one company. The company id always comes from the URL. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    switch (body.action) {
      case "setOperatingScope":
        return NextResponse.json(await setOperatingScope({ organizationId: id, operatingScope: body.operatingScope }), { status: 200, headers: NO_STORE })
      case "setRuleApplicability":
        return NextResponse.json(await setRuleApplicability({ organizationId: id, ruleCode: body.ruleCode, applicability: body.applicability }), { status: 200, headers: NO_STORE })
      case "clearRuleApplicability":
        return NextResponse.json(await clearRuleApplicability({ organizationId: id, ruleCode: body.ruleCode }), { status: 200, headers: NO_STORE })
      case "setDriverRequirements":
        return NextResponse.json(
          await setDriverRequirements({ organizationId: id, minimumDriverAgeYears: body.minimumDriverAgeYears, minimumDriverExperienceMonths: body.minimumDriverExperienceMonths }),
          { status: 200, headers: NO_STORE },
        )
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to save the company setting.")
  }
}
