import "server-only"

import { withAuthorizedSystem } from "@/lib/auth/tes-system-context"

/**
 * Additive read services over the existing operational-identity tables (migrations 0014, 0020, 0021). They only SELECT
 * and run under the same VEHICLE_READ / DRIVER_READ capabilities the row-level security policies already name; they
 * never join public.organizations (invisible to those capabilities) and never return a row another capability owns.
 */

export type OrganizationVehicleRecord = {
  relationshipId: string
  vehicleId: string
  relationshipType: "OPERATES" | "OWNS" | "LEASES"
  unitNumber: string | null
  effectiveFrom: string
  effectiveTo: string | null
  vehicleType: string
  vin: string | null
  modelYear: number | null
  make: string | null
  model: string | null
  vehicleStatus: "active" | "archived" | "merged"
}

export type OrganizationDriverRecord = {
  relationshipId: string
  personId: string
  relationshipType: "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR"
  driverNumber: string | null
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "ENDED"
  effectiveFrom: string
  effectiveTo: string | null
  givenName: string | null
  familyName: string | null
  profileStatus: "active" | "archived"
  licence: {
    id: string
    jurisdictionCountry: string
    jurisdictionRegion: string
    number: string
    licenceClass: string | null
    issueDate: string | null
    expiryDate: string | null
  } | null
}

const day = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10)
const instant = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value : value.toISOString()

/** Current (genuine, open) vehicle relationships of one Organization. */
export async function listOrganizationVehicles(organizationId: string): Promise<OrganizationVehicleRecord[]> {
  return withAuthorizedSystem("VEHICLE_READ", async (client) => {
    const result = await client.query(
      `SELECT r.id AS relationship_id, r.vehicle_id, r.relationship_type, r.unit_number_display,
              r.effective_from, r.effective_to,
              v.vehicle_type_code, v.vin_display, v.model_year, v.make, v.model, v.record_status
         FROM public.organization_vehicle_relationships r
         JOIN public.vehicles v ON v.id = r.vehicle_id
        WHERE r.organization_id = $1
          AND r.record_status = 'active'
          AND r.effective_to IS NULL
        ORDER BY lower(coalesce(r.unit_number_display, '')), r.effective_from, r.id`,
      [organizationId],
    )
    return result.rows.map((row) => ({
      relationshipId: row.relationship_id,
      vehicleId: row.vehicle_id,
      relationshipType: row.relationship_type,
      unitNumber: row.unit_number_display,
      effectiveFrom: instant(row.effective_from) as string,
      effectiveTo: instant(row.effective_to),
      vehicleType: row.vehicle_type_code,
      vin: row.vin_display,
      modelYear: row.model_year,
      make: row.make,
      model: row.model,
      vehicleStatus: row.record_status,
    }))
  })
}

/** Current (genuine, open) driver relationships of one Organization, with the person's current name and licence. */
export async function listOrganizationDrivers(organizationId: string): Promise<OrganizationDriverRecord[]> {
  return withAuthorizedSystem("DRIVER_READ", async (client) => {
    const result = await client.query(
      `SELECT r.id AS relationship_id, r.person_id, r.relationship_type, r.driver_number_display, r.status,
              r.effective_from, r.effective_to, p.record_status AS profile_status,
              n.given_name, n.family_name,
              l.id AS licence_id, l.jurisdiction_country, l.jurisdiction_region, l.licence_number_display,
              l.licence_class, l.issue_date, l.expiry_date
         FROM public.organization_driver_relationships r
         JOIN public.driver_profiles p ON p.person_id = r.person_id
         LEFT JOIN LATERAL (
           SELECT given_name, family_name
             FROM public.person_name_versions
            WHERE person_id = r.person_id AND record_status = 'active' AND effective_to IS NULL
            ORDER BY effective_from DESC, id DESC
            LIMIT 1
         ) n ON true
         LEFT JOIN LATERAL (
           SELECT id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_class, issue_date, expiry_date
             FROM public.driver_licences
            WHERE person_id = r.person_id AND record_status = 'active' AND effective_to IS NULL
            ORDER BY effective_from DESC, id DESC
            LIMIT 1
         ) l ON true
        WHERE r.organization_id = $1
          AND r.record_status = 'active'
          AND r.effective_to IS NULL
        ORDER BY lower(coalesce(n.family_name, '')), lower(coalesce(n.given_name, '')), r.id`,
      [organizationId],
    )
    return result.rows.map((row) => ({
      relationshipId: row.relationship_id,
      personId: row.person_id,
      relationshipType: row.relationship_type,
      driverNumber: row.driver_number_display,
      status: row.status,
      effectiveFrom: day(row.effective_from) as string,
      effectiveTo: day(row.effective_to),
      givenName: row.given_name,
      familyName: row.family_name,
      profileStatus: row.profile_status,
      licence: row.licence_id
        ? {
            id: row.licence_id,
            jurisdictionCountry: row.jurisdiction_country,
            jurisdictionRegion: row.jurisdiction_region,
            number: row.licence_number_display,
            licenceClass: row.licence_class,
            issueDate: day(row.issue_date),
            expiryDate: day(row.expiry_date),
          }
        : null,
    }))
  })
}
