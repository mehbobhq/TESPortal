/**
 * The restored Vehicles workspace's view of "the vehicle store", kept exactly as the original components expect it
 * (vehicles, ownershipRecords, registrationRecords, permitRecords, inspectionRecords, maintenanceRecords, findings, items, links,
 * evidence) but held in MEMORY only and hydrated from the canonical API (see canonical.ts). Nothing here touches browser storage.
 *
 * `saveVehicleStore` keeps its original name and signature so the original tab code is unchanged, but it can no longer persist
 * anything: the canonical PostgreSQL records that exist (vehicle identity, registration periods, relationships) are changed through
 * the canonical API by canonical.ts, never by diffing a store. Any other collection the original code tries to save has no canonical
 * backend, so the call refuses with CanonicalOperationUnavailableError naming what could not be saved.
 */
import { CanonicalOperationUnavailableError } from "@/lib/canonical-ui/unavailable"
import { VEHICLE_EVIDENCE_GAP } from "./evidence-files"

export type {
  FindingMaintenanceLink,
  InspectionFinding,
  InspectionFindingStatus,
  MaintenanceItem,
  VehicleInspectionRecord,
  VehicleMaintenanceRecord,
  VehicleOwnershipRecord,
  VehiclePermitRecord,
  VehicleRegistrationRecord,
  VehicleStore,
} from "@/lib/vehicle-data"
import type {
  FindingMaintenanceLink,
  InspectionFinding,
  InspectionFindingStatus,
  MaintenanceItem,
  VehicleStore,
} from "@/lib/vehicle-data"

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
}

export function isoNow(): string {
  return new Date().toISOString()
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0]
}

