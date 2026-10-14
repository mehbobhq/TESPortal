import "server-only"

import { withAuthorizedSystem } from "@/lib/auth/tes-system-context"

/**
 * Read model of the Vehicles workspace: the company's current vehicles (including archived ones) with this company's
 * registration periods and relationship history. Only SELECTs, under VEHICLE_READ; every row is filtered by the company in
 * the URL, so another company's registrations or history are never returned.
 */

export type VehicleRegistrationRecord = {
  id: string
  registrationKind: "BASE" | "APPORTIONED"
  registrationNumber: string | null
  plate: string | null
  jurisdictionCountry: string
  jurisdictionRegion: string
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected" | "voided"
  correctedAt: string | null
  supersededById: string | null
}

export type VehicleRelationshipHistoryRecord = {
  id: string
  relationshipType: "OPERATES" | "OWNS" | "LEASES"
  unitNumber: string | null
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected" | "voided"
  correctedAt: string | null
  supersededById: string | null
}

export type VehicleWorkspaceRecord = {
  relationshipId: string
  vehicleId: string
  relationshipType: "OPERATES" | "OWNS" | "LEASES"
  unitNumber: string | null
  relationshipEffectiveFrom: string
  vehicleType: string
  vin: string | null
  modelYear: number | null
  make: string | null
  model: string | null
  vehicleStatus: "active" | "archived" | "merged"
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  registrations: VehicleRegistrationRecord[]
  relationshipHistory: VehicleRelationshipHistoryRecord[]
}

const day = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10)
const instant = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? new Date(value).toISOString() : value.toISOString()

export async function getOrganizationVehicleWorkspace(organizationId: string): Promise<VehicleWorkspaceRecord[]> {
  return withAuthorizedSystem("VEHICLE_READ", async (client) => {
    const current = await client.query(
      `SELECT r.id AS relationship_id, r.vehicle_id, r.relationship_type, r.unit_number_display, r.effective_from,
              v.vehicle_type_code, v.vin_display, v.model_year, v.make, v.model, v.record_status, v.archived_at, v.created_at, v.updated_at
         FROM public.organization_vehicle_relationships r
         JOIN public.vehicles v ON v.id = r.vehicle_id
        WHERE r.organization_id = $1 AND r.record_status = 'active' AND r.effective_to IS NULL
        ORDER BY lower(coalesce(r.unit_number_display, '')), r.effective_from, r.id`,
      [organizationId],
    )
    const vehicleIds = [...new Set(current.rows.map((row) => row.vehicle_id as string))]
    const registrations = vehicleIds.length
      ? await client.query(
          `SELECT id, vehicle_id, registration_kind, registration_number_display, plate_display, jurisdiction_country, jurisdiction_region,
                  effective_from, effective_to, record_status, corrected_at, superseded_by_id
             FROM public.vehicle_registration_periods
            WHERE organization_id = $1 AND vehicle_id = ANY($2::uuid[])
            ORDER BY effective_from DESC, created_at DESC, id`,
          [organizationId, vehicleIds],
        )
      : { rows: [] }
    const history = vehicleIds.length
      ? await client.query(
          `SELECT id, vehicle_id, relationship_type, unit_number_display, effective_from, effective_to, record_status, corrected_at, superseded_by_id
             FROM public.organization_vehicle_relationships
            WHERE organization_id = $1 AND vehicle_id = ANY($2::uuid[])
            ORDER BY effective_from DESC, created_at DESC, id`,
          [organizationId, vehicleIds],
        )
      : { rows: [] }

    return current.rows.map((row): VehicleWorkspaceRecord => ({
      relationshipId: row.relationship_id,
      vehicleId: row.vehicle_id,
      relationshipType: row.relationship_type,
      unitNumber: row.unit_number_display,
      relationshipEffectiveFrom: instant(row.effective_from) as string,
      vehicleType: row.vehicle_type_code,
      vin: row.vin_display,
      modelYear: row.model_year,
      make: row.make,
      model: row.model,
      vehicleStatus: row.record_status,
      archivedAt: instant(row.archived_at),
      createdAt: instant(row.created_at) as string,
      updatedAt: instant(row.updated_at) as string,
      registrations: registrations.rows
        .filter((item) => item.vehicle_id === row.vehicle_id)
        .map((item) => ({
          id: item.id,
          registrationKind: item.registration_kind,
          registrationNumber: item.registration_number_display,
          plate: item.plate_display,
          jurisdictionCountry: item.jurisdiction_country,
          jurisdictionRegion: item.jurisdiction_region,
          effectiveFrom: day(item.effective_from) as string,
          effectiveTo: day(item.effective_to),
          recordStatus: item.record_status,
          correctedAt: instant(item.corrected_at),
          supersededById: item.superseded_by_id,
        })),
      relationshipHistory: history.rows
        .filter((item) => item.vehicle_id === row.vehicle_id)
        .map((item) => ({
          id: item.id,
          relationshipType: item.relationship_type,
          unitNumber: item.unit_number_display,
          effectiveFrom: instant(item.effective_from) as string,
          effectiveTo: instant(item.effective_to),
          recordStatus: item.record_status,
          correctedAt: instant(item.corrected_at),
          supersededById: item.superseded_by_id,
        })),
    }))
  })
}
