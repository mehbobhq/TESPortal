import { readFileSync } from "node:fs";
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, type PerformanceFieldDefinition } from "@/lib/driver-performance-schema";
import { createRoadsideEquipmentCollection, createRoadsideEquipmentItem, ROADSIDE_EQUIPMENT_COLLECTION_ID } from "@/lib/driver-performance-child-facts";
import { fieldIsVisible, type EventInput, type Scalar } from "@/lib/driver-events/validation";

function sample(field: PerformanceFieldDefinition): Scalar {
  switch (field.kind) {
    case "number": return Math.min(Math.max(field.validation?.min ?? 0, 1), field.validation?.max ?? 1_000_000);
    case "boolean": return true;
    case "date": return "2026-03-01";
    case "time": return "10:15";
    case "select": return field.options?.[0]?.value ?? "UNKNOWN";
    default: return "Sample text";
  }
}

/** Fills every required, applicable fact (re-evaluating conditions after each answer) so a category can be exercised without hand-written fixtures. */
export function minimalFacts(code: string): Record<string, Scalar> {
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === code)!;
  const facts: Record<string, Scalar> = {};
  for (let pass = 0; pass < 6; pass++) {
    for (const field of definition.fields) {
      if (field.hiddenInCreation || field.key in facts || !fieldIsVisible(field, facts)) continue;
      if (field.required) facts[field.key] = sample(field);
    }
  }
  return facts;
}

export function unitsFor(code: string, facts: Record<string, Scalar>): Record<string, string> {
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === code)!;
  return Object.fromEntries(definition.fields.filter((f) => f.unitOptions?.length && f.key in facts).map((f) => [f.key, f.unitOptions![0]]));
}

export const minimalInput = (code: string, over: Partial<EventInput> = {}): EventInput => {
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === code)!;
  if (DETAILED_CODES.includes(code)) return wizardRecord(code, { title: `${definition.label} test`, ...over });
  const facts = over.facts ?? minimalFacts(code);
  const childCollections = code === "ROADSIDE_INSPECTION" ? { [ROADSIDE_EQUIPMENT_COLLECTION_ID]: createRoadsideEquipmentCollection([createRoadsideEquipmentItem({ role: "POWER_UNIT", equipmentType: "Tractor" })]) } : {};
  return { category: definition.value, title: `${definition.label} test`, sourceType: definition.sources[0], occurrence: { date: "2026-03-09", time: "08:30", timeZone: "America/Toronto" }, factUnits: unitsFor(code, facts), childCollections, ...over, facts };
};


/**
 * The five detailed workflows (Collision, Near Miss, Cargo Incident, Spill or Release, Customer Event) are held to their own workflow rules by the server, so a bare
 * "required facts" record is refused. These records were produced by the real wizards and accepted by their validators; `wizardRecord` returns one, re-pointed at the caller's vehicle.
 */
export const DETAILED_CODES = ["COLLISION", "NEAR_MISS", "CARGO_INCIDENT", "SPILL_RELEASE", "CUSTOMER_EVENT"];
const WIZARD_RECORDS = JSON.parse(readFileSync(new URL("../fixtures/driver-events/wizard-valid-records.json", import.meta.url), "utf8")) as Record<string, Record<string, unknown>>;
export function wizardRecord(code: string, over: Partial<EventInput> = {}): EventInput {
  const base = JSON.parse(JSON.stringify(WIZARD_RECORDS[code])) as EventInput & { vehicleRelationshipId: string };
  const original = base.vehicleRelationshipId;
  const vehicle = (over.vehicleRelationshipId as string | undefined) ?? original;
  const fixtureDay = "2026-03-09";
  const newDay = over.occurrence?.date ?? fixtureDay; // every date in the record moves with the occurrence so their order is unchanged
  const swap = (v: unknown): unknown => (v === original ? vehicle : typeof v === "string" && v.startsWith(fixtureDay) ? newDay + v.slice(fixtureDay.length) : Array.isArray(v) ? v.map(swap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  const input = swap(base) as EventInput;
  return { ...input, ...over, vehicleRelationshipId: vehicle };
}
