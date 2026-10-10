/**
 * Corporate Identity domain operations.
 *
 * Every operation runs on the transaction client the authorization wrapper checked out and records its Master Register
 * event through a repository bound to that SAME client, so the business mutation and its accountability commit or roll
 * back together. Authorization has already happened when these run; they authorize nothing themselves except the one
 * secondary capability (ORGANIZATION_REGISTRY_READ) that decides whether a collision may name the matched Organization,
 * supplied as `canViewRegistry` and evaluated lazily on the same client.
 *
 * No "server-only" import: this module is plain domain logic so it is testable under Node. The server-only boundary is
 * service.ts.
 */

import type { PoolClient } from "pg"
import {
  CorporateIdentifierCollisionError,
  CorporateIdentityConflictError,
  CorporateIdentityNotFoundError,
  CorporateIdentityStateError,
  CorporateIdentityValidationError,
  type CollisionMatch,
} from "@/lib/corporate-identity/errors"
import {
  collisionKey,
  identifierJurisdiction,
  prepareCorporateIdentifier,
  type PreparedCorporateIdentifier,
} from "@/lib/corporate-identity/identifier-definitions"
import {
  parseCountryCode,
  parseOptionalRegion,
  sameJurisdiction,
  type Jurisdiction,
} from "@/lib/corporate-identity/jurisdiction"
import { cleanDisplayText, normalizeBusinessName } from "@/lib/corporate-identity/normalization"
import * as repo from "@/lib/corporate-identity/repository"
import {
  ALIAS_TYPES,
  type AliasType,
  type CreateOrganizationInput,
  type CreateOrganizationResult,
  type MutationResult,
  type OrganizationRecord,
  type ReviewMatch,
  type UpdateLegalIdentityInput,
} from "@/lib/corporate-identity/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor may see matched Organization details (ORGANIZATION_REGISTRY_READ). */
  canViewRegistry: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new CorporateIdentityValidationError(field, `${field} must be an object.`)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new CorporateIdentityValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }
  return value
}

function requireArray(value: unknown, field: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new CorporateIdentityValidationError(field, `${field} must be an array.`)
  return value
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new CorporateIdentityValidationError(field, `${field} must be a UUID.`)
}

function parseFormation(value: unknown, field: string): Jurisdiction | null {
  if (value === undefined || value === null) return null
  const object = requireObject(value, field, ["country", "region"])
  const country = parseCountryCode(object.country, `${field}.country`)
  const region = parseOptionalRegion(country, object.region, `${field}.region`)
  if (country === "US" && region === null) {
    throw new CorporateIdentityValidationError(`${field}.region`, `${field}.region is required for a US formation.`)
  }
  return { country, region }
}

function parseAlias(value: unknown, field: string): { alias: string; normalizedAlias: string; aliasType: AliasType } {
  const object = requireObject(value, field, ["alias", "aliasType"])
  const aliasType = object.aliasType
  if (typeof aliasType !== "string" || !(ALIAS_TYPES as readonly string[]).includes(aliasType)) {
    throw new CorporateIdentityValidationError(`${field}.aliasType`, `${field}.aliasType must be one of ${ALIAS_TYPES.join(", ")}.`)
  }
  const alias = cleanDisplayText(object.alias, `${field}.alias`)
  return {
    alias,
    normalizedAlias: normalizeBusinessName(alias, `${field}.alias`),
    aliasType: aliasType as AliasType,
  }
}

/** Persisted alias_type values are the lower-case form of the typed code. */
const persistedAliasType = (type: AliasType): string => type.toLowerCase()

