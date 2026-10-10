/**
 * Organization Location repository: SQL only, on a caller-supplied transaction client.
 *
 * No authorization, validation, normalization or Master Register logic lives here. Every function takes the client the
 * authorization wrapper checked out, so authorization and persistence share one connection and one transaction. Nothing
 * here issues DELETE (the runtime role has none).
 *
 * Business time is passed and returned as text with microsecond precision where ordering matters, because a JS Date would
 * truncate to milliseconds and could reorder two writes made within the same millisecond.
 */

import type { PoolClient } from "pg"
import type { PreparedAddress } from "@/lib/organization-locations/address-normalization"
import type {
  AddressRecord,
  AssignmentRecord,
  AssignmentRole,
  LocationKind,
  LocationRecord,
  LocationStatus,
} from "@/lib/organization-locations/types"

export type Queryable = Pick<PoolClient, "query">

export const CURRENT_ROLE_CONSTRAINT = "organization_location_assignments_current_role_uq"
export const ARCHIVE_BLOCKED_CONSTRAINT = "locations_archive_requires_no_current_assignment"
export const LOCATION_NOT_ACTIVE_CONSTRAINT = "organization_location_assignments_location_active"
export const ASSIGNMENT_WINDOW_CONSTRAINT = "organization_location_assignments_effective_window_valid"
export const ADDRESS_WINDOW_CONSTRAINT = "location_addresses_effective_window_valid"
export const CURRENT_ADDRESS_CONSTRAINT = "location_addresses_current_uq"

const MICRO_ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

type AddressRow = {
  id: string
  location_id: string
  country_code: string
  region_code: string
  locality: string
  postal_code: string | null
  address_line_1: string
  address_line_2: string | null
  unit: string | null
  version_reason: AddressRecord["versionReason"]
  effective_from: string
  effective_to: string | null
  status: AddressRecord["status"]
  corrected_at: string | null
  superseded_by_address_id: string | null
  created_at: string
}

const ADDRESS_COLUMNS = `id, location_id, country_code, region_code, locality, postal_code, address_line_1, address_line_2,
  unit, version_reason, ${MICRO_ISO("effective_from")} AS effective_from, ${MICRO_ISO("effective_to")} AS effective_to,
  status, ${MICRO_ISO("corrected_at")} AS corrected_at, superseded_by_address_id, ${MICRO_ISO("created_at")} AS created_at`

function toAddress(row: AddressRow): AddressRecord {
  return {
    id: row.id,
    locationId: row.location_id,
    country: row.country_code,
    region: row.region_code,
    locality: row.locality,
    postalCode: row.postal_code,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    unit: row.unit,
    versionReason: row.version_reason,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    correctedAt: row.corrected_at,
    supersededByAddressId: row.superseded_by_address_id,
    createdAt: row.created_at,
  }
}

type LocationRow = {
  id: string
  kind: LocationKind
  status: LocationStatus
  archived_at: string | null
  created_at: string
}

const LOCATION_COLUMNS = `id, kind, status, ${MICRO_ISO("archived_at")} AS archived_at, ${MICRO_ISO("created_at")} AS created_at`

export type LocationCore = Omit<LocationRecord, "currentAddress">

const toLocationCore = (row: LocationRow): LocationCore => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
})

type AssignmentRow = {
  id: string
  organization_id: string
  location_id: string
  role: AssignmentRole
  effective_from: string
  effective_to: string | null
  end_reason: AssignmentRecord["endReason"]
  status: AssignmentRecord["status"]
  corrected_at: string | null
  superseded_by_assignment_id: string | null
  created_at: string
}

const ASSIGNMENT_COLUMNS = `id, organization_id, location_id, role, ${MICRO_ISO("effective_from")} AS effective_from,
  ${MICRO_ISO("effective_to")} AS effective_to, end_reason, status, ${MICRO_ISO("corrected_at")} AS corrected_at,
  superseded_by_assignment_id, ${MICRO_ISO("created_at")} AS created_at`

