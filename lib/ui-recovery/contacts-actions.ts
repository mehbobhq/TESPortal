import "server-only"

import {
  addOrganizationChannel,
  addPersonChannel,
  addRelationship,
  addTitle,
  archivePerson,
  assignPurpose,
  changePersonChannel,
  changePersonName,
  changeTitle,
  correctPersonChannel,
  correctPersonName,
  correctTitle,
  createContact,
  endOrganizationChannel,
  endPersonChannel,
  endPurpose,
  endRelationship,
  endTitle,
  findPersonMatches,
  makePrimary,
  restorePerson,
  voidPersonChannel,
  voidTitle,
} from "@/lib/contacts/service"

/** Result of one routed Contacts action: the HTTP status and the JSON body the route returns. */
export type ContactsActionResult = { status: number; body: unknown }

export class UnsupportedContactsActionError extends Error {
  constructor() {
    super("Unsupported action.")
    this.name = "UnsupportedContactsActionError"
  }
}

const text = (value: unknown): string => String(value ?? "")

/**
 * Every Contacts action the company Contacts workspace can request, in one place so the route stays a thin handler and the
 * same dispatch is what the tests drive. Each action is an existing contacts-domain operation (own validation, own Master
 * Register event, own transaction). The company id is ALWAYS the one taken from the URL by the caller: a body can never name
 * another company, and every operation re-checks that its target (relationship, title, purpose, channel, person) is managed
 * through that company.
 */
export async function performContactsAction({ organizationId, body }: { organizationId: string; body: Record<string, unknown> }): Promise<ContactsActionResult> {
  const ok = (value: unknown, status = 200): ContactsActionResult => ({ status, body: value })
  switch (body.action) {
    case "createContact":
      return ok(await createContact({ organizationId, name: body.name, titles: body.titles, purposes: body.purposes, channels: body.channels } as Parameters<typeof createContact>[0]), 201)
    case "addRelationship":
      return ok(await addRelationship({ organizationId, personId: text(body.personId) }), 201)
    case "addChannel":
      return ok(await addOrganizationChannel({ organizationId, channel: body.channel }), 201)
    case "endChannel":
      return ok(await endOrganizationChannel({ organizationId, channelId: body.channelId }))
    case "addPersonChannel":
      return ok(await addPersonChannel({ organizationId, personId: body.personId, channel: body.channel }), 201)
    // A genuine change keeps the earlier value as history; a correction flags the wrong one; void flags one that never existed.
    case "changePersonChannel":
      return ok(await changePersonChannel({ organizationId, personId: body.personId, channelId: body.channelId, value: body.value }))
    case "correctPersonChannel":
      return ok(await correctPersonChannel({ organizationId, personId: body.personId, channelId: body.channelId, value: body.value }))
    case "endPersonChannel":
      return ok(await endPersonChannel({ organizationId, personId: body.personId, channelId: body.channelId }))
    case "voidPersonChannel":
      return ok(await voidPersonChannel({ organizationId, personId: body.personId, channelId: body.channelId }))
    case "endRelationship":
      return ok(await endRelationship({ organizationId, relationshipId: text(body.relationshipId) }))
    case "changeName":
      return ok(await changePersonName({ organizationId, personId: text(body.personId), givenName: body.givenName as string, familyName: body.familyName as string }))
    case "correctName":
      return ok(await correctPersonName({ organizationId, personId: text(body.personId), givenName: body.givenName as string, familyName: body.familyName as string }))
    case "addTitle":
      return ok(await addTitle({ organizationId, relationshipId: text(body.relationshipId), title: text(body.title) }), 201)
    case "changeTitle":
      return ok(await changeTitle({ organizationId, titleId: text(body.titleId), title: text(body.title) }))
    case "correctTitle":
      return ok(await correctTitle({ organizationId, titleId: text(body.titleId), title: text(body.title) }))
    case "endTitle":
      return ok(await endTitle({ organizationId, titleId: text(body.titleId) }))
    case "voidTitle":
      return ok(await voidTitle({ organizationId, titleId: text(body.titleId) }))
    case "assignPurpose":
      return ok(await assignPurpose({ organizationId, relationshipId: text(body.relationshipId), purpose: text(body.purpose), primary: body.primary === true }), 201)
    case "makePrimary":
      return ok(await makePrimary({ organizationId, relationshipId: text(body.relationshipId), purpose: text(body.purpose) }))
    case "endPurpose":
      return ok(await endPurpose({ organizationId, assignmentId: text(body.assignmentId) }))
    case "archivePerson":
      return ok(await archivePerson({ organizationId, personId: text(body.personId) }))
    case "restorePerson":
      return ok(await restorePerson({ organizationId, personId: text(body.personId) }))
    case "findMatches":
      return ok({ matches: await findPersonMatches(body.query as Parameters<typeof findPersonMatches>[0]) })
    default:
      throw new UnsupportedContactsActionError()
  }
}
