/**
 * Company Credentials repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation or Master Register logic lives here. Every function takes the client the authorization
 * wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing here issues
 * DELETE (the runtime role has none).
 *
 * SECRET HYGIENE: the secret-slot read queries select the slot's kind and state only. secret_store and secret_reference
 * are written by attachSecretReference and are never selected anywhere in this file, so no read path can return one.
 *
 * Business time is passed and returned as text with microsecond precision, because a JS Date would truncate to
 * milliseconds and could reorder two writes made within the same millisecond.
 *
 * Lock order (used by every operation): Organization row, then the credential row, then dependent rows (status periods,
 * verifications, secret slots). System-registry operations take the system-name advisory locks in sorted order and then
 * the system row; the database triggers take the same advisory locks, so a writer that bypassed this layer still serializes.
 */

import type { PoolClient } from "pg"
import type {
  CredentialCategory,
  CredentialStatus,
  MfaMethod,
  PeriodReason,
  ReplacementReason,
  SecretState,
  SecretStore,
  SlotKind,
  VerificationMethod,
  VerificationOutcome,
} from "@/lib/company-credentials/definitions"
import type {
  AliasRecord,
  CredentialRecord,
  SecretSlotRecord,
  StatusPeriodRecord,
  SystemRecord,
  VerificationRecord,
} from "@/lib/company-credentials/types"

export type Queryable = Pick<PoolClient, "query">

// Constraint / trigger-constraint names the operations translate into domain errors.
export const SYSTEM_NAME_CONSTRAINTS = [
  "credential_systems_name_normalized_uq",
  "credential_systems_name_not_alias",
  "credential_system_aliases_active_uq",
  "credential_system_aliases_not_system_name",
] as const
export const ALIAS_SYSTEM_ACTIVE_CONSTRAINT = "credential_system_aliases_system_active"
export const ORGANIZATION_ACTIVE_CONSTRAINT = "organization_must_be_active"
export const ACTIVE_ACCOUNT_CONSTRAINT = "company_credentials_active_account_uq"
export const CREDENTIAL_SYSTEM_ACTIVE_CONSTRAINT = "company_credentials_system_active"
export const CREDENTIAL_CURRENT_STATUS_CONSTRAINT = "company_credentials_require_current_status"
export const CURRENT_STATUS_CONSTRAINT = "credential_status_periods_current_uq"
export const STATUS_CREDENTIAL_ACTIVE_CONSTRAINT = "credential_status_periods_credential_active"
export const STATUS_WINDOW_CONSTRAINT = "credential_status_periods_effective_window_valid"
export const VERIFICATION_CREDENTIAL_ACTIVE_CONSTRAINT = "credential_verifications_credential_active"
export const VERIFICATION_NOT_FUTURE_CONSTRAINT = "credential_verifications_not_future"
export const SLOT_CREDENTIAL_ACTIVE_CONSTRAINT = "credential_secret_slots_credential_active"
export const SLOT_SINGLE_LIVE_CONSTRAINT = "credential_secret_slots_single_live_uq"
export const SLOT_REFERENCE_CONSTRAINT = "credential_secret_slots_reference_shape"
export const SYSTEM_FIELD_CONSTRAINTS: Record<string, string> = {
  credential_systems_display_name_not_blank: "name",
  credential_systems_name_normalized_valid: "name",
  credential_systems_country_valid: "jurisdictionCountry",
  credential_systems_region_valid: "jurisdictionRegion",
  credential_systems_login_url_valid: "loginUrl",
  credential_system_aliases_display_not_blank: "alias",
  credential_system_aliases_normalized_valid: "alias",
}
export const CREDENTIAL_FIELD_CONSTRAINTS: Record<string, string> = {
  company_credentials_username_display_not_blank: "username",
  company_credentials_username_normalized_valid: "username",
  company_credentials_mfa_method_valid: "mfaMethod",
}

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`

export async function databaseNow(client: Queryable): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

export async function isNotInFuture(client: Queryable, instant: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::timestamptz <= clock_timestamp() AS ok`, [instant])
  return result.rows[0].ok
}

// --- organizations --------------------------------------------------------------------------------------------------

