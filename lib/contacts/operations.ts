/**
 * Contacts operations: validation, business rules and Master Register events on a caller-supplied transaction.
 *
 * Every function here runs INSIDE a transaction the authorization wrapper already opened, and Master Register events are
 * written through a repository bound to the same client, so a failure anywhere (including the Master Register) rolls the
 * whole change back.
 *
 * LOCK ORDER (every mutation, without exception - this is what prevents deadlocks):
 *   1. the Organization row            (so all contact writers of one Organization serialize)
 *   2. person rows, in ascending id    (persons are shared across Organizations)
 *   3. the relationship row
 *   4. dependent rows (titles, purpose assignments, channels), in id order
 * Unique indexes on current rows are the structural backstop for races between Organizations or against a writer that
 * somehow bypassed the Organization lock.
 *
 * Correction vs real-world change:
 *   change*  a REAL-WORLD change: the old row is ended at T and the next row starts at T (both stay genuine history).
 *   correct* the recorded row was WRONG: it is kept, flagged 'corrected', pointed at its replacement, never ended, and the
 *            replacement inherits its business time.
 *   void*    the row should never have existed: kept, flagged 'voided', never ended, no replacement.
 *   end*     a REAL-WORLD end (the person left, the line was disconnected). Nothing is deleted.
 *
 * Master Register: events reference rows (table:id) and carry only controlled-vocabulary literals (channel type, usage,
 * purpose code, primary flag). They NEVER contain a name, email address, phone number or title: the Master Register must
 * not become a second copy of contact data.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  PURPOSE_DEFINITIONS,
  isChannelType,
  isChannelUsage,
  isContactPurpose,
  prepareChannel,
  prepareName,
  prepareTitle,
  type ChannelType,
  type ContactPurpose,
  type OrganizationChannelUsage,
} from "@/lib/contacts/definitions"
import {
  ContactConflictError,
  ContactNotFoundError,
  ContactStateError,
  ContactValidationError,
} from "@/lib/contacts/errors"
import * as repo from "@/lib/contacts/repository"
import type {
  ChannelRecord,
  ContactView,
  CreateContactResult,
  NameRecord,
  OrganizationContactsView,
  PersonMatch,
  PersonMatchReason,
  PersonRecord,
  PurposeAssignmentRecord,
  RelationshipRecord,
  TitleRecord,
} from "@/lib/contacts/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor holds PERSON_REGISTRY_READ (same transaction, memoized). */
  canViewRegistry: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContactValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new ContactValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new ContactValidationError(field, `${field} must be a UUID.`)
}

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new ContactValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new ContactValidationError(field, `${field} is not a valid instant.`)
  return date.toISOString()
}

function optionalInstant(value: unknown, field: string): string | null {
  return value === undefined ? null : parseInstant(value, field)
}

function parseBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value === "boolean") return value
  throw new ContactValidationError(field, `${field} must be true or false.`)
}

function parseChannelInput(value: unknown, field: string, usage: boolean): {
  type: ChannelType
  raw: unknown
  extension: unknown
  preferred: boolean
  usage: OrganizationChannelUsage | null
} {
  const input = requireObject(value, field, usage ? ["type", "value", "extension", "preferred", "usage"] : ["type", "value", "extension", "preferred"])
  if (!isChannelType(input.type)) throw new ContactValidationError(`${field}.type`, `${field}.type must be a supported channel type.`)
  let channelUsage: OrganizationChannelUsage | null = null
  if (usage) {
    if (!isChannelUsage(input.usage)) throw new ContactValidationError(`${field}.usage`, `${field}.usage must be a supported channel usage.`)
    channelUsage = input.usage
  }
  return { type: input.type, raw: input.value, extension: input.extension, preferred: parseBoolean(input.preferred, `${field}.preferred`, false), usage: channelUsage }
}

// ---------------------------------------------------------------------------------------------------------------
// Database error translation
// ---------------------------------------------------------------------------------------------------------------

function constraintOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? ((error as { constraint?: string }).constraint ?? undefined) : undefined
}

/** Translates the documented database backstops into domain errors; anything else propagates unchanged. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const constraint = constraintOf(error)
    if (constraint === undefined) throw error
    if (constraint === repo.CURRENT_RELATIONSHIP_CONSTRAINT) {
      throw new ContactConflictError("This person already has an open relationship with the Organization, or a concurrent change was made.")
    }
    if (constraint === repo.CURRENT_NAME_CONSTRAINT) throw new ContactConflictError("A concurrent change was made; retry the operation.")
    if (constraint === repo.CURRENT_PERSON_CHANNEL_CONSTRAINT || constraint === repo.CURRENT_ORGANIZATION_CHANNEL_CONSTRAINT) {
      throw new ContactConflictError("This channel is already recorded as current.")
    }
    if (constraint === repo.PREFERRED_PERSON_CHANNEL_CONSTRAINT || constraint === repo.PREFERRED_ORGANIZATION_CHANNEL_CONSTRAINT) {
      throw new ContactConflictError("Another channel of this kind is already preferred.")
    }
    if (constraint === repo.CURRENT_TITLE_CONSTRAINT) throw new ContactConflictError("The person already holds this title.")
    if (constraint === repo.CURRENT_ASSIGNMENT_CONSTRAINT) throw new ContactConflictError("The person already serves this purpose.")
    if (constraint === repo.CURRENT_PRIMARY_CONSTRAINT) throw new ContactConflictError("Another contact is already the primary for this purpose.")
    if ((repo.WINDOW_CONSTRAINTS as readonly string[]).includes(constraint)) {
      throw new ContactValidationError("effectiveFrom", "The effective date must be after the current record began.")
    }
    if (constraint === repo.PERSON_ACTIVE_CONSTRAINT) throw new ContactStateError("This person is archived; restore the person first.")
    if ((repo.ORGANIZATION_ACTIVE_CONSTRAINTS as readonly string[]).includes(constraint)) {
      throw new ContactStateError("This Organization is not active.")
    }
    if (constraint === repo.RELATIONSHIP_WINDOW_CONSTRAINT) {
      throw new ContactValidationError("effectiveFrom", "The record must fall inside an active relationship.")
    }
    if (constraint === repo.PURPOSE_RULES_CONSTRAINT) {
      throw new ContactValidationError("purpose", "The purpose is not available or the primary flag does not suit it.")
    }
    if (constraint === repo.ARCHIVE_BLOCKED_CONSTRAINT) throw new ContactStateError("End the person's current relationships before archiving the person.")
    if ((repo.DEPENDENTS_BLOCK_CONSTRAINTS as readonly string[]).includes(constraint)) {
      throw new ContactStateError("The relationship still has titles or purposes; end or void them first.")
    }
    throw error
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName =
  | "RECORD_CREATED"
  | "RECORD_UPDATED"
  | "RECORD_CORRECTED"
  | "RECORD_ARCHIVED"
  | "RECORD_RESTORED"
  | "RECORD_LINK_ESTABLISHED"
  | "RECORD_LINK_REMOVED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })

type Target = { resourceType: string; resourceId: string; organizationId: string; personId?: string }

async function record(ctx: OperationContext, eventType: EventTypeName, operation: string, target: Target, fieldChanges: FieldChange[]): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      subjectReferences: [`organization:${target.organizationId}`, ...(target.personId ? [`person:${target.personId}`] : [])],
    },
    source: { sourceType: "APPLICATION", component: "contacts", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

async function lockActiveOrganization(ctx: OperationContext, organizationId: string): Promise<void> {
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new ContactNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new ContactStateError(
      organization.status === "merged"
        ? "This Organization has been merged; its contacts can no longer be changed."
        : "This Organization is archived; restore it before changing its contacts.",
    )
  }
}

/** Locks persons in ascending id order (lock order step 2). */
async function lockPersons(ctx: OperationContext, personIds: string[]): Promise<Map<string, PersonRecord>> {
  const locked = new Map<string, PersonRecord>()
  for (const id of [...new Set(personIds)].sort()) {
    const person = await repo.lockPerson(ctx.client, id)
    if (!person) throw new ContactNotFoundError("Person")
    locked.set(id, person)
  }
  return locked
}

