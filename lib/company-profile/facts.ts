/**
 * Company and Customer profile facts: cargo categories, fleet provider names and the Customer's billing preference
 * (migration 0033). Validation, business rules and Master Register events on a caller-supplied transaction.
 *
 *   cargo categories    DESCRIPTIVE categories a company carries (several at once). Never a compliance claim: a category does not
 *                       assert that any regulation applies (rule applicability, 0019, is a separate, jurisdiction-specific fact).
 *   fleet providers     the NAME of a company's truck GPS provider and fuel provider (one current per kind). A name never creates an
 *                       Organization, a credential or a registry entry.
 *   billing preference  the payment method a Customer PREFERS to be billed by (one current). Not contractual payment terms (the
 *                       contract model owns those), not a payment transaction, no account, card or bank detail. Customers only.
 *
 * Every function runs INSIDE the transaction the authorization wrapper opened; Master Register events are written through a
 * repository bound to the same client, so a failure anywhere (including the Master Register) rolls the whole change back.
 * Capability: cargo and fleet providers need COMPANY_PROFILE_MANAGE (read: COMPANY_PROFILE_READ); the billing preference needs
 * CUSTOMER_RELATIONSHIP_MANAGE (read: CUSTOMER_RELATIONSHIP_READ). The caller enters the capability before calling in; row-level
 * security re-proves it for each statement.
 *
 * LOCK ORDER (every mutation): the Organization row (FOR UPDATE), then the fact's current row(s). The partial unique "current"
 * indexes are the structural backstop for a writer that bypasses this layer.
 *
 * Change vs correction (same meaning as every other effective-dated fact):
 *   change   a REAL-WORLD change: the current row is ended at T and the next one starts at T (both stay history).
 *   correct  the recorded row was WRONG: it is kept and flagged 'corrected' (or 'voided' when it should never have existed and
 *            nothing replaces it), never ended; the replacement inherits its business time.
 *   clear    (change mode, empty value) a REAL-WORLD end with no replacement.
 * An unchanged value is a no-op (nothing written, no event). Nothing is deleted.
 *
 * Master Register: events reference rows (table:id) and carry only controlled literals (category code, provider kind, payment
 * method code). A provider NAME is free text and is never placed in an event; the row reference identifies it.
 *
 * No "server-only" import: plain domain logic, testable under Node. The server-only boundary is the calling service.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { CompanyProfileNotFoundError, CompanyProfileStateError, CompanyProfileValidationError, CompanyProfileConflictError } from "@/lib/company-profile/errors"
import type { OperationContext } from "@/lib/company-profile/operations"
import { normalizeProviderName, prepareProviderName } from "@/lib/company-profile/definitions"
import * as repo from "@/lib/company-profile/repository"
import { recordEvent } from "@/lib/master-register/record-event"
import type { FieldChange } from "@/lib/master-register/types"

import { isFleetProviderKind, type FleetProviderKind } from "@/lib/company-profile/definitions"
export { FLEET_PROVIDER_KINDS, isFleetProviderKind, normalizeProviderName, prepareProviderName, type FleetProviderKind } from "@/lib/company-profile/definitions"

export type FactMode = "change" | "correct"
export const isFactMode = (value: unknown): value is FactMode => value === "change" || value === "correct"

export type CatalogueOption = { code: string; displayName: string }
export type CargoCategoryFact = { id: string; code: string; displayName: string; effectiveFrom: string }
export type FleetProviderFact = { id: string; kind: FleetProviderKind; name: string; effectiveFrom: string }
export type BillingPreferenceFact = { id: string; code: string; displayName: string; effectiveFrom: string }
export type FactHistoryRow = { id: string; value: string; effectiveFrom: string; effectiveTo: string | null; recordStatus: "active" | "corrected" | "voided" }

export type CompanyFacts = {
  cargo: CargoCategoryFact[]
  fleetProviders: { GPS: FleetProviderFact | null; FUEL: FleetProviderFact | null }
  history: { cargo: FactHistoryRow[]; fleetProviders: FactHistoryRow[] }
}

export type FactChangeResult = { changed: boolean; created: number; ended: number; corrected: number; voided: number }
const unchanged = (): FactChangeResult => ({ changed: false, created: 0, ended: 0, corrected: 0, voided: 0 })

// ---------------------------------------------------------------------------------------------------------------
// SQL (the runtime role may UPDATE only the lifecycle columns; effective_to is named in an INSERT only for a correction
// of an already-ended period)
// ---------------------------------------------------------------------------------------------------------------

type Queryable = Pick<PoolClient, "query">
const ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${ISO(column)} END`

export const CARGO_CURRENT_CONSTRAINT = "company_cargo_category_periods_current_uq"
export const FLEET_CURRENT_CONSTRAINT = "company_fleet_provider_periods_current_uq"
export const BILLING_CURRENT_CONSTRAINT = "customer_billing_preference_periods_current_uq"
const CURRENT_CONSTRAINTS = [CARGO_CURRENT_CONSTRAINT, FLEET_CURRENT_CONSTRAINT, BILLING_CURRENT_CONSTRAINT]
const CATALOGUE_CONSTRAINTS = ["company_cargo_category_periods_category_active", "customer_billing_preference_periods_method_active", "company_cargo_category_periods_cargo_category_code_fkey", "customer_billing_preference_periods_payment_method_code_fkey"]

type PeriodTable = "company_cargo_category_periods" | "company_fleet_provider_periods" | "customer_billing_preference_periods"

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const constraint = typeof error === "object" && error !== null ? (error as { constraint?: string }).constraint : undefined
    if (constraint === undefined) throw error
    if (CURRENT_CONSTRAINTS.includes(constraint)) throw new CompanyProfileConflictError("A concurrent change was made to this profile fact; retry the operation.")
    if (constraint === repo.ORGANIZATION_ACTIVE_CONSTRAINT) throw new CompanyProfileStateError("This Organization is not active.")
    if (CATALOGUE_CONSTRAINTS.includes(constraint)) throw new CompanyProfileValidationError("value", "The value is not an active catalogue entry.")
    if (constraint === "customer_billing_preference_periods_customer_exists") throw new CompanyProfileStateError("A billing preference can only be recorded for a Customer.")
    if (constraint.endsWith("_effective_window_valid")) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
    if (constraint === "company_fleet_provider_periods_name_valid" || constraint === "company_fleet_provider_periods_name_normalized_valid") {
      throw new CompanyProfileValidationError("providerName", "The provider name is not accepted.")
    }
    throw error
  }
}

async function endPeriod(client: Queryable, table: PeriodTable, id: string, organizationId: string, at: string): Promise<void> {
  const result = await client.query(
    `UPDATE public.${table} SET effective_to = $3::timestamptz, updated_at = clock_timestamp()
      WHERE id = $1 AND organization_id = $2 AND record_status = 'active' AND effective_to IS NULL`,
    [id, organizationId, at],
  )
  if (result.rowCount !== 1) throw new CompanyProfileConflictError("A concurrent change was made to this profile fact; retry the operation.")
}

async function markPeriod(client: Queryable, table: PeriodTable, id: string, organizationId: string, status: "corrected" | "voided", replacementId: string | null): Promise<void> {
  const result = await client.query(
    `UPDATE public.${table} SET record_status = $3, corrected_at = clock_timestamp(), superseded_by_period_id = $4, updated_at = clock_timestamp()
      WHERE id = $1 AND organization_id = $2 AND record_status = 'active'`,
    [id, organizationId, status, replacementId],
  )
  if (result.rowCount !== 1) throw new CompanyProfileConflictError("A concurrent change was made to this profile fact; retry the operation.")
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

const literal = (value: string): { kind: "LITERAL"; value: string } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })
type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED"

async function record(
  ctx: OperationContext,
  eventType: EventTypeName,
  operation: string,
  component: "company-profile" | "customer-relationship",
  target: { resourceType: string; resourceId: string; organizationId: string },
  fieldChanges: FieldChange[],
): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: { resourceType: target.resourceType, resourceId: target.resourceId, subjectReferences: [`organization:${target.organizationId}`] },
    source: { sourceType: "APPLICATION", component, workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function parseOrganizationId(value: unknown): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new CompanyProfileValidationError("organizationId", "organizationId must be a UUID.")
}

function parseMode(value: unknown): FactMode {
  if (value === undefined) return "change"
  if (!isFactMode(value)) throw new CompanyProfileValidationError("mode", "mode must be 'change' or 'correct'.")
  return value
}

async function lockActiveOrganization(ctx: OperationContext, organizationId: string): Promise<void> {
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CompanyProfileNotFoundError("Organization")
  if (organization.status !== "active") {
    throw new CompanyProfileStateError(organization.status === "merged" ? "This Organization has been merged." : "This Organization is archived; restore it first.")
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reads (no Master Register events)
// ---------------------------------------------------------------------------------------------------------------

export async function readCargoCatalogue(client: Queryable): Promise<CatalogueOption[]> {
  const result = await client.query<{ code: string; display_name: string }>(`SELECT code, display_name FROM public.cargo_categories WHERE is_active ORDER BY sort_order, code`)
  return result.rows.map((row) => ({ code: row.code, displayName: row.display_name }))
}

export async function readPaymentMethodCatalogue(client: Queryable): Promise<CatalogueOption[]> {
  const result = await client.query<{ code: string; display_name: string }>(`SELECT code, display_name FROM public.billing_payment_methods WHERE is_active ORDER BY sort_order, code`)
  return result.rows.map((row) => ({ code: row.code, displayName: row.display_name }))
}

/** Current cargo categories and fleet providers of one Organization, with their complete history. Needs COMPANY_PROFILE_READ. */
export async function readCompanyFacts(client: Queryable, rawOrganizationId: unknown): Promise<CompanyFacts> {
  const organizationId = parseOrganizationId(rawOrganizationId)
  const cargo = await client.query<{ id: string; code: string; display_name: string; effective_from: string }>(
    `SELECT p.id, p.cargo_category_code AS code, c.display_name, ${ISO("p.effective_from")} AS effective_from
       FROM public.company_cargo_category_periods p JOIN public.cargo_categories c ON c.code = p.cargo_category_code
      WHERE p.organization_id = $1 AND p.record_status = 'active' AND p.effective_to IS NULL
      ORDER BY c.sort_order, c.code`,
    [organizationId],
  )
  const providers = await client.query<{ id: string; kind: FleetProviderKind; name: string; effective_from: string }>(
    `SELECT id, provider_kind AS kind, provider_name AS name, ${ISO("effective_from")} AS effective_from
       FROM public.company_fleet_provider_periods
      WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL`,
    [organizationId],
  )
  const cargoHistory = await client.query<{ id: string; value: string; effective_from: string; effective_to: string | null; record_status: FactHistoryRow["recordStatus"] }>(
    `SELECT id, cargo_category_code AS value, ${ISO("effective_from")} AS effective_from, ${ISO_NULL("effective_to")} AS effective_to, record_status
       FROM public.company_cargo_category_periods WHERE organization_id = $1 ORDER BY effective_from, created_at, id`,
    [organizationId],
  )
  const providerHistory = await client.query<{ id: string; value: string; effective_from: string; effective_to: string | null; record_status: FactHistoryRow["recordStatus"] }>(
    `SELECT id, provider_kind || ':' || provider_name AS value, ${ISO("effective_from")} AS effective_from, ${ISO_NULL("effective_to")} AS effective_to, record_status
       FROM public.company_fleet_provider_periods WHERE organization_id = $1 ORDER BY effective_from, created_at, id`,
    [organizationId],
  )
  const row = (r: { id: string; value: string; effective_from: string; effective_to: string | null; record_status: FactHistoryRow["recordStatus"] }): FactHistoryRow => ({
    id: r.id,
    value: r.value,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    recordStatus: r.record_status,
  })
  const byKind = (kind: FleetProviderKind): FleetProviderFact | null => {
    const found = providers.rows.find((r) => r.kind === kind)
    return found ? { id: found.id, kind, name: found.name, effectiveFrom: found.effective_from } : null
  }
  return {
    cargo: cargo.rows.map((r) => ({ id: r.id, code: r.code, displayName: r.display_name, effectiveFrom: r.effective_from })),
    fleetProviders: { GPS: byKind("GPS"), FUEL: byKind("FUEL") },
    history: { cargo: cargoHistory.rows.map(row), fleetProviders: providerHistory.rows.map(row) },
  }
}

