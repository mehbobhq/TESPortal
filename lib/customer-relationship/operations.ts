/**
 * Customer Relationship operations: validation, business rules and Master Register events on a caller-supplied transaction.
 *
 * Every function here runs INSIDE a transaction the authorization wrapper already opened, and Master Register events are
 * written through a repository bound to the same client, so a failure anywhere (including the Master Register) rolls the
 * whole change back.
 *
 * LOCK ORDER (every mutation, without exception):
 *   1. the Organization row   (all writers of one Organization's Customer relationship serialize here; Customers rows are
 *                              immutable and cannot be row-locked by the runtime role)
 *   2. the Engagement row     (FOR NO KEY UPDATE; the database triggers take the same lock, so a writer that somehow
 *                              bypassed this layer still serializes)
 *   3. dependent rows: stages, scopes, responsibility windows, agreement versions
 * Unique indexes, overlap triggers and the deferred consistency trigger are the structural backstops.
 *
 * Establishment: CUSTOMER_ESTABLISH turns an eligible (active) Organization into a Customer relationship - creating the
 * single canonical Customer on first use, reusing it on every re-engagement - and begins an Engagement with its initial
 * stage, atomically. A Customer exists before its first Engagement only inside that transaction.
 *
 * Termination: customer_engagements.ended_at (with the controlled end_reason_code) is the one authoritative fact.
 * endEngagement writes it together with the ENDED stage (its projection) and an audit row in
 * customer_engagement_terminations, and ends everything that depends on the Engagement at the same instant; the deferred
 * constraint trigger rejects any other combination at commit. An ended Engagement is never reopened.
 * correctEngagementTermination CORRECTS a wrongly recorded termination: the canonical columns change, the old audit row is
 * kept and flagged, the ENDED stage and the stage before it are corrected (not rewritten), and dependents that were ended
 * with the old boundary follow it inward atomically. It never expands TES responsibility and refuses anything that would
 * leave a scope or responsibility window impossible.
 *
 * Correction vs real-world change:
 *   change / amend a REAL-WORLD change: the old row is ended at T and the next row starts at T (both stay genuine history).
 *   correct         the recorded row was WRONG: it is kept, flagged 'corrected', pointed at its replacement, never ended, and
 *                   the replacement inherits its business time. (For time-only records - a responsibility window - the
 *                   corrected value IS the window.)
 *   void            the row should never have existed: kept, flagged 'voided', no replacement.
 *   end             a REAL-WORLD end. Nothing is deleted.
 *
 * Master Register: events reference rows (table:id) and carry only controlled-vocabulary literals (engagement type, stage,
 * product level, service code, lifecycle words). Never agreement references, signing dates, free-text reasons or notes.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  STAGE_DEFINITIONS,
  isEngagementEndReason,
  isEngagementStage,
  isEngagementType,
  isProductLevel,
  isServiceCode,
  type EngagementEndReason,
  type EngagementStage,
} from "@/lib/customer-relationship/definitions"
import {
  CustomerRelationshipConflictError,
  CustomerRelationshipNotFoundError,
  CustomerRelationshipStateError,
  CustomerRelationshipValidationError,
} from "@/lib/customer-relationship/errors"
import * as repo from "@/lib/customer-relationship/repository"
import type {
  AgreementRecord,
  AgreementVersionRecord,
  CustomerRecord,
  CustomerRelationshipView,
  EngagementRecord,
  EngagementView,
  EstablishResult,
  ResponsibilityRecord,
  ScopeRecord,
  StageRecord,
  TerminationRecord,
} from "@/lib/customer-relationship/types"
import { recordEvent } from "@/lib/master-register/record-event"
import type { MasterRegisterRepository } from "@/lib/master-register/repository"
import type { ActorType, FieldChange } from "@/lib/master-register/types"

export type OperationContext = {
  client: PoolClient
  actor: { id: string; actorType: ActorType }
  /** Master Register repository bound to `client`. */
  masterRegister: MasterRegisterRepository
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

type Invalid = CustomerRelationshipValidationError

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CustomerRelationshipValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new CustomerRelationshipValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new CustomerRelationshipValidationError(field, `${field} must be a UUID.`)
}

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC at microsecond precision. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new CustomerRelationshipValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new CustomerRelationshipValidationError(field, `${field} is not a valid instant.`)
  return date.toISOString().replace(/Z$/, "000Z")
}

const optionalInstant = (value: unknown, field: string): string | null => (value === undefined ? null : parseInstant(value, field))

function parseOptionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new CustomerRelationshipValidationError(field, `${field} must be text.`)
  const text = value.trim()
  if (text === "") return null
  if (text.length > maxLength) throw new CustomerRelationshipValidationError(field, `${field} must be at most ${maxLength} characters.`)
  return text
}

/** The structural termination reason: required, from the controlled catalogue. There is no free text and no "other". */
function parseEndReason(value: unknown): EngagementEndReason {
  if (!isEngagementEndReason(value)) throw new CustomerRelationshipValidationError("endReason", "endReason must be a supported termination reason.")
  return value
}

function parseOptionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) || Number.isNaN(new Date(`${value.trim()}T00:00:00Z`).getTime())) {
    throw new CustomerRelationshipValidationError(field, `${field} must be a calendar date (YYYY-MM-DD).`)
  }
  const date = value.trim()
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new CustomerRelationshipValidationError(field, `${field} is not a valid date.`)
  return date
}