/** Row-locks the Organization so every writer of its credentials serializes (lock order step 1). */
export async function lockOrganization(
  client: Queryable,
  organizationId: string,
): Promise<{ id: string; status: "active" | "archived" | "merged" } | undefined> {
  const result = await client.query<{ id: string; status: "active" | "archived" | "merged" }>(
    `SELECT id, status FROM public.organizations WHERE id = $1 FOR UPDATE`,
    [organizationId],
  )
  return result.rows[0]
}

export async function organizationExists(client: Queryable, organizationId: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM public.organizations WHERE id = $1`, [organizationId])
  return (result.rowCount ?? 0) > 0
}

// --- system names ---------------------------------------------------------------------------------------------------

/**
 * Takes the per-name advisory locks the database triggers also take, in SORTED order, so two writers that each need
 * several names (a system and its aliases) can never deadlock on each other. Re-entrant for the same transaction.
 */
export async function lockSystemNames(client: Queryable, normalizedNames: string[]): Promise<void> {
  for (const name of [...new Set(normalizedNames)].sort()) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('credential_system_name:' || $1::text, 0))`, [name])
  }
}

/** The system (other than `exceptSystemId`) whose canonical name is `normalized`, or whose ACTIVE alias is. */
export async function findNameHolder(client: Queryable, normalized: string, exceptSystemId: string | null): Promise<{ via: "name" | "alias"; systemId: string } | undefined> {
  const byName = await client.query<{ id: string }>(
    `SELECT id FROM public.credential_systems WHERE display_name_normalized = $1 AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
    [normalized, exceptSystemId],
  )
  if (byName.rows[0]) return { via: "name", systemId: byName.rows[0].id }
  const byAlias = await client.query<{ system_id: string }>(
    `SELECT system_id FROM public.credential_system_aliases WHERE alias_normalized = $1 AND record_status = 'active' AND ($2::uuid IS NULL OR system_id <> $2) LIMIT 1`,
    [normalized, exceptSystemId],
  )
  return byAlias.rows[0] ? { via: "alias", systemId: byAlias.rows[0].system_id } : undefined
}

/** True when `normalized` is already an ACTIVE alias of the given system. */
export async function systemHasActiveAlias(client: Queryable, systemId: string, normalized: string): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM public.credential_system_aliases WHERE system_id = $1 AND alias_normalized = $2 AND record_status = 'active'`, [systemId, normalized])
  return (result.rowCount ?? 0) > 0
}

// --- systems --------------------------------------------------------------------------------------------------------

