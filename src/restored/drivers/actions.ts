/**
 * Canonical actions behind the restored driver controls that HAVE a canonical home: identity (name, email, phone), the Organization
 * relationship (type, status, driver number, end), licences and medical qualification periods. Each action validates what it can
 * BEFORE writing, refuses (CanonicalOperationUnavailableError) the part of an edit that has no canonical home instead of dropping it,
 * and reports what was not recorded. Writes go to the company-scoped API; nothing touches browser storage.
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import type { CompanyDriverRelationship, DriverMaster, LicenceRecord, ScreeningRecord } from "@/types/drivers"
import { addMedicalPeriod, patchDriver, patchMedicalPeriod, recordLicence } from "./canonical-client"
import { MEDICAL_QUALIFICATION_TYPE, RECORD_TYPE_FROM_UI, STATUS_FROM_UI } from "./mapping"
import { currentLicence } from "./driver-data"

export type ChangeKind = "correct" | "change"
export type ProfileEdit = {
  identity: { legalFirstName: string; legalMiddleName: string; legalLastName: string; preferredName: string; dateOfBirth: string; phone: string; email: string }
  relationship: { recordType: string; operatingRegion: string; driverStatus: string; startDate: string; endDate: string; driverNumber: string }
  address: { addressLine1: string; addressLine2: string; city: string; stateProvince: string; postalZip: string; effectiveFrom: string }
  /** Whether name / email / phone edits fix a wrong record (correction) or record a real-world change. */
  identityKind: ChangeKind
  /** Whether relationship edits fix a wrong record (correction) or record a real-world change effective today. */
  relationshipKind: ChangeKind
}

const unavailable = (action: string, reason: string) => new CanonicalOperationUnavailableError(action, reason)
const same = (a: string | undefined, b: string | undefined) => (a ?? "").trim() === (b ?? "").trim()
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Saves the profile edit. Everything is validated first: if any edited value has no canonical home the whole save is refused and
 * nothing is written. Otherwise the canonical operations run in order (name, email, phone, relationship); each is its own
 * transaction, so a failure part-way leaves the earlier ones saved and says so.
 */