const toAssignment = (row: AssignmentRow): AssignmentRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  locationId: row.location_id,
  role: row.role,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  endReason: row.end_reason,
  status: row.status,
  correctedAt: row.corrected_at,
  supersededByAssignmentId: row.superseded_by_assignment_id,
  createdAt: row.created_at,
})

// --- clock --------------------------------------------------------------------------------------------------------

/** The database clock (not transaction start) as a microsecond ISO instant: later writes always sort after earlier ones. */
export async function databaseNow(client: Queryable): Promise<string> {
  const result = await client.query<{ now: string }>(`SELECT ${MICRO_ISO("clock_timestamp()")} AS now`)
  return result.rows[0].now
}

/** True when `instant` is not after the database clock. */
export async function isNotInFuture(client: Queryable, instant: string): Promise<boolean> {
  const result = await client.query<{ ok: boolean }>(`SELECT $1::timestamptz <= clock_timestamp() AS ok`, [instant])
  return result.rows[0].ok
}

// --- organizations ------------------------------------------------------------------------------------------------

/** Row-locks the Organization so concurrent role changes for it serialize. */
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

// --- locations ----------------------------------------------------------------------------------------------------

export async function insertLocation(client: Queryable, kind: LocationKind): Promise<string> {
  const result = await client.query<{ id: string }>(`INSERT INTO public.locations (kind) VALUES ($1) RETURNING id`, [kind])
  return result.rows[0].id
}

export async function getLocation(client: Queryable, locationId: string, lock: "none" | "update" = "none"): Promise<LocationCore | undefined> {
  const result = await client.query<LocationRow>(
    `SELECT ${LOCATION_COLUMNS} FROM public.locations WHERE id = $1${lock === "update" ? " FOR UPDATE" : ""}`,
    [locationId],
  )
  return result.rows[0] ? toLocationCore(result.rows[0]) : undefined
}

export async function setLocationStatus(client: Queryable, locationId: string, status: LocationStatus): Promise<void> {
  await client.query(
    `UPDATE public.locations
        SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1`,
    [locationId, status],
  )
}

// --- address versions ---------------------------------------------------------------------------------------------

export async function insertAddressVersion(
  client: Queryable,
  values: {
    id: string
    locationId: string
    address: PreparedAddress
    versionReason: AddressRecord["versionReason"]
    effectiveFrom: string
  },
): Promise<AddressRecord> {
  const a = values.address
  const result = await client.query<AddressRow>(
    `INSERT INTO public.location_addresses
       (id, location_id, country_code, region_code, locality, postal_code, postal_code_normalized, address_line_1,
        address_line_2, unit, match_key_building, match_key_unit, version_reason, effective_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz)
     RETURNING ${ADDRESS_COLUMNS}`,
    [
      values.id,
      values.locationId,
      a.countryCode,
      a.regionCode,
      a.locality,
      a.postalCode,
      a.postalCodeNormalized,
      a.addressLine1,
      a.addressLine2,
      a.unit,
      a.matchKeyBuilding,
      a.matchKeyUnit,
      values.versionReason,
      values.effectiveFrom,
    ],
  )
  return toAddress(result.rows[0])
}

/** The current address version: active and open-ended. Locked when `lock` is set. */
export async function getCurrentAddress(client: Queryable, locationId: string, lock = false): Promise<AddressRecord | undefined> {
  const result = await client.query<AddressRow>(
    `SELECT ${ADDRESS_COLUMNS} FROM public.location_addresses
      WHERE location_id = $1 AND status = 'active' AND effective_to IS NULL${lock ? " FOR UPDATE" : ""}`,
    [locationId],
  )
  return result.rows[0] ? toAddress(result.rows[0]) : undefined
}

