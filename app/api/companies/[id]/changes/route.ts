import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  applyLegalNameChange,
  attachLegalNameEvidence,
  closeChannelChange,
  closeLegalNameRequest,
  CompanyChangeBlockedStateError,
  confirmChannelChange,
  getCompanyActivity,
  legalNameRequestReadiness,
  legalNameRequesterAuthorities,
  requestLegalNameChange,
} from "@/lib/company-changes/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const NO_STORE = { "Cache-Control": "private, no-store" }

function failure(error: unknown, fallback: string) {
  if (error instanceof CompanyChangeBlockedStateError) return NextResponse.json({ error: error.message, blockers: error.blockers }, { status: 409, headers: NO_STORE })
  return canonicalFailure(error, fallback)
}

/** The Company Activity (one entry per business operation, with evidence links) and any pending, not-yet-effective change requests. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getCompanyActivity(id), { status: 200, headers: NO_STORE })
  } catch (error) {
    return failure(error, "Unable to load the company activity.")
  }
}

/**
 * The gated company changes. The company id always comes from the URL. Every rule (evidence, requester standing, executing authority,
 * established-channel confirmation) is enforced by the service on the server; nothing here decides authority.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const input = { ...body, organizationId: id }
    switch (body.action) {
      case "requestLegalNameChange":
        return NextResponse.json({ request: await requestLegalNameChange(input) }, { status: 201, headers: NO_STORE })
      case "attachLegalNameEvidence":
        return NextResponse.json({ request: await attachLegalNameEvidence(input) }, { status: 200, headers: NO_STORE })
      case "legalNameRequesters":
        return NextResponse.json(await legalNameRequesterAuthorities(id), { status: 200, headers: NO_STORE })
      case "legalNameReadiness":
        return NextResponse.json(await legalNameRequestReadiness(id, String(body.requestId ?? "")), { status: 200, headers: NO_STORE })
      case "applyLegalNameChange":
        return NextResponse.json({ request: await applyLegalNameChange(input) }, { status: 200, headers: NO_STORE })
      case "closeLegalNameRequest":
        return NextResponse.json({ request: await closeLegalNameRequest(input) }, { status: 200, headers: NO_STORE })
      case "confirmChannelChange":
        return NextResponse.json({ request: await confirmChannelChange(input) }, { status: 200, headers: NO_STORE })
      case "closeChannelChange":
        return NextResponse.json({ request: await closeChannelChange(input) }, { status: 200, headers: NO_STORE })
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    }
  } catch (error) {
    return failure(error, "Unable to record the company change.")
  }
}
