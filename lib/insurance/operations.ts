/**
 * Insurance operations: validation, business rules and Master Register events on a caller-supplied transaction.
 *
 * Every function here runs INSIDE a transaction the authorization wrapper already opened, and Master Register events are
 * written through a repository bound to the same client, so a failure anywhere (including the Master Register) rolls the
 * whole change back.
 *
 * LOCK ORDER (every mutation, without exception):
 *   1. the insured Organization row  (all writers of one Organization's insurance serialize here)
 *   2. the policy row                (FOR UPDATE; the database triggers take the same lock, so a writer that somehow
 *                                     bypassed this layer still serializes per policy)
 *   3. dependent rows                (terms, endorsements, coverages, broker periods)
 * The policy-number namespace trigger (advisory lock + check), the unique "current" indexes and the overlap triggers are
 * the structural backstops; a cross-Organization number race is decided by that trigger alone: the loser's insert fails
 * with 23505 under a SAVEPOINT and becomes the same collision result as a pre-check hit.
 *
 * Structure: a POLICY is the stable identity (insured, insurer, family). A TERM is a period with a policy number. A renewal
 * is a new TERM of the same policy (renewPolicy) or a new POLICY pointing at its predecessor (createPolicy renewsPolicyId).
 * COVERAGES are rows inside a term; an ENDORSEMENT is a dated change of coverage: it ends the old coverage row and starts
 * the new state, and both stay history. A BROKER PERIOD is effective-dated broker of record. Nothing is stored about
 * "status": in force / expired / cancelled are read from the dates and the one-way cancellation fact.
 *
 * Correction vs real-world change (migrations 0012-0015):
 *   a real-world change   the old row is ended at T and the next starts at T (renewPolicy, addEndorsement, changeBroker);
 *   a correction          the recorded row was WRONG: it is kept, flagged 'corrected', pointed at its replacement and never
 *                         ended; the replacement inherits its business time. Reads of "current" / "as of" use genuine rows
 *                         only. The coverage rows of a corrected term are implicitly superseded (they count only while
 *                         their term is genuine) and remain attached to that term.
 *
 * Business dates (cancellation, endorsements, broker instants) may be backdated but never lie in the future; the policy
 * period itself (termStart / termEnd) may be future-dated because a renewal is normally bound before it starts.
 *
 * Master Register: events reference rows (table:id) and carry only controlled-vocabulary literals (family, coverage type,
 * endorsement kind, cancellation reason, lifecycle words). Never policy numbers, amounts, dates or insurer names.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  COVERAGE_TYPE_DEFINITIONS,
  coverageInForce,
  coverageWindowEnd,
  isCancellationReason,
  isCoverageType,
  isCurrency,
  isEndorsementKind,
  isFamily,
  isLimitBasis,
  limitBasesOfFamily,
  parseAmount,
  parseCalendarDate,
  prepareNumber,
  scheduleInForce,
  termStateOn,
  type CancellationReason,
  type CoverageType,
  type Currency,
  type EndorsementKind,
  type InsuranceFamily,
  type LimitBasis,
  type PreparedNumber,
} from "@/lib/insurance/definitions"
import {
  InsuranceConflictError,
  InsuranceNotFoundError,
  InsuranceStateError,
  InsuranceValidationError,
  PolicyNumberCollisionError,
  type PolicyNumberHolder,
} from "@/lib/insurance/errors"
import * as repo from "@/lib/insurance/repository"
import type {
  BrokerPeriodRecord,
  CoverageRecord,
  CoverageScheduleView,
  EndorsementRecord,
  OrganizationInsuranceView,
  PolicyNumberCheckResult,
  PolicyRecord,
  PolicyView,
  ScheduledVehicleRecord,
  TermRecord,
  TermView,
  VehicleFamily,
  VehicleInsuranceView,
} from "@/lib/insurance/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
  /** Lazily decides whether this actor also holds INSURANCE_READ (same transaction, memoized): gates collision disclosure. */
  canReadInsurance: () => Promise<boolean>
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InsuranceValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new InsuranceValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new InsuranceValidationError(field, `${field} must be a UUID.`)
}

const optionalUuid = (value: unknown, field: string): string | null => (value === undefined || value === null ? null : parseUuid(value, field))
const optionalDate = (value: unknown, field: string): string | null => (value === undefined || value === null ? null : parseCalendarDate(value, field))

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC at microsecond precision. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new InsuranceValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new InsuranceValidationError(field, `${field} is not a valid instant.`)
  return date.toISOString().replace(/Z$/, "000Z")
}

const optionalInstant = (value: unknown, field: string): string | null => (value === undefined || value === null ? null : parseInstant(value, field))

function parseFamily(value: unknown): InsuranceFamily {
  if (!isFamily(value)) throw new InsuranceValidationError("family", "family must be INSURANCE, WORKERS_COMPENSATION or BOND.")
  return value
}

/** One coverage row's content. Optional members are null when absent. */
export type CoverageSpec = {
  coverageType: CoverageType
  limitAmount: string | null
  deductibleAmount: string | null
  currency: Currency | null
  limitBasis: LimitBasis | null
  scheduledVehiclesOnly: boolean
}

const COVERAGE_KEYS = ["coverageType", "limitAmount", "deductibleAmount", "currency", "limitBasis", "scheduledVehiclesOnly"] as const
const nullish = (value: unknown): boolean => value === undefined || value === null

/** Structural parse of a coverage's content (family rules are applied by assertCoverageSpec once the family is known). */
function parseCoverageSpec(raw: unknown, field: string): CoverageSpec {
  const input = requireObject(raw, field, COVERAGE_KEYS)
  if (!isCoverageType(input.coverageType)) throw new InsuranceValidationError(`${field}.coverageType`, `${field}.coverageType must be a supported coverage type.`)
  if (!nullish(input.currency) && !isCurrency(input.currency)) throw new InsuranceValidationError(`${field}.currency`, `${field}.currency must be CAD or USD.`)
  if (!nullish(input.limitBasis) && !isLimitBasis(input.limitBasis)) throw new InsuranceValidationError(`${field}.limitBasis`, `${field}.limitBasis must be a supported limit basis.`)
  if (!nullish(input.scheduledVehiclesOnly) && typeof input.scheduledVehiclesOnly !== "boolean") {
    throw new InsuranceValidationError(`${field}.scheduledVehiclesOnly`, `${field}.scheduledVehiclesOnly must be true or false.`)
  }
  return {
    coverageType: input.coverageType,
    limitAmount: nullish(input.limitAmount) ? null : parseAmount(input.limitAmount, `${field}.limitAmount`, { allowZero: false }),
    deductibleAmount: nullish(input.deductibleAmount) ? null : parseAmount(input.deductibleAmount, `${field}.deductibleAmount`, { allowZero: true }),
    currency: nullish(input.currency) ? null : (input.currency as Currency),
    limitBasis: nullish(input.limitBasis) ? null : (input.limitBasis as LimitBasis),
    scheduledVehiclesOnly: input.scheduledVehiclesOnly === true,
  }
}

/** The family-dependent rules the database also enforces (the server states them first, with field names). */
function assertCoverageSpec(spec: CoverageSpec, family: InsuranceFamily, field: string): void {
  const definition = COVERAGE_TYPE_DEFINITIONS[spec.coverageType]
  if (definition.family !== family) throw new InsuranceValidationError(`${field}.coverageType`, `${spec.coverageType} is not a ${family} coverage.`)
  if (definition.limitRequired && spec.limitAmount === null) throw new InsuranceValidationError(`${field}.limitAmount`, `${spec.coverageType} requires a limit.`)
  if (!definition.limitRequired && spec.limitAmount !== null) throw new InsuranceValidationError(`${field}.limitAmount`, `${spec.coverageType} is statutory and takes no limit.`)
  const hasAmount = spec.limitAmount !== null || spec.deductibleAmount !== null
  if (hasAmount && spec.currency === null) throw new InsuranceValidationError(`${field}.currency`, "A currency is required with an amount.")
  if (!hasAmount && spec.currency !== null) throw new InsuranceValidationError(`${field}.currency`, "A currency is only accepted with an amount.")
  if (spec.limitBasis !== null) {
    if (spec.limitAmount === null) throw new InsuranceValidationError(`${field}.limitBasis`, "A limit basis needs a limit.")
    if (!limitBasesOfFamily(family).includes(spec.limitBasis)) throw new InsuranceValidationError(`${field}.limitBasis`, `${spec.limitBasis} does not apply to a ${family} limit.`)
  }
  if (spec.scheduledVehiclesOnly && family !== "INSURANCE") throw new InsuranceValidationError(`${field}.scheduledVehiclesOnly`, "Only insurance coverage can be limited to scheduled vehicles.")
}

function parseCoverageList(raw: unknown, family: InsuranceFamily, field: string): CoverageSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new InsuranceValidationError(field, `${field} must list at least one coverage.`)
  if (raw.length > 20) throw new InsuranceValidationError(field, `${field} lists too many coverages.`)
  const specs = raw.map((item, index) => {
    const spec = parseCoverageSpec(item, `${field}[${index}]`)
    assertCoverageSpec(spec, family, `${field}[${index}]`)
    return spec
  })
  const seen = new Set<string>()
  for (const spec of specs) {
    if (seen.has(spec.coverageType)) throw new InsuranceValidationError(field, `${spec.coverageType} is listed more than once.`)
    seen.add(spec.coverageType)
  }
  return specs
}

/** Fields of a coverage correction: absent = inherit, null = clear, a value = replace. */
type CoveragePatch = { [K in keyof CoverageSpec]?: CoverageSpec[K] }

function parseCoveragePatch(input: Record<string, unknown>, allowType: boolean): CoveragePatch {
  const patch: CoveragePatch = {}
  if (input.coverageType !== undefined) {
    if (!allowType) throw new InsuranceValidationError("coverageType", "The coverage type of an endorsement cannot be corrected.")
    if (!isCoverageType(input.coverageType)) throw new InsuranceValidationError("coverageType", "coverageType must be a supported coverage type.")
    patch.coverageType = input.coverageType
  }
  if (input.limitAmount !== undefined) patch.limitAmount = input.limitAmount === null ? null : parseAmount(input.limitAmount, "limitAmount", { allowZero: false })
  if (input.deductibleAmount !== undefined) patch.deductibleAmount = input.deductibleAmount === null ? null : parseAmount(input.deductibleAmount, "deductibleAmount", { allowZero: true })
  if (input.currency !== undefined) {
    if (input.currency !== null && !isCurrency(input.currency)) throw new InsuranceValidationError("currency", "currency must be CAD or USD.")
    patch.currency = input.currency as Currency | null
  }
  if (input.limitBasis !== undefined) {
    if (input.limitBasis !== null && !isLimitBasis(input.limitBasis)) throw new InsuranceValidationError("limitBasis", "limitBasis must be a supported limit basis.")
    patch.limitBasis = input.limitBasis as LimitBasis | null
  }
  if (input.scheduledVehiclesOnly !== undefined) {
    if (typeof input.scheduledVehiclesOnly !== "boolean") throw new InsuranceValidationError("scheduledVehiclesOnly", "scheduledVehiclesOnly must be true or false.")
    patch.scheduledVehiclesOnly = input.scheduledVehiclesOnly
  }
  return patch
}

