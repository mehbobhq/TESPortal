import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import { performContactsAction, UnsupportedContactsActionError } from "@/lib/ui-recovery/contacts-actions"
import { getOrganizationContacts } from "@/lib/contacts/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    return NextResponse.json(await getOrganizationContacts(id), { status: 200, headers: NO_STORE })
  } catch (error) {
    return canonicalFailure(error, "Unable to load contacts.")
  }
}

/**
 * Contact changes for one company. Every action is an existing contacts-domain operation (own validation, own Master Register
 * event; see lib/ui-recovery/contacts-actions.ts); the company id always comes from the URL, never from the body. Nothing is deleted:
 * a channel, title, purpose or relationship is ENDED, or flagged when it was recorded in error (history kept).
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    const result = await performContactsAction({ organizationId: id, body })
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch (error) {
    if (error instanceof UnsupportedContactsActionError) return NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    return canonicalFailure(error, "Unable to save the contact change.")
  }
}
