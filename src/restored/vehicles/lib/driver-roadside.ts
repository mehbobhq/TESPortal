import type { RoadsideEventForVehicle } from "@/lib/driver-data"

/**
 * Roadside inspections that involved a vehicle were derived from the browser-local driver store. There is no canonical roadside
 * record yet (Record of Events is a deferred workspace), so none are shown here.
 */
export function getRoadsideEventsForVehicle(_companyId: string, _vehicleId: string): RoadsideEventForVehicle[] {
  return []
}

export type { RoadsideEventForVehicle }