function parseStageInput(input: Record<string, unknown>): { stage: EngagementStage; plannedEndAt: string | null } {
  if (!isEngagementStage(input.stage)) throw new CustomerRelationshipValidationError("stage", "stage must be a supported engagement stage.")
  const definition = STAGE_DEFINITIONS[input.stage]
  if (definition.terminal) throw new CustomerRelationshipValidationError("stage", "The ended stage is only reached by ending the Engagement.")
  const plannedEndAt = optionalInstant(input.plannedEndAt, "plannedEndAt")
  if (definition.bounded && plannedEndAt === null) throw new CustomerRelationshipValidationError("plannedEndAt", `${input.stage} is a time-boxed stage and needs plannedEndAt.`)
  if (!definition.bounded && plannedEndAt !== null) throw new CustomerRelationshipValidationError("plannedEndAt", `${input.stage} is not a time-boxed stage; plannedEndAt is not accepted.`)
  return { stage: input.stage, plannedEndAt }
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
    const conflict = (message: string) => new CustomerRelationshipConflictError(message)
    const state = (message: string) => new CustomerRelationshipStateError(message)
    const invalid = (field: string, message: string): Invalid => new CustomerRelationshipValidationError(field, message)
    if (constraint === repo.ONE_OPEN_ENGAGEMENT_CONSTRAINT || constraint === repo.ENGAGEMENT_NO_OVERLAP_CONSTRAINT) {
      throw conflict("This Customer already has an Engagement covering that time, or a concurrent change was made.")
    }
    if (constraint === repo.ONE_CUSTOMER_PER_ORGANIZATION_CONSTRAINT) throw conflict("This Organization is already a Customer; retry the operation.")
    if (constraint === repo.ENGAGEMENT_ORGANIZATION_ACTIVE_CONSTRAINT) throw state("This Organization is not active.")
    if (constraint === repo.ENGAGEMENT_ENDED_FINAL_CONSTRAINT) throw state("An ended Engagement cannot be reopened; correct its termination or establish a new Engagement.")
    if (constraint === repo.CURRENT_TERMINATION_CONSTRAINT) throw conflict("A concurrent termination change was made; retry the operation.")
    if (constraint === repo.TERMINATION_AFTER_START_CONSTRAINT) throw invalid("endedAt", "The Engagement must end after it began.")
    if (constraint === repo.CURRENT_STAGE_CONSTRAINT || constraint === repo.STAGE_NO_OVERLAP_CONSTRAINT) throw conflict("A concurrent stage change was made; retry the operation.")
    if (constraint === repo.STAGE_RULES_CONSTRAINT) throw invalid("stage", "The stage is not available, or its planned end does not suit it.")
    if (constraint === repo.STAGE_WINDOW_CONSTRAINT) throw invalid("effectiveFrom", "The stage must fall inside the Engagement.")
    if (constraint === repo.CURRENT_SCOPE_CONSTRAINT || constraint === repo.SCOPE_NO_OVERLAP_CONSTRAINT) throw conflict("This product level or service is already in scope for that time.")
    if (constraint === repo.SCOPE_WINDOW_CONSTRAINT) throw invalid("effectiveFrom", "The scope must fall inside the Engagement.")
    if ((repo.SCOPE_CATALOGUE_CONSTRAINTS as readonly string[]).includes(constraint)) throw invalid("service", "The product level or service is unknown or not available.")
    if (constraint === repo.SCOPE_AGREEMENT_CONSTRAINT) throw invalid("agreementId", "The agreement must be an active agreement of this Customer.")
    if ((repo.SCOPE_DEPENDENTS_CONSTRAINTS as readonly string[]).includes(constraint)) throw state("The scope still has responsibility windows; end or void them first.")
    if (constraint === repo.CURRENT_RESPONSIBILITY_CONSTRAINT || constraint === repo.RESPONSIBILITY_NO_OVERLAP_CONSTRAINT) throw conflict("TES already holds responsibility for this scope in that period.")
    if (constraint === repo.RESPONSIBILITY_WINDOW_CONSTRAINT) throw invalid("effectiveFrom", "Responsibility must fall inside its scope and its Engagement.")
    if (constraint === repo.CURRENT_AGREEMENT_VERSION_CONSTRAINT || constraint === repo.AGREEMENT_VERSION_NO_OVERLAP_CONSTRAINT) throw conflict("The agreement already has a version in force for that time.")
    if (constraint === repo.AGREEMENT_ACTIVE_CONSTRAINT) throw state("This agreement is archived; restore it first.")
    if (constraint === repo.AGREEMENT_ARCHIVE_BLOCKED_CONSTRAINT) throw state("End the agreement's current version before archiving it.")
    if ((repo.WINDOW_CONSTRAINTS as readonly string[]).includes(constraint)) throw invalid("effectiveFrom", "The effective date must be after the current record began, and a planned end after its start.")
    if ((repo.CONSISTENCY_CONSTRAINTS as readonly string[]).includes(constraint)) throw state("The change would leave the Engagement inconsistent; nothing was changed.")
    throw error
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED" | "RECORD_ARCHIVED" | "RECORD_RESTORED" | "RECORD_LINK_ESTABLISHED" | "RECORD_LINK_REMOVED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })

type Target = { resourceType: string; resourceId: string; organizationId: string; customerId: string; engagementId?: string }

async function record(ctx: OperationContext, eventType: EventTypeName, operation: string, target: Target, fieldChanges: FieldChange[]): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      customerId: target.customerId,
      subjectReferences: [`organization:${target.organizationId}`, ...(target.engagementId ? [`customer_engagement:${target.engagementId}`] : [])],
    },
    source: { sourceType: "APPLICATION", component: "customer-relationship", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

type Locked = { organizationId: string; customerId: string; engagement: EngagementRecord }

/** Locks Organization then Engagement (lock order steps 1-2) and returns what the rest of the operation needs. */
async function lockEngagement(ctx: OperationContext, engagementId: string, options: { requireOpen: boolean; requireActiveOrganization: boolean }): Promise<Locked> {
  const organizationId = await repo.findEngagementOrganization(ctx.client, engagementId)
  if (!organizationId) throw new CustomerRelationshipNotFoundError("Engagement")
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CustomerRelationshipNotFoundError("Engagement")
  if (options.requireActiveOrganization && organization.status !== "active") {
    throw new CustomerRelationshipStateError(organization.status === "merged" ? "This Organization has been merged." : "This Organization is archived; restore it first.")
  }
  const engagement = await repo.getEngagement(ctx.client, engagementId, true)
  if (!engagement) throw new CustomerRelationshipNotFoundError("Engagement")
  if (options.requireOpen && engagement.endedAt !== null) throw new CustomerRelationshipStateError("This Engagement has ended.")
  return { organizationId, customerId: engagement.customerId, engagement }
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) throw new CustomerRelationshipValidationError(field, `${field} cannot be in the future.`)
  return explicit
}

const isGenuineOpen = (row: { recordStatus: string; effectiveTo: string | null }): boolean => row.recordStatus === "active" && row.effectiveTo === null

function inForce(row: { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }, at: string): boolean {
  return row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)
}

const normalizeAt = (asOf: string): string => (/\.\d{3}Z$/.test(asOf) ? asOf.replace(/Z$/, "000Z") : asOf)

// ---------------------------------------------------------------------------------------------------------------
// Views and reads (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

function assembleEngagement(engagement: EngagementRecord, stages: StageRecord[], scopes: ScopeRecord[], responsibilities: ResponsibilityRecord[], terminations: TerminationRecord[], asOf: string | null): EngagementView {
  const at = asOf === null ? null : normalizeAt(asOf)
  return {
    engagement,
    stages,
    scopes,
    responsibilities,
    terminations,
    current: {
      termination: terminations.find((row) => row.recordStatus === "active") ?? null,
      stage: stages.find(isGenuineOpen) ?? null,
      scopes: scopes.filter(isGenuineOpen),
      responsibilities: responsibilities.filter(isGenuineOpen),
    },
    asOf:
      at === null
        ? null
        : {
            at,
            engagementInForce: engagement.startedAt <= at && (engagement.endedAt === null || at < engagement.endedAt),
            stage: stages.find((row) => inForce(row, at)) ?? null,
            scopes: scopes.filter((row) => inForce(row, at)),
            responsibilities: responsibilities.filter((row) => inForce(row, at)),
          },
  }
}

async function loadEngagementViews(client: PoolClient, engagements: EngagementRecord[], asOf: string | null): Promise<EngagementView[]> {
  const ids = engagements.map((row) => row.id)
  const [stages, scopes, responsibilities, terminations] = await Promise.all([repo.listStages(client, ids), repo.listScopes(client, ids), repo.listResponsibilities(client, ids), repo.listTerminations(client, ids)])
  return engagements.map((engagement) => assembleEngagement(engagement, stages.get(engagement.id) ?? [], scopes.get(engagement.id) ?? [], responsibilities.get(engagement.id) ?? [], terminations.get(engagement.id) ?? [], asOf))
}

