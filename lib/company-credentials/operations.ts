/**
 * Company Credentials operations: validation, business rules and Master Register events on a caller-supplied transaction.
 *
 * Every function here runs INSIDE a transaction the authorization wrapper already opened, and Master Register events are
 * written through a repository bound to the same client, so a failure anywhere (including the Master Register) rolls the
 * whole change back.
 *
 * NO SECRET VALUE EXISTS IN THIS DOMAIN. PostgreSQL holds credential METADATA and secret-slot STATE. A slot is UNRESOLVED
 * until an opaque secret-store reference (a GCP Secret Manager resource name) is attached; that is the explicit
 * unresolved-secret boundary until a secret store is integrated. Inputs are parsed strictly (unknown keys are refused, so
 * a "password" or "secret" key can never be smuggled in), no read returns a reference, and the Master Register never
 * carries a username, system name, URL or reference.
 *
 * LOCK ORDER (every mutation, without exception):
 *   1. the Organization row   (all writers of one Organization's credentials serialize here)
 *   2. the credential row     (FOR NO KEY UPDATE; the database triggers take FOR SHARE on it, so a bypassing writer serializes)
 *   3. dependent rows         (status periods, verifications, secret slots)
 * The system registry has no Organization: its writers take the per-name advisory locks the triggers also take (sorted, so
 * a writer needing several names cannot deadlock), then the system row. Unique indexes, the name triggers and the deferred
 * current-status trigger are the structural backstops.
 *
 * Identity vs history. A credential is the account an Organization holds on one system. A changed or wrongly entered login
 * is a NEW credential that replaces the old one (the old one is archived, never edited), so status, verification and slot
 * history stay attached to the account they described. Status follows the shared conventions: a real-world change ends the
 * current period at T and starts the next at T; a correction keeps the wrong period flagged 'corrected', points it at its
 * replacement and lets the replacement inherit its business time. A verification is an append-only fact, voided if wrong.
 *
 * Master Register: events reference rows (table:id) and carry only controlled-vocabulary literals (status, outcome,
 * method, category, slot kind and state codes, lifecycle words). Changed names and URLs are recorded as CHANGED, never as
 * values. Never usernames, system names, aliases, URLs, references or free text.
 *
 * No "server-only" import: this is plain domain logic so it is testable under Node. The server-only boundary is service.ts.
 */

import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import {
  isCredentialCategory,
  isCredentialStatus,
  isMfaMethod,
  isReplacementReason,
  isSecretStore,
  isSecretReference,
  isSlotKind,
  isVerificationMethod,
  isVerificationOutcome,
  normalizeSystemName,
  normalizeUsername,
  parseLoginUrl,
  parseSystemDisplayName,
  parseUsernameDisplay,
  type CredentialCategory,
  type CredentialStatus,
  type MfaMethod,
  type ReplacementReason,
  type SlotKind,
} from "@/lib/company-credentials/definitions"
import {
  CompanyCredentialConflictError,
  CompanyCredentialNotFoundError,
  CompanyCredentialStateError,
  CompanyCredentialValidationError,
} from "@/lib/company-credentials/errors"
import * as repo from "@/lib/company-credentials/repository"
import type {
  CredentialRecord,
  CredentialView,
  OrganizationCredentialsView,
  StatusPeriodRecord,
  SystemRecord,
  SystemView,
} from "@/lib/company-credentials/types"
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
    throw new CompanyCredentialValidationError(field, `${field} must be an object.`)
  }
  for (const key of Object.keys(value)) {
    // The key name is the caller's own field name, but it is never echoed when it is not on the list.
    if (!allowedKeys.includes(key)) throw new CompanyCredentialValidationError(`${field}.${key}`, `${field} contains a field that is not accepted.`)
  }
  return value as Record<string, unknown>
}

function parseUuid(value: unknown, field: string): string {
  if (typeof value === "string") {
    const id = value.trim().toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id
  }
  throw new CompanyCredentialValidationError(field, `${field} must be a UUID.`)
}

/** An explicit business instant: an ISO-8601 string with an offset, returned as canonical UTC at microsecond precision. */
function parseInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    throw new CompanyCredentialValidationError(field, `${field} must be an ISO-8601 instant with a time zone.`)
  }
  const date = new Date(value.trim())
  if (Number.isNaN(date.getTime())) throw new CompanyCredentialValidationError(field, `${field} is not a valid instant.`)
  return date.toISOString().replace(/Z$/, "000Z")
}

const optionalInstant = (value: unknown, field: string): string | null => (value === undefined ? null : parseInstant(value, field))

function parseBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new CompanyCredentialValidationError(field, `${field} must be true or false.`)
  return value
}

function parseCategory(value: unknown): CredentialCategory {
  if (!isCredentialCategory(value)) throw new CompanyCredentialValidationError("category", "category must be a supported credential category.")
  return value
}

function parseStatus(value: unknown, field = "status"): CredentialStatus {
  if (!isCredentialStatus(value)) throw new CompanyCredentialValidationError(field, `${field} must be a supported credential status.`)
  return value
}

/** `undefined` = not supplied; `null` = explicitly none. */
function parseMfaMethod(value: unknown): MfaMethod | null {
  if (value === null) return null
  if (!isMfaMethod(value)) throw new CompanyCredentialValidationError("mfaMethod", "mfaMethod must be a supported multi-factor method.")
  return value
}

function parseCountry(value: unknown): string | null {
  if (value === null) return null
  const country = typeof value === "string" ? value.trim().toUpperCase() : ""
  if (!/^[A-Z]{2}$/.test(country)) throw new CompanyCredentialValidationError("jurisdictionCountry", "jurisdictionCountry must be a two-letter country code.")
  return country
}

