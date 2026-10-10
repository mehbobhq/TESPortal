/**
 * Operating-authority domain operations.
 *
 * Every operation runs on the transaction client the authorization wrapper checked out and records its Master Register
 * event through a repository bound to that SAME client, so the business mutation and its accountability commit or roll
 * back together. Authorization has already happened when these run; the only capability evaluated here is the secondary
 * ORGANIZATION_REGISTRY_READ check (`canViewRegistry`, lazy, same client, memoized) that decides whether a number
 * collision may name the other Organization.
 *
 * Lock order (always): Organization row, then authority row, then dependent rows. All writers for an Organization are
 * serialized by the Organization lock; the unique indexes from migration 0013 are the final backstop (identity, number
 * namespace, one current version, one current status). A cross-Organization number race is decided by the number index
 * alone: the loser's insert fails with 23505 under a SAVEPOINT and becomes the same collision result as a pre-check hit.
 *
 * Corrections vs real-world changes (versions and status periods) follow the convention of migration 0012: a change ends
 * the old row (effective_to) and starts a new one; a correction flags the old row 'corrected' (never ended), and the
 * replacement inherits its business time. Reads use 'active' rows only.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  AUTHORITY_STATUSES,
  KIND_DEFINITIONS,
  isAuthorityKind,
  isAuthorityStatus,
  prepareAuthorityNumber,
  resolveJurisdiction,
  type AuthorityKind,
  type AuthorityStatus,
  type KindDefinition,
  type PreparedNumber,
  type ResolvedJurisdiction,
} from "@/lib/operating-authorities/definitions"
import {
  AuthorityNumberCollisionError,
  OperatingAuthorityConflictError,
  OperatingAuthorityNotFoundError,
  OperatingAuthorityStateError,
  OperatingAuthorityValidationError,
  type NumberCollisionMatch,
} from "@/lib/operating-authorities/errors"
import * as repo from "@/lib/operating-authorities/repository"
import type {
  AuthorityMutationResult,
  AuthorityRecord,
  AuthorityView,
  NumberCheckResult,
  OrganizationAuthoritiesView,
  ReviewMatch,
  StatusPeriodRecord,
  VersionRecord,
} from "@/lib/operating-authorities/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor holds ORGANIZATION_REGISTRY_READ (same transaction, memoized). */
  canViewRegistry: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OperatingAuthorityValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new OperatingAuthorityValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new OperatingAuthorityValidationError(field, `${field} must be a UUID.`)
}

function parseKind(value: unknown, field: string): AuthorityKind {
  if (isAuthorityKind(value)) return value
  throw new OperatingAuthorityValidationError(field, `${field} must be a supported authority kind.`)
}

function parseStatus(value: unknown, field: string): AuthorityStatus {
  if (isAuthorityStatus(value)) return value
  throw new OperatingAuthorityValidationError(field, `${field} must be one of ${AUTHORITY_STATUSES.join(", ")}.`)
}

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new OperatingAuthorityValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new OperatingAuthorityValidationError(field, `${field} is not a valid instant.`)
  return date.toISOString()
}

/** A calendar date (YYYY-MM-DD) that really exists. */
function parseDate(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)) return value
  }
  throw new OperatingAuthorityValidationError(field, `${field} must be a calendar date (YYYY-MM-DD).`)
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
    switch (constraintOf(error)) {
      case repo.CURRENT_IDENTITY_CONSTRAINT:
      case repo.CURRENT_VERSION_CONSTRAINT:
      case repo.CURRENT_STATUS_CONSTRAINT:
        throw new OperatingAuthorityConflictError("A concurrent change was made, or the Organization already holds this authority; retry the operation.")
      case repo.VERSION_WINDOW_CONSTRAINT:
      case repo.STATUS_WINDOW_CONSTRAINT:
        throw new OperatingAuthorityValidationError("effectiveFrom", "The effective date must be after the current record began.")
      case repo.VERSION_AUTHORITY_ACTIVE_CONSTRAINT:
      case repo.STATUS_AUTHORITY_ACTIVE_CONSTRAINT:
        throw new OperatingAuthorityStateError("This authority record is archived; restore it before changing it.")
      default:
        throw error
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName =
  | "RECORD_CREATED"
  | "RECORD_UPDATED"
  | "RECORD_CORRECTED"
  | "RECORD_STATUS_CHANGED"
  | "RECORD_ARCHIVED"
  | "RECORD_RESTORED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({
  kind: "LITERAL",
  value,
})
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({
  kind: "REFERENCE",
  reference: `${table}:${id}`,
})

