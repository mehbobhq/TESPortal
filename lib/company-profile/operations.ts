/**
 * Company Operating Profile operations: validation, business rules and Master Register events on a caller-supplied
 * transaction.
 *
 * Every function here runs INSIDE a transaction the authorization wrapper already opened, and Master Register events are
 * written through a repository bound to the same client, so a failure anywhere (including the Master Register) rolls the
 * whole change back.
 *
 * Three effective-dated facts per Organization, each with correction history:
 *   operating scope        one value at a time (CANADA | UNITED_STATES | CANADA_AND_UNITED_STATES)
 *   rule applicability     per catalogued rule: APPLIES | DOES_NOT_APPLY. NO assertion means "not configured" (or the
 *                          catalogue default). clearRuleApplicability ends an assertion without replacing it.
 *   driver requirements    company minimum driver age (years) and experience (months)
 *
 * LOCK ORDER (every mutation, without exception):
 *   1. the Organization row   (all writers of one Organization's profile serialize here; this is also what makes two
 *                              simultaneous first assertions for one rule resolve to exactly one winner)
 *   2. the fact's current / target period row (FOR NO KEY UPDATE)
 * The partial unique indexes on "current" periods are the structural backstop for a writer that bypasses this layer.
 *
 * Correction vs real-world change:
 *   set / change   a REAL-WORLD change: the current period is ended at T and the next one starts at T (both stay history).
 *                  A new period may not start before the current one began, nor before the latest end of earlier history.
 *   clear          a REAL-WORLD end with no replacement (rules only): the rule is not configured again.
 *   correct        the recorded period was WRONG: it is kept, flagged 'corrected', pointed at its replacement and never
 *                  ended; the replacement inherits its business time. A correction that changes nothing is refused.
 * Backdating is allowed; the future is not. Nothing is deleted. An archived or merged Organization refuses every mutation.
 *
 * Repeating an assertion that is already current is refused with a Conflict (it is the "someone else got there first"
 * outcome of a double submit), never silently accepted.
 *
 * Master Register: events reference rows (table:id) and carry only controlled-vocabulary literals (rule code, scope,
 * applicability). Driver minimums are numbers and are treated like dates and amounts: references only.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  DRIVER_AGE_YEARS,
  DRIVER_EXPERIENCE_MONTHS,
  effectiveApplicability,
  isApplicability,
  isDriverAgeYears,
  isDriverExperienceMonths,
  isOperatingScope,
  isRuleCodeShape,
  type Applicability,
  type OperatingScope,
} from "@/lib/company-profile/definitions"
import { CompanyProfileConflictError, CompanyProfileNotFoundError, CompanyProfileStateError, CompanyProfileValidationError } from "@/lib/company-profile/errors"
import * as repo from "@/lib/company-profile/repository"
import type {
  CatalogueRule,
  CompanyProfileView,
  DriverRequirementPeriod,
  RuleProfileEntry,
  TaxAlignment,
  TaxApplicabilityComparison,
} from "@/lib/company-profile/types"
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

function requireObject(value: unknown, field: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CompanyProfileValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new CompanyProfileValidationError(`${field}.${key}`, `${field}.${key} is not accepted.`)
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new CompanyProfileValidationError(field, `${field} must be a UUID.`)
}

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC at microsecond precision. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new CompanyProfileValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new CompanyProfileValidationError(field, `${field} is not a valid instant.`)
  // JS keeps milliseconds only; carry any extra microsecond digits the caller supplied so ordering is never lost.
  const micros = /\.(\d{1,6})(Z|[+-]\d{2}:\d{2})$/.exec(value.trim())?.[1]?.padEnd(6, "0") ?? "000000"
  return date.toISOString().replace(/\.\d{3}Z$/, `.${micros}Z`)
}

const optionalInstant = (value: unknown, field: string): string | null => (value === undefined ? null : parseInstant(value, field))

function parseRuleCode(value: unknown): string {
  if (!isRuleCodeShape(value)) throw new CompanyProfileValidationError("ruleCode", "ruleCode must be a catalogued rule code.")
  return value
}

function parseScope(value: unknown): OperatingScope {
  if (!isOperatingScope(value)) throw new CompanyProfileValidationError("operatingScope", "operatingScope must be CANADA, UNITED_STATES or CANADA_AND_UNITED_STATES.")
  return value
}

function parseApplicability(value: unknown): Applicability {
  if (!isApplicability(value)) throw new CompanyProfileValidationError("applicability", "applicability must be APPLIES or DOES_NOT_APPLY (not configured is the absence of an assertion).")
  return value
}

function parseDriverMinimums(input: Record<string, unknown>): { minimumDriverAgeYears: number; minimumDriverExperienceMonths: number } {
  if (!isDriverAgeYears(input.minimumDriverAgeYears)) {
    throw new CompanyProfileValidationError("minimumDriverAgeYears", `minimumDriverAgeYears must be a whole number from ${DRIVER_AGE_YEARS.min} to ${DRIVER_AGE_YEARS.max}.`)
  }
  if (!isDriverExperienceMonths(input.minimumDriverExperienceMonths)) {
    throw new CompanyProfileValidationError("minimumDriverExperienceMonths", `minimumDriverExperienceMonths must be a whole number from ${DRIVER_EXPERIENCE_MONTHS.min} to ${DRIVER_EXPERIENCE_MONTHS.max}.`)
  }
  return { minimumDriverAgeYears: input.minimumDriverAgeYears, minimumDriverExperienceMonths: input.minimumDriverExperienceMonths }
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
    if ((repo.CURRENT_CONSTRAINTS as readonly string[]).includes(constraint)) throw new CompanyProfileConflictError("A concurrent change was made to this profile fact; retry the operation.")
    if (constraint === repo.ORGANIZATION_ACTIVE_CONSTRAINT) throw new CompanyProfileStateError("This Organization is not active.")
    if ((repo.RULE_ACTIVE_CONSTRAINTS as readonly string[]).includes(constraint)) throw new CompanyProfileValidationError("ruleCode", "The rule is not an active company profile rule.")
    if ((repo.WINDOW_CONSTRAINTS as readonly string[]).includes(constraint)) throw new CompanyProfileValidationError("effectiveFrom", "The effective date must be after the current record began.")
    if ((repo.VALUE_CONSTRAINTS as readonly string[]).includes(constraint)) throw new CompanyProfileValidationError("value", "The value is not accepted.")
    throw error
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED"

const literal = (value: string): { kind: "LITERAL"; value: string } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })

type Target = { resourceType: "company_operating_scope_period" | "company_rule_applicability_period" | "company_driver_requirement_period"; resourceId: string; organizationId: string }

async function record(ctx: OperationContext, eventType: EventTypeName, operation: string, target: Target, fieldChanges: FieldChange[]): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      subjectReferences: [`organization:${target.organizationId}`],
    },
    source: { sourceType: "APPLICATION", component: "company-profile", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

/** Locks the Organization (lock order step 1) and refuses an archived or merged one. */
async function lockActiveOrganization(ctx: OperationContext, organizationId: string): Promise<void> {
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CompanyProfileNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new CompanyProfileStateError(organization.status === "merged" ? "This Organization has been merged." : "This Organization is archived; restore it first.")
  }
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) throw new CompanyProfileValidationError(field, `${field} cannot be in the future.`)
  return explicit
}