function parseClassification(value: unknown, field: string): { code: string; isPrimary: boolean } {
  const object = requireObject(value, field, ["code", "isPrimary"])
  if (typeof object.code !== "string" || object.code.trim() === "") {
    throw new CorporateIdentityValidationError(`${field}.code`, `${field}.code is required.`)
  }
  if (object.isPrimary !== undefined && typeof object.isPrimary !== "boolean") {
    throw new CorporateIdentityValidationError(`${field}.isPrimary`, `${field}.isPrimary must be a boolean.`)
  }
  return { code: object.code.trim(), isPrimary: object.isPrimary === true }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName =
  | "ORGANIZATION_CREATED"
  | "ORGANIZATION_STATUS_CHANGED"
  | "RECORD_CREATED"
  | "RECORD_UPDATED"
  | "RECORD_CORRECTED"
  | "RECORD_STATUS_CHANGED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({
  kind: "LITERAL",
  value,
})
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({
  kind: "REFERENCE",
  reference: `${table}:${id}`,
})

/**
 * Identifier VALUES (tax and registry numbers) are never copied into the Master Register: the event carries a reference
 * to the organization_identifiers row, which is the record of what the value was.
 */
async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: { resourceType: string; resourceId: string; organizationId: string },
  fieldChanges: FieldChange[],
  reason?: string,
): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      subjectReferences: [`organization:${target.organizationId}`],
    },
    source: { sourceType: "APPLICATION", component: "corporate-identity", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: reason === undefined ? { result: "SUCCESS" } : { result: "SUCCESS", reason },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Collision handling
// ---------------------------------------------------------------------------------------------------------------

function toMatch(row: repo.CollisionRow): CollisionMatch {
  return {
    organizationId: row.organizationId,
    legalName: row.legalName,
    displayName: row.displayName,
    status: row.organizationStatus,
    mergedIntoOrganizationId: row.mergedIntoOrganizationId,
    identifierId: row.identifierId,
    recommendedAction:
      row.organizationStatus === "archived"
        ? "RESTORE_ARCHIVED"
        : row.organizationStatus === "merged"
          ? "USE_SURVIVOR"
          : "OPEN_EXISTING",
  }
}

async function collisionError(
  ctx: OperationContext,
  prepared: PreparedCorporateIdentifier,
  row: repo.CollisionRow | undefined,
): Promise<CorporateIdentifierCollisionError> {
  const disclose = row !== undefined && (await ctx.canViewRegistry())
  return new CorporateIdentifierCollisionError(prepared.kind, disclose && row ? toMatch(row) : undefined)
}

/** Explanatory pre-check on the same transaction. The unique index remains the final arbiter (see insertGuarded). */
async function assertNoActiveCollision(ctx: OperationContext, prepared: PreparedCorporateIdentifier): Promise<void> {
  const row = await repo.findActiveIdentifierCollision(ctx.client, prepared)
  if (row) throw await collisionError(ctx, prepared, row)
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505" &&
    (error as { constraint?: unknown }).constraint === constraint
  )
}

/**
 * Inserts an identifier under a savepoint so a unique violation from a concurrent writer (which the pre-check cannot
 * see) can be turned into the same collision result instead of an aborted transaction. Any other error propagates.
 */
async function insertGuarded(
  ctx: OperationContext,
  organizationId: string,
  prepared: PreparedCorporateIdentifier,
): Promise<ReturnType<typeof repo.insertIdentifier>> {
  await ctx.client.query("SAVEPOINT tes_corporate_identifier")
  try {
    const inserted = await repo.insertIdentifier(ctx.client, organizationId, prepared)
    await ctx.client.query("RELEASE SAVEPOINT tes_corporate_identifier")
    return inserted
  } catch (error) {
    if (!isUniqueViolation(error, repo.IDENTIFIER_COLLISION_CONSTRAINT)) throw error
    await ctx.client.query("ROLLBACK TO SAVEPOINT tes_corporate_identifier")
    const winner = await repo.findActiveIdentifierCollision(ctx.client, prepared)
    throw await collisionError(ctx, prepared, winner)
  }
}