function specOf(row: CoverageRecord): CoverageSpec {
  return {
    coverageType: row.coverageType,
    limitAmount: row.limitAmount,
    deductibleAmount: row.deductibleAmount,
    currency: row.currency,
    limitBasis: row.limitBasis,
    scheduledVehiclesOnly: row.scheduledVehiclesOnly,
  }
}

/** Applies a patch to an existing coverage state. The currency follows the amounts unless the patch names it. */
function mergeSpec(current: CoverageSpec, patch: CoveragePatch): CoverageSpec {
  const merged: CoverageSpec = { ...current, ...patch }
  const hasAmount = merged.limitAmount !== null || merged.deductibleAmount !== null
  if (patch.currency === undefined) merged.currency = hasAmount ? current.currency : null
  if (patch.limitBasis === undefined && merged.limitAmount === null) merged.limitBasis = null
  return merged
}

const sameSpec = (a: CoverageSpec, b: CoverageSpec): boolean =>
  a.coverageType === b.coverageType &&
  a.limitAmount === b.limitAmount &&
  a.deductibleAmount === b.deductibleAmount &&
  a.currency === b.currency &&
  a.limitBasis === b.limitBasis &&
  a.scheduledVehiclesOnly === b.scheduledVehiclesOnly

function assertPeriod(family: InsuranceFamily, termStart: string, termEnd: string | null): void {
  if (termEnd === null && family !== "BOND") throw new InsuranceValidationError("termEnd", "termEnd is required (only a continuous bond has no stated expiry).")
  if (termEnd !== null && termEnd <= termStart) throw new InsuranceValidationError("termEnd", "termEnd must be after termStart.")
}

// ---------------------------------------------------------------------------------------------------------------
// Database error translation
// ---------------------------------------------------------------------------------------------------------------

function constraintOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? ((error as { constraint?: string }).constraint ?? undefined) : undefined
}
const codeOf = (error: unknown): string | undefined => (typeof error === "object" && error !== null ? ((error as { code?: string }).code ?? undefined) : undefined)

/** Translates the documented database backstops into domain errors; anything else propagates unchanged. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    // A deadlock or serialization failure between writers is a retryable conflict, not a server fault.
    if (codeOf(error) === "40P01" || codeOf(error) === "40001") throw new InsuranceConflictError("A concurrent change was made; retry the operation.")
    const constraint = constraintOf(error)
    if (constraint === undefined) throw error
    if (constraint === repo.TERM_NO_OVERLAP_CONSTRAINT) throw new InsuranceValidationError("termStart", "Terms of one policy cannot overlap.")
    if (constraint === repo.TERM_POLICY_ACTIVE_CONSTRAINT || constraint === repo.BROKER_POLICY_ACTIVE_CONSTRAINT) throw new InsuranceStateError("This policy is archived; restore it first.")
    if (constraint === repo.ORGANIZATION_ACTIVE_CONSTRAINT) throw new InsuranceStateError("An Organization on this policy is not active.")
    if (constraint === repo.ENDORSEMENT_WINDOW_CONSTRAINT || constraint === repo.COVERAGE_WINDOW_CONSTRAINT) {
      throw new InsuranceValidationError("effectiveOn", "The date must fall inside the active term and not after its cancellation.")
    }
    if (constraint === repo.ENDORSEMENT_NUMBER_CONSTRAINT) throw new InsuranceConflictError("This endorsement number is already used in the term.")
    if (constraint === repo.COVERAGE_LIMIT_RULES_CONSTRAINT) throw new InsuranceValidationError("limitAmount", "The limit does not satisfy the rules of the coverage type.")
    if ((repo.COVERAGE_OVERLAP_CONSTRAINTS as readonly string[]).includes(constraint)) throw new InsuranceConflictError("This coverage is already in force for that period, or a concurrent change was made.")
    if (constraint === repo.CURRENT_BROKER_CONSTRAINT) throw new InsuranceConflictError("A concurrent broker change was made; retry the operation.")
    if (constraint === repo.BROKER_CONTACT_ACTIVE_CONSTRAINT) throw new InsuranceValidationError("brokerPersonId", "The broker contact must hold an active relationship with the brokerage firm.")
    if ((repo.REQUIRED_STATE_CONSTRAINTS as readonly string[]).includes(constraint)) throw new InsuranceStateError("The change would leave the policy without an active term or coverage; nothing was changed.")
    if ((repo.CHECK_CONSTRAINTS as readonly string[]).includes(constraint)) throw new InsuranceValidationError("input", "The values are not consistent with the insurance rules.")
    if (constraint === repo.SCHEDULE_COVERAGE_ACTIVE_CONSTRAINT) throw new InsuranceStateError("The coverage or its term was corrected or is not active; schedule the vehicle on the genuine coverage.")
    if (constraint === repo.SCHEDULE_SAME_ORGANIZATION_CONSTRAINT) throw new InsuranceNotFoundError("Coverage")
    if (constraint === repo.SCHEDULE_COVERAGE_SCHEDULED_CONSTRAINT) throw new InsuranceStateError("This coverage applies to the whole fleet; it does not list vehicles.")
    if (constraint === repo.SCHEDULE_INSIDE_COVERAGE_CONSTRAINT) throw new InsuranceValidationError("effectiveFrom", "The schedule must lie inside the coverage period.")
    if (constraint === repo.SCHEDULE_VEHICLE_ACTIVE_CONSTRAINT) throw new InsuranceStateError("The vehicle does not exist or is archived or merged, and cannot be newly scheduled.")
    if (constraint === repo.SCHEDULE_VEHICLE_OPERATED_CONSTRAINT) throw new InsuranceValidationError("vehicleId", "The vehicle must be operated by the insured Organization when the schedule starts.")
    if ((repo.SCHEDULE_OVERLAP_CONSTRAINTS as readonly string[]).includes(constraint)) throw new InsuranceConflictError("This vehicle is already scheduled on the coverage for that period, or a concurrent change was made.")
    if ((repo.SCHEDULE_CHECK_CONSTRAINTS as readonly string[]).includes(constraint)) throw new InsuranceValidationError("input", "The values are not consistent with the insurance rules.")
    throw error
  }
}

const SAVEPOINT = "tes_insurance_number_claim"

/**
 * Runs `work` (which writes a term that claims a policy number) under a SAVEPOINT, so a number-namespace violation from a
 * concurrent writer (which the pre-check cannot see) becomes the same collision result instead of an aborted transaction.
 * Any other error propagates unchanged for `guarded` to translate.
 */
async function claimingNumber<T>(ctx: OperationContext, claim: { insurerOrganizationId: string; numberNormalized: string; ownPolicyId: string | null }, work: () => Promise<T>): Promise<T> {
  await repo.savepoint(ctx.client, SAVEPOINT)
  try {
    const result = await work()
    await repo.releaseSavepoint(ctx.client, SAVEPOINT)
    return result
  } catch (error) {
    if (constraintOf(error) === repo.NUMBER_NAMESPACE_CONSTRAINT) {
      await repo.rollbackToSavepoint(ctx.client, SAVEPOINT)
      const winner = await repo.findNumberHolder(ctx.client, claim.insurerOrganizationId, claim.numberNormalized, claim.ownPolicyId)
      throw await collisionError(ctx, winner)
    }
    throw error
  }
}

async function collisionError(ctx: OperationContext, holder: PolicyNumberHolder | undefined): Promise<PolicyNumberCollisionError> {
  const disclose = holder !== undefined && (await ctx.canReadInsurance())
  return new PolicyNumberCollisionError(disclose ? holder : undefined)
}

/** Explanatory pre-check on the same transaction. The namespace trigger remains the final arbiter (see claimingNumber). */
async function assertNumberFree(ctx: OperationContext, insurerOrganizationId: string, numberNormalized: string, ownPolicyId: string | null): Promise<void> {
  const holder = await repo.findNumberHolder(ctx.client, insurerOrganizationId, numberNormalized, ownPolicyId)
  if (holder) throw await collisionError(ctx, holder)
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED" | "RECORD_STATUS_CHANGED" | "RECORD_ARCHIVED" | "RECORD_RESTORED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })

type ResourceType = "insurance_policy" | "insurance_policy_term" | "insurance_endorsement" | "insurance_coverage" | "insurance_broker_period" | "insurance_coverage_vehicle"

/**
 * Policy numbers, amounts, dates and insurer names are never copied into the Master Register: events reference the rows,
 * which are the record of what they were. Family, coverage type, endorsement kind and cancellation reason are small
 * controlled-vocabulary values and are recorded as such.
 */
async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  target: { resourceType: ResourceType; resourceId: string; organizationId: string },
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
    source: { sourceType: "APPLICATION", component: "insurance", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

async function recordCoverageCreated(ctx: OperationContext, operation: string, organizationId: string, coverageId: string, termId: string, spec: CoverageSpec): Promise<void> {
  await record(ctx, "RECORD_CREATED", operation, { resourceType: "insurance_coverage", resourceId: coverageId, organizationId }, [
    { field: "coverage", before: literal(null), after: reference("insurance_coverages", coverageId) },
    { field: "term", before: literal(null), after: reference("insurance_policy_terms", termId) },
    { field: "coverageType", before: literal(null), after: literal(spec.coverageType) },
  ])
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

async function lockActiveOrganization(ctx: OperationContext, organizationId: string): Promise<void> {
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new InsuranceNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new InsuranceStateError(
      organization.status === "merged"
        ? "This Organization has been merged; its insurance can no longer be changed."
        : "This Organization is archived; restore it before changing its insurance.",
    )
  }
}

type LockedPolicy = { organizationId: string; policy: PolicyRecord }

/** Locks the insured Organization (active), then the policy (lock order steps 1-2). */
async function lockPolicy(ctx: OperationContext, policyId: string, options: { requireActivePolicy: boolean }): Promise<LockedPolicy> {
  const organizationId = await repo.findPolicyOrganization(ctx.client, policyId)
  if (!organizationId) throw new InsuranceNotFoundError("Policy")
  await lockActiveOrganization(ctx, organizationId)
  const policy = await repo.getPolicy(ctx.client, policyId, true)
  if (!policy) throw new InsuranceNotFoundError("Policy")
  if (options.requireActivePolicy && policy.recordStatus !== "active") throw new InsuranceStateError("This policy is archived; restore it before changing it.")
  return { organizationId, policy }
}

type LockedTerm = LockedPolicy & { term: TermRecord }

/** As lockPolicy, then the term; the term must be genuine (a corrected term is frozen history). */
async function lockTerm(ctx: OperationContext, termId: string): Promise<LockedTerm> {
  const policyId = await repo.findTermPolicy(ctx.client, termId)
  if (!policyId) throw new InsuranceNotFoundError("Term")
  const locked = await lockPolicy(ctx, policyId, { requireActivePolicy: true })
  const term = await repo.getTerm(ctx.client, termId, true)
  if (!term) throw new InsuranceNotFoundError("Term")
  if (term.recordStatus !== "active") throw new InsuranceStateError("This term was corrected; work with its replacement.")
  return { ...locked, term }
}

async function requireActiveInsurer(ctx: OperationContext, insurerOrganizationId: string): Promise<void> {
  const insurer = await repo.getOrganization(ctx.client, insurerOrganizationId)
  if (!insurer) throw new InsuranceNotFoundError("Insurer Organization")
  if (insurer.status !== "active") throw new InsuranceStateError("The insurer Organization is not active.")
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) throw new InsuranceValidationError(field, `${field} cannot be in the future.`)
  return explicit
}