/** A change must start after the current period began; a first (or post-clear) period may not start before earlier history ended. */
async function checkStart(ctx: OperationContext, table: repo.PeriodTable, organizationId: string, current: { effectiveFrom: string } | undefined, at: string, ruleCode?: string): Promise<void> {
  if (current) {
    if (at <= current.effectiveFrom) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
    return
  }
  const previousEnd = await repo.latestEnd(ctx.client, table, organizationId, ruleCode)
  if (previousEnd !== null && at < previousEnd) throw new CompanyProfileValidationError("effectiveFrom", "The new record cannot start before the previous record ended.")
}

const isGenuineOpen = (row: { recordStatus: string; effectiveTo: string | null }): boolean => row.recordStatus === "active" && row.effectiveTo === null
const inForce = (row: { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }, at: string): boolean =>
  row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)

// ---------------------------------------------------------------------------------------------------------------
// Reads (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

function parseReadOptions(options: unknown): string | null {
  const parsed = requireObject(options ?? {}, "options", ["asOf"])
  return parsed.asOf === undefined ? null : parseInstant(parsed.asOf, "asOf")
}

async function assembleProfile(client: PoolClient, organizationId: string, asOf: string | null): Promise<CompanyProfileView> {
  const [catalogue, scopes, rules, drivers] = await Promise.all([
    repo.listRules(client),
    repo.listScopePeriods(client, organizationId),
    repo.listRulePeriods(client, organizationId),
    repo.listDriverPeriods(client, organizationId),
  ])
  const pick = <T extends { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }>(rows: T[]): T | null =>
    rows.find((row) => (asOf === null ? isGenuineOpen(row) : inForce(row, asOf))) ?? null
  return {
    organizationId,
    asOf,
    operatingScope: { assertion: pick(scopes), history: scopes },
    driverRequirements: { assertion: pick(drivers), history: drivers },
    rules: catalogue.map((rule): RuleProfileEntry => {
      const history = rules.filter((row) => row.ruleCode === rule.code)
      const assertion = pick(history)
      return { rule, assertion, ...effectiveApplicability(rule, assertion?.applicability ?? null), history }
    }),
  }
}

