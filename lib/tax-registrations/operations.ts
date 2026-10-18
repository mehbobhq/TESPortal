/**
 * Tax-registration domain operations.
 *
 * Every operation runs on the transaction client the authorization wrapper checked out and records its Master Register
 * event through a repository bound to that SAME client, so the business mutation and its accountability commit or roll
 * back together. Authorization has already happened when these run; the only capability evaluated here is the secondary
 * TAX_REGISTRATION_READ check (`canViewRegistry`, lazy, same client, memoized) that decides whether a number collision may
 * name the other Organization.
 *
 * Lock order (always): Organization row, then registration row, then dependent rows. All writers for an Organization are
 * serialized by the Organization lock; the unique indexes from migration 0016 are the final backstop (number namespace,
 * one current version, one current status). A cross-Organization number race is decided by the number index alone: the
 * loser's insert fails with 23505 under a SAVEPOINT and becomes the same collision result as a pre-check hit. No program
 * claims one current registration per Organization, so there is no identity pre-check.
 *
 * Corrections vs real-world changes (versions and status periods) follow the convention of migrations 0012 / 0013: a
 * change ends the old row (effective_to) and starts a new one; a correction flags the old row 'corrected' (never ended),
 * and the replacement inherits its business time. Reads use 'active' rows only.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  PROGRAM_DEFINITIONS,
  REGISTRATION_STATUSES,
  allowsInPlaceIdentityChange,
  isProgramCode,
  isRegistrationStatus,
  prepareRegistrationNumber,
  resolveJurisdiction,
  type PreparedNumber,
  type ProgramCode,
  type ProgramDefinition,
  type RegistrationStatus,
  type ResolvedJurisdiction,
} from "@/lib/tax-registrations/definitions"
import {
  RegistrationConflictError,
  RegistrationNotFoundError,
  RegistrationNumberCollisionError,
  RegistrationStateError,
  RegistrationValidationError,
  type NumberCollisionMatch,
} from "@/lib/tax-registrations/errors"
import * as repo from "@/lib/tax-registrations/repository"
import type {
  NumberCheckResult,
  OrganizationRegistrationsView,
  RegistrationMutationResult,
  RegistrationRecord,
  RegistrationView,
  ReviewMatch,
  StatusPeriodRecord,
  VersionRecord,
} from "@/lib/tax-registrations/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor also holds TAX_REGISTRATION_READ (same transaction, memoized). */
  canViewRegistry: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RegistrationValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new RegistrationValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
    }
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new RegistrationValidationError(field, `${field} must be a UUID.`)
}

function parseProgram(value: unknown, field: string): ProgramCode {
  if (isProgramCode(value)) return value
  throw new RegistrationValidationError(field, `${field} must be a supported registration program.`)
}

function parseStatus(value: unknown, field: string): RegistrationStatus {
  if (isRegistrationStatus(value)) return value
  throw new RegistrationValidationError(field, `${field} must be one of ${REGISTRATION_STATUSES.join(", ")}.`)
}

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new RegistrationValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new RegistrationValidationError(field, `${field} is not a valid instant.`)
  return date.toISOString()
}

/** A calendar date (YYYY-MM-DD) that really exists. */
function parseDate(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)) return value
  }
  throw new RegistrationValidationError(field, `${field} must be a calendar date (YYYY-MM-DD).`)
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
      case repo.CURRENT_VERSION_CONSTRAINT:
      case repo.CURRENT_STATUS_CONSTRAINT:
        throw new RegistrationConflictError("A concurrent change was made; retry the operation.")
      case repo.VERSION_WINDOW_CONSTRAINT:
      case repo.STATUS_WINDOW_CONSTRAINT:
        throw new RegistrationValidationError("effectiveFrom", "The effective date must be after the current record began.")
      case repo.VERSION_REGISTRATION_ACTIVE_CONSTRAINT:
      case repo.STATUS_REGISTRATION_ACTIVE_CONSTRAINT:
        throw new RegistrationStateError("This registration record is archived; restore it before changing it.")
      case repo.ORGANIZATION_ACTIVE_CONSTRAINT:
        throw new RegistrationStateError("This Organization is not active; its registrations can no longer be changed.")
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
 * Registration numbers, jurisdictions and dates are never copied into the Master Register: events reference the
 * registration_versions / registration_status_periods rows, which are the record of what they were. The program code and
 * the registration status are small controlled-vocabulary values and are recorded as such.
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
    source: { sourceType: "APPLICATION", component: "tax-registrations", workflow: operation },
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
  if (!organization) throw new RegistrationNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new RegistrationStateError(
      organization.status === "merged"
        ? "This Organization has been merged; its registrations can no longer be changed."
        : "This Organization is archived; restore it before changing its registrations.",
    )
  }
}