/**
 * Authority numbers (and jurisdictions and dates) are never copied into the Master Register: events reference the
 * operating_authority_versions / operating_authority_status_periods rows, which are the record of what they were.
 * Kind and regulatory status are small controlled vocabulary values and are recorded as such.
 */
async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: { resourceType: string; resourceId: string; organizationId: string },
  fieldChanges: FieldChange[],
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
    source: { sourceType: "APPLICATION", component: "operating-authorities", workflow: operation },
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
  if (!organization) throw new OperatingAuthorityNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new OperatingAuthorityStateError(
      organization.status === "merged"
        ? "This Organization has been merged; its authorities can no longer be changed."
        : "This Organization is archived; restore it before changing its authorities.",
    )
  }
}

/** Locks the Organization (active) then the authority row; the authority must belong to that Organization. */
async function lockAuthority(ctx: OperationContext, organizationId: string, authorityId: string): Promise<AuthorityRecord> {
  await lockActiveOrganization(ctx, organizationId)
  const authority = await repo.getAuthority(ctx.client, organizationId, authorityId, true)
  if (!authority) throw new OperatingAuthorityNotFoundError()
  return authority
}

function requireActiveRecord(authority: AuthorityRecord): void {
  if (authority.recordStatus !== "active") {
    throw new OperatingAuthorityStateError("This authority record is archived; restore it before changing it.")
  }
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) {
    throw new OperatingAuthorityValidationError(field, `${field} cannot be in the future.`)
  }
  return explicit
}

async function collisionError(ctx: OperationContext, kind: AuthorityKind, holder: NumberCollisionMatch | undefined): Promise<AuthorityNumberCollisionError> {
  const disclose = holder !== undefined && (await ctx.canViewRegistry())
  return new AuthorityNumberCollisionError(kind, disclose ? holder : undefined)
}

/** Explanatory pre-check on the same transaction. The number index remains the final arbiter (see insertVersionGuarded). */
async function assertNumberFree(ctx: OperationContext, kind: AuthorityKind, jurisdiction: ResolvedJurisdiction, normalized: string): Promise<void> {
  const holder = await repo.findCurrentNumberHolder(ctx.client, kind, jurisdiction.country, jurisdiction.region, normalized)
  if (holder) throw await collisionError(ctx, kind, holder)
}

/** Only kinds whose regulator supports one current record per Organization (USDOT) claim that identity. */
async function assertIdentityFree(ctx: OperationContext, organizationId: string, definition: KindDefinition): Promise<void> {
  if (!definition.oneCurrentPerOrganization) return
  const holder = await repo.findCurrentIdentityHolder(ctx.client, organizationId, definition.kind)
  if (holder) {
    throw new OperatingAuthorityConflictError(
      `This Organization already holds a ${definition.kind} authority; change, correct or reactivate it instead of creating another.`,
    )
  }
}

type VersionValues = {
  number: PreparedNumber
  jurisdiction: ResolvedJurisdiction
  issuedOn: string | null
  expiresOn: string | null
}

/**
 * Inserts a version under a SAVEPOINT so a unique violation from a concurrent writer (which the pre-check cannot see)
 * becomes the same collision result instead of an aborted transaction. Any other error propagates.
 */