async function loadEngagement(ctx: OperationContext, engagementId: string): Promise<EngagementView> {
  const engagement = await repo.getEngagement(ctx.client, engagementId)
  if (!engagement) throw new CustomerRelationshipNotFoundError("Engagement")
  return (await loadEngagementViews(ctx.client, [engagement], null))[0]
}

/** The whole Customer relationship of one Organization. An Organization that is not a Customer has `customer: null`. */
export async function readCustomerRelationship(client: PoolClient, rawOrganizationId: unknown, options: { asOf?: string } = {}): Promise<CustomerRelationshipView> {
  const organizationId = parseUuid(rawOrganizationId, "organizationId")
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")
  const exists = await client.query(`SELECT 1 FROM public.organizations WHERE id = $1`, [organizationId])
  if (exists.rowCount === 0) throw new CustomerRelationshipNotFoundError("Organization")
  const customer = await repo.getCustomerByOrganization(client, organizationId)
  if (!customer) return { organizationId, customer: null, engagements: [], openEngagement: null, agreements: [] }
  const engagements = await loadEngagementViews(client, await repo.listEngagements(client, customer.id), asOf)
  return {
    organizationId,
    customer,
    engagements,
    openEngagement: engagements.find((view) => view.engagement.endedAt === null) ?? null,
    agreements: await repo.listAgreements(client, customer.id),
  }
}

export async function readEngagement(client: PoolClient, rawEngagementId: unknown, options: { asOf?: string } = {}): Promise<EngagementView> {
  const engagementId = parseUuid(rawEngagementId, "engagementId")
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")
  const engagement = await repo.getEngagement(client, engagementId)
  if (!engagement) throw new CustomerRelationshipNotFoundError("Engagement")
  return (await loadEngagementViews(client, [engagement], asOf))[0]
}

// ---------------------------------------------------------------------------------------------------------------
// Establishment (CUSTOMER_ESTABLISH)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Turns an eligible Organization into a Customer relationship and begins an Engagement with its initial stage. Reuses the
 * Organization's existing Customer when it returns; never creates a second one. Everything is one transaction.
 */
export async function establishCustomerRelationship(ctx: OperationContext, rawInput: unknown): Promise<EstablishResult> {
  const input = requireObject(rawInput, "input", ["organizationId", "engagementType", "stage", "plannedEndAt", "startedAt"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  if (!isEngagementType(input.engagementType)) throw new CustomerRelationshipValidationError("engagementType", "engagementType must be a supported engagement type.")
  const engagementType = input.engagementType
  const { stage, plannedEndAt } = parseStageInput(input)
  const explicitStart = optionalInstant(input.startedAt, "startedAt")

  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CustomerRelationshipNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new CustomerRelationshipStateError(organization.status === "merged" ? "This Organization has been merged and cannot become a Customer." : "This Organization is archived; restore it before establishing a relationship.")
  }
  const startedAt = await resolveInstant(ctx, explicitStart, "startedAt")

  let customer: CustomerRecord | undefined = await repo.getCustomerByOrganization(ctx.client, organizationId)
  const createdCustomer = customer === undefined
  if (customer) {
    if (await repo.getOpenEngagement(ctx.client, customer.id, true)) {
      throw new CustomerRelationshipConflictError("This Customer already has an open Engagement.")
    }
    const previousEnd = await repo.latestEngagementEnd(ctx.client, customer.id)
    if (previousEnd !== null && startedAt < previousEnd) {
      throw new CustomerRelationshipValidationError("startedAt", "A new Engagement cannot start before the previous Engagement ended.")
    }
  } else {
    customer = await guarded(() => repo.insertCustomer(ctx.client, organizationId))
  }

  const engagement = await guarded(() => repo.insertEngagement(ctx.client, { customerId: customer!.id, engagementType, startedAt }))
  const stageId = randomUUID()
  await guarded(() => repo.insertStage(ctx.client, { id: stageId, engagementId: engagement.id, stage, plannedEndAt, changeReason: "INITIAL", effectiveFrom: startedAt, effectiveTo: null }))

  const target = { organizationId, customerId: customer.id, engagementId: engagement.id }
  if (createdCustomer) {
    await record(ctx, "RECORD_CREATED", "establishCustomerRelationship", { ...target, resourceType: "customer", resourceId: customer.id }, [
      { field: "customer", before: literal(null), after: reference("customers", customer.id) },
      { field: "organization", before: literal(null), after: reference("organizations", organizationId) },
    ])
  }
  await record(ctx, "RECORD_CREATED", "establishCustomerRelationship", { ...target, resourceType: "customer_engagement", resourceId: engagement.id }, [
    { field: "engagement", before: literal(null), after: reference("customer_engagements", engagement.id) },
    { field: "engagementType", before: literal(null), after: literal(engagementType) },
    { field: "reEngagement", before: literal(null), after: literal(!createdCustomer) },
  ])
  await record(ctx, "RECORD_CREATED", "establishCustomerRelationship", { ...target, resourceType: "customer_engagement_stage", resourceId: stageId }, [
    { field: "stage", before: literal(null), after: literal(stage) },
  ])
  return { createdCustomer, customer, engagement: await loadEngagement(ctx, engagement.id) }
}

// ---------------------------------------------------------------------------------------------------------------
// Stage history (CUSTOMER_RELATIONSHIP_MANAGE)
// ---------------------------------------------------------------------------------------------------------------

/** A REAL-WORLD stage change: ends the current stage at T and starts the next one at T. No transition matrix: that is policy. */
export async function changeStage(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["engagementId", "stage", "plannedEndAt", "effectiveFrom"])
  const engagementId = parseUuid(input.engagementId, "engagementId")
  const { stage, plannedEndAt } = parseStageInput(input)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const locked = await lockEngagement(ctx, engagementId, { requireOpen: true, requireActiveOrganization: true })
  const current = await repo.getCurrentStage(ctx.client, engagementId, true)
  if (!current) throw new CustomerRelationshipStateError("This Engagement has no current stage.")
  if (current.stage === stage && current.plannedEndAt === plannedEndAt) throw new CustomerRelationshipValidationError("stage", "The Engagement is already in that stage.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  if (at <= current.effectiveFrom) throw new CustomerRelationshipValidationError("effectiveFrom", "The change must be after the current stage began.")

  const replacementId = randomUUID()
  await guarded(() => repo.endPeriod(ctx.client, "customer_engagement_stages", current.id, at))
  await guarded(() => repo.insertStage(ctx.client, { id: replacementId, engagementId, stage, plannedEndAt, changeReason: "CHANGE", effectiveFrom: at, effectiveTo: null }))
  await record(ctx, "RECORD_UPDATED", "changeStage", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId, resourceType: "customer_engagement_stage", resourceId: replacementId }, [
    { field: "stage", before: literal(current.stage), after: literal(stage) },
  ])
  return loadEngagement(ctx, engagementId)
}

