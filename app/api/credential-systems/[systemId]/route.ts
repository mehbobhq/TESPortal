import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  addAlias,
  archiveSystem,
  getSystem,
  restoreSystem,
  retireAliasOfCredentialSystem,
  updateSystem,
} from "@/lib/company-credentials/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ systemId: string }> }

/** The portal / system registry is global (a system belongs to no company), so this route is not company-scoped. */
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { systemId } = await context.params
    return NextResponse.json({ system: await getSystem(systemId) }, { status: 200 })
  } catch (error) {
    return canonicalFailure(error, "Unable to load credential system.")
  }
}

/**
 * PATCH { action, ... }
 *   update       { name?, providerOrganizationId?, jurisdictionCountry?, jurisdictionRegion?, loginUrl? }
 *   addAlias     { alias }
 *   retireAlias  { aliasId }   (the alias must belong to this system)
 *   archive | restore
 */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { systemId } = await context.params
    const { action, ...rest } = await readJsonBody(request)
    const done = (system: unknown) => NextResponse.json({ system }, { status: 200 })
    switch (action) {
      case "update":
        return done(await updateSystem({ ...rest, systemId }))
      case "addAlias":
        return done(await addAlias({ ...rest, systemId }))
      case "retireAlias":
        return done(await retireAliasOfCredentialSystem(systemId, rest))
      case "archive":
        return done(await archiveSystem({ systemId }))
      case "restore":
        return done(await restoreSystem({ systemId }))
      default:
        return NextResponse.json({ error: "Unsupported credential system action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update credential system.")
  }
}
