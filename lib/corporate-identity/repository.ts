/**
 * Corporate Identity repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation, normalization or Master Register logic lives here; the operations layer owns those. Every
 * function takes the client the authorization wrapper checked out, so authorization and persistence share one connection
 * and one transaction. Nothing here issues DELETE (the runtime role has none) or touches identity-defining columns the
 * runtime role cannot update.
 */

import type { PoolClient } from "pg"
import { kindForPersistedType } from "@/lib/corporate-identity/identifier-definitions"
import type { PreparedCorporateIdentifier } from "@/lib/corporate-identity/identifier-definitions"
import type {
  AliasRecord,
  ClassificationRecord,
  IdentifierRecord,
  OrganizationRecord,
  OrganizationStatus,
} from "@/lib/corporate-identity/types"

export type Queryable = Pick<PoolClient, "query">

/** The unique index that is the authoritative collision backstop (migration 0003). */
export const IDENTIFIER_COLLISION_CONSTRAINT = "organization_identifiers_active_identity_uq"

type OrganizationRow = {
  id: string
  legal_name: string
  display_name: string | null
  normalized_legal_name: string
  status: OrganizationStatus
  country_code: string | null
  region_code: string | null
  merged_into_organization_id: string | null
  created_at: Date
  updated_at: Date
  archived_at: Date | null
}

type IdentifierRow = {
  id: string
  organization_id: string
  identifier_type: string
  namespace: string
  jurisdiction_country: string | null
  jurisdiction_region: string | null
  value: string
  normalized_value: string
  normalization_rule_version: string | null
  verification_status: string
  verified_at: Date | null
  status: "active" | "superseded"
  superseded_at: Date | null
  created_at: Date
}

type AliasRow = {
  id: string
  organization_id: string
  alias: string
  normalized_alias: string
  alias_type: string | null
  status: "active" | "inactive"
  created_at: Date
}

type ClassificationRow = {
  id: string
  organization_id: string
  classification_code: string
  is_primary: boolean
  effective_from: Date
  effective_to: Date | null
}

const ORGANIZATION_COLUMNS = `id, legal_name, display_name, normalized_legal_name, status, country_code, region_code,
  merged_into_organization_id, created_at, updated_at, archived_at`
const IDENTIFIER_COLUMNS = `id, organization_id, identifier_type, namespace, jurisdiction_country, jurisdiction_region,
  value, normalized_value, normalization_rule_version, verification_status, verified_at, status, superseded_at, created_at`
const ALIAS_COLUMNS = `id, organization_id, alias, normalized_alias, alias_type, status, created_at`
const CLASSIFICATION_COLUMNS = `id, organization_id, classification_code, is_primary, effective_from, effective_to`

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString())

export function toIdentifierRecord(row: IdentifierRow): IdentifierRecord {
  return {
    id: row.id,
    kind: kindForPersistedType(row.identifier_type, row.namespace) ?? null,
    identifierType: row.identifier_type,
    namespace: row.namespace,
    jurisdictionCountry: row.jurisdiction_country,
    jurisdictionRegion: row.jurisdiction_region,
    value: row.value,
    normalizedValue: row.normalized_value,
    normalizationRuleVersion: row.normalization_rule_version,
    verificationStatus: row.verification_status,
    verifiedAt: iso(row.verified_at),
    status: row.status,
    supersededAt: iso(row.superseded_at),
    createdAt: row.created_at.toISOString(),
  }
}

function toAliasRecord(row: AliasRow): AliasRecord {
  return {
    id: row.id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    aliasType: row.alias_type,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  }
}

function toClassificationRecord(row: ClassificationRow): ClassificationRecord {
  return {
    id: row.id,
    code: row.classification_code,
    isPrimary: row.is_primary,
    effectiveFrom: row.effective_from.toISOString(),
    effectiveTo: iso(row.effective_to),
  }
}

// --- organizations ------------------------------------------------------------------------------------------------

export type OrganizationCore = {
  id: string
  legalName: string
  displayName: string | null
  normalizedLegalName: string
  status: OrganizationStatus
  formationCountry: string | null
  formationRegion: string | null
  mergedIntoOrganizationId: string | null
}

function toCore(row: OrganizationRow): OrganizationCore {
  return {
    id: row.id,
    legalName: row.legal_name,
    displayName: row.display_name,
    normalizedLegalName: row.normalized_legal_name,
    status: row.status,
    formationCountry: row.country_code,
    formationRegion: row.region_code,
    mergedIntoOrganizationId: row.merged_into_organization_id,
  }
}

