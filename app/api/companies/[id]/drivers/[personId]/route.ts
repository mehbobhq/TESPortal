import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { getOrganizationDriverDetail } from "@/lib/operational-identity/driver-reads"
import { changeDriverName, changeDriverRelationship, correctDriverName, correctDriverRelationship, endDriverRelationship, setDriverChannel } from "@/lib/operational-identity/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; personId: string }> }

/** The driver must belong to the company in the URL; any other person is reported as not found. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id: organizationId, personId } = await context.params
    return NextResponse.json({ driver: await getOrganizationDriverDetail(organizationId, personId) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load the driver.")
  }
}

/** PATCH { action, ... } maps onto the canonical driver operations. The company and person always come from the URL. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id: organizationId, personId } = await context.params
    const { action, ...rest } = await readJsonBody(request)
    const input = { ...rest, organizationId, personId }
    switch (action) {
      case "change-name":
        return NextResponse.json({ result: await changeDriverName(input) }, { status: 200 })
      case "correct-name":
        return NextResponse.json({ result: await correctDriverName(input) }, { status: 200 })
      case "set-channel":
        return NextResponse.json({ result: await setDriverChannel(input) }, { status: 200 })
      case "change-relationship":
        return NextResponse.json({ result: await changeDriverRelationship(input) }, { status: 200 })
      case "correct-relationship":
        return NextResponse.json({ result: await correctDriverRelationship(input) }, { status: 200 })
      case "end-relationship":
        return NextResponse.json({ result: await endDriverRelationship(input) }, { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported driver action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update the driver.")
  }
}