/** A CORRECTION of a wrongly recorded stage (the wrong row is kept and flagged; the replacement inherits its business time). */
export async function correctStage(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["stageId", "stage", "plannedEndAt"])
  const stageId = parseUuid(input.stageId, "stageId")
  const { stage, plannedEndAt } = parseStageInput(input)

  const peek = await repo.getStage(ctx.client, stageId)
  if (!peek) throw new CustomerRelationshipNotFoundError("Stage")
  const locked = await lockEngagement(ctx, peek.engagementId, { requireOpen: false, requireActiveOrganization: false })
  const target = await repo.getStage(ctx.client, stageId, true)
  if (!target) throw new CustomerRelationshipNotFoundError("Stage")
  if (target.recordStatus !== "active") throw new CustomerRelationshipStateError("This stage was already corrected.")
  if (STAGE_DEFINITIONS[target.stage].terminal) throw new CustomerRelationshipStateError("The ended stage mirrors the Engagement's end and cannot be corrected.")
  if (target.stage === stage && target.plannedEndAt === plannedEndAt) throw new CustomerRelationshipValidationError("stage", "The stage is unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markPeriod(ctx.client, "customer_engagement_stages", target.id, "corrected", replacementId))
  await guarded(() =>
    repo.insertStage(ctx.client, { id: replacementId, engagementId: target.engagementId, stage, plannedEndAt, changeReason: "CORRECTION", effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo }),
  )
  await record(ctx, "RECORD_CORRECTED", "correctStage", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: target.engagementId, resourceType: "customer_engagement_stage", resourceId: replacementId }, [
    { field: "stage", before: reference("customer_engagement_stages", target.id), after: reference("customer_engagement_stages", replacementId) },
    { field: "stageCode", before: literal(target.stage), after: literal(stage) },
  ])
  return loadEngagement(ctx, target.engagementId)
}

/**
 * Ends the Engagement: ends open responsibility windows and scopes at the same instant, ends the current stage, starts the
 * ENDED stage, and records ended_at - the single authoritative termination fact. The Customer identity persists; a
 * returning Customer gets a NEW Engagement.
 */
export async function endEngagement(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["engagementId", "endedAt", "endReason"])
  const engagementId = parseUuid(input.engagementId, "engagementId")
  const explicit = optionalInstant(input.endedAt, "endedAt")
  const endReason = parseEndReason(input.endReason)

  const locked = await lockEngagement(ctx, engagementId, { requireOpen: true, requireActiveOrganization: false })
  const current = await repo.getCurrentStage(ctx.client, engagementId, true)
  if (!current) throw new CustomerRelationshipStateError("This Engagement has no current stage.")
  const at = await resolveInstant(ctx, explicit, "endedAt")
  if (at <= locked.engagement.startedAt || at <= current.effectiveFrom) {
    throw new CustomerRelationshipValidationError("endedAt", "The Engagement must end after it began and after its current stage began.")
  }
  const bounds = await repo.dependentBounds(ctx.client, engagementId)
  if ((bounds.latestStart !== null && bounds.latestStart >= at) || (bounds.latestBoundedEnd !== null && bounds.latestBoundedEnd > at)) {
    throw new CustomerRelationshipValidationError("endedAt", "Some scope or responsibility is dated after that end; it must be corrected first.")
  }

  const target = { organizationId: locked.organizationId, customerId: locked.customerId, engagementId }
  const endedResponsibilities = await repo.listOpenResponsibilityIds(ctx.client, { engagementId })
  for (const id of endedResponsibilities) await guarded(() => repo.endPeriod(ctx.client, "engagement_responsibility_periods", id, at))
  const endedScopes = await repo.listOpenScopeIds(ctx.client, engagementId)
  for (const id of endedScopes) await guarded(() => repo.endPeriod(ctx.client, "engagement_service_scopes", id, at))
  await guarded(() => repo.endPeriod(ctx.client, "customer_engagement_stages", current.id, at))
  const endedStageId = randomUUID()
  await guarded(() => repo.insertStage(ctx.client, { id: endedStageId, engagementId, stage: "ENDED", plannedEndAt: null, changeReason: "CHANGE", effectiveFrom: at, effectiveTo: null }))
  await guarded(() => repo.setEngagementEnd(ctx.client, engagementId, at, endReason))
  const terminationId = randomUUID()
  await guarded(() => repo.insertTermination(ctx.client, { id: terminationId, engagementId, endedAt: at, endReason, changeReason: "INITIAL" }))

  // The reason code and the dates are never copied into the register: only references and the lifecycle words.
  await record(ctx, "RECORD_UPDATED", "endEngagement", { ...target, resourceType: "customer_engagement", resourceId: engagementId }, [
    { field: "lifecycle", before: literal("open"), after: literal("ended") },
    { field: "stage", before: reference("customer_engagement_stages", current.id), after: reference("customer_engagement_stages", endedStageId) },
    { field: "termination", before: literal(null), after: reference("customer_engagement_terminations", terminationId) },
  ])
  for (const id of endedScopes) {
    await record(ctx, "RECORD_LINK_REMOVED", "endEngagement", { ...target, resourceType: "engagement_service_scope", resourceId: id }, [{ field: "scope", before: reference("engagement_service_scopes", id), after: literal("ended") }])
  }
  for (const id of endedResponsibilities) {
    await record(ctx, "RECORD_LINK_REMOVED", "endEngagement", { ...target, resourceType: "engagement_responsibility_period", resourceId: id }, [{ field: "responsibility", before: reference("engagement_responsibility_periods", id), after: literal("ended") }])
  }
  return loadEngagement(ctx, engagementId)
}

/**
 * CORRECTS a wrongly recorded termination (date and/or structural reason) of an already-ended Engagement. It is not a way to
 * reopen: only an ended Engagement qualifies, and the Engagement stays ended.
 *
 *   - the old audit row is superseded (kept, flagged, frozen) and a new one mirrors the corrected canonical columns;
 *   - when the date moves, the stage that preceded the end and the ENDED stage are corrected (kept, flagged, replaced by rows
 *     with the new boundary), so stage history stays contiguous and the ENDED stage starts exactly at ended_at;
 *   - when the end moves EARLIER, scopes and responsibility windows that were ended with the old boundary are corrected to
 *     the new one in the same transaction (their originals are kept). When it moves LATER, they are left alone: a correction
 *     never expands TES responsibility;
 *   - a date that leaves any genuine stage, scope or responsibility window impossible is refused.
 */
