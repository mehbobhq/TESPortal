/**
 * Contacts repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation, normalization or Master Register logic lives here. Every function takes the client the
 * authorization wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing
 * here issues DELETE (the runtime role has none).
 *
 * Business time is passed and returned as text with microsecond precision, because a JS Date would truncate to
 * milliseconds and could reorder two writes made within the same millisecond.
 *
 * Lock order (documented once, used by every operation): Organization row, then person row, then relationship row, then
 * dependents. See operations.ts.
 */

import type { PoolClient } from "pg"
import type { ChannelType, ContactPurpose, OrganizationChannelUsage } from "@/lib/contacts/definitions"
import type {
  ChangeReason,
  ChannelRecord,
  ContactRecordStatus,
  NameRecord,
  PersonRecord,
  PurposeAssignmentRecord,
  RelationshipRecord,
  TitleRecord,
} from "@/lib/contacts/types"

export type Queryable = Pick<PoolClient, "query">

export const CURRENT_RELATIONSHIP_CONSTRAINT = "organization_person_relationships_current_uq"
export const CURRENT_NAME_CONSTRAINT = "person_name_versions_current_uq"
export const CURRENT_PERSON_CHANNEL_CONSTRAINT = "person_channels_current_value_uq"
export const PREFERRED_PERSON_CHANNEL_CONSTRAINT = "person_channels_current_preferred_uq"
export const CURRENT_ORGANIZATION_CHANNEL_CONSTRAINT = "organization_channels_current_value_uq"
export const PREFERRED_ORGANIZATION_CHANNEL_CONSTRAINT = "organization_channels_current_preferred_uq"
export const CURRENT_TITLE_CONSTRAINT = "organization_person_titles_current_uq"
export const CURRENT_ASSIGNMENT_CONSTRAINT = "contact_purpose_assignments_current_uq"
export const CURRENT_PRIMARY_CONSTRAINT = "contact_purpose_assignments_current_primary_uq"
export const WINDOW_CONSTRAINTS = [
  "person_name_versions_effective_window_valid",
  "person_channels_effective_window_valid",
  "organization_channels_effective_window_valid",
  "organization_person_relationships_effective_window_valid",
  "organization_person_titles_effective_window_valid",
  "contact_purpose_assignments_effective_window_valid",
] as const
export const PERSON_ACTIVE_CONSTRAINT = "contact_records_person_active"
export const ORGANIZATION_ACTIVE_CONSTRAINTS = [
  "organization_channels_organization_active",
  "organization_person_relationships_organization_active",
] as const
export const RELATIONSHIP_WINDOW_CONSTRAINT = "contact_records_relationship_window"
export const PURPOSE_RULES_CONSTRAINT = "contact_purpose_assignments_purpose_rules"
export const ARCHIVE_BLOCKED_CONSTRAINT = "persons_archive_requires_no_current_relationship"
export const DEPENDENTS_BLOCK_CONSTRAINTS = [
  "organization_person_relationships_dependents_block_void",
  "organization_person_relationships_dependents_block_end",
] as const

const MICRO_ISO = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const MICRO_ISO_NULL = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL ELSE ${MICRO_ISO(column)} END`

/** Tables that follow the effective-dated lifecycle (end / correct / void). */
export type PeriodTable =
  | "person_name_versions"
  | "person_channels"
  | "organization_channels"
  | "organization_person_titles"
  | "contact_purpose_assignments"
  | "organization_person_relationships"

// --- clock --------------------------------------------------------------------------------------------------------

export async function databaseNow(client: Queryable): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

export async function isNotInFuture(client: Queryable, instant: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::timestamptz <= clock_timestamp() AS ok`, [instant])
  return result.rows[0].ok
}

// --- organizations and persons -------------------------------------------------------------------------------------

/** Row-locks the Organization so concurrent contact writers for it serialize (lock order step 1). */
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

export async function loadCustomerOrganizationId(client: Queryable, customerId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(
    `SELECT organization_id FROM public.customers WHERE id = $1`,
    [customerId],
  )
  return result.rows[0]?.organization_id
}