async function assertNotFutureDate(ctx: OperationContext, date: string, field: string): Promise<void> {
  if (!(await repo.isDateNotInFuture(ctx.client, date))) throw new InsuranceValidationError(field, `${field} cannot be in the future.`)
}

/** An endorsement date lies inside the term and not after a cancellation. */
function assertInsideTerm(term: { termStart: string; termEnd: string | null; cancelledOn: string | null }, date: string, field: string): void {
  if (date < term.termStart || (term.termEnd !== null && date >= term.termEnd)) throw new InsuranceValidationError(field, `${field} must fall inside the term.`)
  if (term.cancelledOn !== null && date > term.cancelledOn) throw new InsuranceValidationError(field, `${field} cannot be after the term's cancellation.`)
}

type BrokerInput = { brokerOrganizationId: string; brokerPersonId: string | null; effectiveFrom: string | null }

function parseBroker(raw: unknown, field: string): BrokerInput {
  const input = requireObject(raw, field, ["brokerOrganizationId", "brokerPersonId", "effectiveFrom"])
  return {
    brokerOrganizationId: parseUuid(input.brokerOrganizationId, `${field}.brokerOrganizationId`),
    brokerPersonId: optionalUuid(input.brokerPersonId, `${field}.brokerPersonId`),
    effectiveFrom: optionalInstant(input.effectiveFrom, `${field}.effectiveFrom`),
  }
}

/** The brokerage must be an active Organization; a named contact must hold an ACTIVE relationship with it (Contacts, 0014). */
async function resolveBroker(ctx: OperationContext, brokerOrganizationId: string, brokerPersonId: string | null, field: string): Promise<{ relationshipId: string | null }> {
  const brokerage = await repo.getOrganization(ctx.client, brokerOrganizationId)
  if (!brokerage) throw new InsuranceNotFoundError("Broker Organization")
  if (brokerage.status !== "active") throw new InsuranceStateError("The brokerage Organization is not active.")
  if (brokerPersonId === null) return { relationshipId: null }
  const relationshipId = await repo.findActiveRelationship(ctx.client, brokerOrganizationId, brokerPersonId)
  if (!relationshipId) throw new InsuranceValidationError(`${field}.brokerPersonId`, "The broker contact must hold an active relationship with the brokerage firm.")
  return { relationshipId }
}

// ---------------------------------------------------------------------------------------------------------------
// Views and reads (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

const startOfDay = (date: string): string => `${date}T00:00:00.000000Z`

function assemblePolicy(
  policy: PolicyRecord,
  terms: TermRecord[],
  endorsements: Map<string, EndorsementRecord[]>,
  coverages: Map<string, CoverageRecord[]>,
  brokers: BrokerPeriodRecord[],
  date: string,
): PolicyView {
  const termViews: TermView[] = terms.map((term) => ({
    term,
    state: termStateOn(term, date),
    endorsements: endorsements.get(term.id) ?? [],
    coverages: coverages.get(term.id) ?? [],
  }))
  const inForceTerm = termViews.find((view) => view.state === "IN_FORCE")
  const at = startOfDay(date)
  const genuine = terms.filter((term) => term.recordStatus === "active")
  return {
    policy,
    terms: termViews,
    brokerPeriods: brokers,
    asOf: {
      date,
      inForce: inForceTerm !== undefined,
      term: inForceTerm?.term ?? null,
      coverages: inForceTerm ? inForceTerm.coverages.filter((row) => coverageInForce(row, inForceTerm.state, date)) : [],
      broker: brokers.find((row) => row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)) ?? null,
    },
    current: {
      latestTerm: genuine.length > 0 ? genuine[genuine.length - 1] : null,
      broker: brokers.find((row) => row.recordStatus === "active" && row.effectiveTo === null) ?? null,
    },
  }
}

async function loadPolicies(client: PoolClient, policies: PolicyRecord[], date: string): Promise<PolicyView[]> {
  const policyIds = policies.map((row) => row.id)
  const terms = await repo.listTerms(client, policyIds)
  const termIds = [...terms.values()].flat().map((row) => row.id)
  const [endorsements, coverages, brokers] = await Promise.all([repo.listEndorsements(client, termIds), repo.listCoverages(client, termIds), repo.listBrokerPeriods(client, policyIds)])
  return policies.map((policy) => assemblePolicy(policy, terms.get(policy.id) ?? [], endorsements, coverages, brokers.get(policy.id) ?? [], date))
}

async function loadPolicy(ctx: OperationContext, policyId: string): Promise<PolicyView> {
  const policy = await repo.getPolicy(ctx.client, policyId)
  if (!policy) throw new InsuranceNotFoundError("Policy")
  return (await loadPolicies(ctx.client, [policy], await repo.databaseToday(ctx.client)))[0]
}

/** All the insurance of one Organization (as insured), read on an as-of calendar date (the database date by default). */
export async function readOrganizationInsurance(client: PoolClient, rawOrganizationId: unknown, options: { asOf?: string } = {}): Promise<OrganizationInsuranceView> {
  const organizationId = parseUuid(rawOrganizationId, "organizationId")
  const requested = options.asOf === undefined ? null : parseCalendarDate(options.asOf, "asOf")
  const organization = await repo.getOrganization(client, organizationId)
  if (!organization) throw new InsuranceNotFoundError("Organization")
  const asOfDate = requested ?? (await repo.databaseToday(client))
  const policies = await loadPolicies(client, await repo.listPolicies(client, organizationId), asOfDate)
  return { organizationId, asOfDate, policies }
}

/** The policy-number registry: is this number held within this insurer's namespace, and by which policy. */
export async function checkPolicyNumber(client: PoolClient, rawInsurerOrganizationId: unknown, rawNumber: unknown): Promise<PolicyNumberCheckResult> {
  const insurerOrganizationId = parseUuid(rawInsurerOrganizationId, "insurerOrganizationId")
  const number = prepareNumber(rawNumber, "policyNumber")
  if (!(await repo.getOrganization(client, insurerOrganizationId))) throw new InsuranceNotFoundError("Insurer Organization")
  const holder = await repo.findNumberHolder(client, insurerOrganizationId, number.normalized, null)
  return {
    insurerOrganizationId,
    number: { display: number.display, normalized: number.normalized, ruleVersion: number.ruleVersion },
    registered: holder !== undefined,
    holder: holder ?? null,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// createPolicy
// ---------------------------------------------------------------------------------------------------------------

/**
 * Creates a policy (stable identity), its first term with at least one coverage and, optionally, its first broker period,
 * in one transaction. With `renewsPolicyId` the policy is the NEW-POLICY form of a renewal (same Organization and family).
 */
export async function createPolicy(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["organizationId", "insurerOrganizationId", "family", "policyNumber", "termStart", "termEnd", "coverages", "broker", "renewsPolicyId"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const insurerOrganizationId = parseUuid(input.insurerOrganizationId, "insurerOrganizationId")
  if (insurerOrganizationId === organizationId) throw new InsuranceValidationError("insurerOrganizationId", "The insurer must be a different Organization from the insured.")
  const family = parseFamily(input.family)
  const number = prepareNumber(input.policyNumber, "policyNumber")
  const termStart = parseCalendarDate(input.termStart, "termStart")
  const termEnd = optionalDate(input.termEnd, "termEnd")
  assertPeriod(family, termStart, termEnd)
  const coverages = parseCoverageList(input.coverages, family, "coverages")
  const broker = input.broker === undefined || input.broker === null ? null : parseBroker(input.broker, "broker")
  const renewsPolicyId = optionalUuid(input.renewsPolicyId, "renewsPolicyId")

  await lockActiveOrganization(ctx, organizationId)
  await requireActiveInsurer(ctx, insurerOrganizationId)
  const brokerContact = broker ? await resolveBroker(ctx, broker.brokerOrganizationId, broker.brokerPersonId, "broker") : null
  if (renewsPolicyId) {
    const predecessor = await repo.getPolicy(ctx.client, renewsPolicyId)
    if (!predecessor) throw new InsuranceNotFoundError("Predecessor policy")
    if (predecessor.organizationId !== organizationId || predecessor.family !== family) {
      throw new InsuranceValidationError("renewsPolicyId", "A renewed policy must belong to the same Organization and family.")
    }
  }
  const brokerFrom = broker ? await resolveInstant(ctx, broker.effectiveFrom, "broker.effectiveFrom") : null
  await assertNumberFree(ctx, insurerOrganizationId, number.normalized, null)

  const policyId = randomUUID()
  const termId = randomUUID()
  const coverageIds = coverages.map(() => randomUUID())
  await claimingNumber(ctx, { insurerOrganizationId, numberNormalized: number.normalized, ownPolicyId: null }, async () => {
    await guarded(() => repo.insertPolicy(ctx.client, { id: policyId, organizationId, insurerOrganizationId, family, renewsPolicyId }))
    await guarded(() =>
      repo.insertTerm(ctx.client, { id: termId, policyId, organizationId, insurerOrganizationId, family, numberDisplay: number.display, numberNormalized: number.normalized, ruleVersion: number.ruleVersion, termStart, termEnd, termReason: "INITIAL" }),
    )
    for (const [index, spec] of coverages.entries()) {
      await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(coverageIds[index], termId, policyId, organizationId, family, spec, termStart, null)))
    }
  })
  const brokerPeriodId = randomUUID()
  if (broker && brokerFrom) {
    await guarded(() =>
      repo.insertBrokerPeriod(ctx.client, { id: brokerPeriodId, policyId, organizationId, brokerOrganizationId: broker.brokerOrganizationId, brokerRelationshipId: brokerContact?.relationshipId ?? null, brokerPersonId: broker.brokerPersonId, effectiveFrom: brokerFrom }),
    )
  }

  await record(ctx, "RECORD_CREATED", "createPolicy", { resourceType: "insurance_policy", resourceId: policyId, organizationId }, [
    { field: "policy", before: literal(null), after: reference("insurance_policies", policyId) },
    { field: "family", before: literal(null), after: literal(family) },
    { field: "insurer", before: literal(null), after: reference("organizations", insurerOrganizationId) },
    ...(renewsPolicyId ? [{ field: "renews", before: literal(null), after: reference("insurance_policies", renewsPolicyId) }] : []),
  ])
  await record(ctx, "RECORD_CREATED", "createPolicy", { resourceType: "insurance_policy_term", resourceId: termId, organizationId }, [
    { field: "term", before: literal(null), after: reference("insurance_policy_terms", termId) },
    { field: "termReason", before: literal(null), after: literal("INITIAL") },
  ])
  for (const [index, spec] of coverages.entries()) await recordCoverageCreated(ctx, "createPolicy", organizationId, coverageIds[index], termId, spec)
  if (broker) {
    await record(ctx, "RECORD_CREATED", "createPolicy", { resourceType: "insurance_broker_period", resourceId: brokerPeriodId, organizationId }, [
      { field: "brokerPeriod", before: literal(null), after: reference("insurance_broker_periods", brokerPeriodId) },
      { field: "broker", before: literal(null), after: reference("organizations", broker.brokerOrganizationId) },
    ])
  }
  return loadPolicy(ctx, policyId)
}

function coverageInsert(id: string, termId: string, policyId: string, organizationId: string, family: InsuranceFamily, spec: CoverageSpec, effectiveFrom: string, endorsementId: string | null): repo.CoverageInsert {
  return { id, termId, policyId, organizationId, family, ...spec, effectiveFrom, endorsementId }
}

// ---------------------------------------------------------------------------------------------------------------
// renewPolicy (a new TERM of the same policy)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Records a renewal as a new term of the SAME policy. The number may change (when omitted the previous term's number is
 * kept). A new term can start only when the previous one has ended - on or after its stated end, or on or after its
 * cancellation date when it was cancelled - so the terms of a policy never overlap.
 *
 * A renewal does NOT carry the vehicle schedule: it is a new period with new coverage rows, and the vehicles it insures are
 * scheduled on them again, explicitly (scheduleVehicle). The previous term's schedule stays attached to its own coverage rows
 * as history.
 */