export function addDaysISO(days: number, fromDate: string = todayISO()): string {
  const date = new Date(`${fromDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().split("T")[0]
}

export function emptyVehicleStore(): VehicleStore {
  return {
    version: 3,
    vehicles: [],
    ownershipRecords: [],
    registrationRecords: [],
    permitRecords: [],
    inspectionRecords: [],
    maintenanceRecords: [],
    inspectionFindings: [],
    maintenanceItems: [],
    findingMaintenanceLinks: [],
    evidence: [],
  }
}

const memory = new Map<string, VehicleStore>()

/** Replaces the in-memory model after a canonical hydrate. */
export function setVehicleStoreInMemory(companyId: string, store: VehicleStore): VehicleStore {
  memory.set(companyId, store)
  return store
}

export function loadVehicleStore(companyId: string): VehicleStore {
  return memory.get(companyId) ?? emptyVehicleStore()
}

const COLLECTIONS = [
  ["vehicles", "vehicle details"],
  ["ownershipRecords", "ownership records"],
  ["registrationRecords", "registration records"],
  ["permitRecords", "permits"],
  ["inspectionRecords", "inspections"],
  ["maintenanceRecords", "maintenance records"],
  ["inspectionFindings", "inspection findings"],
  ["maintenanceItems", "maintenance items"],
  ["findingMaintenanceLinks", "finding links"],
  ["evidence", "documents"],
] as const

const NO_BACKEND: Record<string, string> = {
  vehicles: "vehicle details are changed through the vehicle operations, not by saving a record set",
  ownershipRecords: "ownership records (owners, purchase, financing, lease terms) have no canonical record yet",
  registrationRecords: "registrations are changed through the registration operations, not by saving a record set",
  permitRecords: "vehicle permits have no canonical record yet",
  inspectionRecords: "vehicle inspections have no canonical record yet",
  maintenanceRecords: "maintenance records have no canonical record yet",
  inspectionFindings: "inspection findings have no canonical record yet",
  maintenanceItems: "maintenance items have no canonical record yet",
  findingMaintenanceLinks: "inspection-finding links have no canonical record yet",
  evidence: VEHICLE_EVIDENCE_GAP,
}

/**
 * Original signature. Refuses when `next` differs from the canonical model in any collection (it never writes). An unchanged
 * store is accepted so a no-op save does not raise a false alarm.
 */
export function saveVehicleStore(companyId: string, next: VehicleStore): void {
  const current = loadVehicleStore(companyId)
  const changed = COLLECTIONS.filter(([key]) => JSON.stringify(next[key]) !== JSON.stringify(current[key]))
  if (changed.length === 0) return
  const [firstKey] = changed[0]
  throw new CanonicalOperationUnavailableError(
    `Saving ${changed.map(([, label]) => label).join(", ")}`,
    changed.length === 1 ? NO_BACKEND[firstKey] : changed.map(([key, label]) => `${label}: ${NO_BACKEND[key]}`).join("; "),
  )
}

export function persistVehicleStore(companyId: string, updater: (current: VehicleStore) => VehicleStore): VehicleStore {
  const next = updater(loadVehicleStore(companyId))
  saveVehicleStore(companyId, next)
  return next
}

export function createInspectionFinding(
  companyId: string,
  input: Omit<InspectionFinding, "id" | "status" | "evidenceIds" | "archived" | "createdAt" | "updatedAt"> & Partial<Pick<InspectionFinding, "status" | "evidenceIds">>,
): InspectionFinding {
  const now = isoNow()
  const finding: InspectionFinding = { ...input, id: createId("FND"), status: input.status || "OPEN", evidenceIds: input.evidenceIds || [], archived: false, createdAt: now, updatedAt: now }
  persistVehicleStore(companyId, (store) => ({ ...store, inspectionFindings: [...store.inspectionFindings, finding] }))
  return finding
}

export function updateInspectionFindingStatus(companyId: string, findingId: string, status: InspectionFindingStatus): InspectionFinding {
  let updated: InspectionFinding | undefined
  persistVehicleStore(companyId, (store) => ({
    ...store,
    inspectionFindings: store.inspectionFindings.map((finding) => {
      if (finding.id !== findingId) return finding
      updated = { ...finding, status, updatedAt: isoNow() }
      return updated
    }),
  }))
  if (!updated) throw new Error("Inspection finding was not found.")
  return updated
}

export function createMaintenanceItem(
  companyId: string,
  input: Omit<MaintenanceItem, "id" | "status" | "evidenceIds" | "archived" | "createdAt" | "updatedAt"> & Partial<Pick<MaintenanceItem, "status" | "evidenceIds">>,
): MaintenanceItem {
  const now = isoNow()
  const item: MaintenanceItem = { ...input, id: createId("MIT"), status: input.status || "OPEN", evidenceIds: input.evidenceIds || [], archived: false, createdAt: now, updatedAt: now }
  persistVehicleStore(companyId, (store) => ({ ...store, maintenanceItems: [...store.maintenanceItems, item] }))
  return item
}

export function linkFindingToMaintenanceItem(companyId: string, findingId: string, maintenanceItemId: string): FindingMaintenanceLink {
  const store = loadVehicleStore(companyId)
  if (!store.inspectionFindings.some((finding) => finding.id === findingId && !finding.archived)) throw new Error("Inspection finding was not found.")
  if (!store.maintenanceItems.some((item) => item.id === maintenanceItemId && !item.archived)) throw new Error("Maintenance item was not found.")
  const existing = store.findingMaintenanceLinks.find((link) => link.findingId === findingId && link.maintenanceItemId === maintenanceItemId)
  if (existing) return existing
  const link: FindingMaintenanceLink = { id: createId("FML"), findingId, maintenanceItemId, createdAt: isoNow() }
  saveVehicleStore(companyId, { ...store, findingMaintenanceLinks: [...store.findingMaintenanceLinks, link] })
  return link
}

export function getFindingsForInspection(store: VehicleStore, inspectionId: string): InspectionFinding[] {
  return store.inspectionFindings.filter((finding) => finding.inspectionId === inspectionId && !finding.archived)
}

export function getMaintenanceItemsForRecord(store: VehicleStore, maintenanceRecordId: string): MaintenanceItem[] {
  return store.maintenanceItems.filter((item) => item.maintenanceRecordId === maintenanceRecordId && !item.archived)
}

export function getLinksForFinding(store: VehicleStore, findingId: string): FindingMaintenanceLink[] {
  return store.findingMaintenanceLinks.filter((link) => link.findingId === findingId)
}

export function deriveMaintenanceItemProvenance(
  store: VehicleStore,
  item: MaintenanceItem,
): { type: "INSPECTION_FINDING" | "MAINTENANCE_RECORD"; label: string; findingIds: string[] } {
  const links = store.findingMaintenanceLinks.filter((link) => link.maintenanceItemId === item.id)
  const findings = links
    .map((link) => store.inspectionFindings.find((finding) => finding.id === link.findingId))
    .filter((finding): finding is InspectionFinding => Boolean(finding))
  if (findings.length > 0) {
    return {
      type: "INSPECTION_FINDING",
      label: findings.length === 1 ? "Inspection finding" : `${findings.length} inspection findings`,
      findingIds: findings.map((finding) => finding.id),
    }
  }
  return { type: "MAINTENANCE_RECORD", label: "Maintenance record", findingIds: [] }
}