/** The whole Company Operating Profile of one Organization, current or as of a business instant. */
export async function readCompanyProfile(client: PoolClient, rawOrganizationId: unknown, options?: { asOf?: string }): Promise<CompanyProfileView> {
  const organizationId = parseUuid(rawOrganizationId, "organizationId")
  const asOf = parseReadOptions(options)
  if (!(await repo.organizationExists(client, organizationId))) throw new CompanyProfileNotFoundError("Organization")
  return assembleProfile(client, organizationId, asOf)
}

/** The controlled rule catalogue. */
export async function readRules(client: PoolClient): Promise<CatalogueRule[]> {
  return repo.listRules(client)
}

function alignmentOf(entry: { effective: string; hasActiveRegistration: boolean | null }): TaxAlignment {
  if (entry.hasActiveRegistration === null) return "NO_REGISTRATION_IDENTITY"
  if (entry.effective === "APPLIES") return entry.hasActiveRegistration ? "CONSISTENT" : "APPLIES_WITHOUT_ACTIVE_REGISTRATION"
  if (entry.effective === "DOES_NOT_APPLY") return entry.hasActiveRegistration ? "DOES_NOT_APPLY_WITH_ACTIVE_REGISTRATION" : "CONSISTENT"
  return entry.hasActiveRegistration ? "REGISTRATION_WITHOUT_APPLICABILITY" : "NOT_CONFIGURED"
}

/**
 * Read-only comparison of TAX rule applicability with the existence of an ACTIVE-status registration for the mapped
 * program. Registrations are read with plain SELECTs (this domain never imports the registrations domain) and only the
 * boolean is exposed: no number, id or date.
 */
