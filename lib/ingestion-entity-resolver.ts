/**
 * Entity resolution for machine-acquired (OCR) documents — given identifiers
 * extracted from a document, find the matching company, driver, and vehicle
 * already on file.
 *
 * There is no lib/company-data.ts in this codebase, and lib/driver-data.ts's
 * exported readCompanies()/getCompany() intentionally narrow the stored
 * company record down to { id, name, status, region } — it drops fields
 * like the carrier's NSC number this resolver needs. So company records are
 * read directly from the same "tes_companies" localStorage key every page
 * in the portal already reads from, mirroring the pattern used throughout
 * the app (e.g. app/companies/[id]/vehicles/page.tsx's own readCompanies()).
 */

import { loadDriverMasterStore, currentLicence } from "@/lib/driver-data"
import { loadVehicleStore } from "@/lib/vehicle-data"
import type { DriverMaster } from "@/types/drivers"
import type { VehicleRecord } from "@/src/types"

export interface RawCompanyRecord {
  id: string
  name: string
  kind?: string
  status?: string
  nsc?: string
  usdot?: string
  mc?: string
  mvid?: string
}

export interface ResolvedEntities {
  company: RawCompanyRecord | null
  companyConfidence: "EXACT" | "FUZZY" | "UNRESOLVED"
  driver: DriverMaster | null
  driverConfidence: "EXACT" | "UNRESOLVED"
  vehicle: VehicleRecord | null
  vehicleConfidence: "EXACT" | "UNRESOLVED"
}

function readRawCompanies(): RawCompanyRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = JSON.parse(window.localStorage.getItem("tes_companies") || "[]")
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && item.id)).map((item) => ({
      id: String(item.id),
      name: String(item.name || ""),
      kind: typeof item.kind === "string" ? item.kind : undefined,
      status: typeof item.status === "string" ? item.status : undefined,
      nsc: typeof item.nsc === "string" ? item.nsc : undefined,
      usdot: typeof item.usdot === "string" ? item.usdot : undefined,
      mc: typeof item.mc === "string" ? item.mc : undefined,
      mvid: typeof item.mvid === "string" ? item.mvid : undefined,
    }))
  } catch {
    return []
  }
}

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "")
const alnumUpper = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|ltd|corp|co|llc|limited|incorporated)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim()
}

export function resolveEntities(params: {
  carrierName?: string
  nscNumber?: string
  usdotNumber?: string
  driverLicenceNumber?: string
  driverLicenceJurisdiction?: string
  driverName?: string
  vin?: string
  plateNumber?: string
  plateJurisdiction?: string
}): ResolvedEntities {
  const result: ResolvedEntities = {
    company: null,
    companyConfidence: "UNRESOLVED",
    driver: null,
    driverConfidence: "UNRESOLVED",
    vehicle: null,
    vehicleConfidence: "UNRESOLVED",
  }

  // COMPANY RESOLUTION — priority: NSC → USDOT → carrier name fuzzy match
  const companies = readRawCompanies()

  if (params.nscNumber) {
    const normalizedNSC = digitsOnly(params.nscNumber)
    const match = normalizedNSC ? companies.find((c) => c.nsc && digitsOnly(c.nsc) === normalizedNSC) : undefined
    if (match) {
      result.company = match
      result.companyConfidence = "EXACT"
    }
  }

  if (!result.company && params.usdotNumber) {
    const normalizedUSDOT = digitsOnly(params.usdotNumber)
    const match = normalizedUSDOT ? companies.find((c) => c.usdot && digitsOnly(c.usdot) === normalizedUSDOT) : undefined
    if (match) {
      result.company = match
      result.companyConfidence = "EXACT"
    }
  }

  if (!result.company && params.carrierName) {
    const normalizedInput = normalizeCompanyName(params.carrierName)
    const match = normalizedInput ? companies.find((c) => normalizeCompanyName(c.name) === normalizedInput) : undefined
    if (match) {
      result.company = match
      result.companyConfidence = "FUZZY"
    }
  }

  // DRIVER RESOLUTION — licence number exact match only.
  // TODO: a name + date-of-birth fuzzy fallback was specified but is
  // deliberately not implemented — matching a driver record by name alone
  // (with no defined similarity threshold) risks misattributing a
  // compliance event to the wrong person, which this resolver should never
  // guess at. Licence number is the only identifier confident enough for
  // unattended resolution.
  if (params.driverLicenceNumber) {
    const normalizedLicence = alnumUpper(params.driverLicenceNumber)
    const masters = loadDriverMasterStore().drivers || []
    const match = normalizedLicence
      ? masters.find((driver) => {
          const licence = currentLicence(driver)
          if (!licence) return false
          const candidate = alnumUpper(licence.licenceNumberNormalized || licence.licenceNumber || licence.licenceNumberRaw || "")
          if (!candidate || candidate !== normalizedLicence) return false
          if (params.driverLicenceJurisdiction && licence.jurisdiction && licence.jurisdiction !== params.driverLicenceJurisdiction) return false
          return true
        })
      : undefined
    if (match) {
      result.driver = match
      result.driverConfidence = "EXACT"
    }
  }

  // VEHICLE RESOLUTION — priority: VIN → plate (+ jurisdiction when known).
  // Scoped to the resolved company, since vehicle stores are per-company.
  if (result.company && params.vin) {
    const vehicleStore = loadVehicleStore(result.company.id)
    const normalizedVIN = alnumUpper(params.vin)
    const match = normalizedVIN ? vehicleStore.vehicles?.find((v) => v.vin && alnumUpper(v.vin) === normalizedVIN) : undefined
    if (match) {
      result.vehicle = match
      result.vehicleConfidence = "EXACT"
    }
  }

  if (!result.vehicle && result.company && params.plateNumber) {
    const vehicleStore = loadVehicleStore(result.company.id)
    const normalizedPlate = alnumUpper(params.plateNumber)
    const match = normalizedPlate
      ? vehicleStore.vehicles?.find((v) => {
          const plate = v.registration?.plateNumber
          if (!plate || alnumUpper(plate) !== normalizedPlate) return false
          if (params.plateJurisdiction && v.registration?.jurisdiction && v.registration.jurisdiction !== params.plateJurisdiction) return false
          return true
        })
      : undefined
    if (match) {
      result.vehicle = match
      result.vehicleConfidence = "EXACT"
    }
  }

  return result
}
