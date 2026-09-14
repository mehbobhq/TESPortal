/**
 * Auto-save handler for Violation Tickets / Citations.
 *
 * There is no separate ticket/citation extraction schema in the Document AI
 * pipeline today — lib/google-document-ai-provider.ts's SOURCE_FIELD_MAP
 * only knows the Roadside Inspection field set (report/driver/carrier
 * identifiers, no fine amount, violation code, or act/section), so this
 * reuses the same mapMachineResultToRoadsideSource() mapper and observation
 * dataPointId namespace as auto-save-roadside.ts. Unlike Roadside
 * Inspection, the canonical "Traffic Citation" category
 * (lib/driver-performance-schema.ts) has no hard-required fields beyond the
 * base sourceType (which addPerformanceEvent deliberately excludes from its
 * required-field check), so this one can actually reach AUTO_SAVED with
 * today's extraction fields.
 */

import { mapMachineResultToRoadsideSource } from "@/lib/roadside-machine-mapper"
import { resolveRoadsideCanonicalOccurrence, type RoadsideMachineSourceRecord } from "@/lib/roadside-machine-schema"
import { evaluateIngestionConfidence } from "@/lib/ingestion-confidence"
import { resolveEntities } from "@/lib/ingestion-entity-resolver"
import { addPerformanceEvent } from "@/lib/driver-data"
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema"
import { logActivity } from "@/lib/activity-log"
import type { TESMachineDocumentResult } from "@/lib/machine-acquisition"
import type { DriverPerformanceEvent, StructuredEventFact } from "@/types/drivers"

const CITATION_REQUIRED_FIELDS = [
  "roadside.driver_licence_number",
  "roadside.driver_name",
  "roadside.report_number",
]

export type AutoSaveResult =
  | { status: "AUTO_SAVED"; eventId: string; companyId: string }
  | { status: "REVIEW_REQUIRED"; reason: string; draft: RoadsideMachineSourceRecord }
  | { status: "ENTITY_UNRESOLVED"; reason: string; draft: RoadsideMachineSourceRecord }
  | { status: "ERROR"; error: string }

function observationValue(result: TESMachineDocumentResult, dataPointId: string): string | undefined {
  const obs = result.observations.find((o) => o.dataPointId === dataPointId)
  if (!obs) return undefined
  const value = obs.normalizedValue ?? obs.rawValue
  return value === null || value === undefined ? undefined : String(value)
}

function buildFact(key: string, value: string | number | boolean): StructuredEventFact | null {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Traffic Citation"]
  const field = definition?.fields.find((f) => f.key === key)
  if (!field) return null
  return { dataPointId: field.dataPointId, value, valueType: field.valueType, source: "MACHINE_AUTO_SAVE" }
}

