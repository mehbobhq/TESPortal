import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { getOrganization, registerBusinessIdentifier, retireBusinessIdentifier } from "@/lib/corporate-identity/service"
import type { OrganizationRecord } from "@/lib/corporate-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const KINDS = new Set(["INCORPORATION", "CRA_BN", "IRS_EIN"])

/** The Business workspace's view of the company's corporate identity, including superseded numbers (history). */
function view(organization: OrganizationRecord) {
  return {
    organizationId: organization.id,
    formationCountry: organization.formationCountry,
    formationRegion: organization.formationRegion,
    identifiers: organization.identifiers
      .filter((identifier) => identifier.kind !== null && KINDS.has(identifier.kind))
      .map((identifier) => ({
        id: identifier.id,
        kind: identifier.kind,
        value: identifier.value,
        status: identifier.status,
        recordedAt: identifier.createdAt,
        supersededAt: identifier.supersededAt,
      })),
  }
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ business: view(await getOrganization(id)) }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to load business records.")
  }
}

/** POST { kind: "CRA_BN" | "IRS_EIN", value, relation?: "change" | "correction" }: the organization always comes from the URL. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const result = await registerBusinessIdentifier(id, await readJsonBody(request))
    return NextResponse.json({ business: view(result.organization) }, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to record the number.")
  }
}

/** PATCH { action: "retire", identifierId }: ends a CRA BN / EIN as history (never a delete). */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    if (body.action !== "retire" || typeof body.identifierId !== "string") {
      return NextResponse.json({ error: "Unsupported business action." }, { status: 400 })
    }
    const result = await retireBusinessIdentifier(id, body.identifierId)
    return NextResponse.json({ business: view(result.organization) }, { status: 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return canonicalFailure(error, "Unable to retire the number.")
  }
}
