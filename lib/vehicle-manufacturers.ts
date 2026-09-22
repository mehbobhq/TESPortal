import type { EquipmentType } from "@/src/types"

export type ManufacturerCategory = "power-unit" | "trailer"

export interface VehicleManufacturer {
  name: string
  code: string | null
  category: ManufacturerCategory
  aliases?: readonly string[]
  isOther?: boolean
}

const powerUnit = (
  name: string,
  code: string,
  aliases: readonly string[] = []
): VehicleManufacturer => ({ name, code, category: "power-unit", aliases })

const trailer = (
  name: string,
  code: string,
  aliases: readonly string[] = []
): VehicleManufacturer => ({ name, code, category: "trailer", aliases })

export const POWER_UNIT_MANUFACTURERS: readonly VehicleManufacturer[] = [
  powerUnit("American Motors", "AMER"),
  powerUnit("Aurora", "AURO"),
  powerUnit("Autocar", "AUTO"),
  powerUnit("Blue Bird", "BLUB"),
  powerUnit("BYD", "BYD"),
  powerUnit("Cardwell", "CARDW"),
  powerUnit("Caterpillar", "CAT"),
  powerUnit("Chevrolet", "CHEV", ["Chevy"]),
  powerUnit("Dodge", "DODG"),
  powerUnit("Ford", "FORD"),
  powerUnit("Foremost", "FOREM"),
  powerUnit("Freightliner", "FRHT", ["Freight Liner"]),
  powerUnit("Gatik", "GATK"),
  powerUnit("GMC", "GMC"),
  powerUnit("Hino", "HINO"),
  powerUnit("Honda", "HOND"),
  powerUnit("IC Corporation", "ICCO", ["IC Corp"]),
  powerUnit("IHC", "IHC"),
  powerUnit("International", "INTL"),
  powerUnit("Irontech", "IRONT", ["Iron Tech"]),
  powerUnit("Isuzu", "ISUZ"),
  powerUnit("Kalmar", "KALM"),
  powerUnit("Kenworth", "KW"),
  powerUnit("Kodiak", "KODI"),
  powerUnit("Kremco", "KREMC"),
  powerUnit("Liebherr", "LIEBH"),
  powerUnit("Link-Belt", "LBELT", ["Link Belt"]),
  powerUnit("Lion Electric", "LION"),
  powerUnit("Mack", "MACK"),
  powerUnit("Mainland", "MAINL"),
  powerUnit("MCI", "MCI"),
  powerUnit("Mercedes Benz", "MERZ", ["Mercedes-Benz"]),
  powerUnit("Mitsubishi", "MITS"),
  powerUnit("National", "NATIO"),
  powerUnit("Navistar", "NAVIS"),
  powerUnit("Nikola", "NIKO"),
  powerUnit("Nissan", "NISSA"),
  { ...powerUnit("Other", "OTH", ["Others", "Other / Unlisted"]), isOther: true },
  powerUnit("Pacific", "PACIF"),
  powerUnit("Peterbilt", "PTRB"),
  powerUnit("Prevost", "PREV"),
  powerUnit("Ram", "RAM"),
  powerUnit("Sterling", "STER"),
  powerUnit("Tesla", "TESL"),
  powerUnit("Torc", "TORC"),
  powerUnit("Toyota", "TOYT"),
  powerUnit("Volkswagen", "VOLK"),
  powerUnit("Volvo", "VOLV"),
  powerUnit("Western Star", "WSTR"),
  powerUnit("WhiteGMC", "WHGM", ["White GMC"]),
]

export const TRAILER_MANUFACTURERS: readonly VehicleManufacturer[] = [
  trailer("Alutrec", "ALUT"),
  trailer("Benson", "BENS"),
  trailer("Chaparral", "CHAP"),
  trailer("Doepker", "DOEP"),
  trailer("Dorsey", "DORS"),
  trailer("Dynawrap", "DYNA"),
  trailer("East", "EAST"),
  trailer("Extreme", "EXTR"),
  trailer("Felling", "FELL"),
  trailer("Fontaine", "FONT"),
  trailer("Fruehauf", "FRUE"),
  trailer("Great Dane", "GRDA"),
  trailer("Heil", "HEIL"),
  trailer("Hyundai Translead", "HYUN"),
  trailer("Jet", "JET"),
  trailer("Liddell", "LIDD"),
  trailer("Lobo", "LOBO"),
  trailer("MAC", "MAC"),
  trailer("Manac", "MANA"),
  trailer("Manac CPS", "MCPS"),
  trailer("Maximus", "MAXI"),
  trailer("Pinnacle", "PINN"),
  trailer("Pitts", "PITT"),
  trailer("Preston", "PRES"),
  trailer("Reitnouer", "REIT"),
  trailer("Stoughton", "STOU"),
  trailer("Strick", "STRI"),
  trailer("Timpte", "TIMP"),
  trailer("Trail King", "TRKI"),
  trailer("Trailmaster", "TRMA", ["Trail Master"]),
  trailer("Transcraft", "TRAN"),
  trailer("Trailers USA", "TUSA"),
  trailer("Utility", "UTIL"),
  trailer("Vanguard", "VANG"),
  trailer("Wabash", "WABA"),
  trailer("Wilson", "WILS"),
  { name: "Other", code: null, category: "trailer", aliases: ["Others", "Other / Unlisted"], isOther: true },
]

export function manufacturerCategoryForEquipment(equipmentType: EquipmentType): ManufacturerCategory {
  return equipmentType.startsWith("Trailer") || equipmentType === "Converter Dolly" ? "trailer" : "power-unit"
}

export function manufacturersForEquipment(equipmentType: EquipmentType): readonly VehicleManufacturer[] {
  return manufacturerCategoryForEquipment(equipmentType) === "trailer"
    ? TRAILER_MANUFACTURERS
    : POWER_UNIT_MANUFACTURERS
}

function comparisonKey(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function findVehicleManufacturer(
  value: string,
  equipmentType: EquipmentType
): VehicleManufacturer | null {
  const key = comparisonKey(value)
  if (!key) return null

  return manufacturersForEquipment(equipmentType).find((manufacturer) => {
    if (comparisonKey(manufacturer.name) === key) return true
    if (manufacturer.code && comparisonKey(manufacturer.code) === key) return true
    return manufacturer.aliases?.some((alias) => comparisonKey(alias) === key) ?? false
  }) ?? null
}

export function normalizeVehicleManufacturer(
  value: string,
  equipmentType: EquipmentType
): { name: string; code: string | null; matched: boolean } {
  const trimmed = value.trim()
  const manufacturer = findVehicleManufacturer(trimmed, equipmentType)
  if (!manufacturer) return { name: formatVehicleModel(trimmed), code: null, matched: false }
  return { name: manufacturer.name, code: manufacturer.code, matched: true }
}

export function formatVehicleModel(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/\d/.test(word) || (word.length <= 3 && word === word.toUpperCase())) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(" ")
}

export function displayEquipmentType(equipmentType: EquipmentType): string {
  return equipmentType === "Tractor" ? "Truck Tractor" : equipmentType
}