export async function autoSaveCitation(result: TESMachineDocumentResult): Promise<AutoSaveResult> {
  try {
    // 1. Map to roadside source record (shared mapper — see docblock)
    const draft = mapMachineResultToRoadsideSource(result)

    // 2. Evaluate confidence. MachineObservation carries the raw extracted
    // value as `rawValue`, not `value` — adapt to the shape
    // evaluateIngestionConfidence expects.
    const decision = evaluateIngestionConfidence(
      result.observations.map((o) => ({ dataPointId: o.dataPointId, confidence: o.confidence, value: o.rawValue })),
      CITATION_REQUIRED_FIELDS
    )

    if (decision.action === "REVIEW_REQUIRED") {
      return {
        status: "REVIEW_REQUIRED",
        reason: decision.reason,
        draft,
      }
    }

    const occurrence = resolveRoadsideCanonicalOccurrence(draft)
    if (!occurrence.eventDate) {
      return {
        status: "REVIEW_REQUIRED",
        reason: "No offence/citation date could be established from the source document.",
        draft,
      }
    }

    // 3. Resolve entities — same priority as Roadside: NSC/USDOT/carrier
    // name for company, licence number for driver, VIN/plate for vehicle.
    const firstEquipment = draft.equipment?.[0]
    const entities = resolveEntities({
      carrierName: draft.carrierName,
      nscNumber: observationValue(result, "roadside.carrier_nsc_number"),
      usdotNumber: undefined,
      driverLicenceNumber: draft.driverLicenceNumber,
      driverLicenceJurisdiction: draft.driverLicenceJurisdiction,
      driverName: draft.driverName,
      vin: firstEquipment?.vinSerialNumber,
      plateNumber: firstEquipment?.plateNumber,
      plateJurisdiction: firstEquipment?.plateJurisdiction,
    })

    if (!entities.company) {
      return {
        status: "ENTITY_UNRESOLVED",
        reason: `Cannot resolve company from: carrier="${draft.carrierName ?? ""}"`,
        draft,
      }
    }

    if (!entities.driver) {
      return {
        status: "ENTITY_UNRESOLVED",
        reason: `Cannot resolve driver from licence number "${draft.driverLicenceNumber ?? ""}"`,
        draft,
      }
    }

    // 4. Build the canonical Performance Event payload.
    const structuredEventFacts: StructuredEventFact[] = []
    if (draft.reportNumber) {
      const fact = buildFact("citationNumber", draft.reportNumber)
      if (fact) structuredEventFacts.push(fact)
    }
    // TODO: violationCode, fineAmount, pointsAssessed, courtJurisdiction,
    // courtDate, disposition are all fields on the canonical
    // citationDetails/Traffic Citation schema, but nothing in the current
    // Document AI field map (lib/google-document-ai-provider.ts) extracts
    // an offence/charge description, fine amount, act/section, or
    // disposition — there is no confident source for them here, so they
    // are left unset rather than guessed.
    const sourceTypeFact = buildFact("sourceType", "Citation")
    if (sourceTypeFact) structuredEventFacts.push(sourceTypeFact)

    const eventPayload: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> = {
      eventType: "Traffic Citation",
      eventDate: occurrence.eventDate,
      eventTime: occurrence.eventTime || undefined,
      vehicleId: entities.vehicle?.id,
      severity: "Not Applicable",
      status: "Not Applicable",
      summary: `Traffic Citation auto-saved from OCR (${draft.reportNumber || "no ticket number"})`,
      description: `Automatically created from a machine-processed citation/ticket document. Officer: ${draft.officerName || "not extracted"}${draft.officerNumber ? ` (${draft.officerNumber})` : ""}.`,
      descriptionOrigin: "SYSTEM_GENERATED",
      structuredEventFacts,
      linkedRecords: [],
      chronology: [],
      recordProcessingState: "EXTRACTED",
      evidenceIds: [result.sourceEvidenceId],
      provenance: {
        sourceType: "SOURCE_FACT",
        source: "Citation",
        sourceRecordId: draft.reportNumber,
        ingestionOrigin: "DOCUMENT_OCR",
        capturedAt: new Date().toISOString(),
        sourceEvidenceIds: [result.sourceEvidenceId],
        sourceConfidence: "HIGH",
        dataQuality: "HIGH",
      },
      ingestion: {
        origin: "DOCUMENT_OCR",
        sourceType: "Citation",
        sourceEvidenceIds: [result.sourceEvidenceId],
        receivedAt: result.providerMetadata.processedAt,
        processedAt: new Date().toISOString(),
        processorVersion: result.providerMetadata.processorVersion,
      },
    }

    // 5. Save the event, falling through to review on any canonical
    // validation failure rather than fabricating missing data.
    let saved: DriverPerformanceEvent
    try {
      saved = addPerformanceEvent(entities.company.id, entities.driver.id, eventPayload)
    } catch (validationError) {
      return {
        status: "REVIEW_REQUIRED",
        reason: validationError instanceof Error ? validationError.message : "Canonical record validation failed.",
        draft,
      }
    }

    // 6. Log activity
    logActivity(entities.company.id, {
      section: "performance",
      entityId: saved.id,
      entityLabel: `Traffic Citation — ${draft.reportNumber || saved.id}`,
      action: "Auto-saved from OCR",
      detail: `Confidence: ${((decision.lowestConfidence ?? 0) * 100).toFixed(1)}% | Officer: ${draft.officerName || "—"} | Driver: ${draft.driverName || "—"}`,
    })

    return {
      status: "AUTO_SAVED",
      eventId: saved.id,
      companyId: entities.company.id,
    }
  } catch (error) {
    return {
      status: "ERROR",
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