export async function saveProfile(companyId: string, master: DriverMaster, relationship: CompanyDriverRelationship, edit: ProfileEdit): Promise<string[]> {
  const personId = master.id
  const current = master.identity
  const missing: string[] = []
  if (!same(edit.identity.legalMiddleName, current.legalMiddleName)) missing.push("middle name")
  if (!same(edit.identity.preferredName, current.preferredName)) missing.push("preferred name")
  if (!same(edit.identity.dateOfBirth, current.dateOfBirth)) missing.push("date of birth")
  if (edit.address.addressLine1.trim() || edit.address.city.trim() || edit.address.postalZip.trim() || edit.address.stateProvince.trim()) missing.push("residential address")
  if (!same(edit.relationship.operatingRegion, relationship.operatingRegion)) missing.push("operating region")
  if (!same(edit.relationship.startDate, relationship.startDate)) missing.push("relationship start date (a start-date correction is not defined for drivers)")

  const typeChanged = !same(edit.relationship.recordType, relationship.recordType)
  const statusChanged = !same(edit.relationship.driverStatus, relationship.driverStatus)
  const endChanged = !same(edit.relationship.endDate, relationship.endDate)
  const numberChanged = !same(edit.relationship.driverNumber, relationship.companyDriverRecordId === relationship.id ? "" : relationship.companyDriverRecordId)
  const nextType = RECORD_TYPE_FROM_UI[edit.relationship.recordType as keyof typeof RECORD_TYPE_FROM_UI]
  const nextStatus = STATUS_FROM_UI[edit.relationship.driverStatus as keyof typeof STATUS_FROM_UI]
  if (typeChanged && !nextType) missing.push(`record type "${edit.relationship.recordType}" (canonical types: Employee, Contractor, Owner-Operator)`)
  if (statusChanged && !nextStatus) missing.push(`status "${edit.relationship.driverStatus}" (canonical statuses: Onboarding, Active, Suspended, Terminated)`)
  if (missing.length > 0) {
    throw unavailable(
      "Saving these profile values",
      `${missing.join("; ")} ${missing.length === 1 ? "has" : "have"} no canonical home (the approved schema stores name, email, phone, licence, medical period and the Organization relationship type, status, driver number and dates). Nothing was saved; clear or revert ${missing.length === 1 ? "that value" : "those values"} and save again`,
    )
  }
  const ending = nextStatus === "ENDED" && relationship.driverStatus !== "Terminated"
  if (endChanged && !ending && edit.relationship.endDate.trim()) throw unavailable("Setting an end date without ending the relationship", "an end date is recorded by setting the status to Terminated (ENDED); nothing was saved")
  if (ending && !edit.relationship.endDate.trim()) throw unavailable("Ending the relationship", "choose the Relationship End Date when setting the status to Terminated; nothing was saved")
  if (relationship.driverStatus === "Terminated" && (typeChanged || statusChanged || numberChanged)) throw unavailable("Changing an ended relationship", "the relationship has ended; a rehire is a new relationship (Add Driver > same person). Nothing was saved")

  const done: string[] = []
  const fail = (error: unknown): never => {
    const message = error instanceof Error ? error.message : "The change could not be saved."
    throw new Error(done.length ? `${message} (Already saved in this save: ${done.join(", ")}.)` : message)
  }
  try {
    const nameChanged = !same(edit.identity.legalFirstName, current.legalFirstName) || !same(edit.identity.legalLastName, current.legalLastName)
    if (nameChanged) {
      await patchDriver(companyId, personId, edit.identityKind === "change" ? "change-name" : "correct-name", { givenName: edit.identity.legalFirstName.trim(), familyName: edit.identity.legalLastName.trim() })
      done.push("name")
    }
    for (const [type, key, value, before] of [["EMAIL", "email", edit.identity.email, current.email], ["PHONE", "phone", edit.identity.phone, current.phone]] as const) {
      if (value.trim() && !same(value, before)) {
        await patchDriver(companyId, personId, "set-channel", { channelType: type, value: value.trim(), mode: edit.identityKind })
        done.push(key)
      }
    }
    if (ending) {
      await patchDriver(companyId, personId, "end-relationship", { effectiveTo: edit.relationship.endDate.trim() })
      done.push("relationship end")
    } else if (typeChanged || statusChanged || numberChanged) {
      const body: Record<string, unknown> = {}
      if (typeChanged) body.relationshipType = nextType
      if (statusChanged) body.status = nextStatus
      if (numberChanged) body.driverNumber = edit.relationship.driverNumber.trim() || undefined
      // A change takes effect after the open record began; a record that began today can only be corrected.
      const realChange = edit.relationshipKind === "change" && relationship.startDate < today()
      if (edit.relationshipKind === "change" && !realChange) throw unavailable("Recording a change effective today", `this relationship began ${relationship.startDate}; a change must take effect after the open record began, so use "Correction" for a same-day edit. Nothing was saved`)
      await patchDriver(companyId, personId, realChange ? "change-relationship" : "correct-relationship", body)
      done.push("relationship")
    }
  } catch (error) {
    if (error instanceof CanonicalOperationUnavailableError) throw error
    fail(error)
  }
  return done
}