export async function renewPolicy(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["policyId", "policyNumber", "termStart", "termEnd", "coverages"])
  const policyId = parseUuid(input.policyId, "policyId")
  const explicitNumber = input.policyNumber === undefined || input.policyNumber === null ? null : prepareNumber(input.policyNumber, "policyNumber")
  const termStart = parseCalendarDate(input.termStart, "termStart")
  const termEnd = optionalDate(input.termEnd, "termEnd")

  const { organizationId, policy } = await lockPolicy(ctx, policyId, { requireActivePolicy: true })
  assertPeriod(policy.family, termStart, termEnd)
  const coverages = parseCoverageList(input.coverages, policy.family, "coverages")
  await requireActiveInsurer(ctx, policy.insurerOrganizationId)

  const terms = await repo.listActiveTerms(ctx.client, policyId, true)
  const previous = terms[terms.length - 1]
  if (!previous) throw new InsuranceStateError("This policy has no active term to renew.")
  const earliestStart = previous.cancelledOn ?? previous.termEnd
  if (earliestStart === null) throw new InsuranceStateError("The previous term has no stated expiry; cancel it before recording a renewal.")
  if (termStart < earliestStart) {
    throw new InsuranceValidationError("termStart", "A renewal must start on or after the date the previous term ended or was cancelled.")
  }
  const number: PreparedNumber = explicitNumber ?? { display: previous.numberDisplay, normalized: previous.numberNormalized, ruleVersion: previous.normalizationRuleVersion }
  await assertNumberFree(ctx, policy.insurerOrganizationId, number.normalized, policyId)

  const termId = randomUUID()
  const coverageIds = coverages.map(() => randomUUID())
  await claimingNumber(ctx, { insurerOrganizationId: policy.insurerOrganizationId, numberNormalized: number.normalized, ownPolicyId: policyId }, async () => {
    await guarded(() =>
      repo.insertTerm(ctx.client, {
        id: termId,
        policyId,
        organizationId,
        insurerOrganizationId: policy.insurerOrganizationId,
        family: policy.family,
        numberDisplay: number.display,
        numberNormalized: number.normalized,
        ruleVersion: number.ruleVersion,
        termStart,
        termEnd,
        termReason: "RENEWAL",
      }),
    )
    for (const [index, spec] of coverages.entries()) {
      await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(coverageIds[index], termId, policyId, organizationId, policy.family, spec, termStart, null)))
    }
  })
  await record(ctx, "RECORD_CREATED", "renewPolicy", { resourceType: "insurance_policy_term", resourceId: termId, organizationId }, [
    { field: "term", before: reference("insurance_policy_terms", previous.id), after: reference("insurance_policy_terms", termId) },
    { field: "termReason", before: literal(null), after: literal("RENEWAL") },
  ])
  for (const [index, spec] of coverages.entries()) await recordCoverageCreated(ctx, "renewPolicy", organizationId, coverageIds[index], termId, spec)
  return loadPolicy(ctx, policyId)
}

/**
 * When a caller names the Organization a request is made under (the company route does), the policy must belong to it.
 * A mismatch looks exactly like a missing policy, so a URL cannot be used to touch another company's record.
 */
function assertScopedOrganization(requested: unknown, actual: string): void {
  if (requested === undefined) return
  if (parseUuid(requested, "organizationId") !== actual) throw new InsuranceNotFoundError("Policy")
}

// ---------------------------------------------------------------------------------------------------------------
// cancelTerm
// ---------------------------------------------------------------------------------------------------------------

/** The one-way cancellation fact: a date inside the term (never in the future) and a controlled reason. */
export async function cancelTerm(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["termId", "organizationId", "cancelledOn", "reason"])
  const termId = parseUuid(input.termId, "termId")
  const cancelledOn = parseCalendarDate(input.cancelledOn, "cancelledOn")
  if (!isCancellationReason(input.reason)) throw new InsuranceValidationError("reason", "reason must be a supported cancellation reason.")
  const reason: CancellationReason = input.reason

  const { organizationId, policy, term } = await lockTerm(ctx, termId)
  assertScopedOrganization(input.organizationId, organizationId)
  if (term.cancelledOn !== null) throw new InsuranceStateError("This term is already cancelled; correct the term to change the cancellation.")
  if (cancelledOn < term.termStart || (term.termEnd !== null && cancelledOn > term.termEnd)) {
    throw new InsuranceValidationError("cancelledOn", "The cancellation date must fall within the term.")
  }
  await assertNotFutureDate(ctx, cancelledOn, "cancelledOn")
  const endorsements = await repo.listActiveEndorsements(ctx.client, termId)
  const latest = endorsements[endorsements.length - 1]
  if (latest && cancelledOn < latest.effectiveOn) {
    throw new InsuranceValidationError("cancelledOn", "An endorsement is dated after that cancellation; it must be corrected first.")
  }
  await guarded(() => repo.setTermCancellation(ctx.client, termId, cancelledOn, reason))
  await record(ctx, "RECORD_STATUS_CHANGED", "cancelTerm", { resourceType: "insurance_policy_term", resourceId: termId, organizationId }, [
    { field: "cancellation", before: literal(null), after: literal(reason) },
  ])
  return loadPolicy(ctx, policy.id)
}

// ---------------------------------------------------------------------------------------------------------------
// addEndorsement
// ---------------------------------------------------------------------------------------------------------------

/**
 * Records an endorsement and the coverage transition it causes, atomically:
 *   COVERAGE_ADDED    inserts a coverage row starting on effectiveOn (linked to the endorsement);
 *   COVERAGE_CHANGED  ends the CURRENT row of that type on effectiveOn (ended_by the endorsement) and inserts the new state;
 *   COVERAGE_REMOVED  ends the current row on effectiveOn.
 * Endorsements are appended: a date at or before the current state's start is refused (correct the earlier one instead).
 */
export async function addEndorsement(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["termId", "kind", "effectiveOn", "endorsementNumber", "coverage"])
  const termId = parseUuid(input.termId, "termId")
  if (!isEndorsementKind(input.kind)) throw new InsuranceValidationError("kind", "kind must be a supported endorsement kind.")
  const kind: EndorsementKind = input.kind
  const effectiveOn = parseCalendarDate(input.effectiveOn, "effectiveOn")
  const number = input.endorsementNumber === undefined || input.endorsementNumber === null ? null : prepareNumber(input.endorsementNumber, "endorsementNumber")
  const rawCoverage = input.coverage
  if (rawCoverage === undefined || rawCoverage === null) throw new InsuranceValidationError("coverage", "coverage is required.")
  const removal = kind === "COVERAGE_REMOVED"
  const spec = removal
    ? (() => {
        const type = requireObject(rawCoverage, "coverage", ["coverageType"]).coverageType
        if (!isCoverageType(type)) throw new InsuranceValidationError("coverage.coverageType", "coverage.coverageType must be a supported coverage type.")
        return { coverageType: type, limitAmount: null, deductibleAmount: null, currency: null, limitBasis: null, scheduledVehiclesOnly: false } satisfies CoverageSpec
      })()
    : parseCoverageSpec(rawCoverage, "coverage")

  const { organizationId, policy, term } = await lockTerm(ctx, termId)
  assertInsideTerm(term, effectiveOn, "effectiveOn")
  await assertNotFutureDate(ctx, effectiveOn, "effectiveOn")
  if (COVERAGE_TYPE_DEFINITIONS[spec.coverageType].family !== policy.family) {
    throw new InsuranceValidationError("coverage.coverageType", `${spec.coverageType} is not a ${policy.family} coverage.`)
  }
  if (!removal) assertCoverageSpec(spec, policy.family, "coverage")

  const rows = (await repo.listActiveCoverages(ctx.client, termId, true)).filter((row) => row.coverageType === spec.coverageType)
  const current = rows.find((row) => row.effectiveTo === null)
  if (kind === "COVERAGE_ADDED") {
    if (rows.some((row) => row.effectiveTo === null || row.effectiveTo > effectiveOn)) {
      throw new InsuranceConflictError("This coverage is already in force from or after that date; change it with a COVERAGE_CHANGED endorsement.")
    }
  } else {
    if (!current) throw new InsuranceStateError("This coverage is not in force in the term; add it with a COVERAGE_ADDED endorsement.")
    if (effectiveOn <= current.effectiveFrom) {
      throw new InsuranceValidationError("effectiveOn", "The endorsement must be dated after the current coverage state began; correct the earlier endorsement instead.")
    }
    if (kind === "COVERAGE_CHANGED" && sameSpec(specOf(current), spec)) throw new InsuranceValidationError("coverage", "The coverage is unchanged.")
  }

  const endorsementId = randomUUID()
  await guarded(() =>
    repo.insertEndorsement(ctx.client, {
      id: endorsementId,
      termId,
      policyId: policy.id,
      organizationId,
      family: policy.family,
      numberDisplay: number?.display ?? null,
      numberNormalized: number?.normalized ?? null,
      kind,
      effectiveOn,
    }),
  )
  if (kind !== "COVERAGE_ADDED" && current) await guarded(() => repo.endCoverage(ctx.client, current.id, effectiveOn, endorsementId))
  const startedId = removal ? null : randomUUID()
  if (startedId) await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(startedId, termId, policy.id, organizationId, policy.family, spec, effectiveOn, endorsementId)))

  await record(ctx, "RECORD_CREATED", "addEndorsement", { resourceType: "insurance_endorsement", resourceId: endorsementId, organizationId }, [
    { field: "endorsement", before: literal(null), after: reference("insurance_endorsements", endorsementId) },
    { field: "term", before: literal(null), after: reference("insurance_policy_terms", termId) },
    { field: "endorsementKind", before: literal(null), after: literal(kind) },
  ])
  if (kind !== "COVERAGE_ADDED" && current) {
    await record(ctx, "RECORD_UPDATED", "addEndorsement", { resourceType: "insurance_coverage", resourceId: current.id, organizationId }, [
      { field: "coverage", before: literal("in_force"), after: literal("ended") },
      { field: "endedBy", before: literal(null), after: reference("insurance_endorsements", endorsementId) },
    ])
  }
  if (startedId) await recordCoverageCreated(ctx, "addEndorsement", organizationId, startedId, termId, spec)
  if (kind === "COVERAGE_CHANGED" && current && startedId) await continueSchedule(ctx, organizationId, current, startedId, spec.scheduledVehiclesOnly, effectiveOn)
  return loadPolicy(ctx, policy.id)
}

// ---------------------------------------------------------------------------------------------------------------
// correctTerm
// ---------------------------------------------------------------------------------------------------------------

type CancellationPatch = undefined | null | { cancelledOn: string; reason: CancellationReason }

