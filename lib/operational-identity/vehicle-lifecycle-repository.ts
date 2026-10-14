import type { Queryable } from "./repository"

/** SQL for the vehicle lifecycle operations. Only UPDATE columns the runtime role is granted (migration 0020); never DELETE. */

export type VehicleRow = { id: string; recordStatus: "active" | "archived" | "merged"; archivedAt: string | null }

export type RelationshipRow = {
  id: string
  organizationId: string
  vehicleId: string
  relationshipType: "OPERATES" | "OWNS" | "LEASES"
  unitDisplay: string | null
  effectiveFrom: Date
  effectiveTo: Date | null
  recordStatus: "active" | "corrected" | "voided"
}

export type RegistrationRow = {
  id: string
  organizationId: string
  vehicleId: string
  registrationKind: "BASE" | "APPORTIONED"
  registrationDisplay: string | null
  plateDisplay: string | null
  country: string
  region: string
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected" | "voided"
}

const day = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10)

/** Lock order used by every lifecycle operation: organization, then vehicle, then relationship / registration rows. */
export async function lockVehicle(client: Queryable, vehicleId: string): Promise<VehicleRow | undefined> {
  const result = await client.query(
    "SELECT id, record_status, archived_at FROM public.vehicles WHERE id = $1 FOR UPDATE",
    [vehicleId],
  )
  const row = result.rows[0]
  return row ? { id: row.id, recordStatus: row.record_status, archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null } : undefined
}

function toRelationship(row: Record<string, unknown>): RelationshipRow {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    vehicleId: row.vehicle_id as string,
    relationshipType: row.relationship_type as RelationshipRow["relationshipType"],
    unitDisplay: (row.unit_number_display as string | null) ?? null,
    effectiveFrom: new Date(row.effective_from as string),
    effectiveTo: row.effective_to ? new Date(row.effective_to as string) : null,
    recordStatus: row.record_status as RelationshipRow["recordStatus"],
  }
}

const RELATIONSHIP_COLUMNS = "id, organization_id, vehicle_id, relationship_type, unit_number_display, effective_from, effective_to, record_status"

export async function lockRelationship(client: Queryable, relationshipId: string): Promise<RelationshipRow | undefined> {
  const result = await client.query(`SELECT ${RELATIONSHIP_COLUMNS} FROM public.organization_vehicle_relationships WHERE id = $1 FOR UPDATE`, [relationshipId])
  return result.rows[0] ? toRelationship(result.rows[0]) : undefined
}

/** The current (active, open) relationships between one organization and one vehicle (a plain read: it takes no row lock, so it can never wait on a relationship operation). */
export async function currentRelationships(client: Queryable, organizationId: string, vehicleId: string): Promise<RelationshipRow[]> {
  const result = await client.query(
    `SELECT ${RELATIONSHIP_COLUMNS} FROM public.organization_vehicle_relationships
      WHERE organization_id = $1 AND vehicle_id = $2 AND record_status = 'active' AND effective_to IS NULL
      ORDER BY effective_from, id`,
    [organizationId, vehicleId],
  )
  return result.rows.map(toRelationship)
}