async function insertVersionGuarded(
  ctx: OperationContext,
  authority: { id: string; organizationId: string; kind: AuthorityKind },
  values: VersionValues,
  versionId: string,
  reason: VersionRecord["versionReason"],
  effectiveFrom: string,
): Promise<VersionRecord> {
  await ctx.client.query("SAVEPOINT tes_authority_version")
  try {
    const inserted = await repo.insertVersion(ctx.client, {
      id: versionId,
      authorityId: authority.id,
      organizationId: authority.organizationId,
      kind: authority.kind,
      numberDisplay: values.number.display,
      numberNormalized: values.number.normalized,
      normalizationRuleVersion: values.number.ruleVersion,
      jurisdictionCountry: values.jurisdiction.country,
      jurisdictionRegion: values.jurisdiction.region,
      issuedOn: values.issuedOn,
      expiresOn: values.expiresOn,
      versionReason: reason,
      effectiveFrom,
    })
    await ctx.client.query("RELEASE SAVEPOINT tes_authority_version")
    return inserted
  } catch (error) {
    const constraint = constraintOf(error)
    const isUnique = typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"
    if (isUnique && constraint === repo.NUMBER_COLLISION_CONSTRAINT) {
      await ctx.client.query("ROLLBACK TO SAVEPOINT tes_authority_version")
      const winner = await repo.findCurrentNumberHolder(ctx.client, authority.kind, values.jurisdiction.country, values.jurisdiction.region, values.number.normalized)
      throw await collisionError(ctx, authority.kind, winner)
    }
    if (isUnique && (constraint === repo.CURRENT_IDENTITY_CONSTRAINT || constraint === repo.CURRENT_VERSION_CONSTRAINT)) {
      throw new OperatingAuthorityConflictError("A concurrent change was made, or the Organization already holds this authority; retry the operation.")
    }
    throw error
  }
}

async function reviewMatchesFor(
  ctx: OperationContext,
  kind: AuthorityKind,
  values: VersionValues,
  ownAuthorityId: string,
): Promise<ReviewMatch[]> {
  if (!(await ctx.canViewRegistry())) return []
  return repo.findNumberReviewMatches(ctx.client, kind, values.jurisdiction.country, values.jurisdiction.region, values.number.normalized, ownAuthorityId)
}

function assembleView(
  authority: AuthorityRecord,
  versions: VersionRecord[],
  periods: StatusPeriodRecord[],
  asOf: string | null,
): AuthorityView {
  const genuineNow = <T extends { recordStatus: string; effectiveTo: string | null }>(rows: T[]) =>
    rows.find((row) => row.recordStatus === "active" && row.effectiveTo === null) ?? null
  let asOfView: AuthorityView["asOf"] = null
  if (asOf !== null) {
    const at = /\.\d{3}Z$/.test(asOf) ? asOf.replace(/Z$/, "000Z") : asOf
    const inForce = <T extends { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }>(rows: T[]) =>
      rows.find((row) => row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)) ?? null
    asOfView = { at: asOf, version: inForce(versions), status: inForce(periods) }
  }
  return {
    authority,
    current: { version: genuineNow(versions), status: genuineNow(periods) },
    asOf: asOfView,
    versions,
    statusPeriods: periods,
  }
}

async function loadViews(client: PoolClient, authorities: AuthorityRecord[], asOf: string | null): Promise<AuthorityView[]> {
  const ids = authorities.map((authority) => authority.id)
  const [versions, periods] = await Promise.all([repo.listVersions(client, ids), repo.listStatusPeriods(client, ids)])
  return authorities.map((authority) => assembleView(authority, versions.get(authority.id) ?? [], periods.get(authority.id) ?? [], asOf))
}

async function loadView(ctx: OperationContext, organizationId: string, authorityId: string): Promise<AuthorityView> {
  const authority = await repo.getAuthority(ctx.client, organizationId, authorityId)
  if (!authority) throw new OperatingAuthorityNotFoundError()
  return (await loadViews(ctx.client, [authority], null))[0]
}

// ---------------------------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------------------------