/** A real-world change: the version was true until `effectiveTo`. */
export async function endAddressVersion(client: Queryable, addressId: string, effectiveTo: string): Promise<void> {
  await client.query(
    `UPDATE public.location_addresses SET effective_to = $2::timestamptz, updated_at = now()
      WHERE id = $1 AND status = 'active' AND effective_to IS NULL`,
    [addressId, effectiveTo],
  )
}

/** A correction: the version was wrongly recorded. It is kept, flagged, and pointed at its replacement. */
export async function markAddressCorrected(client: Queryable, addressId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.location_addresses
        SET status = 'corrected', corrected_at = now(), superseded_by_address_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [addressId, replacementId],
  )
}

/** The genuine business address at an instant: active versions only, so corrected rows are never reported. */
export async function getAddressAsOf(client: Queryable, locationId: string, at: string): Promise<AddressRecord | undefined> {
  const result = await client.query<AddressRow>(
    `SELECT ${ADDRESS_COLUMNS} FROM public.location_addresses
      WHERE location_id = $1 AND status = 'active'
        AND effective_from <= $2::timestamptz
        AND (effective_to IS NULL OR $2::timestamptz < effective_to)`,
    [locationId, at],
  )
  return result.rows[0] ? toAddress(result.rows[0]) : undefined
}

export async function listAddressVersions(client: Queryable, locationIds: string[]): Promise<Map<string, AddressRecord[]>> {
  const byLocation = new Map<string, AddressRecord[]>()
  if (locationIds.length === 0) return byLocation
  const result = await client.query<AddressRow>(
    `SELECT ${ADDRESS_COLUMNS} FROM public.location_addresses
      WHERE location_id = ANY($1::uuid[]) ORDER BY location_id, effective_from, created_at, id`,
    [locationIds],
  )
  for (const row of result.rows) {
    const list = byLocation.get(row.location_id) ?? []
    list.push(toAddress(row))
    byLocation.set(row.location_id, list)
  }
  return byLocation
}

// --- advisory matching --------------------------------------------------------------------------------------------

export const MATCH_LIMIT = 25

/** Locations whose CURRENT address shares the building-level key. Advisory only. */
export async function findBuildingMatches(
  client: Queryable,
  address: PreparedAddress,
  excludeLocationId: string | null,
): Promise<Array<{ location: LocationCore; currentAddress: AddressRecord; unitMatch: boolean }>> {
  const result = await client.query<AddressRow & { unit_match: boolean }>(
    `SELECT ${ADDRESS_COLUMNS}, (match_key_unit = $2) AS unit_match
       FROM public.location_addresses
      WHERE status = 'active' AND effective_to IS NULL
        AND match_key_building = $1
        AND ($3::uuid IS NULL OR location_id <> $3::uuid)
        AND EXISTS (SELECT 1 FROM public.locations l WHERE l.id = location_id AND l.status = 'active')
      ORDER BY (match_key_unit = $2) DESC, created_at, id
      LIMIT ${MATCH_LIMIT}`,
    [address.matchKeyBuilding, address.matchKeyUnit, excludeLocationId],
  )
  const locations = await getLocationsByIds(client, result.rows.map((row) => row.location_id))
  return result.rows.flatMap((row) => {
    const location = locations.get(row.location_id)
    return location ? [{ location, currentAddress: toAddress(row), unitMatch: row.unit_match }] : []
  })
}

// --- assignments --------------------------------------------------------------------------------------------------