/**
 * A person the caller manages through an Organization: locked, and visible only if it has a (non-voided) relationship
 * with that Organization. Anything else looks exactly like a person that does not exist.
 */
async function lockManagedPerson(ctx: OperationContext, organizationId: string, personId: string, options: { allowArchived?: boolean } = {}): Promise<PersonRecord> {
  const person = (await lockPersons(ctx, [personId])).get(personId)
  if (!person || !(await repo.personRelatedToOrganization(ctx.client, organizationId, personId))) throw new ContactNotFoundError("Person")
  if (person.recordStatus !== "active" && !options.allowArchived) {
    throw new ContactStateError("This person is archived; restore the person first.")
  }
  return person
}

/** Locks (org, person, relationship) in order for an operation named by relationship id. */
async function lockManagedRelationship(ctx: OperationContext, organizationId: string, relationshipId: string): Promise<{ relationship: RelationshipRecord; person: PersonRecord }> {
  await lockActiveOrganization(ctx, organizationId)
  const peek = await repo.getRelationship(ctx.client, organizationId, relationshipId)
  if (!peek) throw new ContactNotFoundError("Relationship")
  const person = (await lockPersons(ctx, [peek.personId])).get(peek.personId) as PersonRecord
  const relationship = await repo.getRelationship(ctx.client, organizationId, relationshipId, true)
  if (!relationship) throw new ContactNotFoundError("Relationship")
  return { relationship, person }
}

function requireOpenRelationship(relationship: RelationshipRecord, person: PersonRecord): void {
  if (relationship.recordStatus !== "active" || relationship.effectiveTo !== null) {
    throw new ContactStateError("This relationship has ended.")
  }
  if (person.recordStatus !== "active") throw new ContactStateError("This person is archived; restore the person first.")
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) throw new ContactValidationError(field, `${field} cannot be in the future.`)
  return explicit
}

// ---------------------------------------------------------------------------------------------------------------
// Views and reads (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

const normalizeAt = (asOf: string): string => (/\.\d{3}Z$/.test(asOf) ? asOf.replace(/Z$/, "000Z") : asOf)

const isGenuineOpen = (row: { recordStatus: string; effectiveTo: string | null }): boolean => row.recordStatus === "active" && row.effectiveTo === null

function inForce(row: { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }, at: string): boolean {
  return row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)
}

function assembleContact(
  relationship: RelationshipRecord,
  person: PersonRecord,
  names: NameRecord[],
  channels: ChannelRecord[],
  titles: TitleRecord[],
  purposes: PurposeAssignmentRecord[],
  asOf: string | null,
): ContactView {
  const relationshipOpen = isGenuineOpen(relationship)
  return {
    relationship,
    person,
    names,
    channels,
    titles,
    purposes,
    current: {
      name: names.find(isGenuineOpen) ?? null,
      channels: channels.filter(isGenuineOpen),
      titles: relationshipOpen ? titles.filter(isGenuineOpen) : [],
      purposes: relationshipOpen ? purposes.filter(isGenuineOpen) : [],
    },
    asOf:
      asOf === null
        ? null
        : {
            at: asOf,
            relationshipInForce: inForce(relationship, normalizeAt(asOf)),
            name: names.find((row) => inForce(row, normalizeAt(asOf))) ?? null,
            channels: channels.filter((row) => inForce(row, normalizeAt(asOf))),
            titles: titles.filter((row) => inForce(row, normalizeAt(asOf))),
            purposes: purposes.filter((row) => inForce(row, normalizeAt(asOf))),
          },
  }
}

async function loadContacts(client: PoolClient, relationships: RelationshipRecord[], asOf: string | null): Promise<ContactView[]> {
  const personIds = [...new Set(relationships.map((row) => row.personId))]
  const relationshipIds = relationships.map((row) => row.id)
  const [persons, names, channels, titles, purposes] = await Promise.all([
    repo.listPersons(client, personIds),
    repo.listNames(client, personIds),
    repo.listPersonChannels(client, personIds),
    repo.listTitles(client, relationshipIds),
    repo.listAssignments(client, relationshipIds),
  ])
  return relationships.map((relationship) =>
    assembleContact(
      relationship,
      persons.get(relationship.personId) as PersonRecord,
      names.get(relationship.personId) ?? [],
      channels.get(relationship.personId) ?? [],
      titles.get(relationship.id) ?? [],
      purposes.get(relationship.id) ?? [],
      asOf,
    ),
  )
}

async function loadContact(ctx: OperationContext, organizationId: string, relationshipId: string): Promise<ContactView> {
  const relationship = await repo.getRelationship(ctx.client, organizationId, relationshipId)
  if (!relationship) throw new ContactNotFoundError("Relationship")
  return (await loadContacts(ctx.client, [relationship], null))[0]
}

/**
 * One Organization's contacts and own channels: what is true now, optionally what was true at an instant, and the full
 * history (corrected / voided rows appear only in the history arrays, flagged). Reads only the named Organization's data.
 */
export async function readOrganizationContacts(
  client: PoolClient,
  organizationId: string,
  options: { asOf?: string } = {},
): Promise<OrganizationContactsView> {
  const id = parseUuid(organizationId, "organizationId")
  if ((await repo.organizationExists(client, id)) === false) throw new ContactNotFoundError("Organization")
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")
  const [channels, relationships] = await Promise.all([repo.listOrganizationChannels(client, id), repo.listRelationships(client, id)])
  return {
    organizationId: id,
    channels,
    currentChannels: channels.filter(isGenuineOpen),
    asOfChannels: asOf === null ? null : channels.filter((row) => inForce(row, normalizeAt(asOf))),
    contacts: await loadContacts(client, relationships, asOf),
  }
}

export type PersonDetailView = {
  person: PersonRecord
  names: NameRecord[]
  currentName: NameRecord | null
  channels: ChannelRecord[]
  /** Every Organization relationship of the person (registry read only). */
  relationships: RelationshipRecord[]
}