export async function createAuthority(ctx: OperationContext, rawInput: unknown): Promise<AuthorityMutationResult> {
  const input = requireObject(rawInput, "input", [
    "organizationId",
    "kind",
    "number",
    "jurisdiction",
    "issuedOn",
    "expiresOn",
    "status",
    "effectiveFrom",
  ])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const kind = parseKind(input.kind, "kind")
  const definition = KIND_DEFINITIONS[kind]
  const number = prepareAuthorityNumber(kind, input.number, "number")
  const jurisdiction = resolveJurisdiction(kind, input.jurisdiction, "jurisdiction")
  const issuedOn = input.issuedOn === undefined ? null : parseDate(input.issuedOn, "issuedOn")
  const expiresOn = input.expiresOn === undefined ? null : parseDate(input.expiresOn, "expiresOn")
  if (expiresOn !== null && !definition.hasExpiry) {
    throw new OperatingAuthorityValidationError("expiresOn", `An expiry date does not apply to ${kind}.`)
  }
  if (issuedOn !== null && expiresOn !== null && expiresOn < issuedOn) {
    throw new OperatingAuthorityValidationError("expiresOn", "The expiry date cannot be before the issue date.")
  }
  const status = input.status === undefined ? "ACTIVE" : parseStatus(input.status, "status")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  if (!(await repo.isActiveKind(ctx.client, kind))) {
    throw new OperatingAuthorityValidationError("kind", `${kind} is not an active authority kind.`)
  }
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")

  const values: VersionValues = { number, jurisdiction, issuedOn, expiresOn }
  await assertNumberFree(ctx, kind, jurisdiction, number.normalized)
  await assertIdentityFree(ctx, organizationId, definition)

  const authorityId = await repo.insertAuthority(ctx.client, organizationId, kind)
  const version = await insertVersionGuarded(ctx, { id: authorityId, organizationId, kind }, values, randomUUID(), "INITIAL", at)
  const period = await guarded(() =>
    repo.insertStatusPeriod(ctx.client, { id: randomUUID(), authorityId, authorityStatus: status, periodReason: "INITIAL", effectiveFrom: at }),
  )

  await record(
    ctx,
    "RECORD_CREATED",
    "createAuthority",
    { resourceType: "operating_authority", resourceId: authorityId, organizationId },
    [
      { field: "kind", after: literal(kind) },
      { field: "version", after: reference("operating_authority_versions", version.id) },
      { field: "status", after: literal(status) },
      { field: "statusPeriod", after: reference("operating_authority_status_periods", period.id) },
    ],
  )

  return { view: await loadView(ctx, organizationId, authorityId), reviewMatches: await reviewMatchesFor(ctx, kind, values, authorityId) }
}

// ---------------------------------------------------------------------------------------------------------------
// version change (real world) and correction
// ---------------------------------------------------------------------------------------------------------------

const VERSION_FIELD_KEYS = ["number", "jurisdiction", "issuedOn", "expiresOn"] as const

function mergeVersionFields(definition: KindDefinition, current: VersionRecord, source: Record<string, unknown>): VersionValues {
  if (!VERSION_FIELD_KEYS.some((key) => source[key] !== undefined)) {
    throw new OperatingAuthorityValidationError("input", "Nothing to change.")
  }

  const number: PreparedNumber =
    source.number !== undefined
      ? prepareAuthorityNumber(definition.kind, source.number, "number")
      : { display: current.numberDisplay, normalized: current.numberNormalized, ruleVersion: current.normalizationRuleVersion }

  const jurisdiction: ResolvedJurisdiction =
    source.jurisdiction !== undefined
      ? resolveJurisdiction(definition.kind, source.jurisdiction, "jurisdiction")
      : { country: current.jurisdictionCountry, region: current.jurisdictionRegion }

  const issuedOn = source.issuedOn === undefined ? current.issuedOn : source.issuedOn === null ? null : parseDate(source.issuedOn, "issuedOn")
  const expiresOn = source.expiresOn === undefined ? current.expiresOn : source.expiresOn === null ? null : parseDate(source.expiresOn, "expiresOn")
  if (expiresOn !== null && !definition.hasExpiry) {
    throw new OperatingAuthorityValidationError("expiresOn", `An expiry date does not apply to ${definition.kind}.`)
  }
  if (issuedOn !== null && expiresOn !== null && expiresOn < issuedOn) {
    throw new OperatingAuthorityValidationError("expiresOn", "The expiry date cannot be before the issue date.")
  }

  const unchanged =
    number.display === current.numberDisplay &&
    number.normalized === current.numberNormalized &&
    jurisdiction.country === current.jurisdictionCountry &&
    jurisdiction.region === current.jurisdictionRegion &&
    issuedOn === current.issuedOn &&
    expiresOn === current.expiresOn
  if (unchanged) throw new OperatingAuthorityValidationError("input", "The authority is unchanged.")

  return { number, jurisdiction, issuedOn, expiresOn }
}

const versionReferenceChange = (before: string, after: string): FieldChange => ({
  field: "version",
  before: reference("operating_authority_versions", before),
  after: reference("operating_authority_versions", after),
})