export async function compareTaxApplicabilityWithRegistrations(client: PoolClient, rawOrganizationId: unknown): Promise<TaxApplicabilityComparison[]> {
  const organizationId = parseUuid(rawOrganizationId, "organizationId")
  if (!(await repo.organizationExists(client, organizationId))) throw new CompanyProfileNotFoundError("Organization")
  const [profile, presence] = await Promise.all([assembleProfile(client, organizationId, null), repo.listTaxRuleRegistrationPresence(client, organizationId)])
  const byCode = new Map(profile.rules.map((entry) => [entry.rule.code, entry]))
  return presence.map((row) => {
    const entry = byCode.get(row.ruleCode)!
    return {
      ruleCode: row.ruleCode,
      registrationProgramCode: row.registrationProgramCode,
      effective: entry.effective,
      source: entry.source,
      hasActiveRegistration: row.hasActiveRegistration,
      alignment: alignmentOf({ effective: entry.effective, hasActiveRegistration: row.hasActiveRegistration }),
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Operating scope
// ---------------------------------------------------------------------------------------------------------------

/** Records the first operating scope, or changes it (the previous scope is ended and stays true history). */
export async function setOperatingScope(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["organizationId", "operatingScope", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const operatingScope = parseScope(input.operatingScope)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  const current = await repo.getCurrentScope(ctx.client, organizationId, true)
  if (current?.operatingScope === operatingScope) throw new CompanyProfileConflictError("The Organization already has that operating scope.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  await checkStart(ctx, "company_operating_scope_periods", organizationId, current, at)

  const id = randomUUID()
  if (current) await guarded(() => repo.endPeriod(ctx.client, "company_operating_scope_periods", current.id, at))
  await guarded(() => repo.insertScope(ctx.client, { id, organizationId, operatingScope, effectiveFrom: at }))
  await record(
    ctx,
    current ? "RECORD_UPDATED" : "RECORD_CREATED",
    "setOperatingScope",
    { resourceType: "company_operating_scope_period", resourceId: id, organizationId },
    [{ field: "operatingScope", ...(current ? { before: literal(current.operatingScope) } : {}), after: literal(operatingScope) }],
  )
  return assembleProfile(ctx.client, organizationId, null)
}

/** CORRECTS a wrongly recorded operating scope (the wrong period is kept and flagged; the replacement inherits its business time). */
export async function correctOperatingScope(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["periodId", "operatingScope"])
  const periodId = parseUuid(input.periodId, "periodId")
  const operatingScope = parseScope(input.operatingScope)

  const organizationId = await repo.findPeriodOrganization(ctx.client, "company_operating_scope_periods", periodId)
  if (!organizationId) throw new CompanyProfileNotFoundError("Operating scope period")
  await lockActiveOrganization(ctx, organizationId)
  const target = await repo.getScopePeriod(ctx.client, periodId, true)
  if (!target) throw new CompanyProfileNotFoundError("Operating scope period")
  if (target.recordStatus !== "active") throw new CompanyProfileStateError("This operating scope was already corrected.")
  if (target.operatingScope === operatingScope) throw new CompanyProfileValidationError("operatingScope", "The operating scope is unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markCorrected(ctx.client, "company_operating_scope_periods", target.id, replacementId))
  await guarded(() => repo.insertScope(ctx.client, { id: replacementId, organizationId, operatingScope, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo }))
  await record(ctx, "RECORD_CORRECTED", "correctOperatingScope", { resourceType: "company_operating_scope_period", resourceId: replacementId, organizationId }, [
    { field: "period", before: reference("company_operating_scope_periods", target.id), after: reference("company_operating_scope_periods", replacementId) },
    { field: "operatingScope", before: literal(target.operatingScope), after: literal(operatingScope) },
  ])
  return assembleProfile(ctx.client, organizationId, null)
}

// ---------------------------------------------------------------------------------------------------------------
// Rule applicability
// ---------------------------------------------------------------------------------------------------------------

async function requireCatalogueRule(ctx: OperationContext, ruleCode: string, options: { mustBeActive: boolean }): Promise<CatalogueRule> {
  const rule = await repo.getRule(ctx.client, ruleCode)
  if (!rule || (options.mustBeActive && !rule.isActive)) throw new CompanyProfileValidationError("ruleCode", "ruleCode must be an active catalogued rule.")
  return rule
}

/**
 * Asserts that a catalogued rule APPLIES or DOES_NOT_APPLY: the first assertion, a first assertion after a clear, or a change
 * (the previous assertion is ended and stays history). Repeating the current assertion is refused.
 */
export async function setRuleApplicability(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["organizationId", "ruleCode", "applicability", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const ruleCode = parseRuleCode(input.ruleCode)
  const applicability = parseApplicability(input.applicability)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  await requireCatalogueRule(ctx, ruleCode, { mustBeActive: true })
  const current = await repo.getCurrentRulePeriod(ctx.client, organizationId, ruleCode, true)
  if (current?.applicability === applicability) throw new CompanyProfileConflictError("That rule already has that applicability.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  await checkStart(ctx, "company_rule_applicability_periods", organizationId, current, at, ruleCode)

  const id = randomUUID()
  if (current) await guarded(() => repo.endPeriod(ctx.client, "company_rule_applicability_periods", current.id, at))
  await guarded(() => repo.insertRulePeriod(ctx.client, { id, organizationId, ruleCode, applicability, effectiveFrom: at }))
  await record(
    ctx,
    current ? "RECORD_UPDATED" : "RECORD_CREATED",
    "setRuleApplicability",
    { resourceType: "company_rule_applicability_period", resourceId: id, organizationId },
    [
      { field: "ruleCode", after: literal(ruleCode) },
      { field: "applicability", ...(current ? { before: literal(current.applicability) } : {}), after: literal(applicability) },
    ],
  )
  return assembleProfile(ctx.client, organizationId, null)
}

/** Ends the current assertion with no replacement: the rule is NOT CONFIGURED again (or takes its catalogue default). */
export async function clearRuleApplicability(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["organizationId", "ruleCode", "endedAt"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const ruleCode = parseRuleCode(input.ruleCode)
  const explicit = optionalInstant(input.endedAt, "endedAt")

  await lockActiveOrganization(ctx, organizationId)
  await requireCatalogueRule(ctx, ruleCode, { mustBeActive: false })
  const current = await repo.getCurrentRulePeriod(ctx.client, organizationId, ruleCode, true)
  if (!current) throw new CompanyProfileStateError("That rule has no current assertion to clear.")
  const at = await resolveInstant(ctx, explicit, "endedAt")
  if (at <= current.effectiveFrom) throw new CompanyProfileValidationError("endedAt", "The assertion must end after it began.")

  await guarded(() => repo.endPeriod(ctx.client, "company_rule_applicability_periods", current.id, at))
  await record(ctx, "RECORD_UPDATED", "clearRuleApplicability", { resourceType: "company_rule_applicability_period", resourceId: current.id, organizationId }, [
    { field: "ruleCode", after: literal(ruleCode) },
    { field: "applicability", before: literal(current.applicability), after: literal("NOT_CONFIGURED") },
  ])
  return assembleProfile(ctx.client, organizationId, null)
}

/** CORRECTS a wrongly recorded assertion (the wrong period is kept and flagged; the replacement inherits its business time). */
export async function correctRuleApplicability(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["periodId", "applicability"])
  const periodId = parseUuid(input.periodId, "periodId")
  const applicability = parseApplicability(input.applicability)

  const organizationId = await repo.findPeriodOrganization(ctx.client, "company_rule_applicability_periods", periodId)
  if (!organizationId) throw new CompanyProfileNotFoundError("Rule applicability period")
  await lockActiveOrganization(ctx, organizationId)
  const target = await repo.getRulePeriod(ctx.client, periodId, true)
  if (!target) throw new CompanyProfileNotFoundError("Rule applicability period")
  if (target.recordStatus !== "active") throw new CompanyProfileStateError("This rule applicability was already corrected.")
  if (target.applicability === applicability) throw new CompanyProfileValidationError("applicability", "The applicability is unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markCorrected(ctx.client, "company_rule_applicability_periods", target.id, replacementId))
  await guarded(() => repo.insertRulePeriod(ctx.client, { id: replacementId, organizationId, ruleCode: target.ruleCode, applicability, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo }))
  await record(ctx, "RECORD_CORRECTED", "correctRuleApplicability", { resourceType: "company_rule_applicability_period", resourceId: replacementId, organizationId }, [
    { field: "period", before: reference("company_rule_applicability_periods", target.id), after: reference("company_rule_applicability_periods", replacementId) },
    { field: "ruleCode", after: literal(target.ruleCode) },
    { field: "applicability", before: literal(target.applicability), after: literal(applicability) },
  ])
  return assembleProfile(ctx.client, organizationId, null)
}

// ---------------------------------------------------------------------------------------------------------------
// Driver requirements
// ---------------------------------------------------------------------------------------------------------------

const sameMinimums = (a: DriverRequirementPeriod, b: { minimumDriverAgeYears: number; minimumDriverExperienceMonths: number }): boolean =>
  a.minimumDriverAgeYears === b.minimumDriverAgeYears && a.minimumDriverExperienceMonths === b.minimumDriverExperienceMonths

/** Records the company driver minimums for the first time, or changes them (the previous minimums are ended and stay history). */
export async function setDriverRequirements(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["organizationId", "minimumDriverAgeYears", "minimumDriverExperienceMonths", "effectiveFrom"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const minimums = parseDriverMinimums(input)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  await lockActiveOrganization(ctx, organizationId)
  const current = await repo.getCurrentDriverPeriod(ctx.client, organizationId, true)
  if (current && sameMinimums(current, minimums)) throw new CompanyProfileConflictError("The Organization already has those driver requirements.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  await checkStart(ctx, "company_driver_requirement_periods", organizationId, current, at)

  const id = randomUUID()
  if (current) await guarded(() => repo.endPeriod(ctx.client, "company_driver_requirement_periods", current.id, at))
  await guarded(() => repo.insertDriverPeriod(ctx.client, { id, organizationId, ...minimums, effectiveFrom: at }))
  await record(
    ctx,
    current ? "RECORD_UPDATED" : "RECORD_CREATED",
    "setDriverRequirements",
    { resourceType: "company_driver_requirement_period", resourceId: id, organizationId },
    [{ field: "driverRequirementPeriod", ...(current ? { before: reference("company_driver_requirement_periods", current.id) } : {}), after: reference("company_driver_requirement_periods", id) }],
  )
  return assembleProfile(ctx.client, organizationId, null)
}

/** CORRECTS wrongly recorded driver minimums (the wrong period is kept and flagged; the replacement inherits its business time). */
export async function correctDriverRequirements(ctx: OperationContext, rawInput: unknown): Promise<CompanyProfileView> {
  const input = requireObject(rawInput, "input", ["periodId", "minimumDriverAgeYears", "minimumDriverExperienceMonths"])
  const periodId = parseUuid(input.periodId, "periodId")
  const minimums = parseDriverMinimums(input)

  const organizationId = await repo.findPeriodOrganization(ctx.client, "company_driver_requirement_periods", periodId)
  if (!organizationId) throw new CompanyProfileNotFoundError("Driver requirement period")
  await lockActiveOrganization(ctx, organizationId)
  const target = await repo.getDriverPeriod(ctx.client, periodId, true)
  if (!target) throw new CompanyProfileNotFoundError("Driver requirement period")
  if (target.recordStatus !== "active") throw new CompanyProfileStateError("These driver requirements were already corrected.")
  if (sameMinimums(target, minimums)) throw new CompanyProfileValidationError("minimumDriverAgeYears", "The driver requirements are unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markCorrected(ctx.client, "company_driver_requirement_periods", target.id, replacementId))
  await guarded(() => repo.insertDriverPeriod(ctx.client, { id: replacementId, organizationId, ...minimums, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo }))
  await record(ctx, "RECORD_CORRECTED", "correctDriverRequirements", { resourceType: "company_driver_requirement_period", resourceId: replacementId, organizationId }, [
    { field: "driverRequirementPeriod", before: reference("company_driver_requirement_periods", target.id), after: reference("company_driver_requirement_periods", replacementId) },
  ])
  return assembleProfile(ctx.client, organizationId, null)
}