/**
 * CORRECTS a wrongly recorded term (number, stated period, cancellation). The wrong term is kept, flagged and frozen; the
 * replacement belongs to the same policy and inherits everything not corrected. The endorsements and genuine coverage rows
 * of the old term are carried onto the replacement (the original rows stay attached to the corrected term, which is why a
 * coverage counts only while its term is genuine); dates that were the term start move with it, endorsement dates never do
 * and must still fall inside the corrected period. The vehicle schedule of each carried coverage row follows it (see
 * carrySchedule); when the corrected period cannot hold a scheduled window the whole correction is refused.
 */
export async function correctTerm(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["termId", "policyNumber", "termStart", "termEnd", "cancellation"])
  const termId = parseUuid(input.termId, "termId")
  const number = input.policyNumber === undefined ? null : prepareNumber(input.policyNumber, "policyNumber")
  const startPatch = input.termStart === undefined ? null : parseCalendarDate(input.termStart, "termStart")
  const endProvided = input.termEnd !== undefined
  const endPatch = input.termEnd === undefined || input.termEnd === null ? null : parseCalendarDate(input.termEnd, "termEnd")
  let cancellationPatch: CancellationPatch
  if (input.cancellation === undefined) cancellationPatch = undefined
  else if (input.cancellation === null) cancellationPatch = null
  else {
    const raw = requireObject(input.cancellation, "cancellation", ["cancelledOn", "reason"])
    if (!isCancellationReason(raw.reason)) throw new InsuranceValidationError("cancellation.reason", "cancellation.reason must be a supported cancellation reason.")
    cancellationPatch = { cancelledOn: parseCalendarDate(raw.cancelledOn, "cancellation.cancelledOn"), reason: raw.reason }
  }

  const { organizationId, policy, term } = await lockTerm(ctx, termId)
  await requireActiveInsurer(ctx, policy.insurerOrganizationId)
  const termStart = startPatch ?? term.termStart
  const termEnd = endProvided ? endPatch : term.termEnd
  assertPeriod(policy.family, termStart, termEnd)
  const numberAfter: PreparedNumber = number ?? { display: term.numberDisplay, normalized: term.numberNormalized, ruleVersion: term.normalizationRuleVersion }
  const cancellation = cancellationPatch === undefined ? (term.cancelledOn === null ? null : { cancelledOn: term.cancelledOn, reason: term.cancellationReason as CancellationReason }) : cancellationPatch
  if (cancellation !== null) {
    if (cancellation.cancelledOn < termStart || (termEnd !== null && cancellation.cancelledOn > termEnd)) {
      throw new InsuranceValidationError("cancellation.cancelledOn", "The cancellation date must fall within the term.")
    }
    if (cancellationPatch !== undefined) await assertNotFutureDate(ctx, cancellation.cancelledOn, "cancellation.cancelledOn")
  }
  const unchanged =
    termStart === term.termStart &&
    termEnd === term.termEnd &&
    numberAfter.normalized === term.numberNormalized &&
    numberAfter.display === term.numberDisplay &&
    (cancellation?.cancelledOn ?? null) === term.cancelledOn &&
    (cancellation?.reason ?? null) === term.cancellationReason
  if (unchanged) throw new InsuranceValidationError("input", "The term is unchanged.")

  const endorsements = await repo.listActiveEndorsements(ctx.client, termId)
  for (const endorsement of endorsements) {
    if (endorsement.effectiveOn < termStart || (termEnd !== null && endorsement.effectiveOn >= termEnd) || (cancellation !== null && endorsement.effectiveOn > cancellation.cancelledOn)) {
      throw new InsuranceValidationError("termStart", "An endorsement is dated outside the corrected term; correct the endorsement first.")
    }
  }
  const coverages = await repo.listActiveCoverages(ctx.client, termId, true)
  if (numberAfter.normalized !== term.numberNormalized) await assertNumberFree(ctx, policy.insurerOrganizationId, numberAfter.normalized, policy.id)

  const replacementId = randomUUID()
  const endorsementIds = new Map(endorsements.map((row) => [row.id, randomUUID()]))
  await claimingNumber(ctx, { insurerOrganizationId: policy.insurerOrganizationId, numberNormalized: numberAfter.normalized, ownPolicyId: policy.id }, async () => {
    await guarded(() => repo.supersedeTerm(ctx.client, termId, replacementId))
    await guarded(() =>
      repo.insertTerm(ctx.client, {
        id: replacementId,
        policyId: policy.id,
        organizationId,
        insurerOrganizationId: policy.insurerOrganizationId,
        family: policy.family,
        numberDisplay: numberAfter.display,
        numberNormalized: numberAfter.normalized,
        ruleVersion: numberAfter.ruleVersion,
        termStart,
        termEnd,
        termReason: "CORRECTION",
      }),
    )
  })
  for (const endorsement of endorsements) {
    await guarded(() =>
      repo.insertEndorsement(ctx.client, {
        id: endorsementIds.get(endorsement.id) as string,
        termId: replacementId,
        policyId: policy.id,
        organizationId,
        family: policy.family,
        numberDisplay: endorsement.numberDisplay,
        numberNormalized: endorsement.numberNormalized,
        kind: endorsement.kind,
        effectiveOn: endorsement.effectiveOn,
      }),
    )
  }
  const carried: Array<{ from: CoverageRecord; id: string }> = []
  // Chronological per type so at most one row of a type is open at any moment (each is ended as soon as it is inserted).
  for (const row of [...coverages].sort((a, b) => (a.coverageType < b.coverageType ? -1 : a.coverageType > b.coverageType ? 1 : a.effectiveFrom < b.effectiveFrom ? -1 : 1))) {
    const id = randomUUID()
    const effectiveFrom = row.endorsementId === null && row.effectiveFrom === term.termStart ? termStart : row.effectiveFrom
    const endorsementId = row.endorsementId === null ? null : (endorsementIds.get(row.endorsementId) ?? null)
    await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(id, replacementId, policy.id, organizationId, policy.family, specOf(row), effectiveFrom, endorsementId)))
    if (row.effectiveTo !== null) {
      await guarded(() => repo.endCoverage(ctx.client, id, row.effectiveTo as string, endorsementIds.get(row.endedByEndorsementId as string) as string))
    }
    carried.push({ from: row, id })
  }
  if (cancellation !== null) await guarded(() => repo.setTermCancellation(ctx.client, replacementId, cancellation.cancelledOn, cancellation.reason))
  // the schedules follow their coverage rows, checked against the corrected period (cancellation included)
  for (const { from, id } of carried) await carrySchedule(ctx, "correctTerm", organizationId, from, id, from.scheduledVehiclesOnly)

  await record(ctx, "RECORD_CORRECTED", "correctTerm", { resourceType: "insurance_policy_term", resourceId: replacementId, organizationId }, [
    { field: "term", before: reference("insurance_policy_terms", termId), after: reference("insurance_policy_terms", replacementId) },
  ])
  for (const endorsement of endorsements) {
    const id = endorsementIds.get(endorsement.id) as string
    await record(ctx, "RECORD_CORRECTED", "correctTerm", { resourceType: "insurance_endorsement", resourceId: id, organizationId }, [
      { field: "endorsement", before: reference("insurance_endorsements", endorsement.id), after: reference("insurance_endorsements", id) },
    ])
  }
  for (const { from, id } of carried) {
    await record(ctx, "RECORD_CORRECTED", "correctTerm", { resourceType: "insurance_coverage", resourceId: id, organizationId }, [
      { field: "coverage", before: reference("insurance_coverages", from.id), after: reference("insurance_coverages", id) },
    ])
  }
  return loadPolicy(ctx, policy.id)
}

// ---------------------------------------------------------------------------------------------------------------
// Vehicle schedule carry-forward (migration 0025)
// ---------------------------------------------------------------------------------------------------------------

const scheduleCarryRefusal = (reason: string): InsuranceStateError =>
  new InsuranceStateError(`The vehicle schedule of the coverage cannot be carried forward (${reason}); nothing was changed.`)

const SCHEDULE_CARRY_BLOCKED = "a scheduled vehicle is no longer active or operated by the insured Organization, or the coverage period no longer contains its window"

/** Domain errors the schedule guard raises become one refusal of the whole correction or endorsement; anything else propagates. */
function refuseCarry(error: unknown): never {
  if (error instanceof InsuranceValidationError || error instanceof InsuranceStateError || error instanceof InsuranceNotFoundError) throw scheduleCarryRefusal(SCHEDULE_CARRY_BLOCKED)
  throw error
}

/**
 * A change endorsement replaces a coverage state by a new one on the same term. The vehicles scheduled on the state it ends
 * stay scheduled: each OPEN entry ends on the endorsement date and the same vehicle starts on the new state the same day
 * (reason CHANGE, one RECORD_UPDATED each). An entry that cannot be split cleanly (it starts on or after the endorsement date,
 * or is bounded beyond it) or a new state that no longer lists vehicles refuses the whole endorsement; nothing is clamped.
 */
async function continueSchedule(ctx: OperationContext, organizationId: string, from: CoverageRecord, toId: string, toSchedules: boolean, date: string): Promise<void> {
  const rows = (await repo.listCoverageSchedule(ctx.client, from.id)).filter((row) => row.recordStatus === "active" && (row.effectiveTo === null || row.effectiveTo > date))
  if (rows.length === 0) return
  if (!toSchedules) throw scheduleCarryRefusal("the new coverage state would no longer list vehicles")
  for (const row of rows) {
    if (row.effectiveTo !== null || row.effectiveFrom >= date) {
      throw scheduleCarryRefusal("a scheduled entry starts on or after the endorsement date or ends after it; end or correct that entry first")
    }
    const nextId = randomUUID()
    try {
      await guarded(() => repo.endSchedule(ctx.client, row.id, date))
      await guarded(() => repo.insertSchedule(ctx.client, { id: nextId, coverageId: toId, vehicleId: row.vehicleId, organizationId, reason: "CHANGE", effectiveFrom: date, effectiveTo: null }))
    } catch (error) {
      refuseCarry(error)
    }
    await recordSchedule(ctx, "RECORD_UPDATED", "addEndorsement", organizationId, nextId, [
      { field: "scheduledVehicle", before: reference("insurance_coverage_vehicles", row.id), after: reference("insurance_coverage_vehicles", nextId) },
      { field: "vehicle", before: reference("vehicles", row.vehicleId), after: reference("vehicles", row.vehicleId) },
    ])
  }
}

/**
 * The vehicle schedule of a corrected coverage moves to its replacement in the same transaction. The corrected coverage keeps
 * its rows as frozen history; every GENUINE row (open or ended, same vehicle, same window) is created again on the replacement
 * as a new row (the supersession link is coverage-scoped, so these are new rows, not corrections), each with its own
 * RECORD_CREATED event. Nothing is clamped: when the replacement cannot take a row exactly as it was (it no longer lists
 * vehicles, or a vehicle is no longer active or operated, or its period no longer contains the window), the whole correction
 * is refused.
 */