/**
 * REAL-WORLD change of a version: the previous number / jurisdiction / dates were true until T and the new ones became
 * true at T. Both stay genuine history. Only what really changes in the world is allowed: the base jurisdiction of an
 * IRP account, a renewed document date, or a re-issued number for a kind issued per jurisdiction. A national number
 * (USDOT, MC) never changes in the real world, and the issuing jurisdiction of every other kind cannot change in place
 * (a different issuer means a different identifier, recorded as a separate authority); mistakes there are corrections.
 */
export async function changeAuthorityVersion(ctx: OperationContext, rawInput: unknown): Promise<AuthorityMutationResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "authorityId", "effectiveFrom", ...VERSION_FIELD_KEYS])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const authorityId = parseUuid(input.authorityId, "authorityId")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  const authority = await lockAuthority(ctx, organizationId, authorityId)
  requireActiveRecord(authority)
  const definition = KIND_DEFINITIONS[authority.kind]
  const current = await repo.getCurrentVersion(ctx.client, authorityId, true)
  if (!current) throw new OperatingAuthorityNotFoundError("Version")

  const values = mergeVersionFields(definition, current, input)
  const jurisdictionChanged =
    values.jurisdiction.country !== current.jurisdictionCountry || values.jurisdiction.region !== current.jurisdictionRegion
  const numberChanged = values.number.normalized !== current.numberNormalized
  if (jurisdictionChanged && definition.jurisdictionScope !== "BASE_JURISDICTION") {
    throw new OperatingAuthorityValidationError(
      "jurisdiction",
      `The issuing jurisdiction of ${authority.kind} cannot change in place (a different issuer means a different identifier); correct a mistake, or record a separate authority.`,
    )
  }
  if (numberChanged && definition.jurisdictionScope === "NATIONAL") {
    throw new OperatingAuthorityValidationError("number", `A ${authority.kind} number does not change; record a correction instead.`)
  }

  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  await guarded(() => repo.endVersion(ctx.client, current.id, at))
  await assertNumberFree(ctx, authority.kind, values.jurisdiction, values.number.normalized)
  await assertIdentityFree(ctx, organizationId, definition)
  const replacement = await insertVersionGuarded(ctx, authority, values, randomUUID(), "CHANGE", at)

  await record(
    ctx,
    "RECORD_UPDATED",
    "changeAuthorityVersion",
    { resourceType: "operating_authority_version", resourceId: replacement.id, organizationId },
    [versionReferenceChange(current.id, replacement.id), { field: "effectiveFrom", after: literal(at) }],
  )
  return { view: await loadView(ctx, organizationId, authorityId), reviewMatches: await reviewMatchesFor(ctx, authority.kind, values, authorityId) }
}

/**
 * CORRECTION of the current version: the number / jurisdiction / dates were recorded wrongly. The wrong version is
 * preserved but flagged 'corrected' (never ended) and pointed at its replacement, which inherits its business time. The
 * authority is not cancelled and recreated.
 */
export async function correctAuthorityVersion(ctx: OperationContext, rawInput: unknown): Promise<AuthorityMutationResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "authorityId", ...VERSION_FIELD_KEYS])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const authorityId = parseUuid(input.authorityId, "authorityId")

  const authority = await lockAuthority(ctx, organizationId, authorityId)
  requireActiveRecord(authority)
  const definition = KIND_DEFINITIONS[authority.kind]
  const current = await repo.getCurrentVersion(ctx.client, authorityId, true)
  if (!current) throw new OperatingAuthorityNotFoundError("Version")

  const values = mergeVersionFields(definition, current, input)
  const replacementId = randomUUID()

  await guarded(() => repo.markVersionCorrected(ctx.client, current.id, replacementId))
  // After the wrong row stops being current it can no longer collide with its own correction.
  await assertNumberFree(ctx, authority.kind, values.jurisdiction, values.number.normalized)
  await assertIdentityFree(ctx, organizationId, definition)
  const replacement = await insertVersionGuarded(ctx, authority, values, replacementId, "CORRECTION", current.effectiveFrom)

  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctAuthorityVersion",
    { resourceType: "operating_authority_version", resourceId: replacement.id, organizationId },
    [versionReferenceChange(current.id, replacement.id)],
  )
  return { view: await loadView(ctx, organizationId, authorityId), reviewMatches: await reviewMatchesFor(ctx, authority.kind, values, authorityId) }
}

// ---------------------------------------------------------------------------------------------------------------
// regulatory status
// ---------------------------------------------------------------------------------------------------------------