/** Superseded rows are review evidence, disclosed only to callers who may read the registry. */
async function reviewMatchesFor(
  ctx: OperationContext,
  identifiers: PreparedCorporateIdentifier[],
  ownOrganizationId: string | null,
): Promise<ReviewMatch[]> {
  if (identifiers.length === 0 || !(await ctx.canViewRegistry())) return []
  const matches: ReviewMatch[] = []
  for (const prepared of identifiers) {
    for (const found of await repo.findSupersededIdentifierMatches(ctx.client, prepared)) {
      if (found.organizationId === ownOrganizationId) continue
      matches.push({
        kind: "SUPERSEDED_IDENTIFIER",
        organizationId: found.organizationId,
        legalName: found.legalName,
        identifierKind: prepared.kind,
      })
    }
  }
  return matches
}

// ---------------------------------------------------------------------------------------------------------------
// Organization state
// ---------------------------------------------------------------------------------------------------------------

async function lockActiveOrganization(ctx: OperationContext, organizationId: string): Promise<repo.OrganizationCore> {
  const core = await repo.lockOrganization(ctx.client, organizationId)
  if (!core) throw new CorporateIdentityNotFoundError()
  if (core.status === "merged") {
    throw new CorporateIdentityStateError("This Organization has been merged; it can no longer be changed.")
  }
  if (core.status === "archived") {
    throw new CorporateIdentityStateError("This Organization is archived; restore it before changing it.")
  }
  return core
}

async function loadResult(ctx: OperationContext, organizationId: string, reviewMatches: ReviewMatch[]): Promise<MutationResult> {
  const organization = await repo.loadOrganization(ctx.client, organizationId)
  if (!organization) throw new CorporateIdentityNotFoundError()
  return { organization, reviewMatches }
}

export async function readOrganization(client: PoolClient, organizationId: string): Promise<OrganizationRecord> {
  const id = requireUuid(organizationId, "organizationId")
  const organization = await repo.loadOrganization(client, id)
  if (!organization) throw new CorporateIdentityNotFoundError()
  return organization
}

/**
 * Whether an identifier may attach to an Organization with this formation. Returns a formation to adopt when the
 * Organization has none and the identifier is its incorporation.
 */
function assertIdentifierFitsOrganization(
  formation: Jurisdiction | null,
  prepared: PreparedCorporateIdentifier,
  field: string,
): Jurisdiction | null {
  const jurisdiction = identifierJurisdiction(prepared)
  if (prepared.kind === "INCORPORATION" && jurisdiction) {
    if (formation === null) return jurisdiction
    if (!sameJurisdiction(formation, jurisdiction)) {
      throw new CorporateIdentityValidationError(
        field,
        "An incorporation identifier must be registered in the Organization's formation jurisdiction.",
      )
    }
  }
  if (prepared.kind === "EXTRA_PROVINCIAL_REGISTRATION" && jurisdiction && formation && sameJurisdiction(formation, jurisdiction)) {
    throw new CorporateIdentityValidationError(
      field,
      "An extra-provincial registration cannot be in the Organization's own formation jurisdiction.",
    )
  }
  return null
}

const formationOf = (core: repo.OrganizationCore): Jurisdiction | null =>
  core.formationCountry === null
    ? null
    : { country: core.formationCountry as Jurisdiction["country"], region: core.formationRegion }

// ---------------------------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------------------------

