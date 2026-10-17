import "server-only"

import { withAuthorizedSystem } from "@/lib/auth/tes-system-context"
import { DriverNotFoundError } from "./driver-errors"

/**
 * Full canonical record of ONE driver as seen through ONE Organization (DRIVER_READ, SYSTEM scope). The driver is reachable only
 * when the Organization has (or had) a genuine relationship with the person; any other person looks exactly like one that does
 * not exist. History rows are returned with their lifecycle flags so the UI can show real-world history apart from corrections.
 */

export type DriverRecordStatus = "active" | "corrected" | "voided"

export type DriverNameVersion = { id: string; givenName: string | null; familyName: string | null; effectiveFrom: string; effectiveTo: string | null; recordStatus: "active" | "corrected"; changeReason: "INITIAL" | "CHANGE" | "CORRECTION" }
export type DriverChannel = { id: string; channelType: string; value: string; extension: string | null; isPreferred: boolean; effectiveFrom: string; effectiveTo: string | null; recordStatus: DriverRecordStatus }
export type DriverRelationshipRow = {
  id: string
  relationshipType: "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR"
  driverNumber: string | null
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "ENDED"
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: DriverRecordStatus
}
export type DriverLicenceRow = {
  id: string
  jurisdictionCountry: string
  jurisdictionRegion: string
  number: string
  licenceClass: string | null
  issueDate: string | null
  expiryDate: string | null
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: DriverRecordStatus
}
export type DriverMedicalPeriodRow = {
  id: string
  qualificationType: string
  jurisdictionCountry: string
  jurisdictionRegion: string | null
  issuedOn: string | null
  expiresOn: string | null
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: DriverRecordStatus
}
export type OrganizationDriverDetail = {
  personId: string
  personStatus: "active" | "archived"
  profileStatus: "active" | "archived"
  names: DriverNameVersion[]
  channels: DriverChannel[]
  relationships: DriverRelationshipRow[]
  licences: DriverLicenceRow[]
  medicalPeriods: DriverMedicalPeriodRow[]
}

const micro = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const dateText = (column: string) => `to_char(${column},'YYYY-MM-DD')`

export async function getOrganizationDriverDetail(organizationId: string, personId: string): Promise<OrganizationDriverDetail> {
  if (!/^[0-9a-f-]{36}$/i.test(personId) || !/^[0-9a-f-]{36}$/i.test(organizationId)) throw new DriverNotFoundError("Driver")
  return withAuthorizedSystem("DRIVER_READ", async (client) => {
    const relationships = await client.query(
      `SELECT id, relationship_type, driver_number_display, status, ${dateText("effective_from")} AS effective_from, ${dateText("effective_to")} AS effective_to, record_status
         FROM public.organization_driver_relationships WHERE organization_id=$1 AND person_id=$2 AND record_status IN ('active','corrected') ORDER BY effective_from, created_at, id`,
      [organizationId, personId],
    )
    if (relationships.rows.length === 0) throw new DriverNotFoundError("Driver")
    const person = await client.query(
      `SELECT p.record_status AS person_status, d.record_status AS profile_status FROM public.persons p JOIN public.driver_profiles d ON d.person_id=p.id WHERE p.id=$1`,
      [personId],
    )
    if (!person.rows[0]) throw new DriverNotFoundError("Driver")
    const names = await client.query(
      `SELECT id, given_name, family_name, ${micro("effective_from")} AS effective_from, ${micro("effective_to")} AS effective_to, record_status, change_reason FROM public.person_name_versions WHERE person_id=$1 ORDER BY effective_from, created_at, id`,
      [personId],
    )
    const channels = await client.query(
      `SELECT id, channel_type, value_display, extension, is_preferred, ${micro("effective_from")} AS effective_from, ${micro("effective_to")} AS effective_to, record_status FROM public.person_channels WHERE person_id=$1 AND record_status IN ('active','corrected') ORDER BY effective_from, created_at, id`,
      [personId],
    )
    const licences = await client.query(
      `SELECT id, jurisdiction_country, jurisdiction_region, licence_number_display, licence_class, ${dateText("issue_date")} AS issue_date, ${dateText("expiry_date")} AS expiry_date, ${dateText("effective_from")} AS effective_from, ${dateText("effective_to")} AS effective_to, record_status
         FROM public.driver_licences WHERE person_id=$1 ORDER BY effective_from, created_at, id`,
      [personId],
    )
    const medical = await client.query(
      `SELECT id, qualification_type, jurisdiction_country, jurisdiction_region, ${dateText("issued_on")} AS issued_on, ${dateText("expires_on")} AS expires_on, ${dateText("effective_from")} AS effective_from, ${dateText("effective_to")} AS effective_to, record_status
         FROM public.driver_medical_qualification_periods WHERE person_id=$1 ORDER BY effective_from, created_at, id`,
      [personId],
    )
    return {
      personId,
      personStatus: person.rows[0].person_status,
      profileStatus: person.rows[0].profile_status,
      names: names.rows.map((r) => ({ id: r.id, givenName: r.given_name, familyName: r.family_name, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, recordStatus: r.record_status, changeReason: r.change_reason })),
      channels: channels.rows.map((r) => ({ id: r.id, channelType: r.channel_type, value: r.value_display, extension: r.extension, isPreferred: r.is_preferred, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, recordStatus: r.record_status })),
      relationships: relationships.rows.map((r) => ({ id: r.id, relationshipType: r.relationship_type, driverNumber: r.driver_number_display, status: r.status, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, recordStatus: r.record_status })),
      licences: licences.rows.map((r) => ({ id: r.id, jurisdictionCountry: r.jurisdiction_country, jurisdictionRegion: r.jurisdiction_region, number: r.licence_number_display, licenceClass: r.licence_class, issueDate: r.issue_date, expiryDate: r.expiry_date, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, recordStatus: r.record_status })),
      medicalPeriods: medical.rows.map((r) => ({ id: r.id, qualificationType: r.qualification_type, jurisdictionCountry: r.jurisdiction_country, jurisdictionRegion: r.jurisdiction_region, issuedOn: r.issued_on, expiresOn: r.expires_on, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, recordStatus: r.record_status })),
    }
  })
}
