/**
 * Canonical adapter for the restored Vehicles workspace.
 *
 * Hydrates the in-memory vehicle model the original components expect from the canonical API
 * (GET /api/companies/[id]/vehicles/workspace) and implements the original mutations by calling the canonical operations. A field
 * or record that has no canonical home is shown as "Not recorded", and editing it refuses with CanonicalOperationUnavailableError.
 * This module never reads or writes browser storage.
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import { normalizeVIN } from "@/lib/identifier-normalization"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import { formatVehicleModel, normalizeVehicleManufacturer } from "@/lib/vehicle-manufacturers"
import type { EquipmentType, VehicleRecord, VehicleStatus } from "@/src/types"
import type { ProfileForm } from "./components/profile/VehicleProfileTab"
import { emptyVehicleStore, loadVehicleStore, setVehicleStoreInMemory } from "./lib/vehicle-data"
import type { VehicleOwnershipRecord, VehicleRegistrationRecord, VehicleStore } from "./lib/vehicle-data"

export const NOT_RECORDED = "Not recorded"

// ---- API shapes (see lib/operational-identity/vehicle-workspace-reads.ts) -----------------------------------------------------

type ApiRegistration = {
  id: string
  registrationKind: "BASE" | "APPORTIONED"
  registrationNumber: string | null
  plate: string | null
  jurisdictionCountry: string
  jurisdictionRegion: string
  effectiveFrom: string
  effectiveTo: string | null
  recordStatus: "active" | "corrected" | "voided"
}
type ApiVehicle = {
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
  registrations: ApiRegistration[]
  relationshipHistory: Array<{ id: string; relationshipType: string; unitNumber: string | null; effectiveFrom: string; effectiveTo: string | null; recordStatus: string }>
}

/** What the canonical records hold for a vehicle, beyond what the original `VehicleRecord` shape can carry. */
export type VehicleCanonicalMeta = { relationshipId: string; relationshipType: ApiVehicle["relationshipType"]; archivedAt: string | null }
const meta = new Map<string, VehicleCanonicalMeta>()
export const canonicalMetaFor = (vehicleId: string): VehicleCanonicalMeta | undefined => meta.get(vehicleId)

// ---- type vocabulary --------------------------------------------------------------------------------------------------------

/**
 * The canonical vehicle type catalogue has exactly Truck Tractor, Straight Truck, Trailer and Other. Only exact matches are saved:
 * a trailer sub-type (dry van, reefer, ...), Converter Dolly and Service Vehicle have no canonical code, so choosing one refuses
 * instead of guessing. "Trailer" itself is offered so trailers can still be recorded.
 */
const CODE_BY_EQUIPMENT: Record<string, "TRUCK_TRACTOR" | "STRAIGHT_TRUCK" | "TRAILER" | "OTHER"> = {
  Tractor: "TRUCK_TRACTOR",
  "Straight Truck": "STRAIGHT_TRUCK",
  Trailer: "TRAILER",
  "Other Equipment": "OTHER",
}
const EQUIPMENT_BY_CODE: Record<string, string> = { TRUCK_TRACTOR: "Tractor", STRAIGHT_TRUCK: "Straight Truck", TRAILER: "Trailer", OTHER: "Other Equipment" }

export const CANONICAL_EQUIPMENT_TYPES = ["Tractor", "Straight Truck", "Trailer", "Other Equipment"] as const

export function typeCodeFor(equipmentType: string): "TRUCK_TRACTOR" | "STRAIGHT_TRUCK" | "TRAILER" | "OTHER" {
  const code = CODE_BY_EQUIPMENT[equipmentType]
  if (!code) {
    throw new CanonicalOperationUnavailableError(
      `Saving the vehicle type "${equipmentType}"`,
      "the canonical vehicle type catalogue has only Truck Tractor, Straight Truck, Trailer and Other, so this type has no exact match and its sub-type cannot be recorded. Choose Tractor, Straight Truck, Trailer or Other Equipment",
    )
  }
  return code
}

// ---- mapping ----------------------------------------------------------------------------------------------------------------

const countryOf = (region: string): "CA" | "US" => (JURISDICTIONS.find((item) => item.code === region)?.country === "Canada" ? "CA" : "US")

export const REGISTRATION_KIND_LABEL: Record<"BASE" | "APPORTIONED", string> = { BASE: "Base", APPORTIONED: "Apportioned" }
const KIND_BY_LABEL: Record<string, "BASE" | "APPORTIONED"> = { Base: "BASE", Apportioned: "APPORTIONED" }

