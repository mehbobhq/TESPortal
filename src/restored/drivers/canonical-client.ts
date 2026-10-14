/**
 * Canonical client of the restored driver UI: fetch calls to the company-scoped driver API (PostgreSQL through the operations in
 * lib/operational-identity). The company always comes from the URL. Nothing here touches browser storage.
 */
import type { OrganizationDriverRecord } from "@/lib/operational-identity/reads"
import type { OrganizationDriverDetail } from "@/lib/operational-identity/driver-reads"
import type { ExistingDriverMatch } from "@/lib/operational-identity/driver-operations"

export type CanonicalDriverRow = OrganizationDriverRecord
export type CanonicalDriverDetail = OrganizationDriverDetail
export type CanonicalExistingDriverMatch = ExistingDriverMatch

export class CanonicalRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "CanonicalRequestError"
    this.status = status
  }
}

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/drivers`

async function call<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: "no-store", ...init })
  } catch {
    throw new CanonicalRequestError(`${fallback} The server could not be reached.`, 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new CanonicalRequestError(typeof body?.error === "string" && body.error ? body.error : fallback, response.status)
  return body as T
}

const json = (method: string, payload: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })

export async function listDrivers(companyId: string): Promise<CanonicalDriverRow[]> {
  return (await call<{ drivers: CanonicalDriverRow[] }>(base(companyId), undefined, "Unable to load drivers.")).drivers
}

export async function getDriver(companyId: string, personId: string): Promise<CanonicalDriverDetail> {
  return (await call<{ driver: CanonicalDriverDetail }>(`${base(companyId)}/${encodeURIComponent(personId)}`, undefined, "Unable to load the driver.")).driver
}

export async function checkExistingDriver(companyId: string, licence: { jurisdictionCountry: string; jurisdictionRegion: string; licenceNumber: string }): Promise<CanonicalExistingDriverMatch> {
  return (await call<{ match: CanonicalExistingDriverMatch }>(`${base(companyId)}/check`, json("POST", licence), "Unable to check for an existing driver.")).match
}

export type CreateDriverPayload = {
  givenName: string
  familyName: string
  email?: string
  phone?: string
  relationshipType: "EMPLOYEE" | "CONTRACTOR" | "OWNER_OPERATOR"
  status: "ONBOARDING" | "ACTIVE" | "SUSPENDED"
  driverNumber?: string
  effectiveFrom: string
  licence?: { jurisdictionCountry: string; jurisdictionRegion: string; licenceNumber: string; licenceClass?: string; effectiveFrom?: string }
}

export async function createDriver(companyId: string, payload: CreateDriverPayload): Promise<{ personId: string }> {
  const body = await call<{ result: { personId: string } }>(base(companyId), json("POST", { mode: "create", ...payload }), "Unable to add the driver.")
  return { personId: body.result.personId }
}

export async function addExistingDriver(companyId: string, payload: { personId: string; relationshipType: CreateDriverPayload["relationshipType"]; status: CreateDriverPayload["status"]; driverNumber?: string; effectiveFrom: string }): Promise<void> {
  await call(base(companyId), json("POST", { mode: "add-existing", ...payload }), "Unable to add the driver.")
}

export async function patchDriver(companyId: string, personId: string, action: string, payload: Record<string, unknown>): Promise<void> {
  await call(`${base(companyId)}/${encodeURIComponent(personId)}`, json("PATCH", { action, ...payload }), "Unable to update the driver.")
}

export async function recordLicence(companyId: string, personId: string, licence: Record<string, unknown>): Promise<void> {
  await call(`${base(companyId)}/${encodeURIComponent(personId)}/licences`, json("POST", { licence }), "Unable to record the licence.")
}

export async function addMedicalPeriod(companyId: string, personId: string, payload: Record<string, unknown>): Promise<void> {
  await call(`${base(companyId)}/${encodeURIComponent(personId)}/medical-periods`, json("POST", payload), "Unable to record the medical qualification period.")
}

export async function patchMedicalPeriod(companyId: string, personId: string, action: "change" | "correct" | "void", payload: Record<string, unknown>): Promise<void> {
  await call(`${base(companyId)}/${encodeURIComponent(personId)}/medical-periods`, json("PATCH", { action, ...payload }), "Unable to update the medical qualification period.")
}