const statusReferenceChange = (before: string, after: string): FieldChange => ({
  field: "statusPeriod",
  before: reference("operating_authority_status_periods", before),
  after: reference("operating_authority_status_periods", after),
})

async function transitionStatus(
  ctx: OperationContext,
  rawInput: unknown,
  operation: "changeAuthorityStatus" | "reactivateAuthority",
): Promise<AuthorityView> {
  const keys = operation === "reactivateAuthority" ? ["organizationId", "authorityId", "effectiveFrom"] : ["organizationId", "authorityId", "status", "effectiveFrom"]
  const input = requireObject(rawInput, "input", keys)
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const authorityId = parseUuid(input.authorityId, "authorityId")
  const target: AuthorityStatus = operation === "reactivateAuthority" ? "ACTIVE" : parseStatus(input.status, "status")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  const authority = await lockAuthority(ctx, organizationId, authorityId)
  requireActiveRecord(authority)
  const current = await repo.getCurrentStatusPeriod(ctx.client, authorityId, true)
  if (!current) throw new OperatingAuthorityNotFoundError("Status")

  const from = current.authorityStatus
  if (from === target) throw new OperatingAuthorityStateError(`The authority is already ${target}.`)
  // Observed status history: any distinct status may be recorded. A return to ACTIVE after the authority was genuinely
  // ACTIVE before is a reactivation (same authority, same number history), recorded as such.
  const periods = (await repo.listStatusPeriods(ctx.client, [authorityId])).get(authorityId) ?? []
  const wasActiveBefore = periods.some((period) => period.recordStatus === "active" && period.authorityStatus === "ACTIVE")
  const isReturnToActive = target === "ACTIVE" && wasActiveBefore
  if (operation === "reactivateAuthority" && !isReturnToActive) {
    throw new OperatingAuthorityStateError("Only an authority that was ACTIVE before can be reactivated; record the status with changeAuthorityStatus.")
  }

  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  await guarded(() => repo.endStatusPeriod(ctx.client, current.id, at))
  const replacement = await guarded(() =>
    repo.insertStatusPeriod(ctx.client, {
      id: randomUUID(),
      authorityId,
      authorityStatus: target,
      periodReason: isReturnToActive ? "REACTIVATION" : "TRANSITION",
      effectiveFrom: at,
    }),
  )
  await record(
    ctx,
    "RECORD_STATUS_CHANGED",
    operation,
    { resourceType: "operating_authority_status_period", resourceId: replacement.id, organizationId },
    [
      { field: "status", before: literal(from), after: literal(target) },
      statusReferenceChange(current.id, replacement.id),
      { field: "effectiveFrom", after: literal(at) },
    ],
  )
  return loadView(ctx, organizationId, authorityId)
}

/** Records an OBSERVED regulatory status change. Any distinct status may be recorded; kind-specific legality is Rules-layer policy. */
export async function changeAuthorityStatus(ctx: OperationContext, rawInput: unknown): Promise<AuthorityView> {
  return transitionStatus(ctx, rawInput, "changeAuthorityStatus")
}

/** Reactivation: the SAME authority (same id, same number history) returns to ACTIVE. Never a new authority. */
export async function reactivateAuthority(ctx: OperationContext, rawInput: unknown): Promise<AuthorityView> {
  return transitionStatus(ctx, rawInput, "reactivateAuthority")
}

/**
 * CORRECTION of the current status: it was recorded wrongly. The wrong period is preserved and flagged, never ended (no
 * transition is invented), and the replacement inherits its business time.
 */