function parseRegion(value: unknown): string | null {
  if (value === null) return null
  const region = typeof value === "string" ? value.trim().toUpperCase() : ""
  if (!/^[A-Z0-9]{1,8}$/.test(region)) throw new CompanyCredentialValidationError("jurisdictionRegion", "jurisdictionRegion must be a region code.")
  return region
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
    const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined
    // A lost deadlock / serialization race is a conflict the caller may retry, never a raw database error.
    if (code === "40P01" || code === "40001") throw new CompanyCredentialConflictError("A concurrent change was made; retry the operation.")
    const constraint = constraintOf(error)
    if (constraint === undefined) throw error
    const conflict = (message: string) => new CompanyCredentialConflictError(message)
    const state = (message: string) => new CompanyCredentialStateError(message)
    if ((repo.SYSTEM_NAME_CONSTRAINTS as readonly string[]).includes(constraint)) throw conflict("That name is already used by another system or alias.")
    if (constraint === repo.ALIAS_SYSTEM_ACTIVE_CONSTRAINT || constraint === repo.CREDENTIAL_SYSTEM_ACTIVE_CONSTRAINT) throw state("This system is archived; restore it first.")
    if (constraint === repo.ORGANIZATION_ACTIVE_CONSTRAINT) throw state("This Organization is not active.")
    if (constraint === repo.ACTIVE_ACCOUNT_CONSTRAINT) throw conflict("This Organization already has an active credential for that account on that system.")
    if (constraint === repo.CREDENTIAL_CURRENT_STATUS_CONSTRAINT) throw state("The change would leave the credential without a current status; nothing was changed.")
    if (constraint === repo.CURRENT_STATUS_CONSTRAINT) throw conflict("A concurrent status change was made; retry the operation.")
    if ([repo.STATUS_CREDENTIAL_ACTIVE_CONSTRAINT, repo.VERIFICATION_CREDENTIAL_ACTIVE_CONSTRAINT, repo.SLOT_CREDENTIAL_ACTIVE_CONSTRAINT].includes(constraint)) {
      throw state("This credential is archived; restore it first.")
    }
    if (constraint === repo.STATUS_WINDOW_CONSTRAINT) throw new CompanyCredentialValidationError("effectiveFrom", "The change must be after the current status began.")
    if (constraint === repo.VERIFICATION_NOT_FUTURE_CONSTRAINT) throw new CompanyCredentialValidationError("verifiedAt", "verifiedAt cannot be in the future.")
    if (constraint === repo.SLOT_SINGLE_LIVE_CONSTRAINT) throw conflict("This credential already has a live slot of that kind.")
    if (constraint === repo.SLOT_REFERENCE_CONSTRAINT) throw new CompanyCredentialValidationError("secretReference", "secretReference must be a secret-store resource name.")
    const systemField = repo.SYSTEM_FIELD_CONSTRAINTS[constraint] ?? repo.CREDENTIAL_FIELD_CONSTRAINTS[constraint]
    if (systemField) throw new CompanyCredentialValidationError(systemField, `${systemField} is not valid.`)
    throw error
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Master Register
// ---------------------------------------------------------------------------------------------------------------

type EventTypeName = "RECORD_CREATED" | "RECORD_UPDATED" | "RECORD_CORRECTED" | "RECORD_STATUS_CHANGED" | "RECORD_ARCHIVED" | "RECORD_RESTORED"

const literal = (value: string | number | boolean | null): { kind: "LITERAL"; value: string | number | boolean | null } => ({ kind: "LITERAL", value })
const reference = (table: string, id: string): { kind: "REFERENCE"; reference: string } => ({ kind: "REFERENCE", reference: `${table}:${id}` })
const changed = (): { kind: "CHANGED" } => ({ kind: "CHANGED" })

/** `organizationId` is absent for the system registry (a system belongs to no Organization). */
type Target = { resourceType: string; resourceId: string; organizationId?: string }

async function record(ctx: OperationContext, eventType: EventTypeName, operation: string, target: Target, fieldChanges: FieldChange[]): Promise<void> {
  await recordEvent(ctx.masterRegister, {
    eventType,
    actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.id },
    action: { operation },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      ...(target.organizationId ? { subjectReferences: [`organization:${target.organizationId}`] } : {}),
    },
    source: { sourceType: "APPLICATION", component: "company-credentials", workflow: operation },
    classification: { materiality: "MATERIAL" },
    change: { changedFields: fieldChanges.map((change) => change.field), fieldChanges },
    outcome: { result: "SUCCESS" },
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------------------------

function requireActiveOrganization(organization: { status: "active" | "archived" | "merged" }): void {
  if (organization.status !== "active") {
    throw new CompanyCredentialStateError(organization.status === "merged" ? "This Organization has been merged." : "This Organization is archived; restore it first.")
  }
}

type LockedCredential = { organizationId: string; credential: CredentialRecord }

/** Locks Organization then credential (lock order steps 1-2). */
async function lockCredential(ctx: OperationContext, credentialId: string, options: { requireActiveOrganization: boolean; requireActiveCredential: boolean }): Promise<LockedCredential> {
  const organizationId = await repo.findCredentialOrganization(ctx.client, credentialId)
  if (!organizationId) throw new CompanyCredentialNotFoundError("Credential")
  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CompanyCredentialNotFoundError("Credential")
  if (options.requireActiveOrganization) requireActiveOrganization(organization)
  const credential = await repo.getCredential(ctx.client, credentialId, "update")
  if (!credential) throw new CompanyCredentialNotFoundError("Credential")
  if (options.requireActiveCredential && credential.recordStatus !== "active") throw new CompanyCredentialStateError("This credential is archived; restore it first.")
  return { organizationId, credential }
}

/**
 * When a caller names the Organization a request is made under (the company route does), the credential must belong to it.
 * A mismatch looks exactly like a missing credential, so a URL cannot be used to touch another company's record.
 */
function assertScopedOrganization(requested: unknown, actual: string): void {
  if (requested === undefined) return
  if (parseUuid(requested, "organizationId") !== actual) throw new CompanyCredentialNotFoundError("Credential")
}

async function resolveInstant(ctx: OperationContext, explicit: string | null, field: string): Promise<string> {
  if (explicit === null) return repo.databaseNow(ctx.client)
  if (!(await repo.isNotInFuture(ctx.client, explicit))) throw new CompanyCredentialValidationError(field, `${field} cannot be in the future.`)
  return explicit
}

const isGenuineOpen = (row: { recordStatus: string; effectiveTo: string | null }): boolean => row.recordStatus === "active" && row.effectiveTo === null

function inForce(row: { recordStatus: string; effectiveFrom: string; effectiveTo: string | null }, at: string): boolean {
  return row.recordStatus === "active" && row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo)
}

// ---------------------------------------------------------------------------------------------------------------
// Views and reads (never write a Master Register event)
// ---------------------------------------------------------------------------------------------------------------

async function loadSystemViews(client: PoolClient, systems: SystemRecord[]): Promise<SystemView[]> {
  const aliases = await repo.listAliases(client, systems.map((system) => system.id))
  return systems.map((system) => ({ ...system, aliases: aliases.get(system.id) ?? [] }))
}

async function loadSystem(ctx: OperationContext, systemId: string): Promise<SystemView> {
  const system = await repo.getSystem(ctx.client, systemId)
  if (!system) throw new CompanyCredentialNotFoundError("System")
  return (await loadSystemViews(ctx.client, [system]))[0]
}

async function loadCredentialViews(client: PoolClient, credentials: CredentialRecord[], asOf: string | null): Promise<CredentialView[]> {
  const ids = credentials.map((credential) => credential.id)
  const systemIds = [...new Set(credentials.map((credential) => credential.systemId))]
  const [periods, verifications, slots, replacements, systems] = await Promise.all([
    repo.listPeriods(client, ids),
    repo.listVerifications(client, ids),
    repo.listSlots(client, ids),
    repo.findReplacements(client, ids),
    Promise.all(systemIds.map((id) => repo.getSystem(client, id))),
  ])
  const systemNames = new Map(systems.filter((system): system is SystemRecord => system !== undefined).map((system) => [system.id, system.displayName]))
  return credentials.map((credential) => {
    const statusHistory = periods.get(credential.id) ?? []
    const credentialVerifications = verifications.get(credential.id) ?? []
    return {
      credential,
      system: { id: credential.systemId, displayName: systemNames.get(credential.systemId) ?? "" },
      statusHistory,
      currentStatus: statusHistory.find(isGenuineOpen) ?? null,
      verifications: credentialVerifications,
      lastVerification: [...credentialVerifications].reverse().find((row) => row.recordStatus === "active") ?? null,
      slots: slots.get(credential.id) ?? [],
      replacedByCredentialId: replacements.get(credential.id) ?? null,
      asOf: asOf === null ? null : { at: asOf, status: statusHistory.find((row) => inForce(row, asOf)) ?? null },
    }
  })
}

async function loadCredential(ctx: OperationContext, credentialId: string): Promise<CredentialView> {
  const credential = await repo.getCredential(ctx.client, credentialId)
  if (!credential) throw new CompanyCredentialNotFoundError("Credential")
  return (await loadCredentialViews(ctx.client, [credential], null))[0]
}

export async function readSystems(client: PoolClient, rawOptions: unknown = {}): Promise<SystemView[]> {
  const options = requireObject(rawOptions, "options", ["includeArchived"])
  const includeArchived = parseBoolean(options.includeArchived, "includeArchived", false)
  return loadSystemViews(client, await repo.listSystems(client, includeArchived))
}

export async function readSystem(client: PoolClient, rawSystemId: unknown): Promise<SystemView> {
  const systemId = parseUuid(rawSystemId, "systemId")
  const system = await repo.getSystem(client, systemId)
  if (!system) throw new CompanyCredentialNotFoundError("System")
  return (await loadSystemViews(client, [system]))[0]
}

/**
 * Every credential of one Organization (archived ones flagged) with status history, verification history and secret SLOT
 * STATE. No secret value or secret-store reference is ever returned.
 */
export async function readOrganizationCredentials(client: PoolClient, rawOrganizationId: unknown, rawOptions: unknown = {}): Promise<OrganizationCredentialsView> {
  const organizationId = parseUuid(rawOrganizationId, "organizationId")
  const options = requireObject(rawOptions, "options", ["asOf"])
  const asOf = options.asOf === undefined ? null : parseInstant(options.asOf, "asOf")
  if (!(await repo.organizationExists(client, organizationId))) throw new CompanyCredentialNotFoundError("Organization")
  const credentials = await repo.listCredentials(client, organizationId)
  return { organizationId, asOf, credentials: await loadCredentialViews(client, credentials, asOf) }
}

// ---------------------------------------------------------------------------------------------------------------
// System registry (CREDENTIAL_MANAGE)
// ---------------------------------------------------------------------------------------------------------------

/** Pre-checks the global name rule for a canonical name or an alias. The triggers and unique indexes remain the final arbiter. */
async function assertNameFree(ctx: OperationContext, normalized: string, exceptSystemId: string | null): Promise<void> {
  if (await repo.findNameHolder(ctx.client, normalized, exceptSystemId)) {
    throw new CompanyCredentialConflictError("That name is already used by another system or alias.")
  }
}

async function requireProviderOrganization(ctx: OperationContext, organizationId: string): Promise<void> {
  const provider = await repo.lockOrganization(ctx.client, organizationId)
  if (!provider) throw new CompanyCredentialValidationError("providerOrganizationId", "providerOrganizationId must be an existing Organization.")
  if (provider.status !== "active") throw new CompanyCredentialValidationError("providerOrganizationId", "providerOrganizationId must be an active Organization.")
}

function parseAliases(value: unknown, canonicalNormalized: string): Array<{ display: string; normalized: string }> {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new CompanyCredentialValidationError("aliases", "aliases must be a list of at most 20 names.")
  const seen = new Set<string>([canonicalNormalized])
  return value.map((entry) => {
    const display = parseSystemDisplayName(entry, "aliases")
    const normalized = normalizeSystemName(display, "aliases")
    if (seen.has(normalized)) throw new CompanyCredentialValidationError("aliases", "aliases must be distinct from each other and from the name.")
    seen.add(normalized)
    return { display, normalized }
  })
}

export async function createSystem(ctx: OperationContext, rawInput: unknown): Promise<SystemView> {
  const input = requireObject(rawInput, "input", ["name", "providerOrganizationId", "jurisdictionCountry", "jurisdictionRegion", "loginUrl", "aliases"])
  const displayName = parseSystemDisplayName(input.name)
  const normalized = normalizeSystemName(displayName)
  const providerOrganizationId = input.providerOrganizationId === undefined || input.providerOrganizationId === null ? null : parseUuid(input.providerOrganizationId, "providerOrganizationId")
  const country = input.jurisdictionCountry === undefined ? null : parseCountry(input.jurisdictionCountry)
  const region = input.jurisdictionRegion === undefined ? null : parseRegion(input.jurisdictionRegion)
  if (region !== null && country === null) throw new CompanyCredentialValidationError("jurisdictionRegion", "jurisdictionRegion needs a jurisdictionCountry.")
  const loginUrl = input.loginUrl === undefined || input.loginUrl === null ? null : parseLoginUrl(input.loginUrl)
  const aliases = parseAliases(input.aliases, normalized)

  if (providerOrganizationId) await requireProviderOrganization(ctx, providerOrganizationId)
  await repo.lockSystemNames(ctx.client, [normalized, ...aliases.map((alias) => alias.normalized)])
  await assertNameFree(ctx, normalized, null)
  for (const alias of aliases) await assertNameFree(ctx, alias.normalized, null)

  const systemId = randomUUID()
  await guarded(() => repo.insertSystem(ctx.client, { id: systemId, displayName, normalized, providerOrganizationId, country, region, loginUrl }))
  await record(ctx, "RECORD_CREATED", "createSystem", { resourceType: "credential_system", resourceId: systemId }, [
    { field: "system", before: literal(null), after: reference("credential_systems", systemId) },
    ...(providerOrganizationId ? [{ field: "provider", before: literal(null), after: reference("organizations", providerOrganizationId) }] : []),
  ])
  for (const alias of aliases) {
    const aliasId = randomUUID()
    await guarded(() => repo.insertAlias(ctx.client, { id: aliasId, systemId, display: alias.display, normalized: alias.normalized }))
    await record(ctx, "RECORD_CREATED", "createSystem", { resourceType: "credential_system_alias", resourceId: aliasId }, [
      { field: "alias", before: literal(null), after: reference("credential_system_aliases", aliasId) },
      { field: "system", before: literal(null), after: reference("credential_systems", systemId) },
    ])
  }
  return loadSystem(ctx, systemId)
}

export async function updateSystem(ctx: OperationContext, rawInput: unknown): Promise<SystemView> {
  const input = requireObject(rawInput, "input", ["systemId", "name", "providerOrganizationId", "jurisdictionCountry", "jurisdictionRegion", "loginUrl"])
  const systemId = parseUuid(input.systemId, "systemId")
  const supplied = ["name", "providerOrganizationId", "jurisdictionCountry", "jurisdictionRegion", "loginUrl"].filter((key) => input[key] !== undefined)
  if (supplied.length === 0) throw new CompanyCredentialValidationError("input", "Nothing to change.")
  const newName = input.name === undefined ? null : parseSystemDisplayName(input.name)
  const newNormalized = newName === null ? null : normalizeSystemName(newName)
  const newProvider = input.providerOrganizationId === undefined ? undefined : input.providerOrganizationId === null ? null : parseUuid(input.providerOrganizationId, "providerOrganizationId")
  const newCountry = input.jurisdictionCountry === undefined ? undefined : parseCountry(input.jurisdictionCountry)
  const newRegion = input.jurisdictionRegion === undefined ? undefined : parseRegion(input.jurisdictionRegion)
  const newLoginUrl = input.loginUrl === undefined ? undefined : input.loginUrl === null ? null : parseLoginUrl(input.loginUrl)

  if (newProvider) await requireProviderOrganization(ctx, newProvider)
  const peek = await repo.getSystem(ctx.client, systemId)
  if (!peek) throw new CompanyCredentialNotFoundError("System")
  if (newNormalized !== null) await repo.lockSystemNames(ctx.client, [newNormalized])
  const current = await repo.getSystem(ctx.client, systemId, "update")
  if (!current) throw new CompanyCredentialNotFoundError("System")
  if (current.recordStatus !== "active") throw new CompanyCredentialStateError("This system is archived; restore it first.")

  const currentNormalized = normalizeSystemName(current.displayName)
  const next = {
    displayName: newName ?? current.displayName,
    normalized: newNormalized ?? currentNormalized,
    providerOrganizationId: newProvider === undefined ? current.providerOrganizationId : newProvider,
    country: newCountry === undefined ? current.jurisdictionCountry : newCountry,
    region: newRegion === undefined ? current.jurisdictionRegion : newRegion,
    loginUrl: newLoginUrl === undefined ? current.loginUrl : newLoginUrl,
  }
  if (next.region !== null && next.country === null) throw new CompanyCredentialValidationError("jurisdictionRegion", "jurisdictionRegion needs a jurisdictionCountry.")
  const nameChanged = next.displayName !== current.displayName
  const providerChanged = next.providerOrganizationId !== current.providerOrganizationId
  const countryChanged = next.country !== current.jurisdictionCountry
  const regionChanged = next.region !== current.jurisdictionRegion
  const urlChanged = next.loginUrl !== current.loginUrl
  if (!nameChanged && !providerChanged && !countryChanged && !regionChanged && !urlChanged) throw new CompanyCredentialValidationError("input", "Nothing to change.")
  if (next.normalized !== currentNormalized) await assertNameFree(ctx, next.normalized, systemId)

  await guarded(() => repo.updateSystem(ctx.client, { id: systemId, displayName: next.displayName, normalized: next.normalized, providerOrganizationId: next.providerOrganizationId, country: next.country, region: next.region, loginUrl: next.loginUrl }))
  const fieldChanges: FieldChange[] = []
  if (nameChanged) fieldChanges.push({ field: "name", before: changed(), after: changed() })
  if (providerChanged) {
    fieldChanges.push({
      field: "provider",
      before: current.providerOrganizationId ? reference("organizations", current.providerOrganizationId) : literal(null),
      after: next.providerOrganizationId ? reference("organizations", next.providerOrganizationId) : literal(null),
    })
  }
  if (countryChanged) fieldChanges.push({ field: "jurisdictionCountry", before: literal(current.jurisdictionCountry), after: literal(next.country) })
  if (regionChanged) fieldChanges.push({ field: "jurisdictionRegion", before: literal(current.jurisdictionRegion), after: literal(next.region) })
  if (urlChanged) fieldChanges.push({ field: "loginUrl", before: changed(), after: changed() })
  await record(ctx, "RECORD_UPDATED", "updateSystem", { resourceType: "credential_system", resourceId: systemId }, fieldChanges)
  return loadSystem(ctx, systemId)
}

export async function addAlias(ctx: OperationContext, rawInput: unknown): Promise<SystemView> {
  const input = requireObject(rawInput, "input", ["systemId", "alias"])
  const systemId = parseUuid(input.systemId, "systemId")
  const display = parseSystemDisplayName(input.alias, "alias")
  const normalized = normalizeSystemName(display, "alias")

  if (!(await repo.getSystem(ctx.client, systemId))) throw new CompanyCredentialNotFoundError("System")
  await repo.lockSystemNames(ctx.client, [normalized])
  const system = await repo.getSystem(ctx.client, systemId, "update")
  if (!system) throw new CompanyCredentialNotFoundError("System")
  if (system.recordStatus !== "active") throw new CompanyCredentialStateError("This system is archived; restore it first.")
  if (normalized === normalizeSystemName(system.displayName)) throw new CompanyCredentialValidationError("alias", "alias must differ from the system's own name.")
  if (await repo.systemHasActiveAlias(ctx.client, systemId, normalized)) throw new CompanyCredentialConflictError("That name is already used by another system or alias.")
  await assertNameFree(ctx, normalized, systemId)

  const aliasId = randomUUID()
  await guarded(() => repo.insertAlias(ctx.client, { id: aliasId, systemId, display, normalized }))
  await record(ctx, "RECORD_CREATED", "addAlias", { resourceType: "credential_system_alias", resourceId: aliasId }, [
    { field: "alias", before: literal(null), after: reference("credential_system_aliases", aliasId) },
    { field: "system", before: literal(null), after: reference("credential_systems", systemId) },
  ])
  return loadSystem(ctx, systemId)
}

export async function retireAlias(ctx: OperationContext, rawInput: unknown): Promise<SystemView> {
  const input = requireObject(rawInput, "input", ["aliasId"])
  const aliasId = parseUuid(input.aliasId, "aliasId")
  const alias = await repo.getAlias(ctx.client, aliasId)
  if (!alias) throw new CompanyCredentialNotFoundError("Alias")
  const system = await repo.getSystem(ctx.client, alias.systemId, "update")
  if (!system) throw new CompanyCredentialNotFoundError("Alias")
  const locked = await repo.getAlias(ctx.client, aliasId)
  if (!locked) throw new CompanyCredentialNotFoundError("Alias")
  if (locked.recordStatus !== "active") throw new CompanyCredentialStateError("This alias is already retired.")
  await guarded(() => repo.retireAlias(ctx.client, aliasId))
  await record(ctx, "RECORD_ARCHIVED", "retireAlias", { resourceType: "credential_system_alias", resourceId: aliasId }, [
    { field: "lifecycle", before: literal("active"), after: literal("retired") },
  ])
  return loadSystem(ctx, alias.systemId)
}

async function setSystemLifecycle(ctx: OperationContext, rawInput: unknown, archive: boolean): Promise<SystemView> {
  const input = requireObject(rawInput, "input", ["systemId"])
  const systemId = parseUuid(input.systemId, "systemId")
  const system = await repo.getSystem(ctx.client, systemId, "update")
  if (!system) throw new CompanyCredentialNotFoundError("System")
  if (archive && system.recordStatus === "archived") throw new CompanyCredentialStateError("This system is already archived.")
  if (!archive && system.recordStatus !== "archived") throw new CompanyCredentialStateError("This system is not archived.")
  await guarded(() => repo.setSystemArchived(ctx.client, systemId, archive))
  await record(ctx, archive ? "RECORD_ARCHIVED" : "RECORD_RESTORED", archive ? "archiveSystem" : "restoreSystem", { resourceType: "credential_system", resourceId: systemId }, [
    { field: "lifecycle", before: literal(archive ? "active" : "archived"), after: literal(archive ? "archived" : "active") },
  ])
  return loadSystem(ctx, systemId)
}

export const archiveSystem = (ctx: OperationContext, rawInput: unknown): Promise<SystemView> => setSystemLifecycle(ctx, rawInput, true)
export const restoreSystem = (ctx: OperationContext, rawInput: unknown): Promise<SystemView> => setSystemLifecycle(ctx, rawInput, false)

// ---------------------------------------------------------------------------------------------------------------
// Credentials (CREDENTIAL_MANAGE)
// ---------------------------------------------------------------------------------------------------------------

/** Inserts a credential with its INITIAL status period and (by default) one UNRESOLVED PASSWORD slot, and records the events. */
async function insertNewCredential(
  ctx: OperationContext,
  input: {
    organizationId: string
    systemId: string
    category: CredentialCategory
    usernameDisplay: string
    usernameNormalized: string
    mfaMethod: MfaMethod | null
    replacesCredentialId: string | null
    replacementReason: ReplacementReason | null
    status: CredentialStatus
    effectiveFrom: string
    passwordSlot: boolean
    operation: string
  },
): Promise<string> {
  const credentialId = randomUUID()
  await guarded(() =>
    repo.insertCredential(ctx.client, {
      id: credentialId,
      organizationId: input.organizationId,
      systemId: input.systemId,
      category: input.category,
      usernameDisplay: input.usernameDisplay,
      usernameNormalized: input.usernameNormalized,
      mfaMethod: input.mfaMethod,
      replacesCredentialId: input.replacesCredentialId,
      replacementReason: input.replacementReason,
    }),
  )
  const periodId = randomUUID()
  await guarded(() => repo.insertPeriod(ctx.client, { id: periodId, credentialId, status: input.status, reason: "INITIAL", effectiveFrom: input.effectiveFrom }))
  const slotId = input.passwordSlot ? randomUUID() : null
  if (slotId) await guarded(() => repo.insertSlot(ctx.client, { id: slotId, credentialId, organizationId: input.organizationId, slotKind: "PASSWORD" }))

  const subject = { organizationId: input.organizationId }
  await record(ctx, "RECORD_CREATED", input.operation, { ...subject, resourceType: "company_credential", resourceId: credentialId }, [
    { field: "credential", before: literal(null), after: reference("company_credentials", credentialId) },
    { field: "system", before: literal(null), after: reference("credential_systems", input.systemId) },
    { field: "category", before: literal(null), after: literal(input.category) },
    ...(input.replacesCredentialId
      ? [
          { field: "replaces", before: literal(null), after: reference("company_credentials", input.replacesCredentialId) },
          { field: "replacementReason", before: literal(null), after: literal(input.replacementReason) },
        ]
      : []),
  ])
  await record(ctx, "RECORD_CREATED", input.operation, { ...subject, resourceType: "credential_status_period", resourceId: periodId }, [
    { field: "status", before: literal(null), after: literal(input.status) },
  ])
  if (slotId) {
    await record(ctx, "RECORD_CREATED", input.operation, { ...subject, resourceType: "credential_secret_slot", resourceId: slotId }, [
      { field: "slotKind", before: literal(null), after: literal("PASSWORD") },
      { field: "slotState", before: literal(null), after: literal("UNRESOLVED") },
    ])
  }
  return credentialId
}

/** A new credential: the account an Organization holds on one system, with its INITIAL status and (by default) an UNRESOLVED PASSWORD slot. */
export async function createCredential(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["organizationId", "systemId", "category", "username", "mfaMethod", "status", "effectiveFrom", "passwordSlot"])
  const organizationId = parseUuid(input.organizationId, "organizationId")
  const systemId = parseUuid(input.systemId, "systemId")
  const category = parseCategory(input.category)
  const usernameDisplay = parseUsernameDisplay(input.username)
  const usernameNormalized = normalizeUsername(input.username)
  const mfaMethod = input.mfaMethod === undefined ? null : parseMfaMethod(input.mfaMethod)
  const status = input.status === undefined ? "ACTIVE" : parseStatus(input.status)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")
  const passwordSlot = parseBoolean(input.passwordSlot, "passwordSlot", true)

  const organization = await repo.lockOrganization(ctx.client, organizationId)
  if (!organization) throw new CompanyCredentialNotFoundError("Organization")
  requireActiveOrganization(organization)
  const system = await repo.getSystem(ctx.client, systemId, "share")
  if (!system) throw new CompanyCredentialNotFoundError("System")
  if (system.recordStatus !== "active") throw new CompanyCredentialStateError("This system is archived; restore it first.")
  if (await repo.findActiveAccount(ctx.client, { organizationId, systemId, usernameNormalized })) {
    throw new CompanyCredentialConflictError("This Organization already has an active credential for that account on that system.")
  }
  const effectiveFrom = await resolveInstant(ctx, explicit, "effectiveFrom")
  const credentialId = await insertNewCredential(ctx, {
    organizationId, systemId, category, usernameDisplay, usernameNormalized, mfaMethod,
    replacesCredentialId: null, replacementReason: null, status, effectiveFrom, passwordSlot, operation: "createCredential",
  })
  return loadCredential(ctx, credentialId)
}

