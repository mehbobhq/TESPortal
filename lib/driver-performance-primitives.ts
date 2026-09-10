import type { PerformanceApplicabilityRule, PerformanceValidationDefinition } from "@/lib/driver-performance-schema";
import type { PerformanceAcquisitionType } from "@/types/drivers";

export interface DriverPerformanceSemanticPrimitive {
  id: string;
  version: string;
  dataPointIds: readonly string[];
  applicability?: readonly PerformanceApplicabilityRule[];
  validation?: PerformanceValidationDefinition;
  sourceCapabilities?: readonly PerformanceAcquisitionType[];
  observationPolicy?: "SOURCE_OBSERVATION" | "DERIVED_ONLY" | "SOURCE_OR_DERIVED";
  relationshipBoundary?: string;
}

export const DRIVER_PERFORMANCE_PRIMITIVES: readonly DriverPerformanceSemanticPrimitive[] = [
  { id: "LOCATION", version: "1.0", dataPointIds: ["DRV.PERF.LOCATION", "DRV.PERF.CITY", "DRV.PERF.STATEPROVINCE", "DRV.PERF.COUNTRY"], sourceCapabilities: ["DOCUMENT", "API", "TELEMATICS", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "OPERATING_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.SHARED.LOAD_STATE", "DRV.PERF.SHARED.DUTY_CONTEXT", "DRV.PERF.SHARED.ZONE_TYPE"], sourceCapabilities: ["DOCUMENT", "API", "TELEMATICS", "ELD", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "WEATHER_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.SHARED.WEATHER_CONDITION", "DRV.PERF.SHARED.ROAD_SURFACE", "DRV.PERF.SHARED.LIGHTING_CONDITION"], sourceCapabilities: ["DOCUMENT", "API", "TELEMATICS", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "REGULATORY_IDENTITY", version: "1.0", dataPointIds: ["DRV.PERF.JURISDICTION", "DRV.PERF.INSPECTIONREGIME", "DRV.PERF.INSPECTIONCLASSIFICATION", "DRV.PERF.AGENCY", "DRV.PERF.INSPECTIONREPORTNUMBER"], sourceCapabilities: ["DOCUMENT", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION", relationshipBoundary: "Regulatory source identity only; no universal regulatory master is created here." },
  { id: "OOS_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.OOSSCOPE", "DRV.PERF.DRIVEROOSSTATE", "DRV.PERF.VEHICLEOOSSTATE", "DRV.PERF.OOSTYPE"], sourceCapabilities: ["DOCUMENT", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "FINANCIAL_IMPACT", version: "1.0", dataPointIds: ["DRV.PERF.ESTIMATEDLOSSAMOUNT", "DRV.PERF.FINEAMOUNT"], sourceCapabilities: ["DOCUMENT", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "CARGO_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.CARGOISSUETYPE", "DRV.PERF.CARGOREFERENCE", "DRV.PERF.CARGODESCRIPTION", "DRV.PERF.QUANTITYAFFECTED"], sourceCapabilities: ["DOCUMENT", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "CUSTOMER_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.CUSTOMERNAME", "DRV.PERF.CUSTOMERREFERENCE", "DRV.PERF.LOADNUMBER"], sourceCapabilities: ["DOCUMENT", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "TELEMATICS_MEASUREMENT", version: "1.0", dataPointIds: ["DRV.PERF.ACTUALSPEED", "DRV.PERF.PEAKSPEED", "DRV.PERF.TRIGGERDECELERATION", "DRV.PERF.TRIGGERACCELERATION"], sourceCapabilities: ["TELEMATICS", "ELD", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
  { id: "VEHICLE_RELATIONSHIP_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.VEHICLESOURCEVIN", "DRV.PERF.VEHICLESOURCEPLATE", "DRV.PERF.VEHICLESOURCEUNITNUMBER"], sourceCapabilities: ["DOCUMENT", "API", "TELEMATICS", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION", relationshipBoundary: "Source-observed identifiers resolve to the canonical Vehicle store; they are never a second Vehicle master." },
  { id: "HOS_RELATIONSHIP_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.RELATEDHOS", "DRV.PERF.RULEJURISDICTION", "DRV.PERF.LOGDATE"], sourceCapabilities: ["DOCUMENT", "API", "ELD", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION", relationshipBoundary: "Canonical HOS remains authoritative." },
  { id: "INJURY_CONTEXT", version: "1.0", dataPointIds: ["DRV.PERF.INJURYCONTEXT", "DRV.PERF.INJURYREFERENCE", "DRV.PERF.INJURYDATE"], sourceCapabilities: ["DOCUMENT", "API", "MANUAL_FALLBACK"], observationPolicy: "SOURCE_OBSERVATION" },
];

export const DRIVER_PERFORMANCE_PRIMITIVE_BY_ID = Object.freeze(
  Object.fromEntries(DRIVER_PERFORMANCE_PRIMITIVES.map((primitive) => [primitive.id, primitive])) as Record<string, DriverPerformanceSemanticPrimitive>,
);

export function getDriverPerformancePrimitive(id: string | undefined): DriverPerformanceSemanticPrimitive | undefined {
  return id ? DRIVER_PERFORMANCE_PRIMITIVE_BY_ID[id] : undefined;
}
