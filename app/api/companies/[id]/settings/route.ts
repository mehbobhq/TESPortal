import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { getCompanyProfile } from "@/lib/company-profile/service"
import { performSettingsAction, UnsupportedSettingsActionError } from "@/lib/ui-recovery/settings-actions"

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

/**
 * Operating scope, rule applicability and driver minimums for one company (see lib/ui-recovery/settings-actions.ts). The company id
 * always comes from the URL. set / clear are real-world changes; correct* flags a wrongly recorded value (history is kept).
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const result = await performSettingsAction({ organizationId: id, body })
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    if (error instanceof UnsupportedSettingsActionError) return NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    return canonicalFailure(error, "Unable to save the company setting.")
  }
}
