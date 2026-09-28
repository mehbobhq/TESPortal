/**
 * TES repair classification catalog.
 *
 * Important: this catalog classifies individual repair line items. It must not
 * be used as a single "repair type" for an entire invoice because one invoice
 * can contain several equally important repairs.
 */

export interface RepairComponentCatalogEntry {
  id: string
  system: string
  assembly: string
  canonicalName: string
  aliases: string[]
  active: boolean
}

export interface RepairComponentMatch {
  entry: RepairComponentCatalogEntry
  confidence: number
}

const CATALOG_STORAGE_PREFIX = "tes_repair_component_catalog_v1_"

export const REPAIR_SYSTEMS = [
  "Brakes",
  "Engine",
  "Transmission / Driveline",
  "Steering",
  "Suspension",
  "Tires / Wheels",
  "Electrical / Lighting",
  "HVAC",
  "Cooling",
  "Exhaust / Emissions",
  "Fuel System",
  "Body / Cab",
  "Trailer",
  "Reefer Unit",
  "Safety Equipment",
  "Other / Unmapped",
] as const

export const REPAIR_ACTIONS = [
  "Inspect",
  "Diagnose",
  "Adjust",
  "Clean",
  "Lubricate",
  "Repair",
  "Replace",
  "Rebuild",
  "Program / Calibrate",
  "Test",
  "Other",
] as const

export const REPAIR_ORIGINS = [
  "Driver-reported defect",
  "Pre-trip / Post-trip finding",
  "Roadside inspection finding",
  "Scheduled service finding",
  "Shop discovery",
  "Breakdown / Emergency",
  "Collision",
  "Recall",
  "Telematics alert",
  "Other / Unknown",
] as const

export type RepairOrigin = (typeof REPAIR_ORIGINS)[number]

/**
 * Starter catalog. It is intentionally extensible: the preventive-maintenance
 * sheet can add entries later without changing saved repair records.
 */