async function carrySchedule(ctx: OperationContext, operation: string, organizationId: string, from: CoverageRecord, replacementId: string, replacementSchedules: boolean): Promise<void> {
  const rows = (await repo.listCoverageSchedule(ctx.client, from.id)).filter((row) => row.recordStatus === "active")
  if (rows.length === 0) return
  if (!replacementSchedules) throw scheduleCarryRefusal("the new coverage would no longer list vehicles")
  for (const row of rows) {
    const carriedId = randomUUID()
    try {
      await guarded(() =>
        repo.insertSchedule(ctx.client, { id: carriedId, coverageId: replacementId, vehicleId: row.vehicleId, organizationId, reason: "CORRECTION", effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo }),
      )
    } catch (error) {
      refuseCarry(error)
    }
    await recordSchedule(ctx, "RECORD_CREATED", operation, organizationId, carriedId, [
      { field: "scheduledVehicle", before: literal(null), after: reference("insurance_coverage_vehicles", carriedId) },
      { field: "vehicle", before: literal(null), after: reference("vehicles", row.vehicleId) },
    ])
  }
}

// ---------------------------------------------------------------------------------------------------------------
// correctCoverage
// ---------------------------------------------------------------------------------------------------------------

/** CORRECTS a wrongly recorded coverage row (kept and flagged; the replacement keeps the same term and dates and takes over its vehicle schedule). */
export async function correctCoverage(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["coverageId", ...COVERAGE_KEYS])
  const coverageId = parseUuid(input.coverageId, "coverageId")
  const { coverageId: _ignored, ...rest } = input
  void _ignored
  const patch = parseCoveragePatch(rest, true)
  if (Object.keys(patch).length === 0) throw new InsuranceValidationError("input", "Nothing to correct.")

  const termId = await repo.findCoverageTerm(ctx.client, coverageId)
  if (!termId) throw new InsuranceNotFoundError("Coverage")
  const { organizationId, policy } = await lockTerm(ctx, termId)
  const target = await repo.getCoverage(ctx.client, coverageId, true)
  if (!target) throw new InsuranceNotFoundError("Coverage")
  if (target.recordStatus !== "active") throw new InsuranceStateError("This coverage was already corrected.")

  const merged = mergeSpec(specOf(target), patch)
  assertCoverageSpec(merged, policy.family, "coverage")
  if (sameSpec(merged, specOf(target))) throw new InsuranceValidationError("input", "The coverage is unchanged.")

  const siblings = (await repo.listActiveCoverages(ctx.client, termId, true)).filter((row) => row.id !== target.id && row.coverageType === merged.coverageType)
  const overlaps = siblings.some((row) => row.effectiveFrom < (target.effectiveTo ?? "9999-12-31") && (row.effectiveTo ?? "9999-12-31") > target.effectiveFrom)
  if (overlaps) throw new InsuranceConflictError("A coverage of that type already exists for that period.")
  if (target.effectiveTo !== null && siblings.some((row) => row.effectiveTo === null)) {
    // A replacement is inserted open and then ended; it cannot coexist with the later, open state of the same coverage.
    throw new InsuranceStateError("This historical coverage state cannot be corrected while a later state of the same coverage is in force; correct the endorsement or the term instead.")
  }

  const replacementId = randomUUID()
  await guarded(() => repo.supersedeCoverage(ctx.client, target.id, replacementId))
  await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(replacementId, termId, policy.id, organizationId, policy.family, merged, target.effectiveFrom, target.endorsementId)))
  if (target.effectiveTo !== null && target.endedByEndorsementId !== null) {
    await guarded(() => repo.endCoverage(ctx.client, replacementId, target.effectiveTo as string, target.endedByEndorsementId as string))
  }
  await record(ctx, "RECORD_CORRECTED", "correctCoverage", { resourceType: "insurance_coverage", resourceId: replacementId, organizationId }, [
    { field: "coverage", before: reference("insurance_coverages", target.id), after: reference("insurance_coverages", replacementId) },
    { field: "coverageType", before: literal(target.coverageType), after: literal(merged.coverageType) },
  ])
  await carrySchedule(ctx, "correctCoverage", organizationId, target, replacementId, merged.scheduledVehiclesOnly)
  return loadPolicy(ctx, policy.id)
}

// ---------------------------------------------------------------------------------------------------------------
// correctEndorsement
// ---------------------------------------------------------------------------------------------------------------

/**
 * CORRECTS a wrongly recorded endorsement: its number, its effective date and/or the content of the coverage state it
 * created. The wrong endorsement and the coverage rows it started / ended are kept and flagged; the replacements are
 * inserted together, so the coverage timeline stays contiguous. The kind and the coverage type are not correctable, and
 * only the LATEST endorsement of a coverage type can be corrected (a later one builds on it).
 */
export async function correctEndorsement(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["endorsementId", "endorsementNumber", "effectiveOn", "limitAmount", "deductibleAmount", "currency", "limitBasis", "scheduledVehiclesOnly"])
  const endorsementId = parseUuid(input.endorsementId, "endorsementId")
  const numberProvided = input.endorsementNumber !== undefined
  const number = !numberProvided || input.endorsementNumber === null ? null : prepareNumber(input.endorsementNumber, "endorsementNumber")
  const dateProvided = input.effectiveOn !== undefined
  const newDate = dateProvided ? parseCalendarDate(input.effectiveOn, "effectiveOn") : null
  const { endorsementId: _id, endorsementNumber: _number, effectiveOn: _date, ...coverageFields } = input
  void _id
  void _number
  void _date
  const patch = parseCoveragePatch(coverageFields, false)
  if (!numberProvided && !dateProvided && Object.keys(patch).length === 0) throw new InsuranceValidationError("input", "Nothing to correct.")

  const termId = await repo.findEndorsementTerm(ctx.client, endorsementId)
  if (!termId) throw new InsuranceNotFoundError("Endorsement")
  const { organizationId, policy, term } = await lockTerm(ctx, termId)
  const old = await repo.getEndorsement(ctx.client, endorsementId, true)
  if (!old) throw new InsuranceNotFoundError("Endorsement")
  if (old.recordStatus !== "active") throw new InsuranceStateError("This endorsement was already corrected.")

  const date = newDate ?? old.effectiveOn
  assertInsideTerm(term, date, "effectiveOn")
  if (dateProvided) await assertNotFutureDate(ctx, date, "effectiveOn")

  const rows = await repo.listActiveCoverages(ctx.client, termId, true)
  const started = rows.find((row) => row.endorsementId === old.id)
  const ended = rows.find((row) => row.endedByEndorsementId === old.id)
  const shapeOk = old.kind === "COVERAGE_ADDED" ? started && !ended : old.kind === "COVERAGE_CHANGED" ? started && ended : ended && !started
  if (!shapeOk) throw new InsuranceStateError("The coverage rows of this endorsement are not in the expected shape; nothing was changed.")
  const type = (started ?? (ended as CoverageRecord)).coverageType
  if (rows.some((row) => row.coverageType === type && row.id !== started?.id && row.id !== ended?.id && row.effectiveFrom >= old.effectiveOn)) {
    throw new InsuranceStateError("A later endorsement builds on this one; correct that endorsement first.")
  }
  if (ended && date <= ended.effectiveFrom) throw new InsuranceValidationError("effectiveOn", "The endorsement must be dated after the coverage state it ends began.")
  if (started && started.effectiveTo !== null && date >= started.effectiveTo) throw new InsuranceValidationError("effectiveOn", "The endorsement must be dated before the coverage state it starts ended.")
  if (started && ended === undefined && started.effectiveTo !== null) throw new InsuranceStateError("A later endorsement builds on this one; correct that endorsement first.")

  if (Object.keys(patch).length > 0 && !started) throw new InsuranceValidationError("input", "A removal carries no coverage content to correct.")
  const startedSpec = started ? mergeSpec(specOf(started), patch) : null
  if (startedSpec) assertCoverageSpec(startedSpec, policy.family, "coverage")
  const numberAfter = numberProvided ? number : old.numberNormalized === null ? null : { display: old.numberDisplay as string, normalized: old.numberNormalized }
  const specChanged = startedSpec !== null && started !== undefined && !sameSpec(startedSpec, specOf(started))
  if (date === old.effectiveOn && !specChanged && (numberAfter?.normalized ?? null) === old.numberNormalized && (numberAfter?.display ?? null) === old.numberDisplay) {
    throw new InsuranceValidationError("input", "The endorsement is unchanged.")
  }

  const replacementId = randomUUID()
  const startedId = started ? randomUUID() : null
  const endedId = ended ? randomUUID() : null
  await guarded(() => repo.supersedeEndorsement(ctx.client, old.id, replacementId))
  if (started && startedId) await guarded(() => repo.supersedeCoverage(ctx.client, started.id, startedId))
  if (ended && endedId) await guarded(() => repo.supersedeCoverage(ctx.client, ended.id, endedId))
  await guarded(() =>
    repo.insertEndorsement(ctx.client, {
      id: replacementId,
      termId,
      policyId: policy.id,
      organizationId,
      family: policy.family,
      numberDisplay: numberAfter?.display ?? null,
      numberNormalized: numberAfter?.normalized ?? null,
      kind: old.kind,
      effectiveOn: date,
    }),
  )
  if (ended && endedId) {
    await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(endedId, termId, policy.id, organizationId, policy.family, specOf(ended), ended.effectiveFrom, ended.endorsementId)))
    await guarded(() => repo.endCoverage(ctx.client, endedId, date, replacementId))
    await carrySchedule(ctx, "correctEndorsement", organizationId, ended, endedId, ended.scheduledVehiclesOnly)
  }
  if (started && startedId && startedSpec) {
    await guarded(() => repo.insertCoverage(ctx.client, coverageInsert(startedId, termId, policy.id, organizationId, policy.family, startedSpec, date, replacementId)))
    await carrySchedule(ctx, "correctEndorsement", organizationId, started, startedId, startedSpec.scheduledVehiclesOnly)
  }

  await record(ctx, "RECORD_CORRECTED", "correctEndorsement", { resourceType: "insurance_endorsement", resourceId: replacementId, organizationId }, [
    { field: "endorsement", before: reference("insurance_endorsements", old.id), after: reference("insurance_endorsements", replacementId) },
  ])
  for (const [from, id] of [[started, startedId], [ended, endedId]] as Array<[CoverageRecord | undefined, string | null]>) {
    if (!from || !id) continue
    await record(ctx, "RECORD_CORRECTED", "correctEndorsement", { resourceType: "insurance_coverage", resourceId: id, organizationId }, [
      { field: "coverage", before: reference("insurance_coverages", from.id), after: reference("insurance_coverages", id) },
    ])
  }
  return loadPolicy(ctx, policy.id)
}

// ---------------------------------------------------------------------------------------------------------------
// Broker of record
// ---------------------------------------------------------------------------------------------------------------

/**
 * A REAL-WORLD change of broker (or broker contact): ends the current broker period at T and starts the next at T. When the
 * policy has no broker of record yet, it starts the first one.
 */