export async function createOrganization(ctx: OperationContext, rawInput: unknown): Promise<CreateOrganizationResult> {
  const input = requireObject(rawInput, "input", [
    "legalName",
    "displayName",
    "formation",
    "identifiers",
    "aliases",
    "classifications",
  ]) as Partial<CreateOrganizationInput> & Record<string, unknown>

  const legalName = cleanDisplayText(input.legalName, "legalName")
  const displayName =
    input.displayName === undefined || input.displayName === null ? null : cleanDisplayText(input.displayName, "displayName")
  const normalizedLegalName = normalizeBusinessName(legalName, "legalName")

  const identifiers = requireArray(input.identifiers, "identifiers").map((item, index) =>
    prepareCorporateIdentifier(item, `identifiers[${index}]`),
  )
  const seenKeys = new Set<string>()
  for (const prepared of identifiers) {
    const key = collisionKey(prepared)
    if (seenKeys.has(key)) {
      throw new CorporateIdentityValidationError("identifiers", "The same corporate identifier is listed more than once.")
    }
    seenKeys.add(key)
  }
  const incorporations = identifiers.filter((prepared) => prepared.kind === "INCORPORATION")
  if (incorporations.length > 1) {
    throw new CorporateIdentityValidationError("identifiers", "An Organization has one incorporation identifier.")
  }

  let formation = parseFormation(input.formation, "formation")
  if (incorporations[0]) {
    const adopted = assertIdentifierFitsOrganization(formation, incorporations[0], "identifiers")
    if (adopted) formation = adopted
  }
  for (const prepared of identifiers) assertIdentifierFitsOrganization(formation, prepared, "identifiers")

  const aliases = requireArray(input.aliases, "aliases").map((item, index) => parseAlias(item, `aliases[${index}]`))
  const aliasKeys = new Set<string>()
  for (const alias of aliases) {
    const key = `${alias.aliasType}|${alias.normalizedAlias}`
    if (aliasKeys.has(key)) throw new CorporateIdentityValidationError("aliases", "The same alias is listed more than once.")
    aliasKeys.add(key)
  }

  const classifications = requireArray(input.classifications, "classifications").map((item, index) =>
    parseClassification(item, `classifications[${index}]`),
  )
  const classificationCodes = new Set<string>()
  for (const classification of classifications) {
    if (classificationCodes.has(classification.code)) {
      throw new CorporateIdentityValidationError("classifications", "The same classification is listed more than once.")
    }
    classificationCodes.add(classification.code)
  }
  if (classifications.filter((classification) => classification.isPrimary).length > 1) {
    throw new CorporateIdentityValidationError("classifications", "Only one classification can be primary.")
  }
  for (const classification of classifications) {
    if (!(await repo.isActiveClassificationCode(ctx.client, classification.code))) {
      throw new CorporateIdentityValidationError("classifications", `"${classification.code}" is not a known classification.`)
    }
  }

  // Authoritative-identifier collisions are checked before anything is written.
  for (const prepared of identifiers) await assertNoActiveCollision(ctx, prepared)

  const organizationId = await repo.insertOrganization(ctx.client, {
    legalName,
    displayName,
    normalizedLegalName,
    formationCountry: formation?.country ?? null,
    formationRegion: formation?.region ?? null,
  })

  const changes: FieldChange[] = [{ field: "legalName", after: literal(legalName) }]
  if (displayName !== null) changes.push({ field: "displayName", after: literal(displayName) })
  if (formation) {
    changes.push({ field: "formationCountry", after: literal(formation.country) })
    if (formation.region) changes.push({ field: "formationRegion", after: literal(formation.region) })
  }

  for (const prepared of identifiers) {
    const inserted = await insertGuarded(ctx, organizationId, prepared)
    changes.push({ field: `identifier:${prepared.kind}`, after: reference("organization_identifiers", inserted.id) })
  }
  for (const alias of aliases) {
    const inserted = await repo.insertAlias(ctx.client, organizationId, {
      alias: alias.alias,
      normalizedAlias: alias.normalizedAlias,
      aliasType: persistedAliasType(alias.aliasType),
    })
    changes.push({ field: `alias:${alias.aliasType}`, after: reference("organization_aliases", inserted.id) })
  }
  for (const classification of classifications) {
    const inserted = await repo.insertClassification(ctx.client, organizationId, classification.code, classification.isPrimary)
    changes.push({ field: `classification:${classification.code}`, after: reference("organization_classifications", inserted.id) })
  }

  await record(
    ctx,
    "ORGANIZATION_CREATED",
    "createOrganization",
    { resourceType: "organization", resourceId: organizationId, organizationId },
    changes,
  )

  const reviewMatches = await reviewMatchesFor(ctx, identifiers, organizationId)
  return loadResult(ctx, organizationId, reviewMatches)
}