/** The Customer's current billing preference with its history, or null. Needs CUSTOMER_RELATIONSHIP_READ. */
export async function readBillingPreference(
  client: Queryable,
  rawOrganizationId: unknown,
): Promise<{ current: BillingPreferenceFact | null; history: FactHistoryRow[] }> {
  const organizationId = parseOrganizationId(rawOrganizationId)
  const current = await client.query<{ id: string; code: string; display_name: string; effective_from: string }>(
    `SELECT p.id, p.payment_method_code AS code, m.display_name, ${ISO("p.effective_from")} AS effective_from
       FROM public.customer_billing_preference_periods p JOIN public.billing_payment_methods m ON m.code = p.payment_method_code
      WHERE p.organization_id = $1 AND p.record_status = 'active' AND p.effective_to IS NULL`,
    [organizationId],
  )
  const history = await client.query<{ id: string; value: string; effective_from: string; effective_to: string | null; record_status: FactHistoryRow["recordStatus"] }>(
    `SELECT id, payment_method_code AS value, ${ISO("effective_from")} AS effective_from, ${ISO_NULL("effective_to")} AS effective_to, record_status
       FROM public.customer_billing_preference_periods WHERE organization_id = $1 ORDER BY effective_from, created_at, id`,
    [organizationId],
  )
  const first = current.rows[0]
  return {
    current: first ? { id: first.id, code: first.code, displayName: first.display_name, effectiveFrom: first.effective_from } : null,
    history: history.rows.map((r) => ({ id: r.id, value: r.value, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, recordStatus: r.record_status })),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cargo categories
// ---------------------------------------------------------------------------------------------------------------

/**
 * Makes the company's CURRENT cargo categories exactly `categories`.
 *   change   categories that are no longer carried are ended now; new ones start now. History stays.
 *   correct  categories recorded in error are VOIDED (they never applied); missing ones are added now.
 * An empty list ends/voids all of them. The same set is a no-op.
 */
export async function setCargoCategories(ctx: OperationContext, rawInput: unknown): Promise<FactChangeResult> {
  const input = rawInput as { organizationId?: unknown; categories?: unknown; mode?: unknown } | null
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CompanyProfileValidationError("input", "input must be an object.")
  const organizationId = parseOrganizationId(input.organizationId)
  const mode = parseMode(input.mode)
  if (!Array.isArray(input.categories)) throw new CompanyProfileValidationError("categories", "categories must be a list of cargo category codes.")
  const wanted = [...new Set(input.categories.map((value) => (typeof value === "string" ? value.trim() : "")))]
  if (wanted.some((code) => !/^[A-Z][A-Z0-9_]{1,47}$/.test(code))) throw new CompanyProfileValidationError("categories", "Every cargo category must be a catalogue code.")

  await lockActiveOrganization(ctx, organizationId)
  const catalogue = new Set((await readCargoCatalogue(ctx.client)).map((option) => option.code))
  for (const code of wanted) if (!catalogue.has(code)) throw new CompanyProfileValidationError("categories", `'${code}' is not an active cargo category.`)

  const open = await ctx.client.query<{ id: string; code: string; effective_from: string }>(
    `SELECT id, cargo_category_code AS code, ${ISO("effective_from")} AS effective_from
       FROM public.company_cargo_category_periods
      WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL FOR NO KEY UPDATE`,
    [organizationId],
  )
  const have = new Set(open.rows.map((row) => row.code))
  const toAdd = wanted.filter((code) => !have.has(code))
  const toRemove = open.rows.filter((row) => !wanted.includes(row.code))
  if (toAdd.length === 0 && toRemove.length === 0) return unchanged()

  const result = unchanged()
  const at = await repo.databaseNow(ctx.client)
  for (const row of toRemove) {
    if (mode === "change") {
      if (at <= row.effective_from) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
      await guarded(() => endPeriod(ctx.client, "company_cargo_category_periods", row.id, organizationId, at))
      await record(ctx, "RECORD_UPDATED", "endCargoCategory", "company-profile", { resourceType: "company_cargo_category_period", resourceId: row.id, organizationId }, [
        { field: "cargoCategory", before: literal(row.code), after: literal("ended") },
      ])
      result.ended += 1
    } else {
      await guarded(() => markPeriod(ctx.client, "company_cargo_category_periods", row.id, organizationId, "voided", null))
      await record(ctx, "RECORD_CORRECTED", "voidCargoCategory", "company-profile", { resourceType: "company_cargo_category_period", resourceId: row.id, organizationId }, [
        { field: "cargoCategory", before: literal(row.code), after: literal("voided") },
      ])
      result.voided += 1
    }
  }
  for (const code of toAdd) {
    const id = randomUUID()
    const previousEnd = await ctx.client.query<{ latest: string | null }>(
      `SELECT ${ISO_NULL("max(effective_to)")} AS latest FROM public.company_cargo_category_periods WHERE organization_id = $1 AND cargo_category_code = $2 AND record_status = 'active'`,
      [organizationId, code],
    )
    const latest = previousEnd.rows[0]?.latest ?? null
    const start = latest !== null && at < latest ? latest : at
    await guarded(() =>
      ctx.client.query(`INSERT INTO public.company_cargo_category_periods (id, organization_id, cargo_category_code, effective_from) VALUES ($1, $2, $3, $4::timestamptz)`, [id, organizationId, code, start]),
    )
    await record(ctx, "RECORD_CREATED", "addCargoCategory", "company-profile", { resourceType: "company_cargo_category_period", resourceId: id, organizationId }, [
      { field: "cargoCategory", before: literal("none"), after: literal(code) },
    ])
    result.created += 1
  }
  result.changed = true
  return result
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet providers
// ---------------------------------------------------------------------------------------------------------------

/**
 * Sets, changes, corrects or clears one fleet provider NAME. `providerName` null or empty clears it: in change mode the current
 * provider is ended (no replacement); in correct mode a provider recorded in error is voided.
 */
export async function setFleetProvider(ctx: OperationContext, rawInput: unknown): Promise<FactChangeResult> {
  const input = rawInput as { organizationId?: unknown; kind?: unknown; providerName?: unknown; mode?: unknown } | null
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CompanyProfileValidationError("input", "input must be an object.")
  const organizationId = parseOrganizationId(input.organizationId)
  const mode = parseMode(input.mode)
  if (!isFleetProviderKind(input.kind)) throw new CompanyProfileValidationError("kind", "kind must be GPS or FUEL.")
  const kind = input.kind
  const clearing = input.providerName === undefined || input.providerName === null || (typeof input.providerName === "string" && input.providerName.trim() === "")
  const name = clearing ? null : prepareProviderName(input.providerName)

  await lockActiveOrganization(ctx, organizationId)
  const open = await ctx.client.query<{ id: string; name: string; normalized: string; effective_from: string; effective_to: string | null }>(
    `SELECT id, provider_name AS name, provider_name_normalized AS normalized, ${ISO("effective_from")} AS effective_from, ${ISO_NULL("effective_to")} AS effective_to
       FROM public.company_fleet_provider_periods
      WHERE organization_id = $1 AND provider_kind = $2 AND record_status = 'active' AND effective_to IS NULL FOR NO KEY UPDATE`,
    [organizationId, kind],
  )
  const current = open.rows[0]
  const table = "company_fleet_provider_periods"
  const target = (id: string) => ({ resourceType: "company_fleet_provider_period", resourceId: id, organizationId })
  const result = unchanged()

  if (name === null) {
    if (!current) return result
    if (mode === "change") {
      const at = await repo.databaseNow(ctx.client)
      if (at <= current.effective_from) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
      await guarded(() => endPeriod(ctx.client, table, current.id, organizationId, at))
      await record(ctx, "RECORD_UPDATED", "endFleetProvider", "company-profile", target(current.id), [
        { field: "providerKind", before: literal(kind), after: literal(kind) },
        { field: "provider", before: reference(table, current.id), after: literal("ended") },
      ])
      result.ended = 1
    } else {
      await guarded(() => markPeriod(ctx.client, table, current.id, organizationId, "voided", null))
      await record(ctx, "RECORD_CORRECTED", "voidFleetProvider", "company-profile", target(current.id), [
        { field: "providerKind", before: literal(kind), after: literal(kind) },
        { field: "provider", before: reference(table, current.id), after: literal("voided") },
      ])
      result.voided = 1
    }
    result.changed = true
    return result
  }

  const normalized = normalizeProviderName(name)
  if (current && current.normalized === normalized && current.name === name) return result
  const replacementId = randomUUID()

  if (!current) {
    const at = await repo.databaseNow(ctx.client)
    const previousEnd = await ctx.client.query<{ latest: string | null }>(
      `SELECT ${ISO_NULL("max(effective_to)")} AS latest FROM public.company_fleet_provider_periods WHERE organization_id = $1 AND provider_kind = $2 AND record_status = 'active'`,
      [organizationId, kind],
    )
    const latest = previousEnd.rows[0]?.latest ?? null
    const start = latest !== null && at < latest ? latest : at
    await guarded(() =>
      ctx.client.query(
        `INSERT INTO public.company_fleet_provider_periods (id, organization_id, provider_kind, provider_name, provider_name_normalized, effective_from) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
        [replacementId, organizationId, kind, name, normalized, start],
      ),
    )
    await record(ctx, "RECORD_CREATED", "addFleetProvider", "company-profile", target(replacementId), [
      { field: "providerKind", before: literal("none"), after: literal(kind) },
      { field: "provider", before: literal("none"), after: reference(table, replacementId) },
    ])
    result.created = 1
  } else if (mode === "change") {
    const at = await repo.databaseNow(ctx.client)
    if (at <= current.effective_from) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
    await guarded(() => endPeriod(ctx.client, table, current.id, organizationId, at))
    await guarded(() =>
      ctx.client.query(
        `INSERT INTO public.company_fleet_provider_periods (id, organization_id, provider_kind, provider_name, provider_name_normalized, effective_from) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
        [replacementId, organizationId, kind, name, normalized, at],
      ),
    )
    await record(ctx, "RECORD_UPDATED", "changeFleetProvider", "company-profile", target(replacementId), [
      { field: "providerKind", before: literal(kind), after: literal(kind) },
      { field: "provider", before: reference(table, current.id), after: reference(table, replacementId) },
    ])
    result.created = 1
    result.ended = 1
  } else {
    await guarded(() => markPeriod(ctx.client, table, current.id, organizationId, "corrected", replacementId))
    await guarded(() =>
      ctx.client.query(
        `INSERT INTO public.company_fleet_provider_periods (id, organization_id, provider_kind, provider_name, provider_name_normalized, effective_from, effective_to) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)`,
        [replacementId, organizationId, kind, name, normalized, current.effective_from, current.effective_to],
      ),
    )
    await record(ctx, "RECORD_CORRECTED", "correctFleetProvider", "company-profile", target(replacementId), [
      { field: "providerKind", before: literal(kind), after: literal(kind) },
      { field: "provider", before: reference(table, current.id), after: reference(table, replacementId) },
    ])
    result.created = 1
    result.corrected = 1
  }
  result.changed = true
  return result
}

// ---------------------------------------------------------------------------------------------------------------
// Customer billing preference
// ---------------------------------------------------------------------------------------------------------------

/**
 * Sets, changes, corrects or clears the Customer's preferred billing payment method (a controlled catalogue code). It is a
 * PREFERENCE: it states nothing about contract terms or payments. Only a Customer can have one (the database also enforces it).
 */
export async function setBillingPreference(ctx: OperationContext, rawInput: unknown): Promise<FactChangeResult> {
  const input = rawInput as { organizationId?: unknown; paymentMethod?: unknown; mode?: unknown } | null
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new CompanyProfileValidationError("input", "input must be an object.")
  const organizationId = parseOrganizationId(input.organizationId)
  const mode = parseMode(input.mode)
  const clearing = input.paymentMethod === undefined || input.paymentMethod === null || (typeof input.paymentMethod === "string" && input.paymentMethod.trim() === "")
  let code: string | null = null
  if (!clearing) {
    if (typeof input.paymentMethod !== "string" || !/^[A-Z][A-Z0-9_]{1,47}$/.test(input.paymentMethod.trim())) {
      throw new CompanyProfileValidationError("paymentMethod", "paymentMethod must be a catalogue payment method code.")
    }
    code = input.paymentMethod.trim()
  }

  await lockActiveOrganization(ctx, organizationId)
  const customer = await ctx.client.query(`SELECT 1 FROM public.customers WHERE organization_id = $1`, [organizationId])
  if (customer.rowCount === 0) throw new CompanyProfileStateError("A billing preference can only be recorded for a Customer.")
  if (code !== null) {
    const catalogue = await readPaymentMethodCatalogue(ctx.client)
    if (!catalogue.some((option) => option.code === code)) throw new CompanyProfileValidationError("paymentMethod", `'${code}' is not an active payment method.`)
  }

  const open = await ctx.client.query<{ id: string; code: string; effective_from: string; effective_to: string | null }>(
    `SELECT id, payment_method_code AS code, ${ISO("effective_from")} AS effective_from, ${ISO_NULL("effective_to")} AS effective_to
       FROM public.customer_billing_preference_periods
      WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL FOR NO KEY UPDATE`,
    [organizationId],
  )
  const current = open.rows[0]
  const table = "customer_billing_preference_periods"
  const target = (id: string) => ({ resourceType: "customer_billing_preference_period", resourceId: id, organizationId })
  const result = unchanged()

  if (code === null) {
    if (!current) return result
    if (mode === "change") {
      const at = await repo.databaseNow(ctx.client)
      if (at <= current.effective_from) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
      await guarded(() => endPeriod(ctx.client, table, current.id, organizationId, at))
      await record(ctx, "RECORD_UPDATED", "endBillingPreference", "customer-relationship", target(current.id), [
        { field: "paymentMethod", before: literal(current.code), after: literal("none") },
      ])
      result.ended = 1
    } else {
      await guarded(() => markPeriod(ctx.client, table, current.id, organizationId, "voided", null))
      await record(ctx, "RECORD_CORRECTED", "voidBillingPreference", "customer-relationship", target(current.id), [
        { field: "paymentMethod", before: literal(current.code), after: literal("none") },
      ])
      result.voided = 1
    }
    result.changed = true
    return result
  }

  if (current && current.code === code) return result
  const replacementId = randomUUID()

  if (!current) {
    const at = await repo.databaseNow(ctx.client)
    const previousEnd = await ctx.client.query<{ latest: string | null }>(
      `SELECT ${ISO_NULL("max(effective_to)")} AS latest FROM public.customer_billing_preference_periods WHERE organization_id = $1 AND record_status = 'active'`,
      [organizationId],
    )
    const latest = previousEnd.rows[0]?.latest ?? null
    const start = latest !== null && at < latest ? latest : at
    await guarded(() =>
      ctx.client.query(`INSERT INTO public.customer_billing_preference_periods (id, organization_id, payment_method_code, effective_from) VALUES ($1, $2, $3, $4::timestamptz)`, [replacementId, organizationId, code, start]),
    )
    await record(ctx, "RECORD_CREATED", "addBillingPreference", "customer-relationship", target(replacementId), [
      { field: "paymentMethod", before: literal("none"), after: literal(code) },
    ])
    result.created = 1
  } else if (mode === "change") {
    const at = await repo.databaseNow(ctx.client)
    if (at <= current.effective_from) throw new CompanyProfileValidationError("effectiveFrom", "The change must be after the current record began.")
    await guarded(() => endPeriod(ctx.client, table, current.id, organizationId, at))
    await guarded(() =>
      ctx.client.query(`INSERT INTO public.customer_billing_preference_periods (id, organization_id, payment_method_code, effective_from) VALUES ($1, $2, $3, $4::timestamptz)`, [replacementId, organizationId, code, at]),
    )
    await record(ctx, "RECORD_UPDATED", "changeBillingPreference", "customer-relationship", target(replacementId), [
      { field: "paymentMethod", before: literal(current.code), after: literal(code) },
    ])
    result.created = 1
    result.ended = 1
  } else {
    await guarded(() => markPeriod(ctx.client, table, current.id, organizationId, "corrected", replacementId))
    await guarded(() =>
      ctx.client.query(
        `INSERT INTO public.customer_billing_preference_periods (id, organization_id, payment_method_code, effective_from, effective_to) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
        [replacementId, organizationId, code, current.effective_from, current.effective_to],
      ),
    )
    await record(ctx, "RECORD_CORRECTED", "correctBillingPreference", "customer-relationship", target(replacementId), [
      { field: "paymentMethod", before: literal(current.code), after: literal(code) },
    ])
    result.created = 1
    result.corrected = 1
  }
  result.changed = true
  return result
}