/**
 * A changed or wrongly entered login: a NEW credential on the same system that points at the one it replaces. The old
 * credential is archived in the same transaction and keeps its own status, verification and slot history. A new login has
 * not been verified, so it starts NEEDS_VERIFICATION unless a status is given. The new credential inherits the category
 * and (unless supplied) the multi-factor method.
 */
export async function replaceCredential(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "username", "reason", "category", "mfaMethod", "status", "effectiveFrom", "passwordSlot"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  const usernameDisplay = parseUsernameDisplay(input.username)
  const usernameNormalized = normalizeUsername(input.username)
  if (!isReplacementReason(input.reason)) throw new CompanyCredentialValidationError("reason", "reason must be a supported replacement reason.")
  const reason = input.reason
  const category = input.category === undefined ? null : parseCategory(input.category)
  const mfaMethod = input.mfaMethod === undefined ? undefined : parseMfaMethod(input.mfaMethod)
  const status = input.status === undefined ? "NEEDS_VERIFICATION" : parseStatus(input.status)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")
  const passwordSlot = parseBoolean(input.passwordSlot, "passwordSlot", true)

  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: true })
  const old = locked.credential
  if (usernameDisplay === old.username) throw new CompanyCredentialValidationError("username", "The replacement must have a different username.")
  const system = await repo.getSystem(ctx.client, old.systemId, "share")
  if (!system || system.recordStatus !== "active") throw new CompanyCredentialStateError("This system is archived; restore it first.")
  const effectiveFrom = await resolveInstant(ctx, explicit, "effectiveFrom")

  // The old credential leaves the active-account index first, so a case-only correction of the same login is allowed.
  await guarded(() => repo.setCredentialArchived(ctx.client, old.id, true))
  const replacementId = await insertNewCredential(ctx, {
    organizationId: locked.organizationId, systemId: old.systemId, category: category ?? old.category, usernameDisplay, usernameNormalized,
    mfaMethod: mfaMethod === undefined ? old.mfaMethod : mfaMethod,
    replacesCredentialId: old.id, replacementReason: reason, status, effectiveFrom, passwordSlot, operation: "replaceCredential",
  })
  await record(ctx, "RECORD_ARCHIVED", "replaceCredential", { organizationId: locked.organizationId, resourceType: "company_credential", resourceId: old.id }, [
    { field: "lifecycle", before: literal("active"), after: literal("archived") },
    { field: "replacedBy", before: literal(null), after: reference("company_credentials", replacementId) },
  ])
  return loadCredential(ctx, replacementId)
}