/** Registry read of one person across Organizations. The service restricts this to PERSON_REGISTRY_READ. */
export async function readPerson(client: PoolClient, personId: string): Promise<PersonDetailView> {
  const id = parseUuid(personId, "personId")
  const persons = await repo.listPersons(client, [id])
  const person = persons.get(id)
  if (!person) throw new ContactNotFoundError("Person")
  const [names, channels, relationships] = await Promise.all([repo.listNames(client, [id]), repo.listPersonChannels(client, [id]), repo.listPersonRelationships(client, id)])
  const nameRows = names.get(id) ?? []
  return { person, names: nameRows, currentName: nameRows.find(isGenuineOpen) ?? null, channels: channels.get(id) ?? [], relationships }
}

function displayName(name: NameRecord | undefined): string {
  return name ? [name.givenName, name.familyName].filter(Boolean).join(" ") : ""
}

/**
 * ADVISORY duplicate candidates for human review. Shared mailboxes, shared phone lines and common names are legitimate,
 * so a match is only ever a suggestion: nothing here merges, links or reuses a person.
 */
export async function findPersonMatches(client: PoolClient, rawInput: unknown): Promise<PersonMatch[]> {
  const input = requireObject(rawInput, "input", ["givenName", "familyName", "email", "phone"])
  const reasons = new Map<string, Set<PersonMatchReason>>()
  const add = (ids: string[], reason: PersonMatchReason) => {
    for (const id of ids) reasons.set(id, (reasons.get(id) ?? new Set()).add(reason))
  }
  if (input.givenName !== undefined || input.familyName !== undefined) {
    const name = prepareName(input.givenName, input.familyName)
    add(await repo.findPersonIdsByName(client, name.normalized), "NAME")
  }
  if (input.email !== undefined) add(await repo.findPersonIdsByChannel(client, "EMAIL", prepareChannel("EMAIL", input.email, undefined, "email").normalized), "EMAIL")
  if (input.phone !== undefined) add(await repo.findPersonIdsByChannel(client, "PHONE", prepareChannel("PHONE", input.phone, undefined, "phone").normalized), "PHONE")
  const ids = [...reasons.keys()]
  const [names, organizations] = await Promise.all([repo.listNames(client, ids), repo.listPersonOrganizationIds(client, ids)])
  return ids.map((personId) => ({
    personId,
    displayName: displayName((names.get(personId) ?? []).find(isGenuineOpen)),
    reasons: [...(reasons.get(personId) as Set<PersonMatchReason>)],
    organizationIds: organizations.get(personId) ?? [],
  }))
}

// ---------------------------------------------------------------------------------------------------------------
// create contact (person + name + relationship, with optional channels / titles / purposes) - atomic
// ---------------------------------------------------------------------------------------------------------------

type PurposeInput = { purpose: ContactPurpose; primary: boolean }

function parsePurposes(value: unknown, field: string): PurposeInput[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ContactValidationError(field, `${field} must be a list.`)
  return value.map((entry, index) => {
    const input = requireObject(entry, `${field}[${index}]`, ["purpose", "primary"])
    if (!isContactPurpose(input.purpose)) throw new ContactValidationError(`${field}[${index}].purpose`, "Unknown contact purpose.")
    return { purpose: input.purpose, primary: resolvePrimary(input.purpose, input.primary, `${field}[${index}].primary`) }
  })
}

/** Applies the purpose's primary_mode: NONE forbids a primary flag, REQUIRED implies it, OPTIONAL leaves the choice. */
function resolvePrimary(purpose: ContactPurpose, requested: unknown, field: string): boolean {
  const mode = PURPOSE_DEFINITIONS[purpose].primaryMode as string
  const primary = parseBoolean(requested, field, mode === "REQUIRED")
  if (mode === "NONE" && primary) throw new ContactValidationError(field, `${purpose} cannot have a primary contact.`)
  if (mode === "REQUIRED" && !primary) throw new ContactValidationError(field, `${purpose} is always the primary contact.`)
  return primary
}

export async function createContact(ctx: OperationContext, rawInput: unknown): Promise<CreateContactResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "name", "channels", "titles", "purposes", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const nameInput = requireObject(input.name, "name", ["givenName", "familyName"])
  const name = prepareName(nameInput.givenName, nameInput.familyName)
  const channelInputs = input.channels === undefined ? [] : Array.isArray(input.channels) ? input.channels : (() => { throw new ContactValidationError("channels", "channels must be a list.") })()
  const channels = channelInputs.map((entry, index) => {
    const parsed = parseChannelInput(entry, `channels[${index}]`, false)
    return { ...parsed, prepared: prepareChannel(parsed.type, parsed.raw, parsed.extension, `channels[${index}].value`) }
  })
  const titleInputs = input.titles === undefined ? [] : Array.isArray(input.titles) ? input.titles : (() => { throw new ContactValidationError("titles", "titles must be a list.") })()
  const titles = titleInputs.map((title, index) => prepareTitle(title, `titles[${index}]`))
  const purposes = parsePurposes(input.purposes, "purposes")
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")

  const matches = (await ctx.canViewRegistry()) ? await findPersonMatchesForCreate(ctx.client, name.normalized, channels) : []

  const personId = randomUUID()
  const nameId = randomUUID()
  const relationshipId = randomUUID()
  await repo.insertPerson(ctx.client, personId)
  await guarded(() => repo.insertName(ctx.client, { id: nameId, personId, givenName: name.givenName, familyName: name.familyName, normalized: name.normalized, reason: "INITIAL", effectiveFrom: at }))
  await guarded(() => repo.insertRelationship(ctx.client, { id: relationshipId, organizationId, personId, effectiveFrom: at }))

  const channelIds: string[] = []
  for (const channel of channels) {
    const id = randomUUID()
    channelIds.push(id)
    await guarded(() =>
      repo.insertPersonChannel(ctx.client, {
        id, personId, channelType: channel.type, display: channel.prepared.display, normalized: channel.prepared.normalized,
        ruleVersion: channel.prepared.ruleVersion, extension: channel.prepared.extension, preferred: channel.preferred, reason: "INITIAL", effectiveFrom: at,
      }),
    )
  }
  const titleIds: string[] = []
  for (const title of titles) {
    const id = randomUUID()
    titleIds.push(id)
    await guarded(() => repo.insertTitle(ctx.client, { id, relationshipId, organizationId, personId, display: title.display, normalized: title.normalized, reason: "INITIAL", effectiveFrom: at }))
  }
  const assignmentIds: Array<{ id: string; purpose: ContactPurpose; primary: boolean }> = []
  for (const purpose of purposes) {
    const id = randomUUID()
    assignmentIds.push({ id, ...purpose })
    await guarded(() => repo.insertAssignment(ctx.client, { id, relationshipId, organizationId, personId, purpose: purpose.purpose, primary: purpose.primary, reason: "INITIAL", effectiveFrom: at }))
  }

  await record(ctx, "RECORD_CREATED", "createContact", { resourceType: "person", resourceId: personId, organizationId, personId }, [
    { field: "name", after: reference("person_name_versions", nameId) },
    ...channelIds.map((id, index) => ({ field: `channel${index}`, after: reference("person_channels", id) })),
    ...titleIds.map((id, index) => ({ field: `title${index}`, after: reference("organization_person_titles", id) })),
  ])
  await record(ctx, "RECORD_LINK_ESTABLISHED", "createContact", { resourceType: "organization_person_relationship", resourceId: relationshipId, organizationId, personId }, [
    { field: "relationship", after: reference("organization_person_relationships", relationshipId) },
  ])
  for (const assignment of assignmentIds) {
    await record(ctx, "RECORD_LINK_ESTABLISHED", "createContact", { resourceType: "contact_purpose_assignment", resourceId: assignment.id, organizationId, personId }, [
      { field: "purpose", after: literal(assignment.purpose) },
      { field: "primary", after: literal(assignment.primary) },
    ])
  }
  return { contact: await loadContact(ctx, organizationId, relationshipId), matches }
}