export async function insertOrganization(
  client: Queryable,
  values: {
    legalName: string
    displayName: string | null
    normalizedLegalName: string
    formationCountry: string | null
    formationRegion: string | null
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.organizations
       (legal_name, display_name, normalized_legal_name, country_code, region_code)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [values.legalName, values.displayName, values.normalizedLegalName, values.formationCountry, values.formationRegion],
  )
  return result.rows[0].id
}

/** Reads and row-locks the Organization so concurrent mutations of it serialize. */
export async function lockOrganization(client: Queryable, id: string): Promise<OrganizationCore | undefined> {
  const result = await client.query<OrganizationRow>(
    `SELECT ${ORGANIZATION_COLUMNS} FROM public.organizations WHERE id = $1 FOR UPDATE`,
    [id],
  )
  return result.rows[0] ? toCore(result.rows[0]) : undefined
}

export async function updateOrganizationIdentity(
  client: Queryable,
  id: string,
  values: {
    legalName: string
    displayName: string | null
    normalizedLegalName: string
    formationCountry: string | null
    formationRegion: string | null
  },
): Promise<void> {
  await client.query(
    `UPDATE public.organizations
        SET legal_name = $2, display_name = $3, normalized_legal_name = $4,
            country_code = $5, region_code = $6, updated_at = now()
      WHERE id = $1`,
    [id, values.legalName, values.displayName, values.normalizedLegalName, values.formationCountry, values.formationRegion],
  )
}