export async function updateCredentialMetadata(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "category", "mfaMethod"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  if (input.category === undefined && input.mfaMethod === undefined) throw new CompanyCredentialValidationError("input", "Nothing to change.")
  const category = input.category === undefined ? null : parseCategory(input.category)
  const mfaMethod = input.mfaMethod === undefined ? undefined : parseMfaMethod(input.mfaMethod)

  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: true })
  const next = { category: category ?? locked.credential.category, mfaMethod: mfaMethod === undefined ? locked.credential.mfaMethod : mfaMethod }
  const fieldChanges: FieldChange[] = []
  if (next.category !== locked.credential.category) fieldChanges.push({ field: "category", before: literal(locked.credential.category), after: literal(next.category) })
  if (next.mfaMethod !== locked.credential.mfaMethod) fieldChanges.push({ field: "mfaMethod", before: literal(locked.credential.mfaMethod), after: literal(next.mfaMethod) })
  if (fieldChanges.length === 0) throw new CompanyCredentialValidationError("input", "Nothing to change.")
  await guarded(() => repo.updateCredentialMetadata(ctx.client, credentialId, next.category, next.mfaMethod))
  await record(ctx, "RECORD_UPDATED", "updateCredentialMetadata", { organizationId: locked.organizationId, resourceType: "company_credential", resourceId: credentialId }, fieldChanges)
  return loadCredential(ctx, credentialId)
}