async function findPersonMatchesForCreate(
  client: PoolClient,
  normalizedName: string,
  channels: Array<{ type: ChannelType; prepared: { normalized: string } }>,
): Promise<PersonMatch[]> {
  const reasons = new Map<string, Set<PersonMatchReason>>()
  const add = (ids: string[], reason: PersonMatchReason) => {
    for (const id of ids) reasons.set(id, (reasons.get(id) ?? new Set()).add(reason))
  }
  add(await repo.findPersonIdsByName(client, normalizedName), "NAME")
  for (const channel of channels) {
    if (channel.type === "EMAIL") add(await repo.findPersonIdsByChannel(client, "EMAIL", channel.prepared.normalized), "EMAIL")
    if (channel.type === "PHONE") add(await repo.findPersonIdsByChannel(client, "PHONE", channel.prepared.normalized), "PHONE")
  }
  const ids = [...reasons.keys()]
  const [names, organizations] = await Promise.all([repo.listNames(client, ids), repo.listPersonOrganizationIds(client, ids)])
  return ids.map((personId) => ({
    personId,
    displayName: displayName((names.get(personId) ?? []).find(isGenuineOpen)),
    reasons: [...(reasons.get(personId) as Set<PersonMatchReason>)],
    organizationIds: organizations.get(personId) ?? [],
  }))
}

// ---------------------------------------------------------------------------------------------------------------
// relationships
// ---------------------------------------------------------------------------------------------------------------

/**
 * Relates an EXISTING person to the Organization. Reuse is explicit: the caller names the person. Without
 * PERSON_REGISTRY_READ a person the caller cannot already see through this Organization is reported as not found.
 */
export async function addRelationship(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "personId", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = parseUuid(input.personId, "personId")
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  const person = (await lockPersons(ctx, [personId]).catch((error: unknown) => {
    if (error instanceof ContactNotFoundError) return undefined
    throw error
  }))?.get(personId)
  const visible = person !== undefined && ((await repo.personRelatedToOrganization(ctx.client, organizationId, personId)) || (await ctx.canViewRegistry()))
  if (!person || !visible) throw new ContactNotFoundError("Person")
  if (person.recordStatus !== "active") throw new ContactStateError("This person is archived; restore the person first.")
  if (await repo.getCurrentRelationship(ctx.client, organizationId, personId, true)) {
    throw new ContactConflictError("This person already has an open relationship with the Organization.")
  }
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  const relationshipId = randomUUID()
  await guarded(() => repo.insertRelationship(ctx.client, { id: relationshipId, organizationId, personId, effectiveFrom: at }))
  await record(ctx, "RECORD_LINK_ESTABLISHED", "addRelationship", { resourceType: "organization_person_relationship", resourceId: relationshipId, organizationId, personId }, [
    { field: "relationship", after: reference("organization_person_relationships", relationshipId) },
  ])
  return loadContact(ctx, organizationId, relationshipId)
}

/** The person left (real-world end). Open titles and purposes end at the same instant. Nothing is deleted. */
export async function endRelationship(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "relationshipId", "effectiveTo"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  const explicitInstant = optionalInstant(input.effectiveTo, "effectiveTo")

  const { relationship } = await lockManagedRelationship(ctx, organizationId, relationshipId)
  if (relationship.recordStatus !== "active" || relationship.effectiveTo !== null) throw new ContactStateError("This relationship has already ended.")
  const at = await resolveInstant(ctx, explicitInstant, "effectiveTo")

  const dependents = await repo.listOpenDependents(ctx.client, relationshipId)
  for (const title of dependents.titles) {
    await guarded(() => repo.endPeriod(ctx.client, "organization_person_titles", title.id, at))
    await record(ctx, "RECORD_UPDATED", "endRelationship", { resourceType: "organization_person_title", resourceId: title.id, organizationId, personId: relationship.personId }, [{ field: "effectiveTo", after: literal(at) }])
  }
  for (const assignment of dependents.assignments) {
    await guarded(() => repo.endPeriod(ctx.client, "contact_purpose_assignments", assignment.id, at))
    await record(ctx, "RECORD_LINK_REMOVED", "endRelationship", { resourceType: "contact_purpose_assignment", resourceId: assignment.id, organizationId, personId: relationship.personId }, [
      { field: "purpose", before: literal(assignment.purpose) },
      { field: "effectiveTo", after: literal(at) },
    ])
  }
  await guarded(() => repo.endPeriod(ctx.client, "organization_person_relationships", relationshipId, at))
  await record(ctx, "RECORD_LINK_REMOVED", "endRelationship", { resourceType: "organization_person_relationship", resourceId: relationshipId, organizationId, personId: relationship.personId }, [
    { field: "relationship", before: reference("organization_person_relationships", relationshipId) },
    { field: "effectiveTo", after: literal(at) },
  ])
  return loadContact(ctx, organizationId, relationshipId)
}

/** The relationship should never have existed (entered in error). Its dependents are voided with it; nothing is deleted. */
export async function voidRelationship(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "relationshipId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")

  const { relationship } = await lockManagedRelationship(ctx, organizationId, relationshipId)
  if (relationship.recordStatus !== "active") throw new ContactStateError("This relationship was already voided.")

  const dependents = await repo.listActiveDependentIds(ctx.client, relationshipId)
  for (const id of dependents.titleIds) await repo.markPeriod(ctx.client, "organization_person_titles", id, "voided", null)
  for (const id of dependents.assignmentIds) await repo.markPeriod(ctx.client, "contact_purpose_assignments", id, "voided", null)
  await repo.markPeriod(ctx.client, "organization_person_relationships", relationshipId, "voided", null)
  await record(ctx, "RECORD_CORRECTED", "voidRelationship", { resourceType: "organization_person_relationship", resourceId: relationshipId, organizationId, personId: relationship.personId }, [
    { field: "relationship", before: reference("organization_person_relationships", relationshipId), after: literal("voided") },
    ...dependents.titleIds.map((id, index) => ({ field: `voidedTitle${index}`, before: reference("organization_person_titles", id), after: literal("voided") })),
    ...dependents.assignmentIds.map((id, index) => ({ field: `voidedPurpose${index}`, before: reference("contact_purpose_assignments", id), after: literal("voided") })),
  ])
  return loadContact(ctx, organizationId, relationshipId)
}

// ---------------------------------------------------------------------------------------------------------------
// person name (real-world change vs correction)
// ---------------------------------------------------------------------------------------------------------------