function toRegistration(vehicleId: string, item: ApiRegistration, createdAt: string): VehicleRegistrationRecord {
  const history = item.recordStatus !== "active"
  return {
    id: item.id,
    vehicleId,
    registrationType: REGISTRATION_KIND_LABEL[item.registrationKind],
    stateProvince: item.jurisdictionRegion,
    registrationDate: item.effectiveFrom,
    expiryDate: item.effectiveTo ?? "",
    plate: item.plate ?? item.registrationNumber ?? "",
    price: "",
    // A corrected row was replaced by its correction; a voided row was recorded by mistake. Both are kept as history.
    status: item.recordStatus === "voided" ? "Cancelled" : item.recordStatus === "corrected" ? "Replaced" : "Active",
    archived: history,
    createdAt,
    updatedAt: createdAt,
  }
}

function toVehicle(item: ApiVehicle): VehicleRecord {
  const status: VehicleStatus = item.vehicleStatus === "archived" ? "Archived" : "Active"
  const base = {
    id: item.vehicleId,
    unitNumber: item.unitNumber ?? "",
    equipmentType: (EQUIPMENT_BY_CODE[item.vehicleType] ?? "Other Equipment") as EquipmentType,
    status,
    vin: item.vin ?? "",
    year: item.modelYear === null ? "" : String(item.modelYear),
    make: item.make ?? "",
    model: item.model ?? "",
    // No canonical home for the fields below: they are shown as "Not recorded" and cannot be edited.
    color: "",
    operatingRegion: "" as unknown as VehicleRecord["operatingRegion"],
    axles: 0,
    fuelType: "" as unknown as VehicleRecord["fuelType"],
    ownershipType: (item.relationshipType === "LEASES" ? "Leased" : "Owned") as VehicleRecord["ownershipType"],
    permits: [],
    inspections: [],
    evidenceIds: [],
    source: "Manual" as const,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  return base
}

function toOwnership(item: ApiVehicle): VehicleOwnershipRecord | null {
  if (item.relationshipType === "OPERATES") return null
  return {
    id: item.relationshipId,
    vehicleId: item.vehicleId,
    relationship: item.relationshipType === "OWNS" ? "Company-Owned" : "Leased",
    purchaseDate: "",
    purchasePrice: "",
    ownershipStartDate: item.relationshipEffectiveFrom.slice(0, 10),
    ownershipEndDate: "",
    legalOwners: [],
    evidenceIds: [],
    archived: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

export function storeFromWorkspace(vehicles: ApiVehicle[]): VehicleStore {
  meta.clear()
  const store = emptyVehicleStore()
  for (const item of vehicles) {
    meta.set(item.vehicleId, { relationshipId: item.relationshipId, relationshipType: item.relationshipType, archivedAt: item.archivedAt })
    store.vehicles.push(toVehicle(item))
    const ownership = toOwnership(item)
    if (ownership) store.ownershipRecords.push(ownership)
    for (const registration of item.registrations) store.registrationRecords.push(toRegistration(item.vehicleId, registration, item.createdAt))
  }
  return store
}

// ---- transport --------------------------------------------------------------------------------------------------------------

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/vehicles`

async function failure(response: Response, fallback: string): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  throw new Error(body?.error || fallback)
}

async function send(url: string, method: "POST" | "PATCH", body: Record<string, unknown>, fallback: string): Promise<unknown> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!response.ok) return failure(response, fallback)
  return response.json().catch(() => ({}))
}

/** Reads the canonical records and replaces the in-memory model. */
export async function hydrateVehicles(companyId: string): Promise<VehicleStore> {
  const response = await fetch(`${base(companyId)}/workspace`, { cache: "no-store" })
  if (!response.ok) return failure(response, "Unable to load vehicles.")
  const body = (await response.json()) as { vehicles?: ApiVehicle[] }
  return setVehicleStoreInMemory(companyId, storeFromWorkspace(body.vehicles ?? []))
}

// ---- vehicle profile --------------------------------------------------------------------------------------------------------

/** The values the create form starts from; a value still equal to this is "untouched", not "entered". */
export const BLANK_PROFILE_DEFAULTS = {
  color: "",
  operatingRegion: "",
  axles: "",
  fleetStartDate: "",
  fleetEndDate: "",
  tareWeight: "",
  fuelType: "",
  equipmentLength: "",
  gpsProvider: "",
} as const

const UNRECORDED_FIELD_LABELS: Array<[keyof typeof BLANK_PROFILE_DEFAULTS, string]> = [
  ["color", "Color"],
  ["operatingRegion", "Operating Region"],
  ["axles", "Equipment Axles"],
  ["fleetStartDate", "Start Date"],
  ["fleetEndDate", "End Date"],
  ["tareWeight", "Tare Weight"],
  ["fuelType", "Fuel Type"],
  ["equipmentLength", "Equipment Length"],
  ["gpsProvider", "GPS Provider"],
]

function assertNoUnrecordedValues(form: ProfileForm, against: Partial<Record<keyof typeof BLANK_PROFILE_DEFAULTS, string>>): void {
  const entered = UNRECORDED_FIELD_LABELS.filter(([key]) => String(form[key] ?? "") !== String(against[key] ?? ""))
  if (entered.length > 0) {
    throw new CanonicalOperationUnavailableError(
      `Saving ${entered.map(([, label]) => label).join(", ")}`,
      "these vehicle fields have no canonical record yet, so they are shown as Not recorded and cannot be saved. Clear them to save the rest",
    )
  }
}

function parseYear(value: string): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  const year = Number(text)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error("Year must be a four-digit year between 1900 and 2200.")
  return year
}

/** Creates the vehicle identity and this company's relationship in one transaction. Returns the new vehicle id. */
export async function createCanonicalVehicle(companyId: string, form: ProfileForm): Promise<string> {
  const vehicleTypeCode = typeCodeFor(form.equipmentType)
  if (form.status !== "Active") {
    throw new CanonicalOperationUnavailableError(`Saving the status "${form.status}"`, "a vehicle record is either active or archived; Maintenance, Out of Service and Inactive have no canonical record")
  }
  assertNoUnrecordedValues(form, BLANK_PROFILE_DEFAULTS)
  const modelYear = parseYear(form.year)
  const created = (await send(
    base(companyId),
    "POST",
    {
      vehicleTypeCode,
      relationshipType: "OPERATES",
      unitNumber: form.unitNumber.trim(),
      vin: form.vin.trim(),
      ...(modelYear !== undefined ? { modelYear } : {}),
      make: form.make.trim(),
      model: form.model.trim(),
    },
    "The vehicle could not be saved.",
  )) as { vehicle?: { vehicleId?: string } }
  const vehicleId = created.vehicle?.vehicleId
  if (!vehicleId) throw new Error("The vehicle was saved but its identifier was not returned.")
  await hydrateVehicles(companyId)
  return vehicleId
}

/**
 * Saves an edit of the profile. The unit (equipment) number is corrected through the relationship operation; the physical vehicle's
 * own attributes (type, VIN, year, make, model) are one shared record with no history of its own, so changing them refuses.
 */
export async function updateCanonicalVehicle(companyId: string, previous: VehicleRecord, next: VehicleRecord): Promise<boolean> {
  const unitChanged = next.unitNumber.trim() !== previous.unitNumber.trim()
  const identityChanged: string[] = []
  if (next.equipmentType !== previous.equipmentType) identityChanged.push("Vehicle Type")
  // Compared the way the form normalises them, so an untouched field never reads as a change.
  if (normalizeVIN(next.vin) !== normalizeVIN(previous.vin)) identityChanged.push("VIN")
  if ((next.year || "") !== (previous.year || "")) identityChanged.push("Year")
  if (normalizeVehicleManufacturer(next.make || "", next.equipmentType).name !== normalizeVehicleManufacturer(previous.make || "", previous.equipmentType).name) identityChanged.push("Make")
  if (formatVehicleModel(next.model || "") !== formatVehicleModel(previous.model || "")) identityChanged.push("Model")
  if (identityChanged.length > 0) {
    throw new CanonicalOperationUnavailableError(
      `Changing ${identityChanged.join(", ")}`,
      "the physical vehicle is one shared record with no change history of its own, and a correction operation for it has not been approved, so it cannot be edited here yet",
    )
  }
  // The profile form shows an archived vehicle as Inactive; that is not a status change.
  if (next.status !== (previous.status === "Archived" ? "Inactive" : previous.status)) {
    throw new CanonicalOperationUnavailableError(`Changing the status to "${next.status}"`, "a vehicle record is either active or archived (use Archive); other statuses have no canonical record")
  }
  const unrecorded = UNRECORDED_FIELD_LABELS.filter(([key]) => {
    const record = next as unknown as Record<string, unknown>
    const was = previous as unknown as Record<string, unknown>
    const value = (item: Record<string, unknown>) => {
      if (key === "fleetStartDate" || key === "fleetEndDate") return String(item[key] ?? "")
      if (key === "tareWeight") return String(item.tareWeightKgs ?? "")
      if (key === "equipmentLength") return String(item.lengthFeet ?? "")
      if (key === "axles") return item.axles ? String(item.axles) : ""
      return String(item[key] ?? "")
    }
    return value(record) !== value(was)
  })
  if (unrecorded.length > 0) {
    throw new CanonicalOperationUnavailableError(
      `Saving ${unrecorded.map(([, label]) => label).join(", ")}`,
      "these vehicle fields have no canonical record yet, so they are shown as Not recorded and cannot be saved",
    )
  }
  if (!unitChanged) return false
  const relationship = canonicalMetaFor(previous.id)
  if (!relationship) throw new Error("This vehicle is not on this company's current record.")
  await send(`${base(companyId)}/relationships/${encodeURIComponent(relationship.relationshipId)}`, "PATCH", { action: "correct-unit", unitNumber: next.unitNumber.trim() }, "The equipment number could not be saved.")
  await hydrateVehicles(companyId)
  return true
}

export async function archiveCanonicalVehicle(companyId: string, vehicleId: string): Promise<void> {
  await send(`${base(companyId)}/${encodeURIComponent(vehicleId)}`, "PATCH", { action: "archive" }, "The vehicle could not be archived.")
  await hydrateVehicles(companyId)
}

export async function restoreCanonicalVehicle(companyId: string, vehicleId: string): Promise<void> {
  await send(`${base(companyId)}/${encodeURIComponent(vehicleId)}`, "PATCH", { action: "restore" }, "The vehicle could not be restored.")
  await hydrateVehicles(companyId)
}

// ---- registrations ----------------------------------------------------------------------------------------------------------

export type RegistrationFormValues = {
  registrationType: string
  stateProvince: string
  plate: string
  registrationDate: string
  expiryDate: string
}

/**
 * Saves a registration form. A NEW registration while a current one of the same kind exists is a real-world change from its start
 * date (the current period ends that day and keeps its history); an EDIT of an existing row is a correction (the mistaken row is
 * flagged and kept). Rows that are already history cannot be edited.
 */
export async function saveCanonicalRegistration(
  companyId: string,
  vehicleId: string,
  initial: VehicleRegistrationRecord | null,
  values: RegistrationFormValues,
): Promise<"added" | "changed" | "corrected" | "unchanged"> {
  const kind = KIND_BY_LABEL[values.registrationType]
  if (!kind) throw new CanonicalOperationUnavailableError(`Saving the registration type "${values.registrationType}"`, "the canonical registration records distinguish only Base and Apportioned registrations")
  const country = countryOf(values.stateProvince)
  const fields = {
    registrationKind: kind,
    plate: values.plate.trim(),
    jurisdictionCountry: country,
    jurisdictionRegion: values.stateProvince,
    effectiveFrom: values.registrationDate,
    effectiveTo: values.expiryDate && values.expiryDate !== "Continuous" ? values.expiryDate : null,
  }
  const registrationsUrl = `${base(companyId)}/registrations`
  if (initial) {
    if (initial.archived) throw new Error("This registration was corrected or voided, so it is kept as history and cannot be edited.")
    const unchanged =
      initial.registrationType === values.registrationType &&
      initial.stateProvince === values.stateProvince &&
      initial.plate === fields.plate &&
      initial.registrationDate === fields.effectiveFrom &&
      (initial.expiryDate || null) === fields.effectiveTo
    if (unchanged) return "unchanged"
    await send(`${registrationsUrl}/${encodeURIComponent(initial.id)}`, "PATCH", { action: "correct", ...fields }, "The registration could not be saved.")
    await hydrateVehicles(companyId)
    return "corrected"
  }
  const current = loadVehicleStore(companyId).registrationRecords.find(
    (record) => record.vehicleId === vehicleId && !record.archived && !record.expiryDate && record.registrationType === values.registrationType,
  )
  if (current) {
    if (values.registrationDate <= current.registrationDate) {
      throw new Error("A current registration of this type already exists. A new one must start after it (it replaces it from that date); to fix a mistake, edit the existing registration.")
    }
    await send(`${registrationsUrl}/${encodeURIComponent(current.id)}`, "PATCH", { action: "change", ...fields }, "The registration could not be saved.")
    await hydrateVehicles(companyId)
    return "changed"
  }
  await send(`${base(companyId)}/${encodeURIComponent(vehicleId)}/registrations`, "POST", fields, "The registration could not be saved.")
  await hydrateVehicles(companyId)
  return "added"
}

/** A registration recorded by mistake is voided (kept and flagged, never deleted). */
export async function voidCanonicalRegistration(companyId: string, registrationId: string): Promise<void> {
  await send(`${base(companyId)}/registrations/${encodeURIComponent(registrationId)}`, "PATCH", { action: "void" }, "The registration could not be voided.")
  await hydrateVehicles(companyId)
}
