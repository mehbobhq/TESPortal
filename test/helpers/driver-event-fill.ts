import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY, type PerformanceFieldDefinition } from "@/lib/driver-performance-schema";
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
  const facts = over.facts ?? minimalFacts(code);
  return { category: definition.value, title: `${definition.label} test`, sourceType: definition.sources[0], occurrence: { date: "2026-03-09", time: "08:30", timeZone: "America/Toronto" }, factUnits: unitsFor(code, facts), ...over, facts };
};

