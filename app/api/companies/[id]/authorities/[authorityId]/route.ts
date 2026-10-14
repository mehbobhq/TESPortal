import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  archiveAuthority,
  changeAuthorityStatus,
  changeAuthorityVersion,
  correctAuthorityStatus,
  correctAuthorityVersion,
  restoreAuthority,
  type ChangeVersionInput,
  type CorrectVersionInput,
} from "@/lib/operating-authorities/service"
import { isAuthorityStatus } from "@/lib/operating-authorities/definitions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; authorityId: string }> }

/** PATCH { action: "status" | "version" | "correctVersion" | "correctStatus" | "archive" | "restore", ... } maps one-to-one onto the canonical operations. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id, authorityId } = await context.params
    const body = await readJsonBody(request)
    const target = { organizationId: id, authorityId }
    switch (body.action) {
      case "status":
        if (!isAuthorityStatus(body.status)) {
          return NextResponse.json({ error: "A valid authority status is required." }, { status: 400 })
        }
        return NextResponse.json({ view: await changeAuthorityStatus({ ...target, status: body.status }) }, { status: 200 })
      case "version": {
        const { action: _action, ...fields } = body
        return NextResponse.json(await changeAuthorityVersion({ ...(fields as ChangeVersionInput), ...target }), { status: 200 })
      }
      // A correction replaces a wrongly recorded version/status; the wrong one is kept, flagged, never reported as history.
      case "correctVersion": {
        const { action: _action, ...fields } = body
        return NextResponse.json(await correctAuthorityVersion({ ...(fields as CorrectVersionInput), ...target }), { status: 200 })
      }
      case "correctStatus":
        if (!isAuthorityStatus(body.status)) return NextResponse.json({ error: "A valid authority status is required." }, { status: 400 })
        return NextResponse.json({ view: await correctAuthorityStatus({ ...target, status: body.status }) }, { status: 200 })
      case "archive":
        return NextResponse.json({ view: await archiveAuthority(target) }, { status: 200 })
      case "restore":
        return NextResponse.json({ view: await restoreAuthority(target) }, { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported authority action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update authority.")
  }
}
