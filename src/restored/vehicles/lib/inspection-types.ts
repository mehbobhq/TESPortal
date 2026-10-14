/**
 * The controlled vocabulary for Inspection Type. src/types.ts holds the same list, but that module re-exports a large
 * unrelated model, so restored code takes the list from here; a static test keeps the two identical.
 */
export const INSPECTION_TYPES = [
  "Annual / Periodic Commercial Vehicle Inspection",
  "Provincial or State Safety Inspection",
  "Pre-Trip / Post-Trip Inspection",
  "Roadside / CVSA Inspection",
  "Emissions Test",
  "Post-Incident Mechanical Inspection",
  "Reefer Unit Operational Check",
] as const

export type InspectionType = (typeof INSPECTION_TYPES)[number]
