import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  archiveRegistration,
  changeRegistrationStatus,
  changeRegistrationVersion,
  correctRegistrationStatus,
  correctRegistrationVersion,
  restoreRegistration,
  type ChangeVersionInput,
  type CorrectVersionInput,
} from "@/lib/tax-registrations/service"
import { isRegistrationStatus } from "@/lib/tax-registrations/definitions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string; registrationId: string }> }

/** PATCH { action: "status" | "version" | "correctVersion" | "correctStatus" | "archive" | "restore", ... } maps one-to-one onto the canonical operations. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id, registrationId } = await context.params
    const body = await readJsonBody(request)
    const target = { organizationId: id, registrationId }
    switch (body.action) {
      case "status":
        if (!isRegistrationStatus(body.status)) {
          return NextResponse.json({ error: "A valid registration status is required." }, { status: 400 })
        }
        return NextResponse.json({ view: await changeRegistrationStatus({ ...target, status: body.status }) }, { status: 200 })
      case "version": {
        const { action: _action, ...fields } = body
        return NextResponse.json(await changeRegistrationVersion({ ...(fields as ChangeVersionInput), ...target }), { status: 200 })
      }
      case "correctVersion": {
        const { action: _action, ...fields } = body
        return NextResponse.json(await correctRegistrationVersion({ ...(fields as CorrectVersionInput), ...target }), { status: 200 })
      }
      case "correctStatus":
        if (!isRegistrationStatus(body.status)) return NextResponse.json({ error: "A valid registration status is required." }, { status: 400 })
        return NextResponse.json({ view: await correctRegistrationStatus({ ...target, status: body.status }) }, { status: 200 })
      case "archive":
        return NextResponse.json({ view: await archiveRegistration(target) }, { status: 200 })
      case "restore":
        return NextResponse.json({ view: await restoreRegistration(target) }, { status: 200 })
      default:
        return NextResponse.json({ error: "Unsupported registration action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to update registration.")
  }
}