export async function changeBroker(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["policyId", "brokerOrganizationId", "brokerPersonId", "effectiveFrom"])
  const policyId = parseUuid(input.policyId, "policyId")
  const brokerOrganizationId = parseUuid(input.brokerOrganizationId, "brokerOrganizationId")
  const brokerPersonId = optionalUuid(input.brokerPersonId, "brokerPersonId")
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const { organizationId } = await lockPolicy(ctx, policyId, { requireActivePolicy: true })
  const contact = await resolveBroker(ctx, brokerOrganizationId, brokerPersonId, "input")
  const current = await repo.getCurrentBrokerPeriod(ctx.client, policyId, true)
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  if (current) {
    if (current.brokerOrganizationId === brokerOrganizationId && current.brokerPersonId === brokerPersonId) {
      throw new InsuranceValidationError("brokerOrganizationId", "That broker is already the broker of record.")
    }
    if (at <= current.effectiveFrom) throw new InsuranceValidationError("effectiveFrom", "The change must be after the current broker period began.")
  } else {
    const latestEnd = await repo.latestBrokerEnd(ctx.client, policyId)
    if (latestEnd !== null && at < latestEnd) throw new InsuranceValidationError("effectiveFrom", "A new broker period cannot start before the previous one ended.")
  }

  const periodId = randomUUID()
  if (current) await guarded(() => repo.endBrokerPeriod(ctx.client, current.id, at))
  await guarded(() =>
    repo.insertBrokerPeriod(ctx.client, { id: periodId, policyId, organizationId, brokerOrganizationId, brokerRelationshipId: contact.relationshipId, brokerPersonId, effectiveFrom: at }),
  )
  await record(ctx, current ? "RECORD_UPDATED" : "RECORD_CREATED", "changeBroker", { resourceType: "insurance_broker_period", resourceId: periodId, organizationId }, [
    { field: "brokerPeriod", before: current ? reference("insurance_broker_periods", current.id) : literal(null), after: reference("insurance_broker_periods", periodId) },
    { field: "broker", before: current ? reference("organizations", current.brokerOrganizationId) : literal(null), after: reference("organizations", brokerOrganizationId) },
  ])
  return loadPolicy(ctx, policyId)
}

/** CORRECTS a wrongly recorded broker period (the brokerage and/or the contact); the replacement inherits its window. */
export async function correctBroker(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["brokerPeriodId", "brokerOrganizationId", "brokerPersonId"])
  const periodId = parseUuid(input.brokerPeriodId, "brokerPeriodId")
  const orgPatch = input.brokerOrganizationId === undefined ? null : parseUuid(input.brokerOrganizationId, "brokerOrganizationId")
  const personProvided = input.brokerPersonId !== undefined
  const personPatch = optionalUuid(input.brokerPersonId, "brokerPersonId")
  if (orgPatch === null && !personProvided) throw new InsuranceValidationError("input", "Nothing to correct.")

  const policyId = await repo.findBrokerPeriodPolicy(ctx.client, periodId)
  if (!policyId) throw new InsuranceNotFoundError("Broker period")
  const { organizationId } = await lockPolicy(ctx, policyId, { requireActivePolicy: true })
  const target = await repo.getBrokerPeriod(ctx.client, periodId, true)
  if (!target) throw new InsuranceNotFoundError("Broker period")
  if (target.recordStatus !== "active") throw new InsuranceStateError("This broker period was already corrected.")

  const brokerOrganizationId = orgPatch ?? target.brokerOrganizationId
  const orgChanged = brokerOrganizationId !== target.brokerOrganizationId
  const brokerPersonId = personProvided ? personPatch : orgChanged ? null : target.brokerPersonId
  if (!orgChanged && brokerPersonId === target.brokerPersonId) throw new InsuranceValidationError("input", "The broker period is unchanged.")
  const contact = await resolveBroker(ctx, brokerOrganizationId, brokerPersonId, "input")
  if (target.effectiveTo !== null && (await repo.getCurrentBrokerPeriod(ctx.client, policyId)) !== undefined) {
    // A replacement is inserted open and then ended; it cannot coexist with the broker period that is current now.
    throw new InsuranceStateError("This earlier broker period cannot be corrected while a later broker period is current.")
  }

  const replacementId = randomUUID()
  await guarded(() => repo.supersedeBrokerPeriod(ctx.client, target.id, replacementId))
  await guarded(() =>
    repo.insertBrokerPeriod(ctx.client, { id: replacementId, policyId, organizationId, brokerOrganizationId, brokerRelationshipId: contact.relationshipId, brokerPersonId, effectiveFrom: target.effectiveFrom }),
  )
  if (target.effectiveTo !== null) await guarded(() => repo.endBrokerPeriod(ctx.client, replacementId, target.effectiveTo as string))
  await record(ctx, "RECORD_CORRECTED", "correctBroker", { resourceType: "insurance_broker_period", resourceId: replacementId, organizationId }, [
    { field: "brokerPeriod", before: reference("insurance_broker_periods", target.id), after: reference("insurance_broker_periods", replacementId) },
    { field: "broker", before: reference("organizations", target.brokerOrganizationId), after: reference("organizations", brokerOrganizationId) },
  ])
  return loadPolicy(ctx, policyId)
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------------------------

/** Archive is RECORD lifecycle, not policy status: nothing about the policy's facts changes. */
export async function archivePolicy(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["policyId", "organizationId"])
  const policyId = parseUuid(input.policyId, "policyId")
  const { organizationId, policy } = await lockPolicy(ctx, policyId, { requireActivePolicy: false })
  assertScopedOrganization(input.organizationId, organizationId)
  if (policy.recordStatus === "archived") throw new InsuranceStateError("This policy is already archived.")
  await guarded(() => repo.setPolicyArchived(ctx.client, policyId, true))
  await record(ctx, "RECORD_ARCHIVED", "archivePolicy", { resourceType: "insurance_policy", resourceId: policyId, organizationId }, [
    { field: "lifecycle", before: literal("active"), after: literal("archived") },
  ])
  return loadPolicy(ctx, policyId)
}

export async function restorePolicy(ctx: OperationContext, rawInput: unknown): Promise<PolicyView> {
  const input = requireObject(rawInput, "input", ["policyId", "organizationId"])
  const policyId = parseUuid(input.policyId, "policyId")
  const { organizationId, policy } = await lockPolicy(ctx, policyId, { requireActivePolicy: false })
  assertScopedOrganization(input.organizationId, organizationId)
  if (policy.recordStatus !== "archived") throw new InsuranceStateError("This policy is not archived.")
  await guarded(() => repo.setPolicyArchived(ctx.client, policyId, false))
  await record(ctx, "RECORD_RESTORED", "restorePolicy", { resourceType: "insurance_policy", resourceId: policyId, organizationId }, [
    { field: "lifecycle", before: literal("archived"), after: literal("active") },
  ])
  return loadPolicy(ctx, policyId)
}

// ---------------------------------------------------------------------------------------------------------------
// Scheduled vehicles (migration 0025)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Which vehicles a vehicle-scheduled coverage insures, over time. A schedule row is a calendar-date window
 * [effectiveFrom, effectiveTo) on ONE coverage for ONE vehicle; an open window runs until the coverage itself ends.
 *
 *   scheduleVehicle         starts a window (the vehicle must be ACTIVE and operated by the insured Organization that day);
 *   removeScheduledVehicle  REAL-WORLD end of an open window;
 *   changeSchedule          REAL-WORLD change of the window: the open window ends at T and a bounded one starts at T;
 *   correctSchedule         the recorded VEHICLE was wrong: the row (open or already ended) is kept, flagged and frozen, and
 *                           its replacement inherits the window; the coverage cannot change (the supersession link is
 *                           coverage-scoped). A wrong coverage is corrected with correctCoverage / correctTerm /
 *                           correctEndorsement, which carry the schedule to the replacement atomically.
 *
 * renewPolicy does NOT carry a schedule: a renewal is a new period of the policy, and the vehicles it insures are scheduled
 * again, explicitly, on the new term's coverages (scheduleVehicle).
 *
 * Lock order: insured Organization, policy, term, coverage, then the vehicle (shared: archiving or merging a vehicle needs
 * it exclusively) and then the schedule row. The vehicle and its Organization relationship are read, and the vehicle locked,
 * by the database guard (a SECURITY DEFINER trigger) when a row is inserted, because the transaction carries an INSURANCE
 * capability and cannot read VEHICLE tables itself; this layer therefore does not pre-check the vehicle and translates the
 * guard's constraint names instead. An operation on an existing row (changeSchedule, correctSchedule) has locked that row
 * before the guard takes the vehicle lock; no vehicle writer ever waits on a schedule row, so the two orders cannot deadlock.
 * Whether a schedule is enough for a fleet is a Rules determination and is never stored here.
 */

type LockedCoverage = { organizationId: string; policy: PolicyRecord; term: TermRecord; coverage: CoverageRecord }

/**
 * Locks the insured Organization (the named one when `expectedOrganizationId` is given: a coverage that belongs to another
 * Organization is then simply not found, and nothing of the other Organization is disclosed), the policy, the term and the
 * coverage. A corrected term or coverage is frozen history and cannot take schedule changes.
 */
async function lockCoverage(ctx: OperationContext, coverageId: string, expectedOrganizationId: string | null): Promise<LockedCoverage> {
  const termId = await repo.findCoverageTerm(ctx.client, coverageId)
  if (!termId) throw new InsuranceNotFoundError("Coverage")
  const policyId = await repo.findTermPolicy(ctx.client, termId)
  if (!policyId) throw new InsuranceNotFoundError("Coverage")
  const insuredId = await repo.findPolicyOrganization(ctx.client, policyId)
  if (!insuredId) throw new InsuranceNotFoundError("Coverage")
  const lockedOrganizationId = expectedOrganizationId ?? insuredId
  await lockActiveOrganization(ctx, lockedOrganizationId)
  if (insuredId !== lockedOrganizationId) throw new InsuranceNotFoundError("Coverage")
  const policy = await repo.getPolicy(ctx.client, policyId, true)
  if (!policy) throw new InsuranceNotFoundError("Policy")
  if (policy.recordStatus !== "active") throw new InsuranceStateError("This policy is archived; restore it before changing it.")
  const term = await repo.getTerm(ctx.client, termId, true)
  const coverage = await repo.getCoverage(ctx.client, coverageId, true)
  if (!term || !coverage) throw new InsuranceNotFoundError("Coverage")
  if (term.recordStatus !== "active" || coverage.recordStatus !== "active") {
    throw new InsuranceStateError("This coverage was corrected; its schedule is history. Work with the replacement coverage.")
  }
  return { organizationId: insuredId, policy, term, coverage }
}

type LockedSchedule = LockedCoverage & { schedule: ScheduledVehicleRecord }

/** Locks the coverage context of an existing schedule row, then the row itself; the row must be genuine. */
async function lockSchedule(ctx: OperationContext, scheduleId: string): Promise<LockedSchedule> {
  const coverageId = await repo.findScheduleCoverage(ctx.client, scheduleId)
  if (!coverageId) throw new InsuranceNotFoundError("Scheduled vehicle")
  const locked = await lockCoverage(ctx, coverageId, null)
  const schedule = await repo.getSchedule(ctx.client, scheduleId, true)
  if (!schedule) throw new InsuranceNotFoundError("Scheduled vehicle")
  if (schedule.recordStatus !== "active") throw new InsuranceStateError("This schedule entry was already corrected; work with its replacement.")
  return { ...locked, schedule }
}

function assertOpen(schedule: ScheduledVehicleRecord): void {
  if (schedule.effectiveTo !== null) throw new InsuranceStateError("This schedule entry has already ended.")
}

/** The window lies inside the coverage: not before it starts, not past its end (its own, its term's or the cancellation). */
function assertInsideCoverage(locked: LockedCoverage, from: string, to: string | null): void {
  const end = coverageWindowEnd({ coverageEnd: locked.coverage.effectiveTo, termEnd: locked.term.termEnd, cancelledOn: locked.term.cancelledOn })
  if (from < locked.coverage.effectiveFrom) throw new InsuranceValidationError("effectiveFrom", "effectiveFrom cannot be before the coverage starts.")
  if (end !== null && from >= end) throw new InsuranceValidationError("effectiveFrom", "effectiveFrom must be before the coverage ends.")
  if (to !== null && to <= from) throw new InsuranceValidationError("effectiveTo", "effectiveTo must be after effectiveFrom.")
  if (to !== null && end !== null && to > end) throw new InsuranceValidationError("effectiveTo", "effectiveTo cannot be after the coverage ends.")
}