/** Locks the Organization (active) then the registration row; the registration must belong to that Organization. */
async function lockRegistration(ctx: OperationContext, organizationId: string, registrationId: string): Promise<RegistrationRecord> {
  await lockActiveOrganization(ctx, organizationId)
  const registration = await repo.getRegistration(ctx.client, organizationId, registrationId, true)
  if (!registration) throw new RegistrationNotFoundError()
  return registration
}

function requireActiveRecord(registration: RegistrationRecord): void {
  if (registration.recordStatus !== "active") {
    throw new RegistrationStateError("This registration record is archived; restore it before changing it.")
  }
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) {
    throw new RegistrationValidationError(field, `${field} cannot be in the future.`)
  }
  return explicit
}

async function collisionError(ctx: OperationContext, program: ProgramCode, holder: NumberCollisionMatch | undefined): Promise<RegistrationNumberCollisionError> {
  const disclose = holder !== undefined && (await ctx.canViewRegistry())
  return new RegistrationNumberCollisionError(program, disclose ? holder : undefined)
}

/** Explanatory pre-check on the same transaction. The number index remains the final arbiter (see insertVersionGuarded). */
async function assertNumberFree(ctx: OperationContext, program: ProgramCode, jurisdiction: ResolvedJurisdiction, normalized: string): Promise<void> {
  const holder = await repo.findCurrentNumberHolder(ctx.client, program, jurisdiction.country, jurisdiction.region, normalized)
  if (holder) throw await collisionError(ctx, program, holder)
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
  registration: { id: string; organizationId: string; program: ProgramCode },
  values: VersionValues,
  versionId: string,
  reason: VersionRecord["versionReason"],
  effectiveFrom: string,
): Promise<VersionRecord> {
  await ctx.client.query("SAVEPOINT tes_registration_version")
  try {
    const inserted = await repo.insertVersion(ctx.client, {
      id: versionId,
      registrationId: registration.id,
      organizationId: registration.organizationId,
      program: registration.program,
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
    await ctx.client.query("RELEASE SAVEPOINT tes_registration_version")
    return inserted
  } catch (error) {
    const constraint = constraintOf(error)
    const isUnique = typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"
    if (isUnique && constraint === repo.NUMBER_COLLISION_CONSTRAINT) {
      await ctx.client.query("ROLLBACK TO SAVEPOINT tes_registration_version")
      const winner = await repo.findCurrentNumberHolder(ctx.client, registration.program, values.jurisdiction.country, values.jurisdiction.region, values.number.normalized)
      throw await collisionError(ctx, registration.program, winner)
    }
    if (isUnique && constraint === repo.CURRENT_VERSION_CONSTRAINT) {
      throw new RegistrationConflictError("A concurrent change was made; retry the operation.")
    }
    if (constraint === repo.ORGANIZATION_ACTIVE_CONSTRAINT) {
      throw new RegistrationStateError("This Organization is not active; its registrations can no longer be changed.")
    }
    if (constraint === repo.VERSION_REGISTRATION_ACTIVE_CONSTRAINT) {
      throw new RegistrationStateError("This registration record is archived; restore it before changing it.")
    }
    throw error
  }
}

async function reviewMatchesFor(
  ctx: OperationContext,
  program: ProgramCode,
  values: VersionValues,
  ownRegistrationId: string,
): Promise<ReviewMatch[]> {
  if (!(await ctx.canViewRegistry())) return []
  return repo.findNumberReviewMatches(ctx.client, program, values.jurisdiction.country, values.jurisdiction.region, values.number.normalized, ownRegistrationId)
}

function assembleView(
  registration: RegistrationRecord,
  versions: VersionRecord[],
  periods: StatusPeriodRecord[],
  asOf: string | null,
): RegistrationView {
  const genuineNow = <T extends { recordStatus: string; effectiveTo: string | null }>(rows: T[]) =>
    rows.find((row) => row.recordStatus === "active" && row.effectiveTo === null) ?? null
  let asOfView: RegistrationView["asOf"] = null
  if (asOf !== null) {
    const at = /\.\d{3}Z$/.test(asOf) ? asOf.replace(/Z$/, "000Z") : asOf
    const inForce = <T extends { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }>(rows: T[]) =>
      rows.find((row) => row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)) ?? null
    asOfView = { at: asOf, version: inForce(versions), status: inForce(periods) }
  }
  return {
    registration,
    current: { version: genuineNow(versions), status: genuineNow(periods) },
    asOf: asOfView,
    versions,
    statusPeriods: periods,
  }
}

async function loadViews(client: PoolClient, registrations: RegistrationRecord[], asOf: string | null): Promise<RegistrationView[]> {
  const ids = registrations.map((registration) => registration.id)
  const [versions, periods] = await Promise.all([repo.listVersions(client, ids), repo.listStatusPeriods(client, ids)])
  return registrations.map((registration) => assembleView(registration, versions.get(registration.id) ?? [], periods.get(registration.id) ?? [], asOf))
}

async function loadView(ctx: OperationContext, organizationId: string, registrationId: string): Promise<RegistrationView> {
  const registration = await repo.getRegistration(ctx.client, organizationId, registrationId)
  if (!registration) throw new RegistrationNotFoundError()
  return (await loadViews(ctx.client, [registration], null))[0]
}

// ---------------------------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------------------------

export async function createRegistration(ctx: OperationContext, rawInput: unknown): Promise<RegistrationMutationResult> {
  const input = requireObject(rawInput, "input", [
    "organizationId",
    "program",
    "number",
    "jurisdiction",
    "issuedOn",
    "expiresOn",
    "status",
    "effectiveFrom",
  ])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const program = parseProgram(input.program, "program")
  const number = prepareRegistrationNumber(program, input.number, "number")
  const jurisdiction = resolveJurisdiction(program, input.jurisdiction, "jurisdiction")
  const issuedOn = input.issuedOn === undefined ? null : parseDate(input.issuedOn, "issuedOn")
  const expiresOn = input.expiresOn === undefined ? null : parseDate(input.expiresOn, "expiresOn")
  if (issuedOn !== null && expiresOn !== null && expiresOn < issuedOn) {
    throw new RegistrationValidationError("expiresOn", "The expiry date cannot be before the issue date.")
  }
  const status = input.status === undefined ? "ACTIVE" : parseStatus(input.status, "status")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  if (!(await repo.isActiveProgram(ctx.client, program))) {
    throw new RegistrationValidationError("program", `${program} is not an active registration program.`)
  }
  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")

  const values: VersionValues = { number, jurisdiction, issuedOn, expiresOn }
  await assertNumberFree(ctx, program, jurisdiction, number.normalized)

  const registrationId = await guarded(() => repo.insertRegistration(ctx.client, organizationId, program))
  const version = await insertVersionGuarded(ctx, { id: registrationId, organizationId, program }, values, randomUUID(), "INITIAL", at)
  const period = await guarded(() =>
    repo.insertStatusPeriod(ctx.client, { id: randomUUID(), registrationId, registrationStatus: status, periodReason: "INITIAL", effectiveFrom: at }),
  )

  await record(
    ctx,
    "RECORD_CREATED",
    "createRegistration",
    { resourceType: "registration", resourceId: registrationId, organizationId },
    [
      { field: "program", after: literal(program) },
      { field: "version", after: reference("registration_versions", version.id) },
      { field: "status", after: literal(status) },
      { field: "statusPeriod", after: reference("registration_status_periods", period.id) },
    ],
  )

  return { view: await loadView(ctx, organizationId, registrationId), reviewMatches: await reviewMatchesFor(ctx, program, values, registrationId) }
}

// ---------------------------------------------------------------------------------------------------------------
// version change (real world) and correction
// ---------------------------------------------------------------------------------------------------------------

const VERSION_FIELD_KEYS = ["number", "jurisdiction", "issuedOn", "expiresOn"] as const

function mergeVersionFields(definition: ProgramDefinition, current: VersionRecord, source: Record<string, unknown>): VersionValues {
  if (!VERSION_FIELD_KEYS.some((key) => source[key] !== undefined)) {
    throw new RegistrationValidationError("input", "Nothing to change.")
  }

  const number: PreparedNumber =
    source.number !== undefined
      ? prepareRegistrationNumber(definition.program, source.number, "number")
      : { display: current.numberDisplay, normalized: current.numberNormalized, ruleVersion: current.normalizationRuleVersion }

  const jurisdiction: ResolvedJurisdiction =
    source.jurisdiction !== undefined
      ? resolveJurisdiction(definition.program, source.jurisdiction, "jurisdiction")
      : { country: current.jurisdictionCountry, region: current.jurisdictionRegion }

  // A recorded version stays unresolved only as the INITIAL one; every later version names its jurisdiction (migration 0034).
  if (definition.jurisdictionScope === "BASE_JURISDICTION" && jurisdiction.country === null) {
    throw new RegistrationValidationError("jurisdiction", `The base jurisdiction of this ${definition.program} account is not established yet; give it (as a correction) together with any other change.`)
  }

  const issuedOn = source.issuedOn === undefined ? current.issuedOn : source.issuedOn === null ? null : parseDate(source.issuedOn, "issuedOn")
  const expiresOn = source.expiresOn === undefined ? current.expiresOn : source.expiresOn === null ? null : parseDate(source.expiresOn, "expiresOn")
  if (issuedOn !== null && expiresOn !== null && expiresOn < issuedOn) {
    throw new RegistrationValidationError("expiresOn", "The expiry date cannot be before the issue date.")
  }

  const unchanged =
    number.display === current.numberDisplay &&
    number.normalized === current.numberNormalized &&
    jurisdiction.country === current.jurisdictionCountry &&
    jurisdiction.region === current.jurisdictionRegion &&
    issuedOn === current.issuedOn &&
    expiresOn === current.expiresOn
  if (unchanged) throw new RegistrationValidationError("input", "The registration is unchanged.")

  return { number, jurisdiction, issuedOn, expiresOn }
}

const versionReferenceChange = (before: string, after: string): FieldChange => ({
  field: "version",
  before: reference("registration_versions", before),
  after: reference("registration_versions", after),
})

/**
 * REAL-WORLD change of a version: the previous number / jurisdiction / dates were true until T and the new ones became
 * true at T. Both stay genuine history. A renewed licence or certificate period (issuedOn / expiresOn) is a real change for
 * every program. A change of NUMBER or issuing JURISDICTION in place is allowed only for BASE_JURISDICTION programs (IFTA:
 * moving the base jurisdiction re-issues the licence). For every other program the number and the issuing jurisdiction
 * identify the registration, so a different one is a mistake to be corrected (or a separate registration), never a change.
 */
export async function changeRegistrationVersion(ctx: OperationContext, rawInput: unknown): Promise<RegistrationMutationResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "registrationId", "effectiveFrom", ...VERSION_FIELD_KEYS])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  const registration = await lockRegistration(ctx, organizationId, registrationId)
  requireActiveRecord(registration)
  const definition = PROGRAM_DEFINITIONS[registration.program]
  const current = await repo.getCurrentVersion(ctx.client, registrationId, true)
  if (!current) throw new RegistrationNotFoundError("Version")

  const values = mergeVersionFields(definition, current, input)
  const jurisdictionChanged =
    values.jurisdiction.country !== current.jurisdictionCountry || values.jurisdiction.region !== current.jurisdictionRegion
  const numberChanged = values.number.normalized !== current.numberNormalized || values.number.display !== current.numberDisplay
  if (!allowsInPlaceIdentityChange(registration.program)) {
    if (jurisdictionChanged) {
      throw new RegistrationValidationError(
        "jurisdiction",
        `The issuing jurisdiction of ${registration.program} cannot change in place; correct a mistake, or record a separate registration.`,
      )
    }
    if (numberChanged) {
      throw new RegistrationValidationError("number", `A ${registration.program} number cannot change in place; record a correction instead.`)
    }
  }

  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  await guarded(() => repo.endVersion(ctx.client, current.id, at))
  await assertNumberFree(ctx, registration.program, values.jurisdiction, values.number.normalized)
  const replacement = await insertVersionGuarded(ctx, registration, values, randomUUID(), "CHANGE", at)

  await record(
    ctx,
    "RECORD_UPDATED",
    "changeRegistrationVersion",
    { resourceType: "registration_version", resourceId: replacement.id, organizationId },
    [versionReferenceChange(current.id, replacement.id)],
  )
  return { view: await loadView(ctx, organizationId, registrationId), reviewMatches: await reviewMatchesFor(ctx, registration.program, values, registrationId) }
}