// ---------------------------------------------------------------------------------------------------------------
// legal identity
// ---------------------------------------------------------------------------------------------------------------

export async function updateLegalIdentity(
  ctx: OperationContext,
  organizationId: string,
  rawInput: unknown,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const input = requireObject(rawInput, "input", ["legalName", "displayName", "formation"]) as UpdateLegalIdentityInput
  if (!("legalName" in input) && !("displayName" in input) && !("formation" in input)) {
    throw new CorporateIdentityValidationError("input", "Nothing to update.")
  }

  const core = await lockActiveOrganization(ctx, id)

  const legalName = "legalName" in input ? cleanDisplayText(input.legalName, "legalName") : core.legalName
  const displayName =
    "displayName" in input
      ? input.displayName === null
        ? null
        : cleanDisplayText(input.displayName, "displayName")
      : core.displayName
  const formation = "formation" in input ? parseFormation(input.formation, "formation") : formationOf(core)

  const current = formationOf(core)
  const formationChanged =
    (formation === null) !== (current === null) || (formation !== null && current !== null && !sameJurisdiction(formation, current))

  if (formationChanged) {
    const identifiers = await repo.listIdentifiers(ctx.client, id)
    if (identifiers.some((identifier) => identifier.status === "active" && identifier.kind === "INCORPORATION")) {
      throw new CorporateIdentityStateError(
        "The formation jurisdiction cannot change while an incorporation identifier is active; supersede it first.",
      )
    }
    if (formation) {
      for (const identifier of identifiers) {
        if (
          identifier.status === "active" &&
          identifier.kind === "EXTRA_PROVINCIAL_REGISTRATION" &&
          identifier.jurisdictionCountry === formation.country &&
          identifier.jurisdictionRegion === formation.region
        ) {
          throw new CorporateIdentityStateError(
            "The formation jurisdiction cannot equal the jurisdiction of an active extra-provincial registration.",
          )
        }
      }
    }
  }

  const changes: FieldChange[] = []
  if (legalName !== core.legalName) {
    changes.push({ field: "legalName", before: literal(core.legalName), after: literal(legalName) })
  }
  if (displayName !== core.displayName) {
    changes.push({ field: "displayName", before: literal(core.displayName), after: literal(displayName) })
  }
  if (formationChanged) {
    changes.push({
      field: "formation",
      before: literal(current ? `${current.country}${current.region ? `-${current.region}` : ""}` : null),
      after: literal(formation ? `${formation.country}${formation.region ? `-${formation.region}` : ""}` : null),
    })
  }
  if (changes.length === 0) return loadResult(ctx, id, [])

  await repo.updateOrganizationIdentity(ctx.client, id, {
    legalName,
    displayName,
    normalizedLegalName: normalizeBusinessName(legalName, "legalName"),
    formationCountry: formation?.country ?? null,
    formationRegion: formation?.region ?? null,
  })
  await record(ctx, "RECORD_UPDATED", "updateLegalIdentity", { resourceType: "organization", resourceId: id, organizationId: id }, changes)
  return loadResult(ctx, id, [])
}

// ---------------------------------------------------------------------------------------------------------------
// identifiers
// ---------------------------------------------------------------------------------------------------------------

async function adoptFormation(ctx: OperationContext, core: repo.OrganizationCore, adopted: Jurisdiction | null): Promise<FieldChange[]> {
  if (!adopted) return []
  await repo.updateOrganizationIdentity(ctx.client, core.id, {
    legalName: core.legalName,
    displayName: core.displayName,
    normalizedLegalName: core.normalizedLegalName,
    formationCountry: adopted.country,
    formationRegion: adopted.region,
  })
  return [
    { field: "formationCountry", before: literal(null), after: literal(adopted.country) },
    ...(adopted.region ? [{ field: "formationRegion", before: literal(null), after: literal(adopted.region) }] : []),
  ]
}