async function nameMutation(ctx: OperationContext, rawInput: unknown, mode: "change" | "correct"): Promise<ContactView> {
  const keys = mode === "change" ? ["organizationId", "personId", "givenName", "familyName", "effectiveFrom"] : ["organizationId", "personId", "givenName", "familyName"]
  const input = requireObject(rawInput, "input", keys)
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = parseUuid(input.personId, "personId")
  if (input.givenName === undefined && input.familyName === undefined) throw new ContactValidationError("input", "Nothing to change.")
  const explicitInstant = mode === "change" ? optionalInstant(input.effectiveFrom, "effectiveFrom") : null

  await lockActiveOrganization(ctx, organizationId)
  await lockManagedPerson(ctx, organizationId, personId)
  const current = await repo.getCurrentName(ctx.client, personId, true)
  if (!current) throw new ContactNotFoundError("Name")
  const name = prepareName(input.givenName !== undefined ? input.givenName : current.givenName, input.familyName !== undefined ? input.familyName : current.familyName)
  if (name.givenName === current.givenName && name.familyName === current.familyName) throw new ContactValidationError("input", "The name is unchanged.")

  const replacementId = randomUUID()
  if (mode === "change") {
    const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
    await guarded(() => repo.endPeriod(ctx.client, "person_name_versions", current.id, at))
    await guarded(() => repo.insertName(ctx.client, { id: replacementId, personId, givenName: name.givenName, familyName: name.familyName, normalized: name.normalized, reason: "CHANGE", effectiveFrom: at }))
    await record(ctx, "RECORD_UPDATED", "changePersonName", { resourceType: "person_name_version", resourceId: replacementId, organizationId, personId }, [
      { field: "name", before: reference("person_name_versions", current.id), after: reference("person_name_versions", replacementId) },
    ])
  } else {
    await guarded(() => repo.markPeriod(ctx.client, "person_name_versions", current.id, "corrected", replacementId))
    await guarded(() => repo.insertName(ctx.client, { id: replacementId, personId, givenName: name.givenName, familyName: name.familyName, normalized: name.normalized, reason: "CORRECTION", effectiveFrom: current.effectiveFrom }))
    await record(ctx, "RECORD_CORRECTED", "correctPersonName", { resourceType: "person_name_version", resourceId: replacementId, organizationId, personId }, [
      { field: "name", before: reference("person_name_versions", current.id), after: reference("person_name_versions", replacementId) },
    ])
  }
  return contactForPerson(ctx, organizationId, personId)
}

/** The relationship view after a person-level change (the person's most recent relationship with the Organization). */
async function contactForPerson(ctx: OperationContext, organizationId: string, personId: string): Promise<ContactView> {
  const relationships = (await repo.listPersonRelationships(ctx.client, personId)).filter((row) => row.organizationId === organizationId && row.recordStatus === "active")
  const relationship = relationships.find(isGenuineOpen) ?? relationships[relationships.length - 1]
  if (!relationship) throw new ContactNotFoundError("Person")
  return (await loadContacts(ctx.client, [relationship], null))[0]
}

/** REAL-WORLD name change (for example after marriage): the previous name stays true history. */
export async function changePersonName(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  return nameMutation(ctx, rawInput, "change")
}

/** CORRECTION of a wrongly recorded name (a typo): the wrong name is preserved but never reported as history. */
export async function correctPersonName(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  return nameMutation(ctx, rawInput, "correct")
}

// ---------------------------------------------------------------------------------------------------------------
// channels (person and Organization share every rule)
// ---------------------------------------------------------------------------------------------------------------

type ChannelScope = {
  kind: "PERSON" | "ORGANIZATION"
  table: "person_channels" | "organization_channels"
  resourceType: "person_channel" | "organization_channel"
}

const PERSON_CHANNELS: ChannelScope = { kind: "PERSON", table: "person_channels", resourceType: "person_channel" }
const ORGANIZATION_CHANNELS: ChannelScope = { kind: "ORGANIZATION", table: "organization_channels", resourceType: "organization_channel" }

async function lockChannelOwner(ctx: OperationContext, scope: ChannelScope, organizationId: string, personId: string | null): Promise<void> {
  await lockActiveOrganization(ctx, organizationId)
  if (scope.kind === "PERSON") await lockManagedPerson(ctx, organizationId, personId as string)
}

async function getOpenChannel(ctx: OperationContext, scope: ChannelScope, organizationId: string, personId: string | null, channelId: string): Promise<ChannelRecord> {
  const channel =
    scope.kind === "PERSON"
      ? await repo.getOpenPersonChannel(ctx.client, personId as string, channelId, true)
      : await repo.getOpenOrganizationChannel(ctx.client, organizationId, channelId, true)
  if (!channel) throw new ContactNotFoundError("Channel")
  return channel
}

async function insertChannel(
  ctx: OperationContext,
  scope: ChannelScope,
  owner: { organizationId: string; personId: string | null },
  row: { id: string; channelType: ChannelType; usage: OrganizationChannelUsage | null; prepared: { display: string; normalized: string; ruleVersion: string; extension: string | null }; preferred: boolean; reason: "INITIAL" | "CHANGE" | "CORRECTION"; effectiveFrom: string },
): Promise<void> {
  const common = { id: row.id, channelType: row.channelType, display: row.prepared.display, normalized: row.prepared.normalized, ruleVersion: row.prepared.ruleVersion, extension: row.prepared.extension, preferred: row.preferred, reason: row.reason, effectiveFrom: row.effectiveFrom }
  if (scope.kind === "PERSON") await guarded(() => repo.insertPersonChannel(ctx.client, { ...common, personId: owner.personId as string }))
  else await guarded(() => repo.insertOrganizationChannel(ctx.client, { ...common, organizationId: owner.organizationId, usage: row.usage as OrganizationChannelUsage }))
}

async function channelView(ctx: OperationContext, scope: ChannelScope, organizationId: string, personId: string | null): Promise<ContactView | OrganizationContactsView> {
  return scope.kind === "PERSON" ? contactForPerson(ctx, organizationId, personId as string) : readOrganizationContacts(ctx.client, organizationId)
}