export async function correctEngagementTermination(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["engagementId", "endedAt", "endReason"])
  const engagementId = parseUuid(input.engagementId, "engagementId")
  const explicitEnd = optionalInstant(input.endedAt, "endedAt")
  const explicitReason = input.endReason === undefined ? null : parseEndReason(input.endReason)
  if (explicitEnd === null && explicitReason === null) throw new CustomerRelationshipValidationError("input", "Nothing to correct.")

  const locked = await lockEngagement(ctx, engagementId, { requireOpen: false, requireActiveOrganization: false })
  const engagement = locked.engagement
  if (engagement.endedAt === null || engagement.endReason === null) {
    throw new CustomerRelationshipStateError("Only the termination of an ended Engagement can be corrected; an open Engagement is ended with endEngagement.")
  }
  const oldEnd = engagement.endedAt
  const oldReason = engagement.endReason
  const previous = await repo.getActiveTermination(ctx.client, engagementId, true)
  if (!previous) throw new CustomerRelationshipStateError("This Engagement has no termination record.")
  const newEnd = explicitEnd ?? oldEnd
  const newReason = explicitReason ?? oldReason
  if (newEnd === oldEnd && newReason === oldReason) throw new CustomerRelationshipValidationError("input", "The termination is unchanged.")

  const stages = ((await repo.listStages(ctx.client, [engagementId])).get(engagementId) ?? []).filter((row) => row.recordStatus === "active")
  const scopes = ((await repo.listScopes(ctx.client, [engagementId])).get(engagementId) ?? []).filter((row) => row.recordStatus === "active")
  const responsibilities = ((await repo.listResponsibilities(ctx.client, [engagementId])).get(engagementId) ?? []).filter((row) => row.recordStatus === "active")
  const endedStage = stages.find((row) => row.effectiveTo === null)
  const precedingStage = stages.find((row) => row.effectiveTo === oldEnd)
  const moved = newEnd !== oldEnd
  const earlier = newEnd < oldEnd

  if (moved) {
    if (newEnd <= engagement.startedAt) throw new CustomerRelationshipValidationError("endedAt", "The Engagement must end after it began.")
    if (!(await repo.isNotInFuture(ctx.client, newEnd))) throw new CustomerRelationshipValidationError("endedAt", "endedAt cannot be in the future.")
    if (!endedStage || !STAGE_DEFINITIONS[endedStage.stage].terminal || !precedingStage) {
      throw new CustomerRelationshipStateError("The Engagement's stage history is not in the expected ended shape.")
    }
    if (newEnd <= precedingStage.effectiveFrom) {
      throw new CustomerRelationshipValidationError("endedAt", "The end must be after the stage that preceded it began; correct that stage first.")
    }
    for (const row of [...scopes, ...responsibilities]) {
      if (row.effectiveFrom >= newEnd) {
        throw new CustomerRelationshipValidationError("endedAt", "A scope or responsibility window starts at or after that end; correct or void it first.")
      }
      if (earlier && row.effectiveTo !== null && row.effectiveTo > newEnd && row.effectiveTo !== oldEnd) {
        throw new CustomerRelationshipValidationError("endedAt", "A scope or responsibility window ends after that date for its own reason; correct it first.")
      }
    }
  }

  const target = { organizationId: locked.organizationId, customerId: locked.customerId, engagementId }
  const terminationId = randomUUID()
  const events: Array<{ type: "scope" | "responsibility" | "stage"; table: string; from: string; to: string }> = []

  // 1. the canonical columns (only ever from one ended value to another; the guard forbids NULL)
  await guarded(() => repo.setEngagementEnd(ctx.client, engagementId, newEnd, newReason))

  if (moved) {
    // 2. dependents that were ended with the old boundary follow it inward (responsibility first: a scope with a live
    //    responsibility window cannot be corrected). Their originals are kept.
    if (earlier) {
      for (const scope of scopes.filter((row) => row.effectiveTo === oldEnd)) {
        const scopeReplacementId = randomUUID()
        const windows = responsibilities.filter((row) => row.scopeId === scope.id)
        const replacements = windows.map((row) => ({ row, id: randomUUID() }))
        for (const { row, id } of replacements) await guarded(() => repo.markPeriod(ctx.client, "engagement_responsibility_periods", row.id, "corrected", id))
        await guarded(() => repo.markPeriod(ctx.client, "engagement_service_scopes", scope.id, "corrected", scopeReplacementId))
        await guarded(() =>
          repo.insertScope(ctx.client, {
            id: scopeReplacementId,
            engagementId,
            productLevel: scope.productLevel,
            serviceCode: scope.serviceCode,
            agreementId: scope.agreementId,
            changeReason: "CORRECTION",
            effectiveFrom: scope.effectiveFrom,
            effectiveTo: newEnd,
          }),
        )
        events.push({ type: "scope", table: "engagement_service_scopes", from: scope.id, to: scopeReplacementId })
        for (const { row, id } of replacements) {
          await guarded(() =>
            repo.insertResponsibility(ctx.client, {
              id,
              engagementId,
              scopeId: scopeReplacementId,
              changeReason: "CORRECTION",
              effectiveFrom: row.effectiveFrom,
              effectiveTo: row.effectiveTo === oldEnd ? newEnd : row.effectiveTo,
            }),
          )
          events.push({ type: "responsibility", table: "engagement_responsibility_periods", from: row.id, to: id })
        }
      }
    }

    // 3. the stage before the end and the ENDED stage move with it
    const precedingId = randomUUID()
    const endedId = randomUUID()
    await guarded(() => repo.markPeriod(ctx.client, "customer_engagement_stages", precedingStage!.id, "corrected", precedingId))
    await guarded(() => repo.markPeriod(ctx.client, "customer_engagement_stages", endedStage!.id, "corrected", endedId))
    await guarded(() =>
      repo.insertStage(ctx.client, {
        id: precedingId,
        engagementId,
        stage: precedingStage!.stage,
        plannedEndAt: precedingStage!.plannedEndAt,
        changeReason: "CORRECTION",
        effectiveFrom: precedingStage!.effectiveFrom,
        effectiveTo: newEnd,
      }),
    )
    await guarded(() => repo.insertStage(ctx.client, { id: endedId, engagementId, stage: "ENDED", plannedEndAt: null, changeReason: "CORRECTION", effectiveFrom: newEnd, effectiveTo: null }))
    events.push({ type: "stage", table: "customer_engagement_stages", from: precedingStage!.id, to: precedingId })
    events.push({ type: "stage", table: "customer_engagement_stages", from: endedStage!.id, to: endedId })
  }

  // 4. the audit trail: the old record is kept and flagged, the new one mirrors the canonical columns
  await guarded(() => repo.supersedeTermination(ctx.client, previous.id, terminationId))
  await guarded(() => repo.insertTermination(ctx.client, { id: terminationId, engagementId, endedAt: newEnd, endReason: newReason, changeReason: "CORRECTION" }))

  // The register gets references only: no date, no reason code, no free text.
  await record(ctx, "RECORD_CORRECTED", "correctEngagementTermination", { ...target, resourceType: "customer_engagement", resourceId: engagementId }, [
    { field: "termination", before: reference("customer_engagement_terminations", previous.id), after: reference("customer_engagement_terminations", terminationId) },
  ])
  for (const event of events) {
    await record(
      ctx,
      "RECORD_CORRECTED",
      "correctEngagementTermination",
      { ...target, resourceType: event.table.replace(/s$/, ""), resourceId: event.to },
      [{ field: event.type, before: reference(event.table, event.from), after: reference(event.table, event.to) }],
    )
  }
  return loadEngagement(ctx, engagementId)
}

// ---------------------------------------------------------------------------------------------------------------
// Service scope
// ---------------------------------------------------------------------------------------------------------------