const SYSTEM_COLUMNS = `id, display_name, provider_organization_id, jurisdiction_country, jurisdiction_region, login_url, record_status, ${MICRO_ISO_NULL("archived_at")} AS archived_at, ${MICRO_ISO("created_at")} AS created_at`
type SystemRow = {
  id: string
  display_name: string
  provider_organization_id: string | null
  jurisdiction_country: string | null
  jurisdiction_region: string | null
  login_url: string | null
  record_status: "active" | "archived"
  archived_at: string | null
  created_at: string
}
const toSystem = (row: SystemRow): SystemRecord => ({
  id: row.id,
  displayName: row.display_name,
  providerOrganizationId: row.provider_organization_id,
  jurisdictionCountry: row.jurisdiction_country,
  jurisdictionRegion: row.jurisdiction_region,
  loginUrl: row.login_url,
  recordStatus: row.record_status,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

export type RowLock = false | "share" | "update"
const lockClause = (lock: RowLock) => (lock === "share" ? " FOR SHARE" : lock === "update" ? " FOR NO KEY UPDATE" : "")

export async function getSystem(client: Queryable, systemId: string, lock: RowLock = false): Promise<SystemRecord | undefined> {
  const result = await client.query<SystemRow>(`SELECT ${SYSTEM_COLUMNS} FROM public.credential_systems WHERE id = $1${lockClause(lock)}`, [systemId])
  return result.rows[0] ? toSystem(result.rows[0]) : undefined
}

export async function listSystems(client: Queryable, includeArchived: boolean): Promise<SystemRecord[]> {
  const result = await client.query<SystemRow>(
    `SELECT ${SYSTEM_COLUMNS} FROM public.credential_systems WHERE ($1::boolean OR record_status = 'active') ORDER BY display_name_normalized, id`,
    [includeArchived],
  )
  return result.rows.map(toSystem)
}

export async function insertSystem(
  client: Queryable,
  input: { id: string; displayName: string; normalized: string; providerOrganizationId: string | null; country: string | null; region: string | null; loginUrl: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.credential_systems (id, display_name, display_name_normalized, provider_organization_id, jurisdiction_country, jurisdiction_region, login_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.id, input.displayName, input.normalized, input.providerOrganizationId, input.country, input.region, input.loginUrl],
  )
}

export async function updateSystem(
  client: Queryable,
  input: { id: string; displayName: string; normalized: string; providerOrganizationId: string | null; country: string | null; region: string | null; loginUrl: string | null },
): Promise<void> {
  await client.query(
    `UPDATE public.credential_systems
        SET display_name = $2, display_name_normalized = $3, provider_organization_id = $4, jurisdiction_country = $5,
            jurisdiction_region = $6, login_url = $7, updated_at = clock_timestamp()
      WHERE id = $1`,
    [input.id, input.displayName, input.normalized, input.providerOrganizationId, input.country, input.region, input.loginUrl],
  )
}

export async function setSystemArchived(client: Queryable, systemId: string, archived: boolean): Promise<void> {
  await client.query(
    `UPDATE public.credential_systems SET record_status = $2, archived_at = CASE WHEN $2 = 'archived' THEN clock_timestamp() ELSE NULL END, updated_at = clock_timestamp() WHERE id = $1`,
    [systemId, archived ? "archived" : "active"],
  )
}

// --- aliases --------------------------------------------------------------------------------------------------------

const ALIAS_COLUMNS = `id, system_id, alias_display, record_status, ${MICRO_ISO_NULL("retired_at")} AS retired_at`
type AliasRow = { id: string; system_id: string; alias_display: string; record_status: "active" | "retired"; retired_at: string | null }
const toAlias = (row: AliasRow): AliasRecord => ({ id: row.id, systemId: row.system_id, alias: row.alias_display, recordStatus: row.record_status, retiredAt: row.retired_at })

export async function getAlias(client: Queryable, aliasId: string): Promise<AliasRecord | undefined> {
  const result = await client.query<AliasRow>(`SELECT ${ALIAS_COLUMNS} FROM public.credential_system_aliases WHERE id = $1`, [aliasId])
  return result.rows[0] ? toAlias(result.rows[0]) : undefined
}

export async function listAliases(client: Queryable, systemIds: string[]): Promise<Map<string, AliasRecord[]>> {
  const grouped = new Map<string, AliasRecord[]>()
  if (systemIds.length === 0) return grouped
  const result = await client.query<AliasRow>(`SELECT ${ALIAS_COLUMNS} FROM public.credential_system_aliases WHERE system_id = ANY($1::uuid[]) ORDER BY alias_normalized, created_at, id`, [systemIds])
  for (const row of result.rows) grouped.set(row.system_id, [...(grouped.get(row.system_id) ?? []), toAlias(row)])
  return grouped
}

export async function insertAlias(client: Queryable, input: { id: string; systemId: string; display: string; normalized: string }): Promise<void> {
  await client.query(`INSERT INTO public.credential_system_aliases (id, system_id, alias_display, alias_normalized) VALUES ($1, $2, $3, $4)`, [input.id, input.systemId, input.display, input.normalized])
}

export async function retireAlias(client: Queryable, aliasId: string): Promise<void> {
  await client.query(`UPDATE public.credential_system_aliases SET record_status = 'retired', retired_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [aliasId])
}

// --- credentials ----------------------------------------------------------------------------------------------------

const CREDENTIAL_COLUMNS = `id, organization_id, system_id, category, username_display, mfa_method, replaces_credential_id, replacement_reason, record_status, ${MICRO_ISO_NULL("archived_at")} AS archived_at, ${MICRO_ISO("created_at")} AS created_at`
type CredentialRow = {
  id: string
  organization_id: string
  system_id: string
  category: CredentialCategory
  username_display: string
  mfa_method: MfaMethod | null
  replaces_credential_id: string | null
  replacement_reason: ReplacementReason | null
  record_status: "active" | "archived"
  archived_at: string | null
  created_at: string
}
const toCredential = (row: CredentialRow): CredentialRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  systemId: row.system_id,
  category: row.category,
  username: row.username_display,
  mfaMethod: row.mfa_method,
  replacesCredentialId: row.replaces_credential_id,
  replacementReason: row.replacement_reason,
  recordStatus: row.record_status,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

/** Resolves a credential to its Organization without locking (used to find the Organization to lock first). */
export async function findCredentialOrganization(client: Queryable, credentialId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(`SELECT organization_id FROM public.company_credentials WHERE id = $1`, [credentialId])
  return result.rows[0]?.organization_id
}

export async function getCredential(client: Queryable, credentialId: string, lock: RowLock = false): Promise<CredentialRecord | undefined> {
  const result = await client.query<CredentialRow>(`SELECT ${CREDENTIAL_COLUMNS} FROM public.company_credentials WHERE id = $1${lockClause(lock)}`, [credentialId])
  return result.rows[0] ? toCredential(result.rows[0]) : undefined
}

export async function listCredentials(client: Queryable, organizationId: string): Promise<CredentialRecord[]> {
  const result = await client.query<CredentialRow>(`SELECT ${CREDENTIAL_COLUMNS} FROM public.company_credentials WHERE organization_id = $1 ORDER BY created_at, id`, [organizationId])
  return result.rows.map(toCredential)
}

export async function findActiveAccount(client: Queryable, input: { organizationId: string; systemId: string; usernameNormalized: string }): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM public.company_credentials WHERE organization_id = $1 AND system_id = $2 AND username_normalized = $3 AND record_status = 'active'`,
    [input.organizationId, input.systemId, input.usernameNormalized],
  )
  return result.rows[0]?.id
}

/** The normalized username of a credential (needed to re-check the active-account rule on restore). */
export async function getUsernameNormalized(client: Queryable, credentialId: string): Promise<string | undefined> {
  const result = await client.query<{ username_normalized: string }>(`SELECT username_normalized FROM public.company_credentials WHERE id = $1`, [credentialId])
  return result.rows[0]?.username_normalized
}

export async function findReplacements(client: Queryable, credentialIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (credentialIds.length === 0) return map
  const result = await client.query<{ id: string; replaces_credential_id: string }>(`SELECT id, replaces_credential_id FROM public.company_credentials WHERE replaces_credential_id = ANY($1::uuid[]) ORDER BY created_at, id`, [credentialIds])
  for (const row of result.rows) map.set(row.replaces_credential_id, row.id)
  return map
}

export async function insertCredential(
  client: Queryable,
  input: {
    id: string
    organizationId: string
    systemId: string
    category: CredentialCategory
    usernameDisplay: string
    usernameNormalized: string
    mfaMethod: MfaMethod | null
    replacesCredentialId: string | null
    replacementReason: ReplacementReason | null
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.company_credentials (id, organization_id, system_id, category, username_display, username_normalized, mfa_method, replaces_credential_id, replacement_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.id, input.organizationId, input.systemId, input.category, input.usernameDisplay, input.usernameNormalized, input.mfaMethod, input.replacesCredentialId, input.replacementReason],
  )
}

export async function updateCredentialMetadata(client: Queryable, credentialId: string, category: CredentialCategory, mfaMethod: MfaMethod | null): Promise<void> {
  await client.query(`UPDATE public.company_credentials SET category = $2, mfa_method = $3, updated_at = clock_timestamp() WHERE id = $1`, [credentialId, category, mfaMethod])
}

export async function setCredentialArchived(client: Queryable, credentialId: string, archived: boolean): Promise<void> {
  await client.query(
    `UPDATE public.company_credentials SET record_status = $2, archived_at = CASE WHEN $2 = 'archived' THEN clock_timestamp() ELSE NULL END, updated_at = clock_timestamp() WHERE id = $1`,
    [credentialId, archived ? "archived" : "active"],
  )
}

// --- status periods -------------------------------------------------------------------------------------------------

const PERIOD_COLUMNS = `id, credential_id, credential_status, period_reason, ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to, record_status, ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_period_id`
type PeriodRow = {
  id: string
  credential_id: string
  credential_status: CredentialStatus
  period_reason: PeriodReason
  effective_from: string
  effective_to: string | null
  record_status: "active" | "corrected"
  corrected_at: string | null
  superseded_by_period_id: string | null
}
const toPeriod = (row: PeriodRow): StatusPeriodRecord => ({
  id: row.id,
  credentialId: row.credential_id,
  status: row.credential_status,
  reason: row.period_reason,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  recordStatus: row.record_status,
  correctedAt: row.corrected_at,
  supersededById: row.superseded_by_period_id,
})

export async function getPeriod(client: Queryable, periodId: string, lock: RowLock = false): Promise<StatusPeriodRecord | undefined> {
  const result = await client.query<PeriodRow>(`SELECT ${PERIOD_COLUMNS} FROM public.credential_status_periods WHERE id = $1${lockClause(lock)}`, [periodId])
  return result.rows[0] ? toPeriod(result.rows[0]) : undefined
}

export async function getCurrentPeriod(client: Queryable, credentialId: string, lock: RowLock = false): Promise<StatusPeriodRecord | undefined> {
  const result = await client.query<PeriodRow>(
    `SELECT ${PERIOD_COLUMNS} FROM public.credential_status_periods WHERE credential_id = $1 AND record_status = 'active' AND effective_to IS NULL${lockClause(lock)}`,
    [credentialId],
  )
  return result.rows[0] ? toPeriod(result.rows[0]) : undefined
}

export async function listPeriods(client: Queryable, credentialIds: string[]): Promise<Map<string, StatusPeriodRecord[]>> {
  const grouped = new Map<string, StatusPeriodRecord[]>()
  if (credentialIds.length === 0) return grouped
  const result = await client.query<PeriodRow>(`SELECT ${PERIOD_COLUMNS} FROM public.credential_status_periods WHERE credential_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`, [credentialIds])
  for (const row of result.rows) grouped.set(row.credential_id, [...(grouped.get(row.credential_id) ?? []), toPeriod(row)])
  return grouped
}

export async function insertPeriod(client: Queryable, input: { id: string; credentialId: string; status: CredentialStatus; reason: PeriodReason; effectiveFrom: string }): Promise<void> {
  await client.query(
    `INSERT INTO public.credential_status_periods (id, credential_id, credential_status, period_reason, effective_from) VALUES ($1, $2, $3, $4, $5::timestamptz)`,
    [input.id, input.credentialId, input.status, input.reason, input.effectiveFrom],
  )
}

/** A REAL-WORLD end: sets effective_to on the genuine, open period. */
export async function endPeriod(client: Queryable, periodId: string, at: string): Promise<void> {
  await client.query(`UPDATE public.credential_status_periods SET effective_to = $2::timestamptz, updated_at = clock_timestamp() WHERE id = $1`, [periodId, at])
}

/** A CORRECTION: flags the period (never ends it) and links its replacement. */
export async function markPeriodCorrected(client: Queryable, periodId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.credential_status_periods SET record_status = 'corrected', corrected_at = clock_timestamp(), superseded_by_period_id = $2, updated_at = clock_timestamp() WHERE id = $1`,
    [periodId, replacementId],
  )
}

// --- verifications --------------------------------------------------------------------------------------------------

const VERIFICATION_COLUMNS = `id, credential_id, outcome, method, ${MICRO_ISO("verified_at")} AS verified_at, recorded_by_actor_id, record_status, ${MICRO_ISO_NULL("voided_at")} AS voided_at`
type VerificationRow = {
  id: string
  credential_id: string
  outcome: VerificationOutcome
  method: VerificationMethod
  verified_at: string
  recorded_by_actor_id: string
  record_status: "active" | "voided"
  voided_at: string | null
}
const toVerification = (row: VerificationRow): VerificationRecord => ({
  id: row.id,
  credentialId: row.credential_id,
  outcome: row.outcome,
  method: row.method,
  verifiedAt: row.verified_at,
  recordedByActorId: row.recorded_by_actor_id,
  recordStatus: row.record_status,
  voidedAt: row.voided_at,
})

export async function findVerificationCredential(client: Queryable, verificationId: string): Promise<string | undefined> {
  const result = await client.query<{ credential_id: string }>(`SELECT credential_id FROM public.credential_verifications WHERE id = $1`, [verificationId])
  return result.rows[0]?.credential_id
}

export async function getVerification(client: Queryable, verificationId: string, lock: RowLock = false): Promise<VerificationRecord | undefined> {
  const result = await client.query<VerificationRow>(`SELECT ${VERIFICATION_COLUMNS} FROM public.credential_verifications WHERE id = $1${lockClause(lock)}`, [verificationId])
  return result.rows[0] ? toVerification(result.rows[0]) : undefined
}

export async function listVerifications(client: Queryable, credentialIds: string[]): Promise<Map<string, VerificationRecord[]>> {
  const grouped = new Map<string, VerificationRecord[]>()
  if (credentialIds.length === 0) return grouped
  const result = await client.query<VerificationRow>(`SELECT ${VERIFICATION_COLUMNS} FROM public.credential_verifications WHERE credential_id = ANY($1::uuid[]) ORDER BY verified_at, created_at, id`, [credentialIds])
  for (const row of result.rows) grouped.set(row.credential_id, [...(grouped.get(row.credential_id) ?? []), toVerification(row)])
  return grouped
}

export async function insertVerification(
  client: Queryable,
  input: { id: string; credentialId: string; organizationId: string; outcome: VerificationOutcome; method: VerificationMethod; verifiedAt: string; actorId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.credential_verifications (id, credential_id, organization_id, outcome, method, verified_at, recorded_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)`,
    [input.id, input.credentialId, input.organizationId, input.outcome, input.method, input.verifiedAt, input.actorId],
  )
}

export async function voidVerification(client: Queryable, verificationId: string): Promise<void> {
  await client.query(`UPDATE public.credential_verifications SET record_status = 'voided', voided_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [verificationId])
}

// --- secret slots (state only) --------------------------------------------------------------------------------------

const SLOT_COLUMNS = `id, credential_id, slot_kind, secret_state, ${MICRO_ISO_NULL("stored_at")} AS stored_at, ${MICRO_ISO_NULL("retired_at")} AS retired_at`
type SlotRow = { id: string; credential_id: string; slot_kind: SlotKind; secret_state: SecretState; stored_at: string | null; retired_at: string | null }
const toSlot = (row: SlotRow): SecretSlotRecord => ({
  id: row.id,
  credentialId: row.credential_id,
  slotKind: row.slot_kind,
  secretState: row.secret_state,
  storedAt: row.stored_at,
  retiredAt: row.retired_at,
})

export async function findSlotCredential(client: Queryable, slotId: string): Promise<string | undefined> {
  const result = await client.query<{ credential_id: string }>(`SELECT credential_id FROM public.credential_secret_slots WHERE id = $1`, [slotId])
  return result.rows[0]?.credential_id
}

export async function getSlot(client: Queryable, slotId: string, lock: RowLock = false): Promise<SecretSlotRecord | undefined> {
  const result = await client.query<SlotRow>(`SELECT ${SLOT_COLUMNS} FROM public.credential_secret_slots WHERE id = $1${lockClause(lock)}`, [slotId])
  return result.rows[0] ? toSlot(result.rows[0]) : undefined
}

export async function listSlots(client: Queryable, credentialIds: string[]): Promise<Map<string, SecretSlotRecord[]>> {
  const grouped = new Map<string, SecretSlotRecord[]>()
  if (credentialIds.length === 0) return grouped
  const result = await client.query<SlotRow>(`SELECT ${SLOT_COLUMNS} FROM public.credential_secret_slots WHERE credential_id = ANY($1::uuid[]) ORDER BY slot_kind, created_at, id`, [credentialIds])
  for (const row of result.rows) grouped.set(row.credential_id, [...(grouped.get(row.credential_id) ?? []), toSlot(row)])
  return grouped
}

export async function insertSlot(client: Queryable, input: { id: string; credentialId: string; organizationId: string; slotKind: SlotKind }): Promise<void> {
  await client.query(`INSERT INTO public.credential_secret_slots (id, credential_id, organization_id, slot_kind) VALUES ($1, $2, $3, $4)`, [input.id, input.credentialId, input.organizationId, input.slotKind])
}

/** UNRESOLVED -> STORED. The reference is written here and never read back by any function in this module. */
export async function attachSlotReference(client: Queryable, slotId: string, store: SecretStore, reference: string): Promise<void> {
  await client.query(
    `UPDATE public.credential_secret_slots SET secret_state = 'STORED', secret_store = $2, secret_reference = $3, stored_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`,
    [slotId, store, reference],
  )
}

/** UNRESOLVED / STORED -> RETIRED. The stored reference stays untouched so the stored version can be destroyed and audited. */
export async function retireSlot(client: Queryable, slotId: string): Promise<void> {
  await client.query(`UPDATE public.credential_secret_slots SET secret_state = 'RETIRED', retired_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`, [slotId])
}
