import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  addOrganizationChannel,
  addPersonChannel,
  createContact,
  endOrganizationChannel,
  endPersonChannel,
  endRelationship,
  getOrganizationContacts,
} from "@/lib/contacts/service"

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
 * event); the company id always comes from the URL, never from the body. Nothing is deleted: a channel or relationship is ENDED
 * (history kept).
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonBody(request)
    switch (body.action) {
      case "createContact":
        return NextResponse.json(
          await createContact({ organizationId: id, name: body.name, titles: body.titles, purposes: body.purposes, channels: body.channels } as Parameters<typeof createContact>[0]),
          { status: 201, headers: NO_STORE },
        )
      case "addChannel":
        return NextResponse.json(await addOrganizationChannel({ organizationId: id, channel: body.channel }), { status: 201, headers: NO_STORE })
      case "endChannel":
        return NextResponse.json(await endOrganizationChannel({ organizationId: id, channelId: body.channelId }), { status: 200, headers: NO_STORE })
      case "addPersonChannel":
        return NextResponse.json(await addPersonChannel({ organizationId: id, personId: body.personId, channel: body.channel }), { status: 201, headers: NO_STORE })
      case "endPersonChannel":
        return NextResponse.json(await endPersonChannel({ organizationId: id, personId: body.personId, channelId: body.channelId }), { status: 200, headers: NO_STORE })
      case "endRelationship":
        return NextResponse.json(await endRelationship({ organizationId: id, relationshipId: String(body.relationshipId ?? "") }), { status: 200, headers: NO_STORE })
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to save the contact change.")
  }
}