async function addChannel(ctx: OperationContext, rawInput: unknown, scope: ChannelScope): Promise<ContactView | OrganizationContactsView> {
  const person = scope.kind === "PERSON"
  const input = requireObject(rawInput, "input", person ? ["organizationId", "personId", "channel", "effectiveFrom"] : ["organizationId", "channel", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = person ? parseUuid(input.personId, "personId") : null
  const parsed = parseChannelInput(input.channel, "channel", !person)
  const prepared = prepareChannel(parsed.type, parsed.raw, parsed.extension, "channel.value")
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockChannelOwner(ctx, scope, organizationId, personId)
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  const id = randomUUID()
  await insertChannel(ctx, scope, { organizationId, personId }, { id, channelType: parsed.type, usage: parsed.usage, prepared, preferred: parsed.preferred, reason: "INITIAL", effectiveFrom: at })
  await record(ctx, "RECORD_CREATED", scope.kind === "PERSON" ? "addPersonChannel" : "addOrganizationChannel", { resourceType: scope.resourceType, resourceId: id, organizationId, personId: personId ?? undefined }, [
    { field: "channel", after: reference(scope.table, id) },
    { field: "channelType", after: literal(parsed.type) },
    ...(parsed.usage ? [{ field: "usage", after: literal(parsed.usage) }] : []),
    { field: "preferred", after: literal(parsed.preferred) },
  ])
  return channelView(ctx, scope, organizationId, personId)
}

async function replaceChannel(ctx: OperationContext, rawInput: unknown, scope: ChannelScope, mode: "change" | "correct"): Promise<ContactView | OrganizationContactsView> {
  const person = scope.kind === "PERSON"
  const keys = [...(person ? ["organizationId", "personId"] : ["organizationId"]), "channelId", "value", "extension", "preferred", ...(mode === "change" ? ["effectiveFrom"] : [])]
  const input = requireObject(rawInput, "input", keys)
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = person ? parseUuid(input.personId, "personId") : null
  const channelId = parseUuid(input.channelId, "channelId")
  if (input.value === undefined && input.extension === undefined && input.preferred === undefined) throw new ContactValidationError("input", "Nothing to change.")
  const explicitInstant = mode === "change" ? optionalInstant(input.effectiveFrom, "effectiveFrom") : null

  await lockChannelOwner(ctx, scope, organizationId, personId)
  const current = await getOpenChannel(ctx, scope, organizationId, personId, channelId)
  const prepared =
    input.value !== undefined || input.extension !== undefined
      ? prepareChannel(current.channelType, input.value !== undefined ? input.value : current.valueDisplay, input.extension !== undefined ? input.extension : current.extension ?? undefined, "value")
      : { display: current.valueDisplay, normalized: current.valueNormalized, ruleVersion: current.normalizationRuleVersion, extension: current.extension }
  const preferred = parseBoolean(input.preferred, "preferred", current.isPreferred)
  if (prepared.normalized === current.valueNormalized && prepared.display === current.valueDisplay && prepared.extension === current.extension && preferred === current.isPreferred) {
    throw new ContactValidationError("input", "The channel is unchanged.")
  }

  const replacementId = randomUUID()
  const owner = { organizationId, personId }
  const operation = `${mode}${scope.kind === "PERSON" ? "PersonChannel" : "OrganizationChannel"}`
  if (mode === "change") {
    const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
    await guarded(() => repo.endPeriod(ctx.client, scope.table, current.id, at))
    await insertChannel(ctx, scope, owner, { id: replacementId, channelType: current.channelType, usage: current.usage, prepared, preferred, reason: "CHANGE", effectiveFrom: at })
  } else {
    await guarded(() => repo.markPeriod(ctx.client, scope.table, current.id, "corrected", replacementId))
    await insertChannel(ctx, scope, owner, { id: replacementId, channelType: current.channelType, usage: current.usage, prepared, preferred, reason: "CORRECTION", effectiveFrom: current.effectiveFrom })
  }
  await record(ctx, mode === "change" ? "RECORD_UPDATED" : "RECORD_CORRECTED", operation, { resourceType: scope.resourceType, resourceId: replacementId, organizationId, personId: personId ?? undefined }, [
    { field: "channel", before: reference(scope.table, current.id), after: reference(scope.table, replacementId) },
  ])
  return channelView(ctx, scope, organizationId, personId)
}

async function closeChannel(ctx: OperationContext, rawInput: unknown, scope: ChannelScope, mode: "end" | "void"): Promise<ContactView | OrganizationContactsView> {
  const person = scope.kind === "PERSON"
  const keys = [...(person ? ["organizationId", "personId"] : ["organizationId"]), "channelId", ...(mode === "end" ? ["effectiveTo"] : [])]
  const input = requireObject(rawInput, "input", keys)
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = person ? parseUuid(input.personId, "personId") : null
  const channelId = parseUuid(input.channelId, "channelId")
  const explicitInstant = mode === "end" ? optionalInstant(input.effectiveTo, "effectiveTo") : null

  await lockChannelOwner(ctx, scope, organizationId, personId)
  const current = await getOpenChannel(ctx, scope, organizationId, personId, channelId)
  const operation = `${mode}${scope.kind === "PERSON" ? "PersonChannel" : "OrganizationChannel"}`
  if (mode === "end") {
    const at = await resolveInstant(ctx, explicitInstant, "effectiveTo")
    await guarded(() => repo.endPeriod(ctx.client, scope.table, current.id, at))
    await record(ctx, "RECORD_UPDATED", operation, { resourceType: scope.resourceType, resourceId: current.id, organizationId, personId: personId ?? undefined }, [{ field: "effectiveTo", after: literal(at) }])
  } else {
    await repo.markPeriod(ctx.client, scope.table, current.id, "voided", null)
    await record(ctx, "RECORD_CORRECTED", operation, { resourceType: scope.resourceType, resourceId: current.id, organizationId, personId: personId ?? undefined }, [
      { field: "channel", before: reference(scope.table, current.id), after: literal("voided") },
    ])
  }
  return channelView(ctx, scope, organizationId, personId)
}

export const addPersonChannel = (ctx: OperationContext, raw: unknown) => addChannel(ctx, raw, PERSON_CHANNELS) as Promise<ContactView>
export const changePersonChannel = (ctx: OperationContext, raw: unknown) => replaceChannel(ctx, raw, PERSON_CHANNELS, "change") as Promise<ContactView>
export const correctPersonChannel = (ctx: OperationContext, raw: unknown) => replaceChannel(ctx, raw, PERSON_CHANNELS, "correct") as Promise<ContactView>
export const endPersonChannel = (ctx: OperationContext, raw: unknown) => closeChannel(ctx, raw, PERSON_CHANNELS, "end") as Promise<ContactView>
export const voidPersonChannel = (ctx: OperationContext, raw: unknown) => closeChannel(ctx, raw, PERSON_CHANNELS, "void") as Promise<ContactView>

export const addOrganizationChannel = (ctx: OperationContext, raw: unknown) => addChannel(ctx, raw, ORGANIZATION_CHANNELS) as Promise<OrganizationContactsView>
export const changeOrganizationChannel = (ctx: OperationContext, raw: unknown) => replaceChannel(ctx, raw, ORGANIZATION_CHANNELS, "change") as Promise<OrganizationContactsView>
export const correctOrganizationChannel = (ctx: OperationContext, raw: unknown) => replaceChannel(ctx, raw, ORGANIZATION_CHANNELS, "correct") as Promise<OrganizationContactsView>
export const endOrganizationChannel = (ctx: OperationContext, raw: unknown) => closeChannel(ctx, raw, ORGANIZATION_CHANNELS, "end") as Promise<OrganizationContactsView>
export const voidOrganizationChannel = (ctx: OperationContext, raw: unknown) => closeChannel(ctx, raw, ORGANIZATION_CHANNELS, "void") as Promise<OrganizationContactsView>

// ---------------------------------------------------------------------------------------------------------------
// titles (history, never identity, never authorization)
// ---------------------------------------------------------------------------------------------------------------

export async function addTitle(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "relationshipId", "title", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  const title = prepareTitle(input.title)
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const { relationship, person } = await lockManagedRelationship(ctx, organizationId, relationshipId)
  requireOpenRelationship(relationship, person)
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  const id = randomUUID()
  await guarded(() => repo.insertTitle(ctx.client, { id, relationshipId, organizationId, personId: relationship.personId, display: title.display, normalized: title.normalized, reason: "INITIAL", effectiveFrom: at }))
  await record(ctx, "RECORD_CREATED", "addTitle", { resourceType: "organization_person_title", resourceId: id, organizationId, personId: relationship.personId }, [
    { field: "title", after: reference("organization_person_titles", id) },
  ])
  return loadContact(ctx, organizationId, relationshipId)
}

async function openTitle(ctx: OperationContext, organizationId: string, titleId: string): Promise<{ title: TitleRecord; relationship: RelationshipRecord; person: PersonRecord }> {
  await lockActiveOrganization(ctx, organizationId)
  const peek = await repo.getOpenTitle(ctx.client, organizationId, titleId)
  if (!peek) throw new ContactNotFoundError("Title")
  const relationshipPeek = await repo.getRelationship(ctx.client, organizationId, peek.relationshipId)
  if (!relationshipPeek) throw new ContactNotFoundError("Title")
  const person = (await lockPersons(ctx, [relationshipPeek.personId])).get(relationshipPeek.personId) as PersonRecord
  const relationship = (await repo.getRelationship(ctx.client, organizationId, peek.relationshipId, true)) as RelationshipRecord
  const title = await repo.getOpenTitle(ctx.client, organizationId, titleId, true)
  if (!title) throw new ContactNotFoundError("Title")
  return { title, relationship, person }
}

/** REAL-WORLD change (a promotion): the previous title stays true history. */
export async function changeTitle(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "titleId", "title", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const titleId = parseUuid(input.titleId, "titleId")
  const next = prepareTitle(input.title)
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const { title, relationship, person } = await openTitle(ctx, organizationId, titleId)
  requireOpenRelationship(relationship, person)
  if (next.display === title.titleDisplay) throw new ContactValidationError("title", "The title is unchanged.")
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  const replacementId = randomUUID()
  await guarded(() => repo.endPeriod(ctx.client, "organization_person_titles", title.id, at))
  await guarded(() => repo.insertTitle(ctx.client, { id: replacementId, relationshipId: relationship.id, organizationId, personId: relationship.personId, display: next.display, normalized: next.normalized, reason: "CHANGE", effectiveFrom: at }))
  await record(ctx, "RECORD_UPDATED", "changeTitle", { resourceType: "organization_person_title", resourceId: replacementId, organizationId, personId: relationship.personId }, [
    { field: "title", before: reference("organization_person_titles", title.id), after: reference("organization_person_titles", replacementId) },
  ])
  return loadContact(ctx, organizationId, relationship.id)
}

/** CORRECTION of a wrongly recorded title (a typo): the wrong title is preserved but never reported as history. */
export async function correctTitle(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "titleId", "title"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const titleId = parseUuid(input.titleId, "titleId")
  const next = prepareTitle(input.title)

  const { title, relationship, person } = await openTitle(ctx, organizationId, titleId)
  requireOpenRelationship(relationship, person)
  if (next.display === title.titleDisplay) throw new ContactValidationError("title", "The title is unchanged.")
  const replacementId = randomUUID()
  await guarded(() => repo.markPeriod(ctx.client, "organization_person_titles", title.id, "corrected", replacementId))
  await guarded(() => repo.insertTitle(ctx.client, { id: replacementId, relationshipId: relationship.id, organizationId, personId: relationship.personId, display: next.display, normalized: next.normalized, reason: "CORRECTION", effectiveFrom: title.effectiveFrom }))
  await record(ctx, "RECORD_CORRECTED", "correctTitle", { resourceType: "organization_person_title", resourceId: replacementId, organizationId, personId: relationship.personId }, [
    { field: "title", before: reference("organization_person_titles", title.id), after: reference("organization_person_titles", replacementId) },
  ])
  return loadContact(ctx, organizationId, relationship.id)
}

export async function endTitle(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "titleId", "effectiveTo"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const titleId = parseUuid(input.titleId, "titleId")
  const explicitInstant = optionalInstant(input.effectiveTo, "effectiveTo")

  const { title, relationship } = await openTitle(ctx, organizationId, titleId)
  const at = await resolveInstant(ctx, explicitInstant, "effectiveTo")
  await guarded(() => repo.endPeriod(ctx.client, "organization_person_titles", title.id, at))
  await record(ctx, "RECORD_UPDATED", "endTitle", { resourceType: "organization_person_title", resourceId: title.id, organizationId, personId: relationship.personId }, [{ field: "effectiveTo", after: literal(at) }])
  return loadContact(ctx, organizationId, relationship.id)
}

export async function voidTitle(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "titleId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const titleId = parseUuid(input.titleId, "titleId")

  const { title, relationship } = await openTitle(ctx, organizationId, titleId)
  await repo.markPeriod(ctx.client, "organization_person_titles", title.id, "voided", null)
  await record(ctx, "RECORD_CORRECTED", "voidTitle", { resourceType: "organization_person_title", resourceId: title.id, organizationId, personId: relationship.personId }, [
    { field: "title", before: reference("organization_person_titles", title.id), after: literal("voided") },
  ])
  return loadContact(ctx, organizationId, relationship.id)
}

// ---------------------------------------------------------------------------------------------------------------
// contact purposes
// ---------------------------------------------------------------------------------------------------------------

export async function assignPurpose(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "relationshipId", "purpose", "primary", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  if (!isContactPurpose(input.purpose)) throw new ContactValidationError("purpose", "Unknown contact purpose.")
  const purpose = input.purpose
  const primary = resolvePrimary(purpose, input.primary, "primary")
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const { relationship, person } = await lockManagedRelationship(ctx, organizationId, relationshipId)
  requireOpenRelationship(relationship, person)
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  const id = randomUUID()
  await guarded(() => repo.insertAssignment(ctx.client, { id, relationshipId, organizationId, personId: relationship.personId, purpose, primary, reason: "INITIAL", effectiveFrom: at }))
  await record(ctx, "RECORD_LINK_ESTABLISHED", "assignPurpose", { resourceType: "contact_purpose_assignment", resourceId: id, organizationId, personId: relationship.personId }, [
    { field: "purpose", after: literal(purpose) },
    { field: "primary", after: literal(primary) },
  ])
  return loadContact(ctx, organizationId, relationshipId)
}

async function openAssignment(ctx: OperationContext, organizationId: string, assignmentId: string): Promise<{ assignment: PurposeAssignmentRecord; relationship: RelationshipRecord; person: PersonRecord }> {
  await lockActiveOrganization(ctx, organizationId)
  const peek = await repo.getOpenAssignment(ctx.client, organizationId, assignmentId)
  if (!peek) throw new ContactNotFoundError("Purpose assignment")
  const relationshipPeek = await repo.getRelationship(ctx.client, organizationId, peek.relationshipId)
  if (!relationshipPeek) throw new ContactNotFoundError("Purpose assignment")
  const person = (await lockPersons(ctx, [relationshipPeek.personId])).get(relationshipPeek.personId) as PersonRecord
  const relationship = (await repo.getRelationship(ctx.client, organizationId, peek.relationshipId, true)) as RelationshipRecord
  const assignment = await repo.getOpenAssignment(ctx.client, organizationId, assignmentId, true)
  if (!assignment) throw new ContactNotFoundError("Purpose assignment")
  return { assignment, relationship, person }
}

export async function endPurpose(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "assignmentId", "effectiveTo"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const assignmentId = parseUuid(input.assignmentId, "assignmentId")
  const explicitInstant = optionalInstant(input.effectiveTo, "effectiveTo")

  const { assignment, relationship } = await openAssignment(ctx, organizationId, assignmentId)
  const at = await resolveInstant(ctx, explicitInstant, "effectiveTo")
  await guarded(() => repo.endPeriod(ctx.client, "contact_purpose_assignments", assignment.id, at))
  await record(ctx, "RECORD_LINK_REMOVED", "endPurpose", { resourceType: "contact_purpose_assignment", resourceId: assignment.id, organizationId, personId: relationship.personId }, [
    { field: "purpose", before: literal(assignment.purpose) },
    { field: "effectiveTo", after: literal(at) },
  ])
  return loadContact(ctx, organizationId, relationship.id)
}

export async function voidPurpose(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "assignmentId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const assignmentId = parseUuid(input.assignmentId, "assignmentId")

  const { assignment, relationship } = await openAssignment(ctx, organizationId, assignmentId)
  await repo.markPeriod(ctx.client, "contact_purpose_assignments", assignment.id, "voided", null)
  await record(ctx, "RECORD_CORRECTED", "voidPurpose", { resourceType: "contact_purpose_assignment", resourceId: assignment.id, organizationId, personId: relationship.personId }, [
    { field: "purpose", before: literal(assignment.purpose), after: literal("voided") },
  ])
  return loadContact(ctx, organizationId, relationship.id)
}

/**
 * Makes the named contact the PRIMARY for a purpose, a real-world change. The previous primary keeps serving the
 * purpose as a non-primary (their row is ended and restarted without the flag); the new primary's row is ended and
 * restarted with it. Everything happens in one transaction, so there is never a moment with two primaries or none.
 */
export async function makePrimary(ctx: OperationContext, rawInput: unknown): Promise<ContactView> {
  const input = requireObject(rawInput, "input", ["organizationId", "relationshipId", "purpose", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const relationshipId = parseUuid(input.relationshipId, "relationshipId")
  if (!isContactPurpose(input.purpose)) throw new ContactValidationError("purpose", "Unknown contact purpose.")
  const purpose = input.purpose
  if ((PURPOSE_DEFINITIONS[purpose].primaryMode as string) === "NONE") throw new ContactValidationError("purpose", `${purpose} cannot have a primary contact.`)
  const explicitInstant = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  const mine = await repo.getRelationship(ctx.client, organizationId, relationshipId)
  if (!mine) throw new ContactNotFoundError("Relationship")
  const incumbentPeek = await repo.getCurrentPrimary(ctx.client, organizationId, purpose)
  const incumbentRelationshipPeek = incumbentPeek ? await repo.getRelationship(ctx.client, organizationId, incumbentPeek.relationshipId) : undefined
  const persons = await lockPersons(ctx, [mine.personId, ...(incumbentRelationshipPeek ? [incumbentRelationshipPeek.personId] : [])])
  const relationship = (await repo.getRelationship(ctx.client, organizationId, relationshipId, true)) as RelationshipRecord
  requireOpenRelationship(relationship, persons.get(mine.personId) as PersonRecord)
  const incumbent = await repo.getCurrentPrimary(ctx.client, organizationId, purpose, true)

  if (incumbent?.relationshipId === relationshipId) throw new ContactStateError("This contact is already the primary for the purpose.")
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")

  if (incumbent) {
    await guarded(() => repo.endPeriod(ctx.client, "contact_purpose_assignments", incumbent.id, at))
    if ((PURPOSE_DEFINITIONS[purpose].primaryMode as string) === "OPTIONAL") {
      const demotedId = randomUUID()
      await guarded(() => repo.insertAssignment(ctx.client, { id: demotedId, relationshipId: incumbent.relationshipId, organizationId, personId: (incumbentRelationshipPeek as RelationshipRecord).personId, purpose, primary: false, reason: "CHANGE", effectiveFrom: at }))
    }
  }
  const existing = await repo.getOpenAssignmentFor(ctx.client, relationshipId, purpose, true)
  if (existing) await guarded(() => repo.endPeriod(ctx.client, "contact_purpose_assignments", existing.id, at))
  const promotedId = randomUUID()
  await guarded(() => repo.insertAssignment(ctx.client, { id: promotedId, relationshipId, organizationId, personId: relationship.personId, purpose, primary: true, reason: "CHANGE", effectiveFrom: at }))
  await record(ctx, "RECORD_UPDATED", "makePrimary", { resourceType: "contact_purpose_assignment", resourceId: promotedId, organizationId, personId: relationship.personId }, [
    { field: "purpose", after: literal(purpose) },
    { field: "primary", before: literal(existing?.isPrimary ?? false), after: literal(true) },
    ...(incumbent ? [{ field: "previousPrimary", before: reference("contact_purpose_assignments", incumbent.id) }] : []),
  ])
  return loadContact(ctx, organizationId, relationshipId)
}

// ---------------------------------------------------------------------------------------------------------------
// archive / restore a person (record lifecycle)
// ---------------------------------------------------------------------------------------------------------------

export async function archivePerson(ctx: OperationContext, rawInput: unknown): Promise<PersonRecord> {
  const input = requireObject(rawInput, "input", ["organizationId", "personId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = parseUuid(input.personId, "personId")

  await lockActiveOrganization(ctx, organizationId)
  const person = await lockManagedPerson(ctx, organizationId, personId, { allowArchived: true })
  if (person.recordStatus === "archived") throw new ContactStateError("This person is already archived.")
  if ((await repo.listPersonRelationships(ctx.client, personId)).some(isGenuineOpen)) {
    throw new ContactStateError("End the person's current relationships before archiving the person.")
  }
  await guarded(() => repo.setPersonRecordStatus(ctx.client, personId, "archived"))
  await record(ctx, "RECORD_ARCHIVED", "archivePerson", { resourceType: "person", resourceId: personId, organizationId, personId }, [
    { field: "recordStatus", before: literal("active"), after: literal("archived") },
  ])
  return (await repo.lockPerson(ctx.client, personId)) as PersonRecord
}

export async function restorePerson(ctx: OperationContext, rawInput: unknown): Promise<PersonRecord> {
  const input = requireObject(rawInput, "input", ["organizationId", "personId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const personId = parseUuid(input.personId, "personId")

  await lockActiveOrganization(ctx, organizationId)
  const person = await lockManagedPerson(ctx, organizationId, personId, { allowArchived: true })
  if (person.recordStatus !== "archived") throw new ContactStateError("Only an archived person can be restored.")
  await repo.setPersonRecordStatus(ctx.client, personId, "active")
  await record(ctx, "RECORD_RESTORED", "restorePerson", { resourceType: "person", resourceId: personId, organizationId, personId }, [
    { field: "recordStatus", before: literal("archived"), after: literal("active") },
  ])
  return (await repo.lockPerson(ctx.client, personId)) as PersonRecord
}