/** A REAL-WORLD status change: ends the current period at T and starts the next one at T. */
export async function changeCredentialStatus(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "organizationId", "status", "effectiveFrom"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  const status = parseStatus(input.status)
  const explicit = optionalInstant(input.effectiveFrom, "effectiveFrom")

  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: true })
  assertScopedOrganization(input.organizationId, locked.organizationId)
  const current = await repo.getCurrentPeriod(ctx.client, credentialId, "update")
  if (!current) throw new CompanyCredentialStateError("This credential has no current status.")
  if (current.status === status) throw new CompanyCredentialValidationError("status", "The credential already has that status.")
  const at = await resolveInstant(ctx, explicit, "effectiveFrom")
  if (at <= current.effectiveFrom) throw new CompanyCredentialValidationError("effectiveFrom", "The change must be after the current status began.")

  const replacementId = randomUUID()
  await guarded(() => repo.endPeriod(ctx.client, current.id, at))
  await guarded(() => repo.insertPeriod(ctx.client, { id: replacementId, credentialId, status, reason: "TRANSITION", effectiveFrom: at }))
  await record(ctx, "RECORD_STATUS_CHANGED", "changeCredentialStatus", { organizationId: locked.organizationId, resourceType: "credential_status_period", resourceId: replacementId }, [
    { field: "status", before: literal(current.status), after: literal(status) },
    { field: "period", before: reference("credential_status_periods", current.id), after: reference("credential_status_periods", replacementId) },
  ])
  return loadCredential(ctx, credentialId)
}