export async function correctAuthorityStatus(ctx: OperationContext, rawInput: unknown): Promise<AuthorityView> {
  const input = requireObject(rawInput, "input", ["organizationId", "authorityId", "status"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const authorityId = parseUuid(input.authorityId, "authorityId")
  const status = parseStatus(input.status, "status")

  const authority = await lockAuthority(ctx, organizationId, authorityId)
  requireActiveRecord(authority)
  const current = await repo.getCurrentStatusPeriod(ctx.client, authorityId, true)
  if (!current) throw new OperatingAuthorityNotFoundError("Status")
  if (current.authorityStatus === status) throw new OperatingAuthorityValidationError("status", "The status is unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markStatusPeriodCorrected(ctx.client, current.id, replacementId))
  const replacement = await guarded(() =>
    repo.insertStatusPeriod(ctx.client, {
      id: replacementId,
      authorityId,
      authorityStatus: status,
      periodReason: "CORRECTION",
      effectiveFrom: current.effectiveFrom,
    }),
  )
  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctAuthorityStatus",
    { resourceType: "operating_authority_status_period", resourceId: replacement.id, organizationId },
    [
      { field: "status", before: literal(current.authorityStatus), after: literal(status) },
      statusReferenceChange(current.id, replacement.id),
    ],
  )
  return loadView(ctx, organizationId, authorityId)
}

// ---------------------------------------------------------------------------------------------------------------
// archive / restore (record lifecycle, not regulatory status)
// ---------------------------------------------------------------------------------------------------------------

export async function archiveAuthority(ctx: OperationContext, rawInput: unknown): Promise<AuthorityView> {
  const input = requireObject(rawInput, "input", ["organizationId", "authorityId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const authorityId = parseUuid(input.authorityId, "authorityId")

  const authority = await lockAuthority(ctx, organizationId, authorityId)
  if (authority.recordStatus !== "active") throw new OperatingAuthorityStateError("This authority record is already archived.")
  await repo.setAuthorityRecordStatus(ctx.client, authorityId, "archived")
  await record(
    ctx,
    "RECORD_ARCHIVED",
    "archiveAuthority",
    { resourceType: "operating_authority", resourceId: authorityId, organizationId },
    [{ field: "recordStatus", before: literal("active"), after: literal("archived") }],
  )
  return loadView(ctx, organizationId, authorityId)
}

export async function restoreAuthority(ctx: OperationContext, rawInput: unknown): Promise<AuthorityView> {
  const input = requireObject(rawInput, "input", ["organizationId", "authorityId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const authorityId = parseUuid(input.authorityId, "authorityId")

  const authority = await lockAuthority(ctx, organizationId, authorityId)
  if (authority.recordStatus !== "archived") throw new OperatingAuthorityStateError("Only an archived authority record can be restored.")
  await repo.setAuthorityRecordStatus(ctx.client, authorityId, "active")
  await record(
    ctx,
    "RECORD_RESTORED",
    "restoreAuthority",
    { resourceType: "operating_authority", resourceId: authorityId, organizationId },
    [{ field: "recordStatus", before: literal("archived"), after: literal("active") }],
  )
  return loadView(ctx, organizationId, authorityId)
}

// ---------------------------------------------------------------------------------------------------------------
// reads and lookups (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

/**
 * SYSTEM registry lookup: is this number registered in its namespace, and by whom. Callable only with
 * ORGANIZATION_REGISTRY_READ (the service enforces it as the primary capability), so details are always disclosable.
 */
export async function checkAuthorityNumber(client: PoolClient, rawInput: unknown): Promise<NumberCheckResult> {
  const input = requireObject(rawInput, "input", ["kind", "number", "jurisdiction"])
  const kind = parseKind(input.kind, "kind")
  const number = prepareAuthorityNumber(kind, input.number, "number")
  const jurisdiction = resolveJurisdiction(kind, input.jurisdiction, "jurisdiction")
  const match = await repo.findCurrentNumberHolder(client, kind, jurisdiction.country, jurisdiction.region, number.normalized)
  const reviewMatches = await repo.findNumberReviewMatches(client, kind, jurisdiction.country, jurisdiction.region, number.normalized, null)
  return { registered: match !== undefined, match: match ?? null, reviewMatches }
}

/**
 * One Organization's authorities: what is true now, optionally what was true at an instant, and the full history.
 * Corrected versions / periods appear only in `versions` / `statusPeriods` (flagged); `current` and `asOf` come from
 * genuine ('active') rows only. Reads only the named Organization's authorities.
 */
export async function readOrganizationAuthorities(
  client: PoolClient,
  organizationId: string,
  options: { asOf?: string } = {},
): Promise<OrganizationAuthoritiesView> {
  const id = parseUuid(organizationId, "organizationId")
  if (!(await repo.organizationExists(client, id))) throw new OperatingAuthorityNotFoundError("Organization")
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")
  const authorities = await repo.listAuthorities(client, id)
  return { organizationId: id, authorities: await loadViews(client, authorities, asOf) }
}
