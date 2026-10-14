import type { CanonicalVehicleResolution, VehicleIdentifierResolutionInput } from "@/lib/vehicle-data"

/**
 * The original performance-event forms looked vehicles up in the browser vehicle store (`lib/vehicle-data`). The restored driver
 * workspace never reads browser storage, and performance events themselves have no canonical backend (see actions.ts), so these
 * lookups honestly report "no vehicle available" instead of inventing a match.
 */
const NO_LOOKUP = "Vehicle lookup is not connected in the restored driver workspace; the roadside/performance forms are visible but their records cannot be saved yet."

export function resolveCanonicalVehicleByIdentifiers(_operatingCompanyId: string, _identifiers: VehicleIdentifierResolutionInput, _asOfDate?: string): CanonicalVehicleResolution {
  return { state: "UNRESOLVED", reason: NO_LOOKUP, conflicts: [], identifierDiscrepancies: [], candidateVehicleIds: [], evaluatedAt: new Date().toISOString() }
}

export function loadVehicleStore(_companyId: string): { vehicles: Array<{ id: string; unitNumber?: string; equipmentType?: string }> } {
  return { vehicles: [] }
}

export function loadCompanies(): Array<{ id: string; cargoTypes?: string[] }> {
  return []
}