function parseScopeContent(input: Record<string, unknown>) {
  if (!isProductLevel(input.productLevel)) throw new CustomerRelationshipValidationError("productLevel", "productLevel must be a supported product level.")
  if (input.service !== undefined && input.service !== null && !isServiceCode(input.service)) throw new CustomerRelationshipValidationError("service", "service must be a service code.")
  const agreementId = input.agreementId === undefined || input.agreementId === null ? null : parseUuid(input.agreementId, "agreementId")
  return { productLevel: input.productLevel, serviceCode: (input.service ?? null) as string | null, agreementId }
}

export async function addScope(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["engagementId", "productLevel", "service", "agreementId", "effectiveFrom"])
  const engagementId = parseUuid(input.engagementId, "engagementId")
  const content = parseScopeContent(input)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const locked = await lockEngagement(ctx, engagementId, { requireOpen: true, requireActiveOrganization: true })
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  const scopeId = randomUUID()
  await guarded(() => repo.insertScope(ctx.client, { id: scopeId, engagementId, ...content, changeReason: "INITIAL", effectiveFrom: at, effectiveTo: null }))
  await record(ctx, "RECORD_LINK_ESTABLISHED", "addScope", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId, resourceType: "engagement_service_scope", resourceId: scopeId }, [
    { field: "productLevel", before: literal(null), after: literal(content.productLevel) },
    { field: "service", before: literal(null), after: literal(content.serviceCode) },
  ])
  return loadEngagement(ctx, engagementId)
}

async function lockScope(ctx: OperationContext, scopeId: string, requireOpenEngagement: boolean): Promise<{ locked: Locked; scope: ScopeRecord }> {
  const peek = await repo.getScope(ctx.client, scopeId)
  if (!peek) throw new CustomerRelationshipNotFoundError("Scope")
  const locked = await lockEngagement(ctx, peek.engagementId, { requireOpen: requireOpenEngagement, requireActiveOrganization: false })
  const scope = await repo.getScope(ctx.client, scopeId, true)
  if (!scope) throw new CustomerRelationshipNotFoundError("Scope")
  if (scope.recordStatus !== "active") throw new CustomerRelationshipStateError("This scope was already corrected or voided.")
  return { locked, scope }
}

/** A REAL-WORLD end of a scope. Open responsibility windows for it end at the same instant. */
export async function endScope(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["scopeId", "effectiveTo"])
  const scopeId = parseUuid(input.scopeId, "scopeId")
  const explicit = optionalInstant(input.effectiveTo, "effectiveTo")

  const { locked, scope } = await lockScope(ctx, scopeId, true)
  if (scope.effectiveTo !== null) throw new CustomerRelationshipStateError("This scope has already ended.")
  const at = await resolveInstant(ctx, explicit, "effectiveTo")
  if (at <= scope.effectiveFrom) throw new CustomerRelationshipValidationError("effectiveTo", "The scope must end after it began.")
  const target = { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: scope.engagementId }
  const responsibilityIds = await repo.listOpenResponsibilityIds(ctx.client, { engagementId: scope.engagementId, scopeId })
  for (const id of responsibilityIds) await guarded(() => repo.endPeriod(ctx.client, "engagement_responsibility_periods", id, at))
  await guarded(() => repo.endPeriod(ctx.client, "engagement_service_scopes", scopeId, at))
  await record(ctx, "RECORD_LINK_REMOVED", "endScope", { ...target, resourceType: "engagement_service_scope", resourceId: scopeId }, [
    { field: "scope", before: reference("engagement_service_scopes", scopeId), after: literal("ended") },
  ])
  for (const id of responsibilityIds) {
    await record(ctx, "RECORD_LINK_REMOVED", "endScope", { ...target, resourceType: "engagement_responsibility_period", resourceId: id }, [{ field: "responsibility", before: reference("engagement_responsibility_periods", id), after: literal("ended") }])
  }
  return loadEngagement(ctx, scope.engagementId)
}

/** A CORRECTION of a wrongly recorded scope. Blocked while responsibility windows depend on it (correct or void those first). */
export async function correctScope(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["scopeId", "productLevel", "service", "agreementId"])
  const scopeId = parseUuid(input.scopeId, "scopeId")
  const content = parseScopeContent(input)
  const { locked, scope } = await lockScope(ctx, scopeId, false)
  if (content.productLevel === scope.productLevel && content.serviceCode === scope.serviceCode && content.agreementId === scope.agreementId) {
    throw new CustomerRelationshipValidationError("productLevel", "The scope is unchanged.")
  }
  const replacementId = randomUUID()
  await guarded(() => repo.markPeriod(ctx.client, "engagement_service_scopes", scopeId, "corrected", replacementId))
  await guarded(() => repo.insertScope(ctx.client, { id: replacementId, engagementId: scope.engagementId, ...content, changeReason: "CORRECTION", effectiveFrom: scope.effectiveFrom, effectiveTo: scope.effectiveTo }))
  await record(ctx, "RECORD_CORRECTED", "correctScope", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: scope.engagementId, resourceType: "engagement_service_scope", resourceId: replacementId }, [
    { field: "scope", before: reference("engagement_service_scopes", scopeId), after: reference("engagement_service_scopes", replacementId) },
    { field: "productLevel", before: literal(scope.productLevel), after: literal(content.productLevel) },
  ])
  return loadEngagement(ctx, scope.engagementId)
}

export async function voidScope(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["scopeId"])
  const scopeId = parseUuid(input.scopeId, "scopeId")
  const { locked, scope } = await lockScope(ctx, scopeId, false)
  await guarded(() => repo.markPeriod(ctx.client, "engagement_service_scopes", scopeId, "voided", null))
  await record(ctx, "RECORD_CORRECTED", "voidScope", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: scope.engagementId, resourceType: "engagement_service_scope", resourceId: scopeId }, [
    { field: "scope", before: reference("engagement_service_scopes", scopeId), after: literal("voided") },
  ])
  return loadEngagement(ctx, scope.engagementId)
}

// ---------------------------------------------------------------------------------------------------------------
// TES responsibility windows
// ---------------------------------------------------------------------------------------------------------------

/** TES assumes operational responsibility for an open scope from T. It cannot start before the scope or the Engagement. */
export async function assumeResponsibility(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["scopeId", "effectiveFrom"])
  const scopeId = parseUuid(input.scopeId, "scopeId")
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const peek = await repo.getScope(ctx.client, scopeId)
  if (!peek) throw new CustomerRelationshipNotFoundError("Scope")
  const locked = await lockEngagement(ctx, peek.engagementId, { requireOpen: true, requireActiveOrganization: true })
  const scope = await repo.getScope(ctx.client, scopeId, true)
  if (!scope || scope.recordStatus !== "active") throw new CustomerRelationshipNotFoundError("Scope")
  if (scope.effectiveTo !== null) throw new CustomerRelationshipStateError("This scope has ended.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  if (at < scope.effectiveFrom) throw new CustomerRelationshipValidationError("effectiveFrom", "Responsibility cannot start before its scope.")
  const id = randomUUID()
  await guarded(() => repo.insertResponsibility(ctx.client, { id, engagementId: scope.engagementId, scopeId, changeReason: "INITIAL", effectiveFrom: at, effectiveTo: null }))
  await record(ctx, "RECORD_LINK_ESTABLISHED", "assumeResponsibility", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: scope.engagementId, resourceType: "engagement_responsibility_period", resourceId: id }, [
    { field: "scope", before: literal(null), after: reference("engagement_service_scopes", scopeId) },
  ])
  return loadEngagement(ctx, scope.engagementId)
}