/**
 * A CORRECTION of a wrongly recorded status: the wrong period is kept and flagged 'corrected', pointed at its replacement,
 * and the replacement inherits its business time. Only the CURRENT period can be corrected: the runtime role may insert a
 * period only as open (effective_to is not insertable), and a second open period cannot exist, so an already-ended period
 * cannot be re-created by a correction. Earlier mistakes are fixed by recording the true change going forward.
 */
export async function correctCredentialStatus(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["periodId", "status"])
  const periodId = parseUuid(input.periodId, "periodId")
  const status = parseStatus(input.status)

  const peek = await repo.getPeriod(ctx.client, periodId)
  if (!peek) throw new CompanyCredentialNotFoundError("Status period")
  const locked = await lockCredential(ctx, peek.credentialId, { requireActiveOrganization: false, requireActiveCredential: true })
  const target = await repo.getPeriod(ctx.client, periodId, "update")
  if (!target) throw new CompanyCredentialNotFoundError("Status period")
  if (target.recordStatus !== "active") throw new CompanyCredentialStateError("This status was already corrected.")
  if (target.effectiveTo !== null) throw new CompanyCredentialStateError("Only the current status can be corrected; record the real change going forward.")
  if (target.status === status) throw new CompanyCredentialValidationError("status", "The status is unchanged.")

  const replacementId = randomUUID()
  await guarded(() => repo.markPeriodCorrected(ctx.client, target.id, replacementId))
  await guarded(() => repo.insertPeriod(ctx.client, { id: replacementId, credentialId: target.credentialId, status, reason: "CORRECTION", effectiveFrom: target.effectiveFrom }))
  await record(ctx, "RECORD_CORRECTED", "correctCredentialStatus", { organizationId: locked.organizationId, resourceType: "credential_status_period", resourceId: replacementId }, [
    { field: "period", before: reference("credential_status_periods", target.id), after: reference("credential_status_periods", replacementId) },
    { field: "status", before: literal(target.status), after: literal(status) },
  ])
  return loadCredential(ctx, target.credentialId)
}