async function assertSingleIncorporation(ctx: OperationContext, organizationId: string, prepared: PreparedCorporateIdentifier) {
  if (prepared.kind !== "INCORPORATION") return
  const existing = await repo.listIdentifiers(ctx.client, organizationId)
  if (existing.some((identifier) => identifier.status === "active" && identifier.kind === "INCORPORATION")) {
    throw new CorporateIdentityConflictError(
      "This Organization already has an active incorporation identifier; correct or supersede it instead.",
    )
  }
}

export async function addIdentifier(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const prepared = prepareCorporateIdentifier(rawInput, "identifier")
  const core = await lockActiveOrganization(ctx, id)

  const adopted = assertIdentifierFitsOrganization(formationOf(core), prepared, "identifier")
  await assertSingleIncorporation(ctx, id, prepared)
  await assertNoActiveCollision(ctx, prepared)

  const formationChanges = await adoptFormation(ctx, core, adopted)
  const inserted = await insertGuarded(ctx, id, prepared)

  await record(
    ctx,
    "RECORD_CREATED",
    "addIdentifier",
    { resourceType: "organization_identifier", resourceId: inserted.id, organizationId: id },
    [{ field: `identifier:${prepared.kind}`, after: reference("organization_identifiers", inserted.id) }, ...formationChanges],
  )
  return loadResult(ctx, id, await reviewMatchesFor(ctx, [prepared], id))
}

/**
 * Corrects an identifier by preserving history: the old row is superseded and a new row is created. Identity-defining
 * columns are never rewritten (the runtime role cannot). The replacement must be the same kind.
 */
export async function correctIdentifier(
  ctx: OperationContext,
  organizationId: string,
  identifierId: string,
  rawInput: unknown,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const oldId = requireUuid(identifierId, "identifierId")
  const prepared = prepareCorporateIdentifier(rawInput, "identifier")
  const core = await lockActiveOrganization(ctx, id)

  const old = await repo.getIdentifier(ctx.client, id, oldId)
  if (!old) throw new CorporateIdentityNotFoundError("Identifier")
  if (old.status !== "active") throw new CorporateIdentityStateError("Only an active identifier can be corrected.")
  if (old.kind !== prepared.kind) {
    throw new CorporateIdentityValidationError("identifier.kind", "A correction must be the same kind of identifier as the one it replaces.")
  }

  assertIdentifierFitsOrganization(formationOf(core), prepared, "identifier")

  // Supersede first: a correction that only changes formatting normalizes to the same key and must not collide with
  // the row it replaces. Any later failure rolls the whole transaction back.
  await repo.supersedeIdentifierRow(ctx.client, oldId)
  await assertNoActiveCollision(ctx, prepared)
  const inserted = await insertGuarded(ctx, id, prepared)

  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctIdentifier",
    { resourceType: "organization_identifier", resourceId: inserted.id, organizationId: id },
    [
      {
        field: `identifier:${prepared.kind}`,
        before: reference("organization_identifiers", oldId),
        after: reference("organization_identifiers", inserted.id),
      },
    ],
  )
  return loadResult(ctx, id, await reviewMatchesFor(ctx, [prepared], id))
}