async function lockResponsibility(ctx: OperationContext, responsibilityId: string): Promise<{ locked: Locked; row: ResponsibilityRecord }> {
  const peek = await repo.getResponsibility(ctx.client, responsibilityId)
  if (!peek) throw new CustomerRelationshipNotFoundError("Responsibility")
  const locked = await lockEngagement(ctx, peek.engagementId, { requireOpen: false, requireActiveOrganization: false })
  const row = await repo.getResponsibility(ctx.client, responsibilityId, true)
  if (!row) throw new CustomerRelationshipNotFoundError("Responsibility")
  if (row.recordStatus !== "active") throw new CustomerRelationshipStateError("This responsibility window was already corrected or voided.")
  return { locked, row }
}

/** TES releases responsibility at T. */
export async function endResponsibility(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["responsibilityId", "effectiveTo"])
  const responsibilityId = parseUuid(input.responsibilityId, "responsibilityId")
  const explicit = optionalInstant(input.effectiveTo, "effectiveTo")
  const { locked, row } = await lockResponsibility(ctx, responsibilityId)
  if (row.effectiveTo !== null) throw new CustomerRelationshipStateError("This responsibility window has already ended.")
  const at = await resolveInstant(ctx, explicit, "effectiveTo")
  if (at <= row.effectiveFrom) throw new CustomerRelationshipValidationError("effectiveTo", "Responsibility must end after it began.")
  await guarded(() => repo.endPeriod(ctx.client, "engagement_responsibility_periods", responsibilityId, at))
  await record(ctx, "RECORD_LINK_REMOVED", "endResponsibility", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: row.engagementId, resourceType: "engagement_responsibility_period", resourceId: responsibilityId }, [
    { field: "responsibility", before: reference("engagement_responsibility_periods", responsibilityId), after: literal("ended") },
  ])
  return loadEngagement(ctx, row.engagementId)
}

/** CORRECTS the window of a wrongly recorded responsibility (a time-only record: the corrected value IS the window). */
export async function correctResponsibility(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["responsibilityId", "effectiveFrom", "effectiveTo"])
  const responsibilityId = parseUuid(input.responsibilityId, "responsibilityId")
  const from = optionalInstant(input.effectiveFrom, "effectiveFrom")
  const to = optionalInstant(input.effectiveTo, "effectiveTo")
  const { locked, row } = await lockResponsibility(ctx, responsibilityId)
  const effectiveFrom = from ?? row.effectiveFrom
  const effectiveTo = input.effectiveTo === undefined ? row.effectiveTo : to
  if (effectiveFrom === row.effectiveFrom && effectiveTo === row.effectiveTo) throw new CustomerRelationshipValidationError("effectiveFrom", "The responsibility window is unchanged.")
  if (!(await repo.isNotInFuture(ctx.client, effectiveFrom))) throw new CustomerRelationshipValidationError("effectiveFrom", "effectiveFrom cannot be in the future.")
  const replacementId = randomUUID()
  await guarded(() => repo.markPeriod(ctx.client, "engagement_responsibility_periods", responsibilityId, "corrected", replacementId))
  await guarded(() => repo.insertResponsibility(ctx.client, { id: replacementId, engagementId: row.engagementId, scopeId: row.scopeId, changeReason: "CORRECTION", effectiveFrom, effectiveTo }))
  await record(ctx, "RECORD_CORRECTED", "correctResponsibility", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: row.engagementId, resourceType: "engagement_responsibility_period", resourceId: replacementId }, [
    { field: "responsibility", before: reference("engagement_responsibility_periods", responsibilityId), after: reference("engagement_responsibility_periods", replacementId) },
  ])
  return loadEngagement(ctx, row.engagementId)
}

export async function voidResponsibility(ctx: OperationContext, rawInput: unknown): Promise<EngagementView> {
  const input = requireObject(rawInput, "input", ["responsibilityId"])
  const responsibilityId = parseUuid(input.responsibilityId, "responsibilityId")
  const { locked, row } = await lockResponsibility(ctx, responsibilityId)
  await guarded(() => repo.markPeriod(ctx.client, "engagement_responsibility_periods", responsibilityId, "voided", null))
  await record(ctx, "RECORD_CORRECTED", "voidResponsibility", { organizationId: locked.organizationId, customerId: locked.customerId, engagementId: row.engagementId, resourceType: "engagement_responsibility_period", resourceId: responsibilityId }, [
    { field: "responsibility", before: reference("engagement_responsibility_periods", responsibilityId), after: literal("voided") },
  ])
  return loadEngagement(ctx, row.engagementId)
}

// ---------------------------------------------------------------------------------------------------------------
// Agreements
// ---------------------------------------------------------------------------------------------------------------

type LockedAgreement = { organizationId: string; customerId: string; agreement: Omit<AgreementRecord, "versions"> }

async function lockAgreement(ctx: OperationContext, agreementId: string, requireActiveOrganization: boolean): Promise<LockedAgreement> {
  const organizationId = await repo.findAgreementOrganization(ctx.client, agreementId)
  if (!organizationId) throw new CustomerRelationshipNotFoundError("Agreement")
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CustomerRelationshipNotFoundError("Agreement")
  if (requireActiveOrganization && organization.status !== "active") throw new CustomerRelationshipStateError("This Organization is not active.")
  const agreement = await repo.getAgreementRow(ctx.client, agreementId, true)
  if (!agreement) throw new CustomerRelationshipNotFoundError("Agreement")
  return { organizationId, customerId: agreement.customerId, agreement }
}

async function loadAgreement(ctx: OperationContext, agreementId: string, customerId: string): Promise<AgreementRecord> {
  const agreement = (await repo.listAgreements(ctx.client, customerId)).find((row) => row.id === agreementId)
  if (!agreement) throw new CustomerRelationshipNotFoundError("Agreement")
  return agreement
}

function parseVersionContent(input: Record<string, unknown>) {
  return { reference: parseOptionalText(input.agreementReference, "agreementReference", 100), signedOn: parseOptionalDate(input.signedOn, "signedOn") }
}

