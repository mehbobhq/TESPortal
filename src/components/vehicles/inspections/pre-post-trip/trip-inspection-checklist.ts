export const TRIP_INSPECTION_TEMPLATE_VERSION = "TES-TRIP-1.0.0" as const

export type EquipmentScope = "POWER_UNIT" | "TRAILER"

export type ChecklistDefinition = {
  id: string
  scope: EquipmentScope
  group: string
  label: string
  sourceLabel: string
  regulatoryCategories: string[]
}

export const POWER_UNIT_CHECKLIST: readonly ChecklistDefinition[] = [
  { id: "PU_AIR_COMPRESSOR", scope: "POWER_UNIT", group: "Brake systems", label: "Air compressor", sourceLabel: "Air Compressor", regulatoryCategories: ["NSC13_AIR_BRAKE", "FMCSA_SERVICE_BRAKES"] },
  { id: "PU_AIR_LINES", scope: "POWER_UNIT", group: "Brake systems", label: "Air lines", sourceLabel: "Air Lines", regulatoryCategories: ["NSC13_AIR_BRAKE", "FMCSA_SERVICE_BRAKES"] },
  { id: "PU_BATTERY", scope: "POWER_UNIT", group: "Electrical and starting", label: "Battery", sourceLabel: "Battery", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_BELTS_HOSES", scope: "POWER_UNIT", group: "Engine and fluids", label: "Belts and hoses", sourceLabel: "Belts and Hoses", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_BODY", scope: "POWER_UNIT", group: "Body and frame", label: "Body", sourceLabel: "Body", regulatoryCategories: ["NSC13_FRAME_CARGO_BODY"] },
  { id: "PU_BRAKE_ACCESSORIES", scope: "POWER_UNIT", group: "Brake systems", label: "Brake accessories", sourceLabel: "Brake Accessories", regulatoryCategories: ["NSC13_AIR_BRAKE", "FMCSA_SERVICE_BRAKES"] },
  { id: "PU_BRAKES_PARKING", scope: "POWER_UNIT", group: "Brake systems", label: "Parking brakes", sourceLabel: "Brakes, Parking", regulatoryCategories: ["NSC13_AIR_BRAKE", "NSC13_HYDRAULIC_BRAKE", "FMCSA_PARKING_BRAKE"] },
  { id: "PU_BRAKES_SERVICE", scope: "POWER_UNIT", group: "Brake systems", label: "Service brakes", sourceLabel: "Brakes, Service", regulatoryCategories: ["NSC13_AIR_BRAKE", "NSC13_HYDRAULIC_BRAKE", "FMCSA_SERVICE_BRAKES"] },
  { id: "PU_CLUTCH", scope: "POWER_UNIT", group: "Controls and drivetrain", label: "Clutch", sourceLabel: "Clutch", regulatoryCategories: ["NSC13_DRIVER_CONTROLS"] },
  { id: "PU_COUPLING_DEVICES", scope: "POWER_UNIT", group: "Coupling", label: "Coupling devices", sourceLabel: "Coupling Devices", regulatoryCategories: ["NSC13_COUPLING", "FMCSA_COUPLING"] },
  { id: "PU_DEFROSTER_HEATER", scope: "POWER_UNIT", group: "Cab and visibility", label: "Defroster and heater", sourceLabel: "Defroster/ Heater", regulatoryCategories: ["NSC13_HEATER_DEFROSTER"] },
  { id: "PU_DRIVE_LINE", scope: "POWER_UNIT", group: "Controls and drivetrain", label: "Drive line", sourceLabel: "Drive Line", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_ENGINE", scope: "POWER_UNIT", group: "Engine and fluids", label: "Engine", sourceLabel: "Engine", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_EXHAUST", scope: "POWER_UNIT", group: "Exhaust", label: "Exhaust", sourceLabel: "Exhaust", regulatoryCategories: ["NSC13_EXHAUST"] },
  { id: "PU_FIFTH_WHEEL", scope: "POWER_UNIT", group: "Coupling", label: "Fifth wheel", sourceLabel: "Fifth Wheel", regulatoryCategories: ["NSC13_COUPLING", "FMCSA_COUPLING"] },
  { id: "PU_FLUID_LEVELS", scope: "POWER_UNIT", group: "Engine and fluids", label: "Fluid levels", sourceLabel: "Fluid Levels", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_FRAME_ASSEMBLY", scope: "POWER_UNIT", group: "Body and frame", label: "Frame and assembly", sourceLabel: "Frame and Assembly", regulatoryCategories: ["NSC13_FRAME_CARGO_BODY"] },
  { id: "PU_FRONT_AXLE", scope: "POWER_UNIT", group: "Steering and suspension", label: "Front axle", sourceLabel: "Front Axle", regulatoryCategories: ["NSC13_STEERING", "NSC13_SUSPENSION"] },
  { id: "PU_FUEL_TANKS", scope: "POWER_UNIT", group: "Fuel system", label: "Fuel tanks", sourceLabel: "Fuel Tanks", regulatoryCategories: ["NSC13_FUEL_SYSTEM"] },
  { id: "PU_GENERATOR", scope: "POWER_UNIT", group: "Electrical and starting", label: "Generator", sourceLabel: "Generator", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_HORN", scope: "POWER_UNIT", group: "Cab and visibility", label: "Horn", sourceLabel: "Horn", regulatoryCategories: ["NSC13_HORN", "FMCSA_HORN"] },
  { id: "PU_LIGHTS_HEAD_STOP", scope: "POWER_UNIT", group: "Lights and reflectors", label: "Head and stop lights", sourceLabel: "Lights - Head - Stop", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "PU_LIGHTS_TAIL_DASH", scope: "POWER_UNIT", group: "Lights and reflectors", label: "Tail and dash lights", sourceLabel: "Lights - Tail - Dash", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "PU_LIGHTS_TURN_INDICATORS", scope: "POWER_UNIT", group: "Lights and reflectors", label: "Turn indicators", sourceLabel: "Lights - Turn Indicators", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "PU_MIRRORS", scope: "POWER_UNIT", group: "Cab and visibility", label: "Mirrors", sourceLabel: "Mirrors", regulatoryCategories: ["NSC13_GLASS_MIRRORS", "FMCSA_REAR_VISION_MIRRORS"] },
  { id: "PU_MUFFLER", scope: "POWER_UNIT", group: "Exhaust", label: "Muffler", sourceLabel: "Muffler", regulatoryCategories: ["NSC13_EXHAUST"] },
  { id: "PU_OIL_LEVEL", scope: "POWER_UNIT", group: "Engine and fluids", label: "Oil level", sourceLabel: "Oil Level", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_RADIATOR_LEVEL", scope: "POWER_UNIT", group: "Engine and fluids", label: "Radiator level", sourceLabel: "Radiator Level", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_REAR_END", scope: "POWER_UNIT", group: "Controls and drivetrain", label: "Rear end", sourceLabel: "Rear End", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_REFLECTORS", scope: "POWER_UNIT", group: "Lights and reflectors", label: "Reflectors", sourceLabel: "Reflectors", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "PU_FIRE_EXTINGUISHER", scope: "POWER_UNIT", group: "Emergency equipment", label: "Fire extinguisher", sourceLabel: "Fire Extinguisher", regulatoryCategories: ["NSC13_EMERGENCY_EQUIPMENT", "FMCSA_EMERGENCY_EQUIPMENT"] },
  { id: "PU_FLAGS_FLARES_FUSEES", scope: "POWER_UNIT", group: "Emergency equipment", label: "Flags, flares and fusees", sourceLabel: "Flags- Flares - Fusees", regulatoryCategories: ["NSC13_EMERGENCY_EQUIPMENT", "FMCSA_EMERGENCY_EQUIPMENT"] },
  { id: "PU_REFLECTIVE_TRIANGLES", scope: "POWER_UNIT", group: "Emergency equipment", label: "Reflective triangles", sourceLabel: "Reflective Triangles", regulatoryCategories: ["NSC13_EMERGENCY_EQUIPMENT", "FMCSA_EMERGENCY_EQUIPMENT"] },
  { id: "PU_SPARE_BULBS_FUSES", scope: "POWER_UNIT", group: "Emergency equipment", label: "Spare bulbs and fuses", sourceLabel: "Spare Bulbs and Fuses", regulatoryCategories: ["COMPANY_POLICY"] },
  { id: "PU_SPARE_SEALED_BEAM", scope: "POWER_UNIT", group: "Emergency equipment", label: "Spare sealed-beam lamp", sourceLabel: "Spare Seal Beam", regulatoryCategories: ["COMPANY_POLICY"] },
  { id: "PU_STARTER", scope: "POWER_UNIT", group: "Electrical and starting", label: "Starter", sourceLabel: "Starter", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_STEERING", scope: "POWER_UNIT", group: "Steering and suspension", label: "Steering", sourceLabel: "Steering", regulatoryCategories: ["NSC13_STEERING", "FMCSA_STEERING"] },
  { id: "PU_SUSPENSION_SYSTEM", scope: "POWER_UNIT", group: "Steering and suspension", label: "Suspension system", sourceLabel: "Suspension System", regulatoryCategories: ["NSC13_SUSPENSION"] },
  { id: "PU_TIRE_CHAINS", scope: "POWER_UNIT", group: "Tires, wheels and hubs", label: "Tire chains", sourceLabel: "Tire Chains", regulatoryCategories: ["COMPANY_POLICY"] },
  { id: "PU_TIRES", scope: "POWER_UNIT", group: "Tires, wheels and hubs", label: "Tires", sourceLabel: "Tire", regulatoryCategories: ["NSC13_TIRES", "FMCSA_TIRES"] },
  { id: "PU_TRANSMISSION", scope: "POWER_UNIT", group: "Controls and drivetrain", label: "Transmission", sourceLabel: "Transmission", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
  { id: "PU_TRIP_RECORDER", scope: "POWER_UNIT", group: "Controls and drivetrain", label: "Trip recorder", sourceLabel: "Trip Recorder", regulatoryCategories: ["COMPANY_POLICY"] },
  { id: "PU_WHEELS_RIMS", scope: "POWER_UNIT", group: "Tires, wheels and hubs", label: "Wheels and rims", sourceLabel: "Wheels and Rims", regulatoryCategories: ["NSC13_WHEELS_HUBS_FASTENERS", "FMCSA_WHEELS_RIMS"] },
  { id: "PU_WINDOWS", scope: "POWER_UNIT", group: "Cab and visibility", label: "Windows", sourceLabel: "Windows", regulatoryCategories: ["NSC13_GLASS_MIRRORS"] },
  { id: "PU_WINDSHIELD_WIPERS", scope: "POWER_UNIT", group: "Cab and visibility", label: "Windshield wipers", sourceLabel: "Windshield Wipers", regulatoryCategories: ["NSC13_WIPER_WASHER", "FMCSA_WINDSHIELD_WIPERS"] },
  { id: "PU_OTHER", scope: "POWER_UNIT", group: "Other", label: "Other observed condition", sourceLabel: "Other", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
] as const

export const TRAILER_CHECKLIST: readonly ChecklistDefinition[] = [
  { id: "TRAILER_BRAKE_CONNECTIONS", scope: "TRAILER", group: "Brake systems", label: "Brake connections", sourceLabel: "Brake Connections", regulatoryCategories: ["NSC13_AIR_BRAKE", "FMCSA_TRAILER_BRAKE_CONNECTIONS"] },
  { id: "TRAILER_BRAKES", scope: "TRAILER", group: "Brake systems", label: "Brakes", sourceLabel: "Brakes", regulatoryCategories: ["NSC13_AIR_BRAKE", "NSC13_ELECTRIC_BRAKE", "FMCSA_SERVICE_BRAKES"] },
  { id: "TRAILER_COUPLING_DEVICES", scope: "TRAILER", group: "Coupling", label: "Coupling devices", sourceLabel: "Coupling Devices", regulatoryCategories: ["NSC13_COUPLING", "FMCSA_COUPLING"] },
  { id: "TRAILER_KING_PIN", scope: "TRAILER", group: "Coupling", label: "Kingpin", sourceLabel: "Coupling (King) Pin", regulatoryCategories: ["NSC13_COUPLING", "FMCSA_COUPLING"] },
  { id: "TRAILER_DOORS", scope: "TRAILER", group: "Body and cargo", label: "Doors", sourceLabel: "Doors", regulatoryCategories: ["NSC13_FRAME_CARGO_BODY"] },
  { id: "TRAILER_HITCH", scope: "TRAILER", group: "Coupling", label: "Hitch", sourceLabel: "Hitch", regulatoryCategories: ["NSC13_COUPLING", "FMCSA_COUPLING"] },
  { id: "TRAILER_LIGHTING_GEAR", scope: "TRAILER", group: "Lights and reflectors", label: "Lighting gear", sourceLabel: "Lighting Gear", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "TRAILER_LIGHTS_ALL", scope: "TRAILER", group: "Lights and reflectors", label: "All trailer lights", sourceLabel: "Lights - All", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "TRAILER_REFLECTORS_TAPE", scope: "TRAILER", group: "Lights and reflectors", label: "Reflectors and reflective tape", sourceLabel: "Reflectors/ Reflective Tape", regulatoryCategories: ["NSC13_LAMPS_REFLECTORS", "FMCSA_LIGHTING_REFLECTORS"] },
  { id: "TRAILER_ROOF", scope: "TRAILER", group: "Body and cargo", label: "Roof", sourceLabel: "Roof", regulatoryCategories: ["NSC13_FRAME_CARGO_BODY"] },
  { id: "TRAILER_SUSPENSION_SYSTEM", scope: "TRAILER", group: "Suspension", label: "Suspension system", sourceLabel: "Suspension System", regulatoryCategories: ["NSC13_SUSPENSION"] },
  { id: "TRAILER_STRAPS", scope: "TRAILER", group: "Cargo securement", label: "Straps", sourceLabel: "Straps", regulatoryCategories: ["NSC13_CARGO_SECUREMENT", "NSC10_CARGO_SECUREMENT"] },
  { id: "TRAILER_TARPAULIN", scope: "TRAILER", group: "Cargo securement", label: "Tarpaulin or load covering", sourceLabel: "Tarpaulin", regulatoryCategories: ["NSC13_CARGO_SECUREMENT", "NSC10_CARGO_SECUREMENT"] },
  { id: "TRAILER_TIRES", scope: "TRAILER", group: "Tires, wheels and hubs", label: "Tires", sourceLabel: "Tires", regulatoryCategories: ["NSC13_TIRES", "FMCSA_TIRES"] },
  { id: "TRAILER_WHEELS_RIMS", scope: "TRAILER", group: "Tires, wheels and hubs", label: "Wheels and rims", sourceLabel: "Wheels and Rims", regulatoryCategories: ["NSC13_WHEELS_HUBS_FASTENERS", "FMCSA_WHEELS_RIMS"] },
  { id: "TRAILER_OTHER", scope: "TRAILER", group: "Other", label: "Other observed condition", sourceLabel: "Others", regulatoryCategories: ["GENERAL_SAFE_OPERATION"] },
] as const

if (POWER_UNIT_CHECKLIST.length !== 46) throw new Error("Power-unit checklist must contain exactly 46 definitions.")
if (TRAILER_CHECKLIST.length !== 16) throw new Error("Trailer checklist must contain exactly 16 definitions.")

export function groupChecklist(definitions: readonly ChecklistDefinition[]) {
  return definitions.reduce<Record<string, ChecklistDefinition[]>>((groups, definition) => {
    ;(groups[definition.group] ||= []).push(definition)
    return groups
  }, {})
}

