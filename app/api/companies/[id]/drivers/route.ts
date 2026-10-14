import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { addExistingDriver, createDriver } from "@/lib/operational-identity/service"
import { listOrganizationDrivers } from "@/lib/operational-identity/reads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json({ drivers: await listOrganizationDrivers(id) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load drivers.")
  }
}

/**
 * Adds a driver to the company in the URL (the company is never read from the body).
 *   { mode: "create", givenName, familyName, email?, phone?, relationshipType, status, driverNumber?, effectiveFrom, licence? }
 *       creates the Person, its name, driver profile, email/phone, licence and the relationship atomically;
 *   { mode: "add-existing", personId, relationshipType, status, driverNumber?, effectiveFrom }
 *       the "same person" resolution of an existing driver: only a new relationship with this company.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id: organizationId } = await context.params
    const { mode, ...rest } = await readJsonBody(request)
    if (mode === "add-existing") return NextResponse.json({ result: await addExistingDriver({ ...rest, organizationId }) }, { status: 201 })
    if (mode === "create") return NextResponse.json({ result: await createDriver({ ...rest, organizationId }) }, { status: 201 })
    return NextResponse.json({ error: "Unsupported driver request." }, { status: 400 })
  } catch (error) {
    return canonicalFailure(error, "Unable to add the driver.")
  }
}