/** Adds a licence. Fields with no canonical home that were filled in are reported, never silently dropped. */
export async function addLicence(companyId: string, master: DriverMaster, data: Omit<LicenceRecord, "id" | "createdAt" | "status" | "effectiveTo">): Promise<string[]> {
  const notRecorded: string[] = []
  if (data.endorsements?.length) notRecorded.push("endorsements")
  if (data.restrictions?.length) notRecorded.push("restrictions")
  if (data.airBrakeQualified) notRecorded.push("air brake qualification")
  if (data.documentType) notRecorded.push("document type")
  if (data.endorsementNotes || data.restrictionNotes || data.notes) notRecorded.push("notes")
  if (data.verificationState && data.verificationState !== "Unverified") notRecorded.push("verification state")
  const existing = currentLicence(master)
  if (existing && data.effectiveFrom <= existing.effectiveFrom && existing.jurisdiction === data.jurisdiction && existing.country === data.country) {
    throw unavailable("Recording a replacement licence for the same day", `the current licence began ${existing.effectiveFrom}; a replacement must take effect after it. If the recorded licence was wrong, correct it instead. Nothing was saved`)
  }
  await recordLicence(companyId, master.id, {
    jurisdictionCountry: data.country,
    jurisdictionRegion: data.jurisdiction,
    licenceNumber: data.licenceNumberRaw || data.licenceNumber,
    licenceClass: data.class || undefined,
    issueDate: data.issueDate || undefined,
    expiryDate: data.expiryDate || undefined,
    effectiveFrom: data.effectiveFrom,
  })
  return notRecorded.length ? [`Saved. Not recorded (no canonical home): ${notRecorded.join(", ")}.`] : []
}

/** Medical / DOT physical screenings are canonical medical qualification periods; every other screening category is not. */
export async function addScreening(companyId: string, master: DriverMaster, screenings: ScreeningRecord[], data: Omit<ScreeningRecord, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived">): Promise<string[]> {
  if (data.category !== "Medical Card / DOT Physical") {
    throw unavailable(`Recording a "${data.category}" screening`, "only the medical qualification period has a canonical table (driver_medical_qualification_periods); drug and alcohol tests, clearinghouse queries, PSP, employer verifications, road tests and the other screening categories have no canonical domain. Nothing was saved")
  }
  const licence = currentLicence(master)
  if (!licence) throw unavailable("Recording a medical qualification period", "the canonical period needs a jurisdiction country and this driver has no current licence to take it from; record the licence first. Nothing was saved")
  const issued = data.medicalCardDetails?.certificateIssueDate || data.recordDate
  const current = screenings.find((item) => item.category === "Medical Card / DOT Physical" && !item.isArchived)
  const common = { issuedOn: issued || undefined, expiresOn: data.expiryDate || undefined }
  if (current) await patchMedicalPeriod(companyId, master.id, "change", { periodId: current.id, ...common, effectiveFrom: issued && issued > current.createdAt ? issued : undefined })
  else await addMedicalPeriod(companyId, master.id, { qualificationType: MEDICAL_QUALIFICATION_TYPE, jurisdictionCountry: licence.country, ...common, effectiveFrom: issued || undefined })
  const dropped = [
    data.resultSummary && "result summary",
    data.providerOrAuthority && "provider / authority",
    data.medicalCardDetails?.examinerName && "examiner",
    data.medicalCardDetails?.nationalRegistryNumber && "national registry number",
    data.medicalCardDetails?.medicalQualificationStatus && "qualification status",
    data.medicalCardDetails?.verificationState && "verification state",
    data.status && "screening status",
    data.notes && "notes",
  ].filter(Boolean)
  return [`Saved as a canonical medical qualification period (issue and expiry dates; jurisdiction recorded as ${licence.country}, the country of the current licence).${dropped.length ? ` Not recorded (no canonical home): ${dropped.join(", ")}.` : ""}`]
}

/** Archiving a medical record voids the canonical period (entered in error: kept, flagged, never deleted); other screenings are not canonical. */
export async function archiveScreening(companyId: string, master: DriverMaster, screenings: ScreeningRecord[], id: string): Promise<string[]> {
  const record = screenings.find((item) => item.id === id)
  if (!record || record.category !== "Medical Card / DOT Physical") {
    throw unavailable("Archiving this screening record", "only medical qualification periods are canonical; this record family has no canonical domain. Nothing was changed")
  }
  await patchMedicalPeriod(companyId, master.id, "void", { periodId: id })
  return ["The medical qualification period was voided (kept as history, flagged as entered in error). The archive reason has no canonical home and was not recorded."]
}
