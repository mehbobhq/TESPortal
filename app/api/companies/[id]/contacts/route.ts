import { NextRequest, NextResponse } from "next/server"
import { canonicalFailure, readJsonBody } from "@/lib/api/canonical-response"
import {
  addPersonChannel,
  addRelationship,
  addTitle,
  changeTitle,
  changePersonChannel,
  correctPersonChannel,
  archivePerson,
  assignPurpose,
  changePersonName,
  correctPersonName,
  createContact,
  excludeFromOperationalEmail,
  resumeOperationalEmail,
  endPersonChannel,
  endPurpose,
  endRelationship,
  endTitle,
  findPersonMatches,
  getOrganizationContacts,
  makePrimary,
  restoreContact,
  restorePerson,
  refuseDirectCompanyChannelChange,
} from "@/lib/contacts/service"
import { createContactWithDetails, saveContact } from "@/lib/contact-identity/service"

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
      // The company's own phone, email and website are SENSITIVE: they change only through Company Edit, where a replacement or removal waits for
      // confirmation with verified evidence through an established channel. A direct add / end here would bypass that gate, so it is refused.
      case "addChannel":
      case "endChannel":
        return await refuseDirectCompanyChannelChange()
      case "addPersonChannel":
        return NextResponse.json(await addPersonChannel({ organizationId: id, personId: body.personId, channel: body.channel }), { status: 201, headers: NO_STORE })
      // Editing a person's own channel keeps the earlier value as history (change) or flags it as wrong (correct). The company's own
      // lines are never touched through a person.
      case "changePersonChannel":
        return NextResponse.json(await changePersonChannel({ organizationId: id, personId: body.personId, channelId: body.channelId, value: body.value, preferred: body.preferred }), { status: 200, headers: NO_STORE })
      case "correctPersonChannel":
        return NextResponse.json(await correctPersonChannel({ organizationId: id, personId: body.personId, channelId: body.channelId, value: body.value, preferred: body.preferred }), { status: 200, headers: NO_STORE })
      // A contact who left is re-associated as the SAME person (no second person record is created).
      case "addRelationship":
        return NextResponse.json(await addRelationship({ organizationId: id, personId: String(body.personId ?? "") }), { status: 201, headers: NO_STORE })
      case "changeTitle":
        return NextResponse.json(await changeTitle({ organizationId: id, titleId: String(body.titleId ?? ""), title: String(body.title ?? "") }), { status: 200, headers: NO_STORE })
      case "endPersonChannel":
        return NextResponse.json(await endPersonChannel({ organizationId: id, personId: body.personId, channelId: body.channelId }), { status: 200, headers: NO_STORE })
      case "endRelationship":
        return NextResponse.json(await endRelationship({ organizationId: id, relationshipId: String(body.relationshipId ?? "") }), { status: 200, headers: NO_STORE })
      // A genuine change keeps the earlier name as history; a correction flags the wrong one. Neither deletes anything.
      case "changeName":
        return NextResponse.json(await changePersonName({ organizationId: id, personId: String(body.personId ?? ""), givenName: body.givenName as string, familyName: body.familyName as string }), { status: 200, headers: NO_STORE })
      case "correctName":
        return NextResponse.json(await correctPersonName({ organizationId: id, personId: String(body.personId ?? ""), givenName: body.givenName as string, familyName: body.familyName as string }), { status: 200, headers: NO_STORE })
      case "addTitle":
        return NextResponse.json(await addTitle({ organizationId: id, relationshipId: String(body.relationshipId ?? ""), title: String(body.title ?? "") }), { status: 201, headers: NO_STORE })
      case "endTitle":
        return NextResponse.json(await endTitle({ organizationId: id, titleId: String(body.titleId ?? "") }), { status: 200, headers: NO_STORE })
      case "assignPurpose":
        return NextResponse.json(await assignPurpose({ organizationId: id, relationshipId: String(body.relationshipId ?? ""), purpose: String(body.purpose ?? ""), primary: body.primary === true }), { status: 201, headers: NO_STORE })
      case "makePrimary":
        return NextResponse.json(await makePrimary({ organizationId: id, relationshipId: String(body.relationshipId ?? ""), purpose: String(body.purpose ?? "") }), { status: 200, headers: NO_STORE })
      case "endPurpose":
        return NextResponse.json(await endPurpose({ organizationId: id, assignmentId: String(body.assignmentId ?? "") }), { status: 200, headers: NO_STORE })
      case "archivePerson":
        return NextResponse.json(await archivePerson({ organizationId: id, personId: String(body.personId ?? "") }), { status: 200, headers: NO_STORE })
      case "restorePerson":
        return NextResponse.json(await restorePerson({ organizationId: id, personId: String(body.personId ?? "") }), { status: 200, headers: NO_STORE })
      // ONE transaction per save: name, own email / phone, title, Primary Contact designation and (when permitted) identity details commit
      // together or not at all, and the server works out what differs, so a repeated submit changes nothing instead of failing.
      case "saveContact":
        return NextResponse.json(
          await saveContact({ organizationId: id, personId: String(body.personId ?? ""), name: body.name as never, email: body.email as never, phone: body.phone as never, title: body.title as never, primary: body.primary as never, identity: body.identity as never }),
          { status: 200, headers: NO_STORE },
        )
      case "createContactFull":
        return NextResponse.json(
          await createContactWithDetails({ organizationId: id, name: (body.name ?? {}) as never, email: body.email as never, phone: body.phone as never, title: body.title as never, primary: body.primary === true, identity: body.identity as never }),
          { status: 201, headers: NO_STORE },
        )
      // Operational-email inclusion is its own record: it never ends an email, the relationship or the Primary Contact designation.
      case "excludeFromOperationalEmail":
        return NextResponse.json(await excludeFromOperationalEmail({ organizationId: id, relationshipId: body.relationshipId, source: body.source, reference: body.reference, instructedByPersonId: body.instructedByPersonId, evidenceDocumentId: body.evidenceDocumentId }), { status: 201, headers: NO_STORE })
      case "resumeOperationalEmail":
        return NextResponse.json(await resumeOperationalEmail({ organizationId: id, exclusionId: body.exclusionId }), { status: 200, headers: NO_STORE })
      case "restoreContact":
        return NextResponse.json(await restoreContact({ organizationId: id, personId: String(body.personId ?? "") }), { status: 201, headers: NO_STORE })
      case "findMatches":
        return NextResponse.json({ matches: await findPersonMatches(body.query as Parameters<typeof findPersonMatches>[0]) }, { status: 200, headers: NO_STORE })
      default:
        return NextResponse.json({ error: "Unsupported action." }, { status: 400 })
    }
  } catch (error) {
    return canonicalFailure(error, "Unable to save the contact change.")
  }
}