/**
 * CORRECTION of the current version: the number / jurisdiction / dates were recorded wrongly. The wrong version is
 * preserved but flagged 'corrected' (never ended) and pointed at its replacement, which inherits its business time. The
 * registration is not closed and recreated.
 */
export async function correctRegistrationVersion(ctx: OperationContext, rawInput: unknown): Promise<RegistrationMutationResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "registrationId", ...VERSION_FIELD_KEYS])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")

  const registration = await lockRegistration(ctx, organizationId, registrationId)
  requireActiveRecord(registration)
  const definition = PROGRAM_DEFINITIONS[registration.program]
  const current = await repo.getCurrentVersion(ctx.client, registrationId, true)
  if (!current) throw new RegistrationNotFoundError("Version")

  const values = mergeVersionFields(definition, current, input)
  const replacementId = randomUUID()

  await guarded(() => repo.markVersionCorrected(ctx.client, current.id, replacementId))
  // After the wrong row stops being current it can no longer collide with its own correction.
  await assertNumberFree(ctx, registration.program, values.jurisdiction, values.number.normalized)
  const replacement = await insertVersionGuarded(ctx, registration, values, replacementId, "CORRECTION", current.effectiveFrom)

  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctRegistrationVersion",
    { resourceType: "registration_version", resourceId: replacement.id, organizationId },
    [versionReferenceChange(current.id, replacement.id)],
  )
  return { view: await loadView(ctx, organizationId, registrationId), reviewMatches: await reviewMatchesFor(ctx, registration.program, values, registrationId) }
}