export async function supersedeIdentifier(
  ctx: OperationContext,
  organizationId: string,
  identifierId: string,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const identifier = requireUuid(identifierId, "identifierId")
  await lockActiveOrganization(ctx, id)

  const row = await repo.getIdentifier(ctx.client, id, identifier)
  if (!row) throw new CorporateIdentityNotFoundError("Identifier")
  if (row.status !== "active") throw new CorporateIdentityStateError("This identifier is already superseded.")

  await repo.supersedeIdentifierRow(ctx.client, identifier)
  await record(
    ctx,
    "RECORD_STATUS_CHANGED",
    "supersedeIdentifier",
    { resourceType: "organization_identifier", resourceId: identifier, organizationId: id },
    [{ field: "status", before: literal("active"), after: literal("superseded") }],
  )
  return loadResult(ctx, id, [])
}

// ---------------------------------------------------------------------------------------------------------------
// aliases
// ---------------------------------------------------------------------------------------------------------------

export async function addAlias(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const alias = parseAlias(rawInput, "alias")
  await lockActiveOrganization(ctx, id)

  const persistedType = persistedAliasType(alias.aliasType)
  if (await repo.findActiveAlias(ctx.client, id, alias.normalizedAlias, persistedType)) {
    throw new CorporateIdentityConflictError("This alias is already recorded for the Organization.")
  }
  const inserted = await repo.insertAlias(ctx.client, id, {
    alias: alias.alias,
    normalizedAlias: alias.normalizedAlias,
    aliasType: persistedType,
  })
  await record(
    ctx,
    "RECORD_CREATED",
    "addAlias",
    { resourceType: "organization_alias", resourceId: inserted.id, organizationId: id },
    [{ field: `alias:${alias.aliasType}`, after: reference("organization_aliases", inserted.id) }],
  )
  return loadResult(ctx, id, [])
}

export async function deactivateAlias(ctx: OperationContext, organizationId: string, aliasId: string): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const alias = requireUuid(aliasId, "aliasId")
  await lockActiveOrganization(ctx, id)

  const row = await repo.getAlias(ctx.client, id, alias)
  if (!row) throw new CorporateIdentityNotFoundError("Alias")
  if (row.status !== "active") throw new CorporateIdentityStateError("This alias is already inactive.")

  await repo.deactivateAliasRow(ctx.client, alias)
  await record(
    ctx,
    "RECORD_STATUS_CHANGED",
    "deactivateAlias",
    { resourceType: "organization_alias", resourceId: alias, organizationId: id },
    [{ field: "status", before: literal("active"), after: literal("inactive") }],
  )
  return loadResult(ctx, id, [])
}

// ---------------------------------------------------------------------------------------------------------------
// classifications
// ---------------------------------------------------------------------------------------------------------------

export async function addClassification(ctx: OperationContext, organizationId: string, rawInput: unknown): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const classification = parseClassification(rawInput, "classification")
  await lockActiveOrganization(ctx, id)

  if (!(await repo.isActiveClassificationCode(ctx.client, classification.code))) {
    throw new CorporateIdentityValidationError("classification.code", `"${classification.code}" is not a known classification.`)
  }
  if (await repo.findCurrentClassification(ctx.client, id, classification.code)) {
    throw new CorporateIdentityConflictError("This Organization already has that classification.")
  }

  const changes: FieldChange[] = []
  if (classification.isPrimary) {
    const demoted = await repo.clearCurrentPrimaryClassification(ctx.client, id)
    if (demoted) changes.push({ field: "primaryClassification", before: reference("organization_classifications", demoted) })
  }
  const inserted = await repo.insertClassification(ctx.client, id, classification.code, classification.isPrimary)
  changes.unshift({ field: `classification:${classification.code}`, after: reference("organization_classifications", inserted.id) })

  await record(
    ctx,
    "RECORD_CREATED",
    "addClassification",
    { resourceType: "organization_classification", resourceId: inserted.id, organizationId: id },
    changes,
  )
  return loadResult(ctx, id, [])
}