/**
 * Records a verification FACT. The recording actor is the authenticated TES actor of the authorization decision (it is
 * never supplied by the caller). It does not change the credential's status: that is a separate, explicit decision.
 */
export async function recordVerification(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "organizationId", "outcome", "method", "verifiedAt"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  if (!isVerificationOutcome(input.outcome)) throw new CompanyCredentialValidationError("outcome", "outcome must be a supported verification outcome.")
  if (!isVerificationMethod(input.method)) throw new CompanyCredentialValidationError("method", "method must be a supported verification method.")
  const outcome = input.outcome
  const method = input.method
  const explicit = optionalInstant(input.verifiedAt, "verifiedAt")

  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: true })
  assertScopedOrganization(input.organizationId, locked.organizationId)
  const verifiedAt = await resolveInstant(ctx, explicit, "verifiedAt")
  const verificationId = randomUUID()
  await guarded(() => repo.insertVerification(ctx.client, { id: verificationId, credentialId, organizationId: locked.organizationId, outcome, method, verifiedAt, actorId: ctx.actor.id }))
  await record(ctx, "RECORD_CREATED", "recordVerification", { organizationId: locked.organizationId, resourceType: "credential_verification", resourceId: verificationId }, [
    { field: "verification", before: literal(null), after: reference("credential_verifications", verificationId) },
    { field: "outcome", before: literal(null), after: literal(outcome) },
    { field: "method", before: literal(null), after: literal(method) },
  ])
  return loadCredential(ctx, credentialId)
}

/** A verification entered in error is VOIDED (one-way); it is kept, never edited or deleted. */
export async function voidVerification(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["verificationId"])
  const verificationId = parseUuid(input.verificationId, "verificationId")
  const credentialId = await repo.findVerificationCredential(ctx.client, verificationId)
  if (!credentialId) throw new CompanyCredentialNotFoundError("Verification")
  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: false, requireActiveCredential: false })
  const verification = await repo.getVerification(ctx.client, verificationId, "update")
  if (!verification) throw new CompanyCredentialNotFoundError("Verification")
  if (verification.recordStatus !== "active") throw new CompanyCredentialStateError("This verification was already voided.")
  await guarded(() => repo.voidVerification(ctx.client, verificationId))
  await record(ctx, "RECORD_STATUS_CHANGED", "voidVerification", { organizationId: locked.organizationId, resourceType: "credential_verification", resourceId: verificationId }, [
    { field: "lifecycle", before: literal("active"), after: literal("voided") },
  ])
  return loadCredential(ctx, credentialId)
}