export async function getCurrentAssignment(
  client: Queryable,
  organizationId: string,
  role: AssignmentRole,
  lock = false,
): Promise<AssignmentRecord | undefined> {
  const result = await client.query<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM public.organization_location_assignments
      WHERE organization_id = $1 AND role = $2 AND status = 'active' AND effective_to IS NULL${lock ? " FOR UPDATE" : ""}`,
    [organizationId, role],
  )
  return result.rows[0] ? toAssignment(result.rows[0]) : undefined
}

export async function endAssignmentRow(
  client: Queryable,
  assignmentId: string,
  effectiveTo: string,
  reason: "CHANGED" | "CEASED",
): Promise<void> {
  await client.query(
    `UPDATE public.organization_location_assignments
        SET effective_to = $2::timestamptz, end_reason = $3, updated_at = now()
      WHERE id = $1 AND effective_to IS NULL`,
    [assignmentId, effectiveTo, reason],
  )
}

export async function insertAssignment(
  client: Queryable,
  values: {
    id?: string
    organizationId: string
    locationId: string
    locationKind: LocationKind
    role: AssignmentRole
    effectiveFrom: string
    /** Only for the replacement of an already ended assignment (a correction of history). */
    effectiveTo?: string | null
    endReason?: "CHANGED" | "CEASED" | null
  },
): Promise<AssignmentRecord> {
  const result = await client.query<AssignmentRow>(
    `INSERT INTO public.organization_location_assignments
       (id, organization_id, location_id, location_kind, role, effective_from, effective_to, end_reason)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8)
     RETURNING ${ASSIGNMENT_COLUMNS}`,
    [
      values.id ?? null,
      values.organizationId,
      values.locationId,
      values.locationKind,
      values.role,
      values.effectiveFrom,
      values.effectiveTo ?? null,
      values.endReason ?? null,
    ],
  )
  return toAssignment(result.rows[0])
}

/** One assignment of the Organization by id (any status), optionally row-locked. */
export async function getAssignment(
  client: Queryable,
  organizationId: string,
  assignmentId: string,
  lock = false,
): Promise<AssignmentRecord | undefined> {
  const result = await client.query<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM public.organization_location_assignments
      WHERE id = $1 AND organization_id = $2${lock ? " FOR UPDATE" : ""}`,
    [assignmentId, organizationId],
  )
  return result.rows[0] ? toAssignment(result.rows[0]) : undefined
}

/** A correction: the assignment was wrongly recorded. It is kept, flagged, NOT ended, and pointed at its replacement. */
export async function markAssignmentCorrected(client: Queryable, assignmentId: string, replacementId: string): Promise<void> {
  await client.query(
    `UPDATE public.organization_location_assignments
        SET status = 'corrected', corrected_at = now(), superseded_by_assignment_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [assignmentId, replacementId],
  )
}

export async function listAssignments(client: Queryable, organizationId: string): Promise<AssignmentRecord[]> {
  const result = await client.query<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM public.organization_location_assignments
      WHERE organization_id = $1 ORDER BY effective_from DESC, created_at DESC, id`,
    [organizationId],
  )
  return result.rows.map(toAssignment)
}

/** Has this Organization ever (or does it currently) genuinely use the Location? Corrected (known-wrong) rows do not count. */
export async function organizationHasUsedLocation(client: Queryable, organizationId: string, locationId: string, currentOnly: boolean): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.organization_location_assignments
      WHERE organization_id = $1 AND location_id = $2 AND status = 'active'${currentOnly ? " AND effective_to IS NULL" : ""} LIMIT 1`,
    [organizationId, locationId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function currentOrganizationIdsAt(client: Queryable, locationId: string): Promise<string[]> {
  const result = await client.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id FROM public.organization_location_assignments
      WHERE location_id = $1 AND status = 'active' AND effective_to IS NULL ORDER BY organization_id`,
    [locationId],
  )
  return result.rows.map((row) => row.organization_id)
}

export async function getLocationsByIds(client: Queryable, ids: string[]): Promise<Map<string, LocationCore>> {
  const map = new Map<string, LocationCore>()
  if (ids.length === 0) return map
  const result = await client.query<LocationRow>(`SELECT ${LOCATION_COLUMNS} FROM public.locations WHERE id = ANY($1::uuid[])`, [ids])
  for (const row of result.rows) map.set(row.id, toLocationCore(row))
  return map
}