// ---------------------------------------------------------------------------------------------------------------
// registration status
// ---------------------------------------------------------------------------------------------------------------

const statusReferenceChange = (before: string, after: string): FieldChange => ({
  field: "statusPeriod",
  before: reference("registration_status_periods", before),
  after: reference("registration_status_periods", after),
})

/**
 * Records an OBSERVED registration status change. Any distinct status may be recorded; program-specific legality is
 * Rules-layer policy. A return to ACTIVE after the registration was genuinely ACTIVE before is recorded as a
 * REACTIVATION of the SAME registration (same id, same number history), never a new registration.
 */
export async function changeRegistrationStatus(ctx: OperationContext, rawInput: unknown): Promise<RegistrationView> {
  const input = requireObject(rawInput, "input", ["organizationId", "registrationId", "status", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")
  const target = parseStatus(input.status, "status")
  const explicitInstant = input.effectiveFrom === undefined ? null : parseInstant(input.effectiveFrom, "effectiveFrom")

  const registration = await lockRegistration(ctx, organizationId, registrationId)
  requireActiveRecord(registration)
  const current = await repo.getCurrentStatusPeriod(ctx.client, registrationId, true)
  if (!current) throw new RegistrationNotFoundError("Status")

  const from = current.registrationStatus
  if (from === target) throw new RegistrationStateError(`The registration is already ${target}.`)
  const periods = (await repo.listStatusPeriods(ctx.client, [registrationId])).get(registrationId) ?? []
  const wasActiveBefore = periods.some((period) => period.recordStatus === "active" && period.registrationStatus === "ACTIVE")
  const isReturnToActive = target === "ACTIVE" && wasActiveBefore

  const at = await resolveInstant(ctx, explicitInstant, "effectiveFrom")
  await guarded(() => repo.endStatusPeriod(ctx.client, current.id, at))
  const replacement = await guarded(() =>
    repo.insertStatusPeriod(ctx.client, {
      id: randomUUID(),
      registrationId,
      registrationStatus: target,
      periodReason: isReturnToActive ? "REACTIVATION" : "TRANSITION",
      effectiveFrom: at,
    }),
  )
  await record(
    ctx,
    "RECORD_STATUS_CHANGED",
    "changeRegistrationStatus",
    { resourceType: "registration_status_period", resourceId: replacement.id, organizationId },
    [{ field: "status", before: literal(from), after: literal(target) }, statusReferenceChange(current.id, replacement.id)],
  )
  return loadView(ctx, organizationId, registrationId)
}

/**
 * CORRECTION of the current status: it was recorded wrongly. The wrong period is preserved and flagged, never ended (no
 * transition is invented), and the replacement inherits its business time.
 */
export async function correctRegistrationStatus(ctx: OperationContext, rawInput: unknown): Promise<RegistrationView> {
  const input = requireObject(rawInput, "input", ["organizationId", "registrationId", "status"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")
  const status = parseStatus(input.status, "status")

  const registration = await lockRegistration(ctx, organizationId, registrationId)
  requireActiveRecord(registration)
  const current = await repo.getCurrentStatusPeriod(ctx.client, registrationId, true)
  if (!current) throw new RegistrationNotFoundError("Status")
  if (current.registrationStatus === status) throw new RegistrationValidationError("status", "The status is unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markStatusPeriodCorrected(ctx.client, current.id, replacementId))
  const replacement = await guarded(() =>
    repo.insertStatusPeriod(ctx.client, {
      id: replacementId,
      registrationId,
      registrationStatus: status,
      periodReason: "CORRECTION",
      effectiveFrom: current.effectiveFrom,
    }),
  )
  await record(
    ctx,
    "RECORD_CORRECTED",
    "correctRegistrationStatus",
    { resourceType: "registration_status_period", resourceId: replacement.id, organizationId },
    [
      { field: "status", before: literal(current.registrationStatus), after: literal(status) },
      statusReferenceChange(current.id, replacement.id),
    ],
  )
  return loadView(ctx, organizationId, registrationId)
}

// ---------------------------------------------------------------------------------------------------------------
// archive / restore (record lifecycle, not registration status)
// ---------------------------------------------------------------------------------------------------------------

export async function archiveRegistration(ctx: OperationContext, rawInput: unknown): Promise<RegistrationView> {
  const input = requireObject(rawInput, "input", ["organizationId", "registrationId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")

  const registration = await lockRegistration(ctx, organizationId, registrationId)
  if (registration.recordStatus !== "active") throw new RegistrationStateError("This registration record is already archived.")
  await repo.setRegistrationRecordStatus(ctx.client, registrationId, "archived")
  await record(
    ctx,
    "RECORD_ARCHIVED",
    "archiveRegistration",
    { resourceType: "registration", resourceId: registrationId, organizationId },
    [{ field: "recordStatus", before: literal("active"), after: literal("archived") }],
  )
  return loadView(ctx, organizationId, registrationId)
}

export async function restoreRegistration(ctx: OperationContext, rawInput: unknown): Promise<RegistrationView> {
  const input = requireObject(rawInput, "input", ["organizationId", "registrationId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const registrationId = parseUuid(input.registrationId, "registrationId")

  const registration = await lockRegistration(ctx, organizationId, registrationId)
  if (registration.recordStatus !== "archived") throw new RegistrationStateError("Only an archived registration record can be restored.")
  await repo.setRegistrationRecordStatus(ctx.client, registrationId, "active")
  await record(
    ctx,
    "RECORD_RESTORED",
    "restoreRegistration",
    { resourceType: "registration", resourceId: registrationId, organizationId },
    [{ field: "recordStatus", before: literal("archived"), after: literal("active") }],
  )
  return loadView(ctx, organizationId, registrationId)
}

// ---------------------------------------------------------------------------------------------------------------
// reads and lookups (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

/**
 * SYSTEM registry lookup: is this number registered in its namespace, and by whom. Callable only with
 * TAX_REGISTRATION_READ (the service enforces it as the primary capability), so details are always disclosable.
 */
export async function checkRegistrationNumber(client: PoolClient, rawInput: unknown): Promise<NumberCheckResult> {
  const input = requireObject(rawInput, "input", ["program", "number", "jurisdiction"])
  const program = parseProgram(input.program, "program")
  const number = prepareRegistrationNumber(program, input.number, "number")
  const jurisdiction = resolveJurisdiction(program, input.jurisdiction, "jurisdiction")
  const match = await repo.findCurrentNumberHolder(client, program, jurisdiction.country, jurisdiction.region, number.normalized)
  const reviewMatches = await repo.findNumberReviewMatches(client, program, jurisdiction.country, jurisdiction.region, number.normalized, null)
  return { registered: match !== undefined, match: match ?? null, reviewMatches }
}

/**
 * One Organization's registrations: what is true now, optionally what was true at an instant, and the full history.
 * Corrected versions / periods appear only in `versions` / `statusPeriods` (flagged); `current` and `asOf` come from
 * genuine ('active') rows only. Reads only the named Organization's registrations.
 */
export async function readOrganizationRegistrations(
  client: PoolClient,
  organizationId: string,
  options: { asOf?: string } = {},
): Promise<OrganizationRegistrationsView> {
  const id = parseUuid(organizationId, "organizationId")
  if (!(await repo.organizationExists(client, id))) throw new RegistrationNotFoundError("Organization")
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")
  const registrations = await repo.listRegistrations(client, id)
  return { organizationId: id, registrations: await loadViews(client, registrations, asOf) }
}