export async function addSecretSlot(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "slotKind"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  if (!isSlotKind(input.slotKind)) throw new CompanyCredentialValidationError("slotKind", "slotKind must be a supported secret slot kind.")
  const slotKind: SlotKind = input.slotKind

  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: true })
  const slotId = randomUUID()
  await guarded(() => repo.insertSlot(ctx.client, { id: slotId, credentialId, organizationId: locked.organizationId, slotKind }))
  await record(ctx, "RECORD_CREATED", "addSecretSlot", { organizationId: locked.organizationId, resourceType: "credential_secret_slot", resourceId: slotId }, [
    { field: "slotKind", before: literal(null), after: literal(slotKind) },
    { field: "slotState", before: literal(null), after: literal("UNRESOLVED") },
  ])
  return loadCredential(ctx, credentialId)
}

/**
 * UNRESOLVED -> STORED: attaches the opaque resource name of a secret that already lives in the secret store. This is the
 * ONLY place a reference enters the system. The input accepts exactly slotId, secretReference and secretStore: a key such as
 * `value`, `password` or `secret` is refused as an unknown field, and a malformed reference is refused WITHOUT echoing it.
 */
export async function attachSecretReference(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["slotId", "secretReference", "secretStore"])
  const slotId = parseUuid(input.slotId, "slotId")
  const store = input.secretStore === undefined ? "GCP_SECRET_MANAGER" : input.secretStore
  if (!isSecretStore(store)) throw new CompanyCredentialValidationError("secretStore", "secretStore must be a supported secret store.")
  if (!isSecretReference(input.secretReference)) {
    throw new CompanyCredentialValidationError("secretReference", "secretReference must be a secret-store resource name (projects/<id>/secrets/<name>).")
  }
  const secretReference = input.secretReference

  const credentialId = await repo.findSlotCredential(ctx.client, slotId)
  if (!credentialId) throw new CompanyCredentialNotFoundError("Secret slot")
  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: true })
  const slot = await repo.getSlot(ctx.client, slotId, "update")
  if (!slot) throw new CompanyCredentialNotFoundError("Secret slot")
  if (slot.secretState !== "UNRESOLVED") {
    throw new CompanyCredentialStateError(slot.secretState === "STORED" ? "This slot already holds a reference; retire it and add a new slot." : "This slot is retired.")
  }
  await guarded(() => repo.attachSlotReference(ctx.client, slotId, store, secretReference))
  await record(ctx, "RECORD_UPDATED", "attachSecretReference", { organizationId: locked.organizationId, resourceType: "credential_secret_slot", resourceId: slotId }, [
    { field: "slotState", before: literal("UNRESOLVED"), after: literal("STORED") },
  ])
  return loadCredential(ctx, credentialId)
}

/** Retires a slot (UNRESOLVED or STORED). Allowed on an archived credential so its slots can be closed out. */
export async function retireSecretSlot(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["slotId"])
  const slotId = parseUuid(input.slotId, "slotId")
  const credentialId = await repo.findSlotCredential(ctx.client, slotId)
  if (!credentialId) throw new CompanyCredentialNotFoundError("Secret slot")
  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: false, requireActiveCredential: false })
  const slot = await repo.getSlot(ctx.client, slotId, "update")
  if (!slot) throw new CompanyCredentialNotFoundError("Secret slot")
  if (slot.secretState === "RETIRED") throw new CompanyCredentialStateError("This slot is already retired.")
  await guarded(() => repo.retireSlot(ctx.client, slotId))
  await record(ctx, "RECORD_STATUS_CHANGED", "retireSecretSlot", { organizationId: locked.organizationId, resourceType: "credential_secret_slot", resourceId: slotId }, [
    { field: "slotState", before: literal(slot.secretState), after: literal("RETIRED") },
  ])
  return loadCredential(ctx, credentialId)
}

export async function archiveCredential(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "organizationId"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: false, requireActiveCredential: false })
  assertScopedOrganization(input.organizationId, locked.organizationId)
  if (locked.credential.recordStatus === "archived") throw new CompanyCredentialStateError("This credential is already archived.")
  await guarded(() => repo.setCredentialArchived(ctx.client, credentialId, true))
  await record(ctx, "RECORD_ARCHIVED", "archiveCredential", { organizationId: locked.organizationId, resourceType: "company_credential", resourceId: credentialId }, [
    { field: "lifecycle", before: literal("active"), after: literal("archived") },
  ])
  return loadCredential(ctx, credentialId)
}

/** Restores an archived credential, unless that would give the Organization two active accounts for the same login on the same system. */
export async function restoreCredential(ctx: OperationContext, rawInput: unknown): Promise<CredentialView> {
  const input = requireObject(rawInput, "input", ["credentialId", "organizationId"])
  const credentialId = parseUuid(input.credentialId, "credentialId")
  const locked = await lockCredential(ctx, credentialId, { requireActiveOrganization: true, requireActiveCredential: false })
  assertScopedOrganization(input.organizationId, locked.organizationId)
  if (locked.credential.recordStatus !== "archived") throw new CompanyCredentialStateError("This credential is not archived.")
  const usernameNormalized = await repo.getUsernameNormalized(ctx.client, credentialId)
  if (usernameNormalized === undefined) throw new CompanyCredentialNotFoundError("Credential")
  if (await repo.findActiveAccount(ctx.client, { organizationId: locked.organizationId, systemId: locked.credential.systemId, usernameNormalized })) {
    throw new CompanyCredentialConflictError("This Organization already has an active credential for that account on that system.")
  }
  await guarded(() => repo.setCredentialArchived(ctx.client, credentialId, false))
  await record(ctx, "RECORD_RESTORED", "restoreCredential", { organizationId: locked.organizationId, resourceType: "company_credential", resourceId: credentialId }, [
    { field: "lifecycle", before: literal("archived"), after: literal("active") },
  ])
  return loadCredential(ctx, credentialId)
}

export type { StatusPeriodRecord }
