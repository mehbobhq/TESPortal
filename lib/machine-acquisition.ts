import type { StructuredEventFactValue } from "@/types/drivers";

export type MachineDocumentClass =
  | "ROADSIDE_INSPECTION"
  | "CLASSIFICATION_REVIEW_REQUIRED"
  | "CLASSIFICATION_AMBIGUOUS"
  | "UNMAPPED_DOCUMENT_CLASS";

export interface MachineSourceLocation {
  page?: number;
  textAnchorStart?: number;
  textAnchorEnd?: number;
  boundingPolygon?: Array<{ x?: number; y?: number }>;
}
export interface MachineObservation {
  dataPointId: string;
  rawValue: StructuredEventFactValue;
  normalizedValue?: StructuredEventFactValue;
  confidence?: number;
  sourceLocation?: MachineSourceLocation;
  providerEntityId?: string;
  method?: "EXTRACT" | "DERIVE" | "RELAXED_EXTRACT" | "UNKNOWN";
}
export interface MachineDocumentClassification {
  documentClass: MachineDocumentClass;
  sourceDocumentTitle?: string;
  confidence?: number;
  autoRouteEligible: boolean;
  reason: string;
}
export interface MachineProviderMetadata {
  provider: string;
  processor?: string;
  processorVersion?: string;
  model?: string;
  processedAt: string;
}
export interface TESMachineDocumentResult {
  sourceEvidenceId: string;
  classification: MachineDocumentClassification;
  observations: MachineObservation[];
  providerMetadata: MachineProviderMetadata;
  warnings: string[];
}
export interface MachineAcquisitionRequest {
  evidenceId: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
}
export interface MachineAcquisitionProvider {
  readonly providerName: string;
  process(request: MachineAcquisitionRequest): Promise<TESMachineDocumentResult>;
}
export const ROADSIDE_AUTO_ROUTE_CONFIDENCE = 0.99;
export function classifyRoadsideForRouting(confidence: number | undefined, sourceDocumentTitle?: string): MachineDocumentClassification {
  const numericConfidence = typeof confidence === "number" ? confidence : undefined;
  if (numericConfidence !== undefined && numericConfidence >= ROADSIDE_AUTO_ROUTE_CONFIDENCE) {
    return { documentClass: "ROADSIDE_INSPECTION", sourceDocumentTitle, confidence: numericConfidence, autoRouteEligible: true, reason: "Roadside Inspection classification met the TES automatic-routing threshold." };
  }
  return { documentClass: "CLASSIFICATION_REVIEW_REQUIRED", sourceDocumentTitle, confidence: numericConfidence, autoRouteEligible: false, reason: "Roadside Inspection classification requires internal verification before routing." };
}