async function recordSchedule(ctx: OperationContext, eventType: EventTypeName, operation: string, organizationId: string, scheduleId: string, fieldChanges: FieldChange[]): Promise<void> {
  await record(ctx, eventType, operation, { resourceType: "insurance_coverage_vehicle", resourceId: scheduleId, organizationId }, fieldChanges)
}

/** Starts a window: the vehicle becomes scheduled on the coverage from `effectiveFrom` (an `effectiveTo` records an already ended window). */
export async function scheduleVehicle(ctx: OperationContext, rawInput: unknown): Promise<CoverageScheduleView> {
  const input = requireObject(rawInput, "input", ["organizationId", "coverageId", "vehicleId", "effectiveFrom", "effectiveTo"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const coverageId = parseUuid(input.coverageId, "coverageId")
  const vehicleId = parseUuid(input.vehicleId, "vehicleId")
  const effectiveFrom = parseCalendarDate(input.effectiveFrom, "effectiveFrom")
  const effectiveTo = optionalDate(input.effectiveTo, "effectiveTo")

  const locked = await lockCoverage(ctx, coverageId, organizationId)
  if (!locked.coverage.scheduledVehiclesOnly) throw new InsuranceStateError("This coverage applies to the whole fleet; it does not list vehicles.")
  await assertNotFutureDate(ctx, effectiveFrom, "effectiveFrom")
  if (effectiveTo !== null) await assertNotFutureDate(ctx, effectiveTo, "effectiveTo")
  assertInsideCoverage(locked, effectiveFrom, effectiveTo)

  const scheduleId = randomUUID()
  await guarded(() => repo.insertSchedule(ctx.client, { id: scheduleId, coverageId, vehicleId, organizationId, reason: "INITIAL", effectiveFrom, effectiveTo }))
  await recordSchedule(ctx, "RECORD_CREATED", "scheduleVehicle", organizationId, scheduleId, [
    { field: "scheduledVehicle", before: literal(null), after: reference("insurance_coverage_vehicles", scheduleId) },
    { field: "vehicle", before: literal(null), after: reference("vehicles", vehicleId) },
  ])
  return readCoverageSchedule(ctx.client, coverageId)
}

/** REAL-WORLD removal: ends the open window on `effectiveTo` (the database date by default). The row stays as history. */
export async function removeScheduledVehicle(ctx: OperationContext, rawInput: unknown): Promise<CoverageScheduleView> {
  const input = requireObject(rawInput, "input", ["scheduleId", "effectiveTo"])
  const scheduleId = parseUuid(input.scheduleId, "scheduleId")
  const explicit = optionalDate(input.effectiveTo, "effectiveTo")

  const locked = await lockSchedule(ctx, scheduleId)
  assertOpen(locked.schedule)
  const effectiveTo = explicit ?? (await repo.databaseToday(ctx.client))
  await assertNotFutureDate(ctx, effectiveTo, "effectiveTo")
  assertInsideCoverage(locked, locked.schedule.effectiveFrom, effectiveTo)

  await guarded(() => repo.endSchedule(ctx.client, scheduleId, effectiveTo))
  await recordSchedule(ctx, "RECORD_UPDATED", "removeScheduledVehicle", locked.organizationId, scheduleId, [
    { field: "scheduledVehicle", before: reference("insurance_coverage_vehicles", scheduleId), after: literal("ended") },
    { field: "vehicle", before: reference("vehicles", locked.schedule.vehicleId), after: literal(null) },
  ])
  return readCoverageSchedule(ctx.client, locked.coverage.id)
}

/**
 * REAL-WORLD change of the window: the open window ends on `effectiveFrom` and the next one, bounded by `effectiveTo`, starts
 * on the same day (an open window replaced by another open one would change nothing, so the new end is required).
 */
export async function changeSchedule(ctx: OperationContext, rawInput: unknown): Promise<CoverageScheduleView> {
  const input = requireObject(rawInput, "input", ["scheduleId", "effectiveFrom", "effectiveTo"])
  const scheduleId = parseUuid(input.scheduleId, "scheduleId")
  const effectiveFrom = parseCalendarDate(input.effectiveFrom, "effectiveFrom")
  const effectiveTo = parseCalendarDate(input.effectiveTo, "effectiveTo")

  const locked = await lockSchedule(ctx, scheduleId)
  assertOpen(locked.schedule)
  await assertNotFutureDate(ctx, effectiveFrom, "effectiveFrom")
  await assertNotFutureDate(ctx, effectiveTo, "effectiveTo")
  if (effectiveFrom <= locked.schedule.effectiveFrom) throw new InsuranceValidationError("effectiveFrom", "The change must be after the current window began.")
  assertInsideCoverage(locked, effectiveFrom, effectiveTo)

  const nextId = randomUUID()
  await guarded(() => repo.endSchedule(ctx.client, scheduleId, effectiveFrom))
  await guarded(() =>
    repo.insertSchedule(ctx.client, {
      id: nextId,
      coverageId: locked.coverage.id,
      vehicleId: locked.schedule.vehicleId,
      organizationId: locked.organizationId,
      reason: "CHANGE",
      effectiveFrom,
      effectiveTo,
    }),
  )
  await recordSchedule(ctx, "RECORD_UPDATED", "changeSchedule", locked.organizationId, nextId, [
    { field: "scheduledVehicle", before: reference("insurance_coverage_vehicles", scheduleId), after: reference("insurance_coverage_vehicles", nextId) },
    { field: "vehicle", before: reference("vehicles", locked.schedule.vehicleId), after: reference("vehicles", locked.schedule.vehicleId) },
  ])
  return readCoverageSchedule(ctx.client, locked.coverage.id)
}

/** CORRECTS the vehicle of a wrongly recorded entry (open or already ended); the replacement inherits the window. */
export async function correctSchedule(ctx: OperationContext, rawInput: unknown): Promise<CoverageScheduleView> {
  const input = requireObject(rawInput, "input", ["scheduleId", "vehicleId"])
  const scheduleId = parseUuid(input.scheduleId, "scheduleId")
  const vehicleId = parseUuid(input.vehicleId, "vehicleId")

  const locked = await lockSchedule(ctx, scheduleId)
  const old = locked.schedule
  if (vehicleId === old.vehicleId) throw new InsuranceValidationError("vehicleId", "The schedule entry is unchanged.")
  assertInsideCoverage(locked, old.effectiveFrom, old.effectiveTo)

  const replacementId = randomUUID()
  await guarded(() =>
    repo.insertSchedule(ctx.client, {
      id: replacementId,
      coverageId: old.coverageId,
      vehicleId,
      organizationId: locked.organizationId,
      reason: "CORRECTION",
      effectiveFrom: old.effectiveFrom,
      effectiveTo: old.effectiveTo,
    }),
  )
  await guarded(() => repo.supersedeSchedule(ctx.client, scheduleId, replacementId))
  await recordSchedule(ctx, "RECORD_CORRECTED", "correctSchedule", locked.organizationId, replacementId, [
    { field: "scheduledVehicle", before: reference("insurance_coverage_vehicles", scheduleId), after: reference("insurance_coverage_vehicles", replacementId) },
    { field: "vehicle", before: reference("vehicles", old.vehicleId), after: reference("vehicles", vehicleId) },
  ])
  return readCoverageSchedule(ctx.client, old.coverageId)
}

/** The vehicles a coverage schedules on a calendar date (the database date by default) and the whole history of the schedule. */
export async function readCoverageSchedule(client: PoolClient, rawCoverageId: unknown, options: { asOf?: string } = {}): Promise<CoverageScheduleView> {
  const coverageId = parseUuid(rawCoverageId, "coverageId")
  const requested = options.asOf === undefined ? null : parseCalendarDate(options.asOf, "asOf")
  const coverage = await repo.getCoverage(client, coverageId)
  if (!coverage) throw new InsuranceNotFoundError("Coverage")
  const term = await repo.getTerm(client, coverage.termId)
  const policyId = await repo.findTermPolicy(client, coverage.termId)
  const organizationId = policyId ? await repo.findPolicyOrganization(client, policyId) : undefined
  if (!term || !organizationId) throw new InsuranceNotFoundError("Coverage")
  const asOfDate = requested ?? (await repo.databaseToday(client))
  const history = await repo.listCoverageSchedule(client, coverageId)
  const genuine = coverage.recordStatus === "active" && term.recordStatus === "active"
  // an open window runs only until the coverage ends
  const end = coverageWindowEnd({ coverageEnd: coverage.effectiveTo, termEnd: term.termEnd, cancelledOn: term.cancelledOn })
  const coverageInForceOnDate = genuine && (end === null || asOfDate < end)
  const scheduled = coverageInForceOnDate ? history.filter((row) => row.recordStatus === "active" && scheduleInForce(row, asOfDate)) : []
  return { coverageId, organizationId, asOfDate, coverage, scheduled, history }
}

/**
 * Step one of a vehicle read, on a transaction that can read vehicles (VEHICLE_READ): the vehicle a (possibly merged-away)
 * vehicle answers for, found by following vehicles.merged_into_vehicle_id, and every vehicle merged into that survivor.
 */
export async function readVehicleFamily(client: PoolClient, rawVehicleId: unknown): Promise<VehicleFamily> {
  const vehicleId = parseUuid(rawVehicleId, "vehicleId")
  const found = await repo.findVehicleSurvivor(client, vehicleId)
  if (!found.exists) throw new InsuranceNotFoundError("Vehicle")
  if (found.survivorId === null) throw new InsuranceStateError("The merge history of this vehicle has no surviving vehicle; it cannot be resolved.")
  return { vehicleId, resolvedVehicleId: found.survivorId, vehicleIds: await repo.listVehicleFamily(client, found.survivorId) }
}

/**
 * Step two, on an INSURANCE_READ transaction: the scheduled coverages of a vehicle family on a calendar date. Asking about a
 * vehicle that was merged away answers for the surviving vehicle, and the survivor's answer includes what was scheduled on
 * the vehicles merged into it (each row still names the vehicle it was recorded on).
 */
export async function readVehicleInsurance(client: PoolClient, family: VehicleFamily, options: { asOf?: string } = {}): Promise<VehicleInsuranceView> {
  const requested = options.asOf === undefined ? null : parseCalendarDate(options.asOf, "asOf")
  const asOfDate = requested ?? (await repo.databaseToday(client))
  const inForce = await repo.listVehicleScheduleInForce(client, family.vehicleIds, asOfDate)
  const history = await repo.listVehicleSchedule(client, family.vehicleIds)
  const coverages = await repo.getCoverages(client, [...new Set(inForce.map((row) => row.schedule.coverageId))])
  const scheduled = inForce.map(({ schedule, policyId }) => {
    const coverage = coverages.get(schedule.coverageId)
    if (!coverage) throw new InsuranceNotFoundError("Coverage")
    return { schedule, coverage, policyId, organizationId: schedule.organizationId }
  })
  return { vehicleId: family.vehicleId, resolvedVehicleId: family.resolvedVehicleId, asOfDate, scheduled, history }
}