export async function endClassification(
  ctx: OperationContext,
  organizationId: string,
  classificationId: string,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const classification = requireUuid(classificationId, "classificationId")
  await lockActiveOrganization(ctx, id)

  const row = await repo.getClassification(ctx.client, id, classification)
  if (!row) throw new CorporateIdentityNotFoundError("Classification")
  if (row.effectiveTo !== null) throw new CorporateIdentityStateError("This classification has already ended.")

  await repo.endClassificationRow(ctx.client, classification)
  await record(
    ctx,
    "RECORD_STATUS_CHANGED",
    "endClassification",
    { resourceType: "organization_classification", resourceId: classification, organizationId: id },
    [{ field: "status", before: literal("current"), after: literal("ended") }],
  )
  return loadResult(ctx, id, [])
}

export async function setPrimaryClassification(
  ctx: OperationContext,
  organizationId: string,
  classificationId: string,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const classification = requireUuid(classificationId, "classificationId")
  await lockActiveOrganization(ctx, id)

  const row = await repo.getClassification(ctx.client, id, classification)
  if (!row) throw new CorporateIdentityNotFoundError("Classification")
  if (row.effectiveTo !== null) throw new CorporateIdentityStateError("An ended classification cannot be primary.")
  if (row.isPrimary) throw new CorporateIdentityStateError("This classification is already primary.")

  const demoted = await repo.clearCurrentPrimaryClassification(ctx.client, id)
  await repo.setPrimaryClassificationRow(ctx.client, classification)

  const changes: FieldChange[] = [{ field: "isPrimary", before: literal(false), after: literal(true) }]
  if (demoted) changes.push({ field: "primaryClassification", before: reference("organization_classifications", demoted) })
  await record(
    ctx,
    "RECORD_UPDATED",
    "setPrimaryClassification",
    { resourceType: "organization_classification", resourceId: classification, organizationId: id },
    changes,
  )
  return loadResult(ctx, id, [])
}

// ---------------------------------------------------------------------------------------------------------------
// archive / restore
// ---------------------------------------------------------------------------------------------------------------

function optionalReason(rawInput: unknown): string | undefined {
  if (rawInput === undefined) return undefined
  const input = requireObject(rawInput, "input", ["reason"])
  if (input.reason === undefined) return undefined
  return cleanDisplayText(input.reason, "reason", 500)
}

export async function archiveOrganization(
  ctx: OperationContext,
  organizationId: string,
  rawInput?: unknown,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const reason = optionalReason(rawInput)
  const core = await repo.lockOrganization(ctx.client, id)
  if (!core) throw new CorporateIdentityNotFoundError()
  if (core.status !== "active") {
    throw new CorporateIdentityStateError(
      core.status === "merged" ? "A merged Organization cannot be archived." : "This Organization is already archived.",
    )
  }
  await repo.archiveOrganizationRow(ctx.client, id)
  await record(
    ctx,
    "ORGANIZATION_STATUS_CHANGED",
    "archiveOrganization",
    { resourceType: "organization", resourceId: id, organizationId: id },
    [{ field: "status", before: literal("active"), after: literal("archived") }],
    reason,
  )
  return loadResult(ctx, id, [])
}

export async function restoreOrganization(
  ctx: OperationContext,
  organizationId: string,
  rawInput?: unknown,
): Promise<MutationResult> {
  const id = requireUuid(organizationId, "organizationId")
  const reason = optionalReason(rawInput)
  const core = await repo.lockOrganization(ctx.client, id)
  if (!core) throw new CorporateIdentityNotFoundError()
  if (core.status !== "archived") {
    throw new CorporateIdentityStateError(
      core.status === "merged" ? "A merged Organization cannot be restored." : "Only an archived Organization can be restored.",
    )
  }
  await repo.restoreOrganizationRow(ctx.client, id)
  await record(
    ctx,
    "ORGANIZATION_STATUS_CHANGED",
    "restoreOrganization",
    { resourceType: "organization", resourceId: id, organizationId: id },
    [{ field: "status", before: literal("archived"), after: literal("active") }],
    reason,
  )
  return loadResult(ctx, id, [])
}