export async function archiveOrganizationRow(client: Queryable, id: string): Promise<void> {
  await client.query(
    `UPDATE public.organizations
        SET status = 'archived', archived_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [id],
  )
}

export async function restoreOrganizationRow(client: Queryable, id: string): Promise<void> {
  await client.query(
    `UPDATE public.organizations
        SET status = 'active', archived_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'archived'`,
    [id],
  )
}

// --- identifiers --------------------------------------------------------------------------------------------------

export type CollisionRow = {
  identifierId: string
  organizationId: string
  legalName: string
  displayName: string | null
  organizationStatus: OrganizationStatus
  mergedIntoOrganizationId: string | null
}

/**
 * The active identifier row holding this key, if any. The predicate mirrors the unique index expression for expression
 * (including NULL jurisdiction parts comparing equal), so a pre-check hit and a 23505 are the same condition.
 */
export async function findActiveIdentifierCollision(
  client: Queryable,
  prepared: PreparedCorporateIdentifier,
): Promise<CollisionRow | undefined> {
  const result = await client.query<{
    identifier_id: string
    organization_id: string
    legal_name: string
    display_name: string | null
    status: OrganizationStatus
    merged_into_organization_id: string | null
  }>(
    `SELECT oi.id AS identifier_id, o.id AS organization_id, o.legal_name, o.display_name, o.status,
            o.merged_into_organization_id
       FROM public.organization_identifiers oi
       JOIN public.organizations o ON o.id = oi.organization_id
      WHERE oi.status = 'active'
        AND lower(btrim(oi.namespace)) = lower(btrim($1))
        AND lower(btrim(oi.identifier_type)) = lower(btrim($2))
        AND upper(btrim(oi.jurisdiction_country)) IS NOT DISTINCT FROM upper(btrim($3::text))
        AND upper(btrim(oi.jurisdiction_region)) IS NOT DISTINCT FROM upper(btrim($4::text))
        AND oi.normalized_value = $5
      LIMIT 1`,
    [
      prepared.namespace,
      prepared.identifierType,
      prepared.jurisdictionCountry,
      prepared.jurisdictionRegion,
      prepared.normalizedValue,
    ],
  )
  const row = result.rows[0]
  if (!row) return undefined
  return {
    identifierId: row.identifier_id,
    organizationId: row.organization_id,
    legalName: row.legal_name,
    displayName: row.display_name,
    organizationStatus: row.status,
    mergedIntoOrganizationId: row.merged_into_organization_id,
  }
}

/** Superseded rows with the same key: review evidence, never a blocker. */
export async function findSupersededIdentifierMatches(
  client: Queryable,
  prepared: PreparedCorporateIdentifier,
): Promise<Array<{ organizationId: string; legalName: string }>> {
  const result = await client.query<{ organization_id: string; legal_name: string }>(
    `SELECT DISTINCT o.id AS organization_id, o.legal_name
       FROM public.organization_identifiers oi
       JOIN public.organizations o ON o.id = oi.organization_id
      WHERE oi.status = 'superseded'
        AND lower(btrim(oi.namespace)) = lower(btrim($1))
        AND lower(btrim(oi.identifier_type)) = lower(btrim($2))
        AND upper(btrim(oi.jurisdiction_country)) IS NOT DISTINCT FROM upper(btrim($3::text))
        AND upper(btrim(oi.jurisdiction_region)) IS NOT DISTINCT FROM upper(btrim($4::text))
        AND oi.normalized_value = $5`,
    [
      prepared.namespace,
      prepared.identifierType,
      prepared.jurisdictionCountry,
      prepared.jurisdictionRegion,
      prepared.normalizedValue,
    ],
  )
  return result.rows.map((row) => ({ organizationId: row.organization_id, legalName: row.legal_name }))
}

export async function insertIdentifier(
  client: Queryable,
  organizationId: string,
  prepared: PreparedCorporateIdentifier,
): Promise<IdentifierRecord> {
  const result = await client.query<IdentifierRow>(
    `INSERT INTO public.organization_identifiers
       (organization_id, identifier_type, namespace, jurisdiction_country, jurisdiction_region,
        value, normalized_value, normalization_rule_version, verification_status, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unverified', 'active')
     RETURNING ${IDENTIFIER_COLUMNS}`,
    [
      organizationId,
      prepared.identifierType,
      prepared.namespace,
      prepared.jurisdictionCountry,
      prepared.jurisdictionRegion,
      prepared.value,
      prepared.normalizedValue,
      prepared.normalizationRuleVersion,
    ],
  )
  return toIdentifierRecord(result.rows[0])
}

export async function getIdentifier(
  client: Queryable,
  organizationId: string,
  identifierId: string,
): Promise<IdentifierRecord | undefined> {
  const result = await client.query<IdentifierRow>(
    `SELECT ${IDENTIFIER_COLUMNS} FROM public.organization_identifiers WHERE id = $1 AND organization_id = $2`,
    [identifierId, organizationId],
  )
  return result.rows[0] ? toIdentifierRecord(result.rows[0]) : undefined
}

export async function supersedeIdentifierRow(client: Queryable, identifierId: string): Promise<void> {
  await client.query(
    `UPDATE public.organization_identifiers
        SET status = 'superseded', superseded_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [identifierId],
  )
}

export async function listIdentifiers(client: Queryable, organizationId: string): Promise<IdentifierRecord[]> {
  const result = await client.query<IdentifierRow>(
    `SELECT ${IDENTIFIER_COLUMNS} FROM public.organization_identifiers
      WHERE organization_id = $1 ORDER BY created_at, id`,
    [organizationId],
  )
  return result.rows.map(toIdentifierRecord)
}

// --- aliases ------------------------------------------------------------------------------------------------------

export async function insertAlias(
  client: Queryable,
  organizationId: string,
  values: { alias: string; normalizedAlias: string; aliasType: string },
): Promise<AliasRecord> {
  const result = await client.query<AliasRow>(
    `INSERT INTO public.organization_aliases (organization_id, alias, normalized_alias, alias_type, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING ${ALIAS_COLUMNS}`,
    [organizationId, values.alias, values.normalizedAlias, values.aliasType],
  )
  return toAliasRecord(result.rows[0])
}

export async function findActiveAlias(
  client: Queryable,
  organizationId: string,
  normalizedAlias: string,
  aliasType: string,
): Promise<AliasRecord | undefined> {
  const result = await client.query<AliasRow>(
    `SELECT ${ALIAS_COLUMNS} FROM public.organization_aliases
      WHERE organization_id = $1 AND normalized_alias = $2 AND alias_type = $3 AND status = 'active'`,
    [organizationId, normalizedAlias, aliasType],
  )
  return result.rows[0] ? toAliasRecord(result.rows[0]) : undefined
}

export async function getAlias(client: Queryable, organizationId: string, aliasId: string): Promise<AliasRecord | undefined> {
  const result = await client.query<AliasRow>(
    `SELECT ${ALIAS_COLUMNS} FROM public.organization_aliases WHERE id = $1 AND organization_id = $2`,
    [aliasId, organizationId],
  )
  return result.rows[0] ? toAliasRecord(result.rows[0]) : undefined
}

export async function deactivateAliasRow(client: Queryable, aliasId: string): Promise<void> {
  await client.query(
    `UPDATE public.organization_aliases SET status = 'inactive', updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [aliasId],
  )
}

export async function listAliases(client: Queryable, organizationId: string): Promise<AliasRecord[]> {
  const result = await client.query<AliasRow>(
    `SELECT ${ALIAS_COLUMNS} FROM public.organization_aliases WHERE organization_id = $1 ORDER BY created_at, id`,
    [organizationId],
  )
  return result.rows.map(toAliasRecord)
}

// --- classifications ----------------------------------------------------------------------------------------------

export async function isActiveClassificationCode(client: Queryable, code: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.organization_classification_types WHERE code = $1 AND is_active`,
    [code],
  )
  return result.rowCount === 1
}

export async function insertClassification(
  client: Queryable,
  organizationId: string,
  code: string,
  isPrimary: boolean,
): Promise<ClassificationRecord> {
  const result = await client.query<ClassificationRow>(
    `INSERT INTO public.organization_classifications (organization_id, classification_code, is_primary)
     VALUES ($1, $2, $3)
     RETURNING ${CLASSIFICATION_COLUMNS}`,
    [organizationId, code, isPrimary],
  )
  return toClassificationRecord(result.rows[0])
}

export async function findCurrentClassification(
  client: Queryable,
  organizationId: string,
  code: string,
): Promise<ClassificationRecord | undefined> {
  const result = await client.query<ClassificationRow>(
    `SELECT ${CLASSIFICATION_COLUMNS} FROM public.organization_classifications
      WHERE organization_id = $1 AND classification_code = $2 AND effective_to IS NULL`,
    [organizationId, code],
  )
  return result.rows[0] ? toClassificationRecord(result.rows[0]) : undefined
}

export async function getClassification(
  client: Queryable,
  organizationId: string,
  classificationId: string,
): Promise<ClassificationRecord | undefined> {
  const result = await client.query<ClassificationRow>(
    `SELECT ${CLASSIFICATION_COLUMNS} FROM public.organization_classifications
      WHERE id = $1 AND organization_id = $2`,
    [classificationId, organizationId],
  )
  return result.rows[0] ? toClassificationRecord(result.rows[0]) : undefined
}

export async function endClassificationRow(client: Queryable, classificationId: string): Promise<void> {
  // is_primary is cleared with the end date so an ended row never claims to be primary.
  await client.query(
    `UPDATE public.organization_classifications
        SET effective_to = GREATEST(now(), effective_from), is_primary = false, updated_at = now()
      WHERE id = $1 AND effective_to IS NULL`,
    [classificationId],
  )
}

export async function clearCurrentPrimaryClassification(client: Queryable, organizationId: string): Promise<string | undefined> {
  const result = await client.query<{ id: string }>(
    `UPDATE public.organization_classifications SET is_primary = false, updated_at = now()
      WHERE organization_id = $1 AND is_primary AND effective_to IS NULL
      RETURNING id`,
    [organizationId],
  )
  return result.rows[0]?.id
}

export async function setPrimaryClassificationRow(client: Queryable, classificationId: string): Promise<void> {
  await client.query(
    `UPDATE public.organization_classifications SET is_primary = true, updated_at = now()
      WHERE id = $1 AND effective_to IS NULL`,
    [classificationId],
  )
}

export async function listClassifications(client: Queryable, organizationId: string): Promise<ClassificationRecord[]> {
  const result = await client.query<ClassificationRow>(
    `SELECT ${CLASSIFICATION_COLUMNS} FROM public.organization_classifications
      WHERE organization_id = $1 ORDER BY effective_from, id`,
    [organizationId],
  )
  return result.rows.map(toClassificationRecord)
}

// --- read model ---------------------------------------------------------------------------------------------------

function derivePrimaryRegistration(
  core: OrganizationCore,
  identifiers: IdentifierRecord[],
): IdentifierRecord | null {
  if (core.formationCountry === null) return null
  return (
    identifiers.find(
      (identifier) =>
        identifier.status === "active" &&
        identifier.kind === "INCORPORATION" &&
        identifier.jurisdictionCountry === core.formationCountry &&
        identifier.jurisdictionRegion === core.formationRegion,
    ) ?? null
  )
}

export async function loadOrganization(client: Queryable, id: string): Promise<OrganizationRecord | undefined> {
  const result = await client.query<OrganizationRow>(
    `SELECT ${ORGANIZATION_COLUMNS} FROM public.organizations WHERE id = $1`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return undefined

  const core = toCore(row)
  const [identifiers, aliases, classifications] = await Promise.all([
    listIdentifiers(client, id),
    listAliases(client, id),
    listClassifications(client, id),
  ])

  return {
    id: core.id,
    legalName: core.legalName,
    displayName: core.displayName,
    normalizedLegalName: core.normalizedLegalName,
    status: core.status,
    formationCountry: core.formationCountry,
    formationRegion: core.formationRegion,
    mergedIntoOrganizationId: core.mergedIntoOrganizationId,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: iso(row.archived_at),
    identifiers,
    aliases,
    classifications,
    primaryRegistration: derivePrimaryRegistration(core, identifiers),
  }
}

/** The Organization behind one Customer. Under a CUSTOMER wrapper, row-level security limits `customers` to that tenant. */
export async function loadCustomerOrganizationId(client: Queryable, customerId: string): Promise<string | undefined> {
  const result = await client.query<{ organization_id: string }>(
    `SELECT organization_id FROM public.customers WHERE id = $1`,
    [customerId],
  )
  return result.rows[0]?.organization_id
}