/** Another organization's current relationship with the vehicle (archiving a shared physical vehicle must not affect it). */
export async function otherOrganizationsCurrentlyOnRecord(client: Queryable, organizationId: string, vehicleId: string): Promise<number> {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM public.organization_vehicle_relationships
      WHERE vehicle_id = $1 AND organization_id <> $2 AND record_status = 'active' AND effective_to IS NULL`,
    [vehicleId, organizationId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

export async function setVehicleArchived(client: Queryable, vehicleId: string): Promise<void> {
  await client.query(
    "UPDATE public.vehicles SET record_status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1 AND record_status = 'active'",
    [vehicleId],
  )
}

export async function setVehicleActive(client: Queryable, vehicleId: string): Promise<void> {
  await client.query(
    "UPDATE public.vehicles SET record_status = 'active', archived_at = NULL, updated_at = now() WHERE id = $1 AND record_status = 'archived'",
    [vehicleId],
  )
}

export async function endRelationship(client: Queryable, relationshipId: string, effectiveTo: string): Promise<void> {
  await client.query(
    "UPDATE public.organization_vehicle_relationships SET effective_to = $2::timestamptz, updated_at = now() WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL",
    [relationshipId, effectiveTo],
  )
}

/** Marks the row as corrected by `supersededById` (deferred foreign key: the new row is inserted afterwards in the same transaction). */
export async function supersedeRelationship(client: Queryable, relationshipId: string, supersededById: string): Promise<void> {
  await client.query(
    `UPDATE public.organization_vehicle_relationships
        SET record_status = 'corrected', corrected_at = now(), superseded_by_id = $2, updated_at = now()
      WHERE id = $1 AND record_status = 'active'`,
    [relationshipId, supersededById],
  )
}

export async function insertRelationship(
  client: Queryable,
  row: { id: string; organizationId: string; vehicleId: string; relationshipType: string; unitDisplay: string | null; unitNormalized: string | null; effectiveFrom: string; effectiveTo: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.organization_vehicle_relationships
       (id, organization_id, vehicle_id, relationship_type, unit_number_display, unit_number_normalized, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
    [row.id, row.organizationId, row.vehicleId, row.relationshipType, row.unitDisplay, row.unitNormalized, row.effectiveFrom, row.effectiveTo],
  )
}

const REGISTRATION_COLUMNS =
  "id, organization_id, vehicle_id, registration_kind, registration_number_display, plate_display, jurisdiction_country, jurisdiction_region, effective_from, effective_to, record_status"

function toRegistration(row: Record<string, unknown>): RegistrationRow {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    vehicleId: row.vehicle_id as string,
    registrationKind: row.registration_kind as RegistrationRow["registrationKind"],
    registrationDisplay: (row.registration_number_display as string | null) ?? null,
    plateDisplay: (row.plate_display as string | null) ?? null,
    country: row.jurisdiction_country as string,
    region: row.jurisdiction_region as string,
    effectiveFrom: day(row.effective_from as Date | string) as string,
    effectiveTo: day((row.effective_to as Date | string | null) ?? null),
    recordStatus: row.record_status as RegistrationRow["recordStatus"],
  }
}

export async function lockRegistration(client: Queryable, registrationId: string): Promise<RegistrationRow | undefined> {
  const result = await client.query(`SELECT ${REGISTRATION_COLUMNS} FROM public.vehicle_registration_periods WHERE id = $1 FOR UPDATE`, [registrationId])
  return result.rows[0] ? toRegistration(result.rows[0]) : undefined
}

export async function endRegistration(client: Queryable, registrationId: string, effectiveTo: string): Promise<void> {
  await client.query(
    "UPDATE public.vehicle_registration_periods SET effective_to = $2::date, updated_at = now() WHERE id = $1 AND record_status = 'active' AND effective_to IS NULL",
    [registrationId, effectiveTo],
  )
}

export async function supersedeRegistration(client: Queryable, registrationId: string, supersededById: string): Promise<void> {
  await client.query(
    `UPDATE public.vehicle_registration_periods
        SET record_status = 'corrected', corrected_at = now(), superseded_by_id = $2, updated_at = now()
      WHERE id = $1 AND record_status = 'active'`,
    [registrationId, supersededById],
  )
}

export async function voidRegistration(client: Queryable, registrationId: string): Promise<void> {
  await client.query(
    "UPDATE public.vehicle_registration_periods SET record_status = 'voided', corrected_at = now(), updated_at = now() WHERE id = $1 AND record_status = 'active'",
    [registrationId],
  )
}

export async function insertRegistration(
  client: Queryable,
  row: {
    id: string
    vehicleId: string
    organizationId: string
    registrationKind: string
    registrationDisplay: string | null
    registrationNormalized: string | null
    plateDisplay: string | null
    plateNormalized: string | null
    country: string
    region: string
    effectiveFrom: string
    effectiveTo: string | null
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.vehicle_registration_periods
       (id, vehicle_id, organization_id, registration_kind, registration_number_display, registration_number_normalized,
        plate_display, plate_normalized, jurisdiction_country, jurisdiction_region, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date)`,
    [row.id, row.vehicleId, row.organizationId, row.registrationKind, row.registrationDisplay, row.registrationNormalized, row.plateDisplay, row.plateNormalized, row.country, row.region, row.effectiveFrom, row.effectiveTo],
  )
}