export const DEFAULT_REPAIR_COMPONENT_CATALOG: RepairComponentCatalogEntry[] = [
  { id: "brk-air-chamber", system: "Brakes", assembly: "Air Brake System", canonicalName: "Brake Chamber", aliases: ["brake chamber", "air chamber", "spring brake"], active: true },
  { id: "brk-slack-adjuster", system: "Brakes", assembly: "Foundation Brake", canonicalName: "Slack Adjuster", aliases: ["slack adjuster", "automatic slack"], active: true },
  { id: "brk-s-cam", system: "Brakes", assembly: "Foundation Brake", canonicalName: "S-Cam", aliases: ["s-cam", "s cam", "camshaft bushing"], active: true },
  { id: "brk-pad", system: "Brakes", assembly: "Disc Brake", canonicalName: "Brake Pad", aliases: ["brake pad", "disc pad", "pad set", "front pads", "rear pads"], active: true },
  { id: "brk-lining-shoe", system: "Brakes", assembly: "Drum Brake", canonicalName: "Brake Shoe / Lining", aliases: ["brake shoe", "brake lining", "lining set"], active: true },
  { id: "brk-disc-rotor", system: "Brakes", assembly: "Disc Brake", canonicalName: "Brake Disc / Rotor", aliases: ["brake disc", "disc brake", "brake rotor", "disc rotor", "rotor assembly"], active: true },
  { id: "brk-drum", system: "Brakes", assembly: "Drum Brake", canonicalName: "Brake Drum", aliases: ["brake drum", "drum assembly"], active: true },
  { id: "brk-caliper", system: "Brakes", assembly: "Disc Brake", canonicalName: "Brake Caliper", aliases: ["brake caliper", "caliper"], active: true },
  { id: "brk-air-line", system: "Brakes", assembly: "Air Supply", canonicalName: "Air Hose / Line", aliases: ["air hose", "air line", "brake hose", "air leak"], active: true },
  { id: "brk-air-valve", system: "Brakes", assembly: "Air Supply", canonicalName: "Air Valve", aliases: ["relay valve", "quick release valve", "foot valve", "air valve"], active: true },
  { id: "brk-compressor", system: "Brakes", assembly: "Air Supply", canonicalName: "Air Compressor", aliases: ["air compressor", "compressor governor"], active: true },
  { id: "brk-air-dryer", system: "Brakes", assembly: "Air Supply", canonicalName: "Air Dryer", aliases: ["air dryer", "dryer cartridge"], active: true },
  { id: "brk-abs-sensor", system: "Brakes", assembly: "ABS", canonicalName: "ABS Wheel Speed Sensor", aliases: ["abs sensor", "wheel speed sensor"], active: true },
  { id: "brk-abs-modulator", system: "Brakes", assembly: "ABS", canonicalName: "ABS Modulator / ECU", aliases: ["abs modulator", "abs module", "abs ecu"], active: true },

  { id: "eng-oil-system", system: "Engine", assembly: "Lubrication", canonicalName: "Engine Oil System", aliases: ["engine oil", "oil pan", "oil pump", "oil leak"], active: true },
  { id: "eng-turbo", system: "Engine", assembly: "Air Induction", canonicalName: "Turbocharger", aliases: ["turbo", "turbocharger", "boost leak"], active: true },
  { id: "eng-injector", system: "Engine", assembly: "Fuel Delivery", canonicalName: "Fuel Injector", aliases: ["injector", "fuel injector"], active: true },
  { id: "eng-mount", system: "Engine", assembly: "Mounting", canonicalName: "Engine Mount", aliases: ["engine mount", "motor mount"], active: true },
  { id: "drv-clutch", system: "Transmission / Driveline", assembly: "Clutch", canonicalName: "Clutch", aliases: ["clutch", "clutch assembly"], active: true },
  { id: "drv-transmission", system: "Transmission / Driveline", assembly: "Transmission", canonicalName: "Transmission", aliases: ["transmission", "gearbox"], active: true },
  { id: "drv-drive-shaft", system: "Transmission / Driveline", assembly: "Driveline", canonicalName: "Drive Shaft / U-Joint", aliases: ["drive shaft", "driveshaft", "u-joint", "universal joint"], active: true },
  { id: "drv-differential", system: "Transmission / Driveline", assembly: "Axle", canonicalName: "Differential", aliases: ["differential", "rear end"], active: true },

  { id: "str-steering-gear", system: "Steering", assembly: "Steering Gear", canonicalName: "Steering Gear / Box", aliases: ["steering gear", "steering box"], active: true },
  { id: "str-tie-rod", system: "Steering", assembly: "Steering Linkage", canonicalName: "Tie Rod / Drag Link", aliases: ["tie rod", "drag link"], active: true },
  { id: "sus-shock", system: "Suspension", assembly: "Suspension", canonicalName: "Shock Absorber", aliases: ["shock", "shock absorber"], active: true },
  { id: "sus-air-spring", system: "Suspension", assembly: "Air Suspension", canonicalName: "Air Spring / Air Bag", aliases: ["air bag", "air spring", "suspension bag"], active: true },
  { id: "sus-leaf-spring", system: "Suspension", assembly: "Spring Suspension", canonicalName: "Leaf Spring", aliases: ["leaf spring", "spring pack"], active: true },

  { id: "tir-tire", system: "Tires / Wheels", assembly: "Tire", canonicalName: "Tire", aliases: ["tire", "tyre", "retread"], active: true },
  { id: "tir-wheel-rim", system: "Tires / Wheels", assembly: "Wheel", canonicalName: "Wheel / Rim", aliases: ["wheel", "rim"], active: true },
  { id: "tir-wheel-bearing", system: "Tires / Wheels", assembly: "Hub", canonicalName: "Wheel Bearing / Hub", aliases: ["wheel bearing", "hub bearing", "wheel hub"], active: true },

  { id: "elec-battery", system: "Electrical / Lighting", assembly: "Starting / Charging", canonicalName: "Battery", aliases: ["battery", "batteries"], active: true },
  { id: "elec-alternator", system: "Electrical / Lighting", assembly: "Starting / Charging", canonicalName: "Alternator", aliases: ["alternator", "charging system"], active: true },
  { id: "elec-starter", system: "Electrical / Lighting", assembly: "Starting / Charging", canonicalName: "Starter", aliases: ["starter", "starter motor"], active: true },
  { id: "elec-headlamp", system: "Electrical / Lighting", assembly: "Lighting", canonicalName: "Headlamp", aliases: ["headlamp", "headlight"], active: true },
  { id: "elec-marker-light", system: "Electrical / Lighting", assembly: "Lighting", canonicalName: "Marker / Clearance Light", aliases: ["marker light", "clearance light", "side marker"], active: true },
  { id: "elec-tail-light", system: "Electrical / Lighting", assembly: "Lighting", canonicalName: "Tail / Stop / Turn Light", aliases: ["tail light", "stop light", "brake light", "turn signal"], active: true },

  { id: "cool-radiator", system: "Cooling", assembly: "Engine Cooling", canonicalName: "Radiator", aliases: ["radiator", "coolant radiator"], active: true },
  { id: "cool-water-pump", system: "Cooling", assembly: "Engine Cooling", canonicalName: "Water Pump", aliases: ["water pump", "coolant pump"], active: true },
  { id: "cool-hose", system: "Cooling", assembly: "Engine Cooling", canonicalName: "Coolant Hose", aliases: ["coolant hose", "radiator hose"], active: true },
  { id: "em-dpf", system: "Exhaust / Emissions", assembly: "Aftertreatment", canonicalName: "Diesel Particulate Filter", aliases: ["dpf", "diesel particulate filter"], active: true },
  { id: "em-def", system: "Exhaust / Emissions", assembly: "Aftertreatment", canonicalName: "DEF System", aliases: ["def system", "def pump", "def doser"], active: true },
  { id: "em-nox", system: "Exhaust / Emissions", assembly: "Aftertreatment", canonicalName: "NOx Sensor", aliases: ["nox sensor", "nitrogen oxide sensor"], active: true },

  { id: "fuel-tank", system: "Fuel System", assembly: "Fuel Storage", canonicalName: "Fuel Tank", aliases: ["fuel tank", "diesel tank"], active: true },
  { id: "fuel-line", system: "Fuel System", assembly: "Fuel Delivery", canonicalName: "Fuel Line / Hose", aliases: ["fuel line", "fuel hose"], active: true },
  { id: "hvac-compressor", system: "HVAC", assembly: "Air Conditioning", canonicalName: "A/C Compressor", aliases: ["a/c compressor", "ac compressor"], active: true },
  { id: "hvac-heater", system: "HVAC", assembly: "Heating", canonicalName: "Heater / Blower", aliases: ["heater core", "blower motor", "cab heater"], active: true },

  { id: "trl-landing-gear", system: "Trailer", assembly: "Landing Gear", canonicalName: "Landing Gear", aliases: ["landing gear", "landing leg"], active: true },
  { id: "trl-door", system: "Trailer", assembly: "Body", canonicalName: "Trailer Door", aliases: ["trailer door", "roll-up door", "swing door"], active: true },
  { id: "trl-floor", system: "Trailer", assembly: "Body", canonicalName: "Trailer Floor", aliases: ["trailer floor", "floor board"], active: true },
  { id: "trl-coupling", system: "Trailer", assembly: "Coupling", canonicalName: "Kingpin / Coupler", aliases: ["kingpin", "coupler", "fifth wheel coupling"], active: true },

  { id: "rfr-compressor", system: "Reefer Unit", assembly: "Refrigeration", canonicalName: "Reefer Compressor", aliases: ["reefer compressor", "refrigeration compressor"], active: true },
  { id: "rfr-controller", system: "Reefer Unit", assembly: "Controls", canonicalName: "Reefer Controller", aliases: ["reefer controller", "temperature controller", "control module"], active: true },
  { id: "rfr-sensor", system: "Reefer Unit", assembly: "Controls", canonicalName: "Temperature Sensor / Probe", aliases: ["temperature sensor", "temperature probe", "reefer sensor"], active: true },
  { id: "rfr-evaporator", system: "Reefer Unit", assembly: "Refrigeration", canonicalName: "Evaporator / Condenser", aliases: ["evaporator", "condenser", "reefer coil"], active: true },

  { id: "other-unmapped", system: "Other / Unmapped", assembly: "Unmapped", canonicalName: "Other / Unmapped Component", aliases: [], active: true },
]

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function loadRepairComponentCatalog(companyId?: string): RepairComponentCatalogEntry[] {
  if (typeof window === "undefined" || !companyId) return DEFAULT_REPAIR_COMPONENT_CATALOG
  try {
    const raw = window.localStorage.getItem(`${CATALOG_STORAGE_PREFIX}${companyId}`)
    if (!raw) return DEFAULT_REPAIR_COMPONENT_CATALOG
    const custom = JSON.parse(raw) as RepairComponentCatalogEntry[]
    const byId = new Map(DEFAULT_REPAIR_COMPONENT_CATALOG.map((entry) => [entry.id, entry]))
    for (const entry of custom) byId.set(entry.id, entry)
    return Array.from(byId.values()).filter((entry) => entry.active)
  } catch {
    return DEFAULT_REPAIR_COMPONENT_CATALOG
  }
}

export function matchRepairComponent(
  description: string,
  catalog: RepairComponentCatalogEntry[] = DEFAULT_REPAIR_COMPONENT_CATALOG,
): RepairComponentMatch | null {
  const source = normalize(description)
  if (!source) return null

  let best: RepairComponentMatch | null = null
  for (const entry of catalog) {
    if (!entry.active || entry.id === "other-unmapped") continue
    const candidates = [entry.canonicalName, ...entry.aliases].map(normalize).filter(Boolean)
    for (const candidate of candidates) {
      if (!source.includes(candidate)) continue
      const confidence = Math.min(0.98, 0.72 + candidate.length / Math.max(source.length, candidate.length) * 0.24)
      if (!best || confidence > best.confidence) best = { entry, confidence }
    }
  }
  return best
}