/** Creates an agreement identity with its first version. The Organization must already be a Customer. */
export async function createAgreement(ctx: OperationContext, rawInput: unknown): Promise<AgreementRecord> {
  const input = requireObject(rawInput, "input", ["organizationId", "agreementReference", "signedOn", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const content = parseVersionContent(input)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CustomerRelationshipNotFoundError("Organization")
  if (organization.status !== "active") throw new CustomerRelationshipStateError("This Organization is not active.")
  const customer = await repo.getCustomerByOrganization(ctx.client, organizationId)
  if (!customer) throw new CustomerRelationshipNotFoundError("Customer")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  const agreementId = randomUUID()
  const versionId = randomUUID()
  await guarded(() => repo.insertAgreement(ctx.client, { id: agreementId, customerId: customer.id }))
  await guarded(() => repo.insertVersion(ctx.client, { id: versionId, agreementId, ...content, changeReason: "INITIAL", effectiveFrom: at, effectiveTo: null }))
  const target = { organizationId, customerId: customer.id }
  await record(ctx, "RECORD_CREATED", "createAgreement", { ...target, resourceType: "customer_agreement", resourceId: agreementId }, [
    { field: "agreement", before: literal(null), after: reference("customer_agreements", agreementId) },
  ])
  await record(ctx, "RECORD_CREATED", "createAgreement", { ...target, resourceType: "customer_agreement_version", resourceId: versionId }, [
    { field: "version", before: literal(null), after: reference("customer_agreement_versions", versionId) },
  ])
  return loadAgreement(ctx, agreementId, customer.id)
}

/** A REAL-WORLD amendment: ends the current version at T and starts the next at T. Previous versions are preserved. */
export async function amendAgreement(ctx: OperationContext, rawInput: unknown): Promise<AgreementRecord> {
  const input = requireObject(rawInput, "input", ["agreementId", "agreementReference", "signedOn", "effectiveFrom"])
  const agreementId = parseUuid(input.agreementId, "agreementId")
  const content = parseVersionContent(input)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const locked = await lockAgreement(ctx, agreementId, true)
  if (locked.agreement.recordStatus !== "active") throw new CustomerRelationshipStateError("This agreement is archived; restore it first.")
  const current = await repo.getCurrentVersion(ctx.client, agreementId, true)
  if (!current) throw new CustomerRelationshipStateError("This agreement has no version in force to amend.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  if (at <= current.effectiveFrom) throw new CustomerRelationshipValidationError("effectiveFrom", "The amendment must be after the current version began.")
  const versionId = randomUUID()
  await guarded(() => repo.endPeriod(ctx.client, "customer_agreement_versions", current.id, at))
  await guarded(() => repo.insertVersion(ctx.client, { id: versionId, agreementId, ...content, changeReason: "AMENDMENT", effectiveFrom: at, effectiveTo: null }))
  await record(ctx, "RECORD_UPDATED", "amendAgreement", { organizationId: locked.organizationId, customerId: locked.customerId, resourceType: "customer_agreement_version", resourceId: versionId }, [
    { field: "version", before: reference("customer_agreement_versions", current.id), after: reference("customer_agreement_versions", versionId) },
  ])
  return loadAgreement(ctx, agreementId, locked.customerId)
}

/** CORRECTS a wrongly recorded version (kept and flagged; the replacement inherits its business time). */
export async function correctAgreementVersion(ctx: OperationContext, rawInput: unknown): Promise<AgreementRecord> {
  const input = requireObject(rawInput, "input", ["versionId", "agreementReference", "signedOn"])
  const versionId = parseUuid(input.versionId, "versionId")
  const content = parseVersionContent(input)
  const agreementId = await repo.findVersionAgreement(ctx.client, versionId)
  if (!agreementId) throw new CustomerRelationshipNotFoundError("Agreement version")
  const locked = await lockAgreement(ctx, agreementId, false)
  const version = await repo.getVersion(ctx.client, versionId, true)
  if (!version) throw new CustomerRelationshipNotFoundError("Agreement version")
  if (version.recordStatus !== "active") throw new CustomerRelationshipStateError("This version was already corrected or voided.")
  if (content.reference === version.agreementReference && content.signedOn === version.signedOn) throw new CustomerRelationshipValidationError("agreementReference", "The version is unchanged.")
  const replacementId = randomUUID()
  await guarded(() => repo.markPeriod(ctx.client, "customer_agreement_versions", versionId, "corrected", replacementId))
  await guarded(() => repo.insertVersion(ctx.client, { id: replacementId, agreementId, ...content, changeReason: "CORRECTION", effectiveFrom: version.effectiveFrom, effectiveTo: version.effectiveTo }))
  await record(ctx, "RECORD_CORRECTED", "correctAgreementVersion", { organizationId: locked.organizationId, customerId: locked.customerId, resourceType: "customer_agreement_version", resourceId: replacementId }, [
    { field: "version", before: reference("customer_agreement_versions", versionId), after: reference("customer_agreement_versions", replacementId) },
  ])
  return loadAgreement(ctx, agreementId, locked.customerId)
}

/** A REAL-WORLD end of the agreement: ends the version in force without a successor. */
export async function endAgreement(ctx: OperationContext, rawInput: unknown): Promise<AgreementRecord> {
  const input = requireObject(rawInput, "input", ["agreementId", "effectiveTo"])
  const agreementId = parseUuid(input.agreementId, "agreementId")
  const explicit = optionalInstant(input.effectiveTo, "effectiveTo")
  const locked = await lockAgreement(ctx, agreementId, false)
  const current = await repo.getCurrentVersion(ctx.client, agreementId, true)
  if (!current) throw new CustomerRelationshipStateError("This agreement has no version in force.")
  const at = await resolveInstant(ctx, explicit, "effectiveTo")
  if (at <= current.effectiveFrom) throw new CustomerRelationshipValidationError("effectiveTo", "The agreement must end after the current version began.")
  await guarded(() => repo.endPeriod(ctx.client, "customer_agreement_versions", current.id, at))
  await record(ctx, "RECORD_LINK_REMOVED", "endAgreement", { organizationId: locked.organizationId, customerId: locked.customerId, resourceType: "customer_agreement_version", resourceId: current.id }, [
    { field: "version", before: reference("customer_agreement_versions", current.id), after: literal("ended") },
  ])
  return loadAgreement(ctx, agreementId, locked.customerId)
}

export async function archiveAgreement(ctx: OperationContext, rawInput: unknown): Promise<AgreementRecord> {
  const input = requireObject(rawInput, "input", ["agreementId"])
  const agreementId = parseUuid(input.agreementId, "agreementId")
  const locked = await lockAgreement(ctx, agreementId, false)
  if (locked.agreement.recordStatus === "archived") throw new CustomerRelationshipStateError("This agreement is already archived.")
  await guarded(() => repo.setAgreementArchived(ctx.client, agreementId, true))
  await record(ctx, "RECORD_ARCHIVED", "archiveAgreement", { organizationId: locked.organizationId, customerId: locked.customerId, resourceType: "customer_agreement", resourceId: agreementId }, [
    { field: "lifecycle", before: literal("active"), after: literal("archived") },
  ])
  return loadAgreement(ctx, agreementId, locked.customerId)
}

export async function restoreAgreement(ctx: OperationContext, rawInput: unknown): Promise<AgreementRecord> {
  const input = requireObject(rawInput, "input", ["agreementId"])
  const agreementId = parseUuid(input.agreementId, "agreementId")
  const locked = await lockAgreement(ctx, agreementId, true)
  if (locked.agreement.recordStatus !== "archived") throw new CustomerRelationshipStateError("This agreement is not archived.")
  await guarded(() => repo.setAgreementArchived(ctx.client, agreementId, false))
  await record(ctx, "RECORD_RESTORED", "restoreAgreement", { organizationId: locked.organizationId, customerId: locked.customerId, resourceType: "customer_agreement", resourceId: agreementId }, [
    { field: "lifecycle", before: literal("archived"), after: literal("active") },
  ])
  return loadAgreement(ctx, agreementId, locked.customerId)
}

export type { AgreementVersionRecord }