/** Row-locks the person (lock order step 2). */
export async function lockPerson(client: Queryable, personId: string): Promise<PersonRecord | undefined> {
  const result = await client.query(
    `SELECT id, record_status, ${MICRO_ISO_NULL("archived_at")} AS archived_at, ${MICRO_ISO("created_at")} AS created_at
       FROM public.persons WHERE id = $1 FOR UPDATE`,
    [personId],
  )
  return result.rows[0] ? mapPerson(result.rows[0]) : undefined
}

export async function insertPerson(client: Queryable, id: string): Promise<void> {
  await client.query(`INSERT INTO public.persons (id) VALUES ($1)`, [id])
}

export async function setPersonRecordStatus(client: Queryable, personId: string, status: "active" | "archived"): Promise<void> {
  await client.query(
    `UPDATE public.persons
        SET record_status = $2::text,
            archived_at = CASE WHEN $2::text = 'archived' THEN clock_timestamp() ELSE NULL END,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [personId, status],
  )
}

/** Whether the person has ever been related (non-voided) to the Organization: the visibility test without registry read. */
export async function personRelatedToOrganization(client: Queryable, organizationId: string, personId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.organization_person_relationships
      WHERE organization_id = $1 AND person_id = $2 AND record_status = 'active' LIMIT 1`,
    [organizationId, personId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function personExists(client: Queryable, personId: string): Promise<boolean> {
  return ((await client.query(`SELECT 1 FROM public.persons WHERE id = $1`, [personId])).rowCount ?? 0) > 0
}

// --- generic period lifecycle ---------------------------------------------------------------------------------------

/** Real-world end: sets effective_to on a genuine, still-open row. Returns false when no such row exists. */
export async function endPeriod(client: Queryable, table: PeriodTable, id: string, at: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE public.${table}
        SET effective_to = $2::timestamptz, updated_at = clock_timestamp()
      WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL`,
    [id, at],
  )
  return (result.rowCount ?? 0) > 0
}

/** Correction (with a replacement) or void (without): marks a genuine row, never ends it. */
export async function markPeriod(
  client: Queryable,
  table: PeriodTable,
  id: string,
  status: "corrected" | "voided",
  replacementId: string | null,
): Promise<boolean> {
  const sets = table === "organization_person_relationships"
    ? `record_status = $2, corrected_at = clock_timestamp(), updated_at = clock_timestamp()`
    : `record_status = $2, corrected_at = clock_timestamp(), superseded_by_id = $3::uuid, updated_at = clock_timestamp()`
  const params = table === "organization_person_relationships" ? [id, status] : [id, status, replacementId]
  const result = await client.query(`UPDATE public.${table} SET ${sets} WHERE id = $1 AND record_status = 'active'`, params)
  return (result.rowCount ?? 0) > 0
}

// --- inserts ---------------------------------------------------------------------------------------------------------

export async function insertName(
  client: Queryable,
  row: { id: string; personId: string; givenName: string | null; familyName: string | null; normalized: string; reason: ChangeReason; effectiveFrom: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.person_name_versions (id, person_id, given_name, family_name, name_normalized, change_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [row.id, row.personId, row.givenName, row.familyName, row.normalized, row.reason, row.effectiveFrom],
  )
}

export async function insertPersonChannel(
  client: Queryable,
  row: {
    id: string
    personId: string
    channelType: ChannelType
    display: string
    normalized: string
    ruleVersion: string
    extension: string | null
    preferred: boolean
    reason: ChangeReason
    effectiveFrom: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.person_channels
       (id, person_id, channel_type, value_display, value_normalized, normalization_rule_version, extension, is_preferred, change_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
    [row.id, row.personId, row.channelType, row.display, row.normalized, row.ruleVersion, row.extension, row.preferred, row.reason, row.effectiveFrom],
  )
}

export async function insertOrganizationChannel(
  client: Queryable,
  row: {
    id: string
    organizationId: string
    channelType: ChannelType
    usage: OrganizationChannelUsage
    display: string
    normalized: string
    ruleVersion: string
    extension: string | null
    preferred: boolean
    reason: ChangeReason
    effectiveFrom: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.organization_channels
       (id, organization_id, channel_type, channel_usage, value_display, value_normalized, normalization_rule_version, extension, is_preferred, change_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)`,
    [row.id, row.organizationId, row.channelType, row.usage, row.display, row.normalized, row.ruleVersion, row.extension, row.preferred, row.reason, row.effectiveFrom],
  )
}

export async function insertRelationship(
  client: Queryable,
  row: { id: string; organizationId: string; personId: string; effectiveFrom: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.organization_person_relationships (id, organization_id, person_id, effective_from)
     VALUES ($1, $2, $3, $4::timestamptz)`,
    [row.id, row.organizationId, row.personId, row.effectiveFrom],
  )
}

export async function insertTitle(
  client: Queryable,
  row: { id: string; relationshipId: string; organizationId: string; personId: string; display: string; normalized: string; reason: ChangeReason; effectiveFrom: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.organization_person_titles
       (id, relationship_id, organization_id, person_id, title_display, title_normalized, change_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [row.id, row.relationshipId, row.organizationId, row.personId, row.display, row.normalized, row.reason, row.effectiveFrom],
  )
}

export async function insertAssignment(
  client: Queryable,
  row: { id: string; relationshipId: string; organizationId: string; personId: string; purpose: ContactPurpose; primary: boolean; reason: ChangeReason; effectiveFrom: string },
): Promise<void> {
  await client.query(
    `INSERT INTO public.contact_purpose_assignments
       (id, relationship_id, organization_id, person_id, purpose_code, is_primary, change_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [row.id, row.relationshipId, row.organizationId, row.personId, row.purpose, row.primary, row.reason, row.effectiveFrom],
  )
}

// --- row mappers -----------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>

function mapPerson(row: Row): PersonRecord {
  return {
    id: row.id as string,
    recordStatus: row.record_status as PersonRecord["recordStatus"],
    archivedAt: (row.archived_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }
}

const period = (row: Row) => ({
  id: row.id as string,
  changeReason: row.change_reason as ChangeReason,
  effectiveFrom: row.effective_from as string,
  effectiveTo: (row.effective_to as string | null) ?? null,
  recordStatus: row.record_status as ContactRecordStatus,
  correctedAt: (row.corrected_at as string | null) ?? null,
  supersededById: (row.superseded_by_id as string | null) ?? null,
  createdAt: row.created_at as string,
})

const PERIOD_COLUMNS = `id, change_reason, record_status,
       ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to,
       ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, superseded_by_id, ${MICRO_ISO("created_at")} AS created_at`

function mapName(row: Row): NameRecord {
  return { ...period(row), personId: row.person_id as string, givenName: (row.given_name as string | null) ?? null, familyName: (row.family_name as string | null) ?? null }
}

function mapChannel(row: Row, ownerType: "PERSON" | "ORGANIZATION"): ChannelRecord {
  return {
    ...period(row),
    ownerType,
    ownerId: (ownerType === "PERSON" ? row.person_id : row.organization_id) as string,
    channelType: row.channel_type as ChannelType,
    usage: (row.channel_usage as OrganizationChannelUsage | null | undefined) ?? null,
    valueDisplay: row.value_display as string,
    valueNormalized: row.value_normalized as string,
    normalizationRuleVersion: row.normalization_rule_version as string,
    extension: (row.extension as string | null) ?? null,
    isPreferred: row.is_preferred as boolean,
  }
}

function mapRelationship(row: Row): RelationshipRecord {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    personId: row.person_id as string,
    effectiveFrom: row.effective_from as string,
    effectiveTo: (row.effective_to as string | null) ?? null,
    recordStatus: row.record_status as RelationshipRecord["recordStatus"],
    correctedAt: (row.corrected_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }
}

function mapTitle(row: Row): TitleRecord {
  return { ...period(row), relationshipId: row.relationship_id as string, titleDisplay: row.title_display as string }
}

function mapAssignment(row: Row): PurposeAssignmentRecord {
  return { ...period(row), relationshipId: row.relationship_id as string, purpose: row.purpose_code as ContactPurpose, isPrimary: row.is_primary as boolean }
}

// --- single-row reads (optionally locking) -----------------------------------------------------------------------

const RELATIONSHIP_COLUMNS = `id, organization_id, person_id, record_status,
       ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO_NULL("effective_to")} AS effective_to,
       ${MICRO_ISO_NULL("corrected_at")} AS corrected_at, ${MICRO_ISO("created_at")} AS created_at`

export async function getRelationship(
  client: Queryable,
  organizationId: string,
  relationshipId: string,
  forUpdate = false,
): Promise<RelationshipRecord | undefined> {
  const result = await client.query(
    `SELECT ${RELATIONSHIP_COLUMNS} FROM public.organization_person_relationships
      WHERE id = $1 AND organization_id = $2 ${forUpdate ? "FOR UPDATE" : ""}`,
    [relationshipId, organizationId],
  )
  return result.rows[0] ? mapRelationship(result.rows[0]) : undefined
}

export async function getCurrentRelationship(
  client: Queryable,
  organizationId: string,
  personId: string,
  forUpdate = false,
): Promise<RelationshipRecord | undefined> {
  const result = await client.query(
    `SELECT ${RELATIONSHIP_COLUMNS} FROM public.organization_person_relationships
      WHERE organization_id = $1 AND person_id = $2 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [organizationId, personId],
  )
  return result.rows[0] ? mapRelationship(result.rows[0]) : undefined
}

export async function getCurrentName(client: Queryable, personId: string, forUpdate = false): Promise<NameRecord | undefined> {
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, person_id, given_name, family_name FROM public.person_name_versions
      WHERE person_id = $1 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [personId],
  )
  return result.rows[0] ? mapName(result.rows[0]) : undefined
}

const PERSON_CHANNEL_COLUMNS = `${PERIOD_COLUMNS}, person_id, channel_type, NULL::text AS channel_usage, value_display, value_normalized, normalization_rule_version, extension, is_preferred`
const ORG_CHANNEL_COLUMNS = `${PERIOD_COLUMNS}, organization_id, channel_type, channel_usage, value_display, value_normalized, normalization_rule_version, extension, is_preferred`

/** A genuine, open person channel owned by the person (locks it when asked). */
export async function getOpenPersonChannel(client: Queryable, personId: string, channelId: string, forUpdate = false): Promise<ChannelRecord | undefined> {
  const result = await client.query(
    `SELECT ${PERSON_CHANNEL_COLUMNS} FROM public.person_channels
      WHERE id = $1 AND person_id = $2 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [channelId, personId],
  )
  return result.rows[0] ? mapChannel(result.rows[0], "PERSON") : undefined
}

export async function getOpenOrganizationChannel(client: Queryable, organizationId: string, channelId: string, forUpdate = false): Promise<ChannelRecord | undefined> {
  const result = await client.query(
    `SELECT ${ORG_CHANNEL_COLUMNS} FROM public.organization_channels
      WHERE id = $1 AND organization_id = $2 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [channelId, organizationId],
  )
  return result.rows[0] ? mapChannel(result.rows[0], "ORGANIZATION") : undefined
}

export async function getOpenTitle(client: Queryable, organizationId: string, titleId: string, forUpdate = false): Promise<TitleRecord | undefined> {
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, title_display FROM public.organization_person_titles
      WHERE id = $1 AND organization_id = $2 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [titleId, organizationId],
  )
  return result.rows[0] ? mapTitle(result.rows[0]) : undefined
}

export async function getOpenAssignment(client: Queryable, organizationId: string, assignmentId: string, forUpdate = false): Promise<PurposeAssignmentRecord | undefined> {
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, purpose_code, is_primary FROM public.contact_purpose_assignments
      WHERE id = $1 AND organization_id = $2 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [assignmentId, organizationId],
  )
  return result.rows[0] ? mapAssignment(result.rows[0]) : undefined
}

export async function getOpenAssignmentFor(client: Queryable, relationshipId: string, purpose: ContactPurpose, forUpdate = false): Promise<PurposeAssignmentRecord | undefined> {
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, purpose_code, is_primary FROM public.contact_purpose_assignments
      WHERE relationship_id = $1 AND purpose_code = $2 AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [relationshipId, purpose],
  )
  return result.rows[0] ? mapAssignment(result.rows[0]) : undefined
}

export async function getCurrentPrimary(client: Queryable, organizationId: string, purpose: ContactPurpose, forUpdate = false): Promise<PurposeAssignmentRecord | undefined> {
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, purpose_code, is_primary FROM public.contact_purpose_assignments
      WHERE organization_id = $1 AND purpose_code = $2 AND is_primary AND record_status = 'active' AND effective_to IS NULL ${forUpdate ? "FOR UPDATE" : ""}`,
    [organizationId, purpose],
  )
  return result.rows[0] ? mapAssignment(result.rows[0]) : undefined
}

/** Open genuine dependents of a relationship (for ending / voiding it together). */
export async function listOpenDependents(
  client: Queryable,
  relationshipId: string,
): Promise<{ titles: TitleRecord[]; assignments: PurposeAssignmentRecord[] }> {
  const titles = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, title_display FROM public.organization_person_titles
      WHERE relationship_id = $1 AND record_status = 'active' AND effective_to IS NULL FOR UPDATE`,
    [relationshipId],
  )
  const assignments = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, purpose_code, is_primary FROM public.contact_purpose_assignments
      WHERE relationship_id = $1 AND record_status = 'active' AND effective_to IS NULL FOR UPDATE`,
    [relationshipId],
  )
  return { titles: titles.rows.map(mapTitle), assignments: assignments.rows.map(mapAssignment) }
}

/** Genuine dependents that may be ended by a relationship end at `at` but still run past it (for voiding, all of them). */
export async function listActiveDependentIds(client: Queryable, relationshipId: string): Promise<{ titleIds: string[]; assignmentIds: string[] }> {
  const titles = await client.query<{ id: string }>(
    `SELECT id FROM public.organization_person_titles WHERE relationship_id = $1 AND record_status = 'active' FOR UPDATE`,
    [relationshipId],
  )
  const assignments = await client.query<{ id: string }>(
    `SELECT id FROM public.contact_purpose_assignments WHERE relationship_id = $1 AND record_status = 'active' FOR UPDATE`,
    [relationshipId],
  )
  return { titleIds: titles.rows.map((row) => row.id), assignmentIds: assignments.rows.map((row) => row.id) }
}

// --- list reads ------------------------------------------------------------------------------------------------------

export async function listPersons(client: Queryable, personIds: string[]): Promise<Map<string, PersonRecord>> {
  if (personIds.length === 0) return new Map()
  const result = await client.query(
    `SELECT id, record_status, ${MICRO_ISO_NULL("archived_at")} AS archived_at, ${MICRO_ISO("created_at")} AS created_at
       FROM public.persons WHERE id = ANY($1::uuid[])`,
    [personIds],
  )
  return new Map(result.rows.map((row) => [row.id as string, mapPerson(row)]))
}

export async function listNames(client: Queryable, personIds: string[]): Promise<Map<string, NameRecord[]>> {
  const map = new Map<string, NameRecord[]>()
  if (personIds.length === 0) return map
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, person_id, given_name, family_name FROM public.person_name_versions
      WHERE person_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [personIds],
  )
  for (const row of result.rows) {
    const record = mapName(row)
    map.set(record.personId, [...(map.get(record.personId) ?? []), record])
  }
  return map
}

export async function listPersonChannels(client: Queryable, personIds: string[]): Promise<Map<string, ChannelRecord[]>> {
  const map = new Map<string, ChannelRecord[]>()
  if (personIds.length === 0) return map
  const result = await client.query(
    `SELECT ${PERSON_CHANNEL_COLUMNS} FROM public.person_channels
      WHERE person_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [personIds],
  )
  for (const row of result.rows) {
    const record = mapChannel(row, "PERSON")
    map.set(record.ownerId, [...(map.get(record.ownerId) ?? []), record])
  }
  return map
}

export async function listOrganizationChannels(client: Queryable, organizationId: string): Promise<ChannelRecord[]> {
  const result = await client.query(
    `SELECT ${ORG_CHANNEL_COLUMNS} FROM public.organization_channels
      WHERE organization_id = $1 ORDER BY effective_from, created_at, id`,
    [organizationId],
  )
  return result.rows.map((row) => mapChannel(row, "ORGANIZATION"))
}

export async function listRelationships(client: Queryable, organizationId: string): Promise<RelationshipRecord[]> {
  const result = await client.query(
    `SELECT ${RELATIONSHIP_COLUMNS} FROM public.organization_person_relationships
      WHERE organization_id = $1 ORDER BY effective_from, created_at, id`,
    [organizationId],
  )
  return result.rows.map(mapRelationship)
}

export async function listPersonRelationships(client: Queryable, personId: string): Promise<RelationshipRecord[]> {
  const result = await client.query(
    `SELECT ${RELATIONSHIP_COLUMNS} FROM public.organization_person_relationships
      WHERE person_id = $1 ORDER BY effective_from, created_at, id`,
    [personId],
  )
  return result.rows.map(mapRelationship)
}

export async function listTitles(client: Queryable, relationshipIds: string[]): Promise<Map<string, TitleRecord[]>> {
  const map = new Map<string, TitleRecord[]>()
  if (relationshipIds.length === 0) return map
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, title_display FROM public.organization_person_titles
      WHERE relationship_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [relationshipIds],
  )
  for (const row of result.rows) {
    const record = mapTitle(row)
    map.set(record.relationshipId, [...(map.get(record.relationshipId) ?? []), record])
  }
  return map
}

export async function listAssignments(client: Queryable, relationshipIds: string[]): Promise<Map<string, PurposeAssignmentRecord[]>> {
  const map = new Map<string, PurposeAssignmentRecord[]>()
  if (relationshipIds.length === 0) return map
  const result = await client.query(
    `SELECT ${PERIOD_COLUMNS}, relationship_id, purpose_code, is_primary FROM public.contact_purpose_assignments
      WHERE relationship_id = ANY($1::uuid[]) ORDER BY effective_from, created_at, id`,
    [relationshipIds],
  )
  for (const row of result.rows) {
    const record = mapAssignment(row)
    map.set(record.relationshipId, [...(map.get(record.relationshipId) ?? []), record])
  }
  return map
}

// --- advisory matching -----------------------------------------------------------------------------------------------

/** Persons whose CURRENT genuine name has the normalized form. Advisory: never unique, never a merge. */
export async function findPersonIdsByName(client: Queryable, normalized: string): Promise<string[]> {
  const result = await client.query<{ person_id: string }>(
    `SELECT person_id FROM public.person_name_versions
      WHERE name_normalized = $1 AND record_status = 'active' AND effective_to IS NULL LIMIT 50`,
    [normalized],
  )
  return result.rows.map((row) => row.person_id)
}

export async function findPersonIdsByChannel(client: Queryable, channelType: ChannelType, normalized: string): Promise<string[]> {
  const result = await client.query<{ person_id: string }>(
    `SELECT DISTINCT person_id FROM public.person_channels
      WHERE channel_type = $1 AND value_normalized = $2 AND record_status = 'active' AND effective_to IS NULL LIMIT 50`,
    [channelType, normalized],
  )
  return result.rows.map((row) => row.person_id)
}

/** Organizations with a genuine relationship (current or past) to each person. */
export async function listPersonOrganizationIds(client: Queryable, personIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (personIds.length === 0) return map
  const result = await client.query<{ person_id: string; organization_id: string }>(
    `SELECT DISTINCT person_id, organization_id FROM public.organization_person_relationships
      WHERE person_id = ANY($1::uuid[]) AND record_status = 'active'`,
    [personIds],
  )
  for (const row of result.rows) map.set(row.person_id, [...(map.get(row.person_id) ?? []), row.organization_id])
  return map
}

export async function organizationExists(client: Queryable, organizationId: string): Promise<boolean> {
  return ((await client.query(`SELECT 1 FROM public.organizations WHERE id = $1`, [organizationId])).rowCount ?? 0) > 0
}
