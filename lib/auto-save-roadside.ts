/**
 * Auto-save handler for Roadside Inspection documents.
 *
 * IMPORTANT — read before changing the required-field list or "why doesn't
 * this ever AUTO_SAVE" behavior:
 *
 * lib/driver-data.ts's addPerformanceEvent() enforces the real Roadside
 * Inspection schema (lib/driver-performance-schema.ts) at write time. That
 * schema marks jurisdiction, inspectionRegime, inspectionScope, and inspectionResult
 * (plus driver/vehicle OOS results
 * once scope is known) as hard-required fields — and none of those concepts
 * are extracted anywhere in the current Google Document AI field map
 * (lib/google-document-ai-provider.ts's SOURCE_FIELD_MAP only surfaces
 * report/driver/carrier/officer/equipment/finding identifiers, not
 * jurisdiction/regime/classification/scope). Rather than invent values for
 * those fields to force an auto-save through, this module lets
 * addPerformanceEvent's own validation be authoritative: if it throws
 * because required data isn't present, that throw is caught and converted
 * into REVIEW_REQUIRED. In today's extraction pipeline that means Roadside
 * Inspection auto-save will rarely (if ever) actually fire — that is
 * intentional, not a bug. It will start firing on its own once the OCR
 * schema is extended to also extract those fields with high confidence.
 */

import { mapMachineResultToRoadsideSource } from "@/lib/roadside-machine-mapper"
import { resolveRoadsideCanonicalFacts, resolveRoadsideCanonicalOccurrence, type RoadsideMachineSourceRecord } from "@/lib/roadside-machine-schema"
import { evaluateIngestionConfidence } from "@/lib/ingestion-confidence"
import { resolveEntities } from "@/lib/ingestion-entity-resolver"
import { addPerformanceEvent, persistPerformanceRelationshipResolutions } from "@/lib/driver-data"
import { resolveCanonicalVehicleByIdentifiers } from "@/lib/vehicle-data"
import { createRoadsideEquipmentCollection, createRoadsideEquipmentItem, createRoadsideViolationCollection, createRoadsideViolationItem } from "@/lib/driver-performance-child-facts"
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema"
import { logActivity } from "@/lib/activity-log"
import type { TESMachineDocumentResult } from "@/lib/machine-acquisition"
import type { DriverPerformanceEvent, PerformanceRelationshipResolution, StructuredEventFact } from "@/types/drivers"

// Required fields that must meet 98% threshold for auto-save. These are
// Document AI OBSERVATION dataPointIds (lib/google-document-ai-provider.ts's
// SOURCE_FIELD_MAP namespace), a different id-space from the canonical
// StructuredEventFact dataPointIds used once a record is actually saved.
const ROADSIDE_REQUIRED_FIELDS = [
  "roadside.driver_licence_number",
  "roadside.driver_name",
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
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Roadside Inspection"]
  const field = definition?.fields.find((f) => f.key === key)
  if (!field) return null
  return { dataPointId: field.dataPointId, value, valueType: field.valueType, source: "MACHINE_AUTO_SAVE" }
}

function roadsideSubjectFromFinding(finding: RoadsideMachineSourceRecord["findings"][number]): "DRIVER" | "OPERATING_CARRIER" | "POWER_UNIT" | "TOWED_UNIT" | "OTHER" {
  const item = (finding.inspectionItem || finding.defectCategory || "").trim().toUpperCase()
  const reference = (finding.sourceEquipmentReference || finding.sourceUnitNumber || "").trim().toUpperCase()
  if (item === "DRIVER" || item.includes("HOURS")) return "DRIVER"
  if (reference === "PU" || reference === "POWER UNIT") return "POWER_UNIT"
  if (/^T\d+$/.test(reference) || reference.includes("TRAILER")) return "TOWED_UNIT"
  return "OTHER"
}

function roadsideEquipmentIdForFinding(
  finding: RoadsideMachineSourceRecord["findings"][number],
  equipment: Array<{ itemId: string; role: "POWER_UNIT" | "TOWED_UNIT" }>
): string | undefined {
  const reference = (finding.sourceEquipmentReference || finding.sourceUnitNumber || "").trim().toUpperCase()
  if (reference === "PU" || reference === "POWER UNIT") {
    return equipment.find((item) => item.role === "POWER_UNIT")?.itemId
  }
  const trailerMatch = reference.match(/^T(\d+)$/)
  if (trailerMatch) {
    const trailerIndex = Number(trailerMatch[1]) - 1
    return equipment.filter((item) => item.role === "TOWED_UNIT")[trailerIndex]?.itemId
  }
  return undefined
}

function inferredRoadsideEquipmentType(role: "POWER_UNIT" | "TOWED_UNIT", sourceType?: string): string | undefined {
  if (sourceType?.trim()) return sourceType.trim()
  return role === "POWER_UNIT" ? "Tractor" : undefined
}

function roadsideFindingDescription(finding: RoadsideMachineSourceRecord["findings"][number]): string | undefined {
  const code = (finding.sourceResultCode || "").trim().toUpperCase()
  const codeLabel = code === "X" ? "Violation Present" : code === "O" ? "Out of Service" : code === "N" ? "Inspection Note" : ""
  const text = finding.violationDescription || finding.defectDescription || finding.comments || ""
  return [codeLabel ? `Source result ${code}: ${codeLabel}.` : "", text].filter(Boolean).join(" ") || undefined
}

function buildEquipmentVehicleResolution(
  eventId: string,
  itemId: string,
  resolved: ReturnType<typeof resolveCanonicalVehicleByIdentifiers>,
  evidenceId: string,
): PerformanceRelationshipResolution {
  return {
    id: `PRR-${eventId}-equipment:${itemId}`,
    eventId,
    fromEntityType: "DriverPerformanceEvent",
    fromEntityId: eventId,
    relationshipKey: `equipment:${itemId}`,
    relationshipType: "ASSOCIATED_WITH",
    targetEntityType: "Vehicle",
    toEntityId: resolved.canonicalVehicle?.id,
    resolvedRecordId: resolved.canonicalVehicle?.id,
    state: resolved.state,
    candidateIds: resolved.candidateVehicleIds,
    deterministicMatchingReason: resolved.reason,
    resolutionMethod: resolved.method,
    resolvedEntityCompanyId: resolved.canonicalCompanyId,
    resolvedEntitySummary: resolved.canonicalVehicle
      ? `${resolved.canonicalVehicle.year} ${resolved.canonicalVehicle.make} ${resolved.canonicalVehicle.model} · Unit ${resolved.canonicalVehicle.unitNumber} · VIN ${resolved.canonicalVehicle.vin}`
      : undefined,
    conflictCodes: resolved.conflicts,
    identifierDiscrepancies: resolved.identifierDiscrepancies,
    resolutionSource: "DETERMINISTIC_RESOLVER",
    evidenceIds: [evidenceId],
    evaluatedAt: resolved.evaluatedAt,
  }
}

export async function autoSaveRoadsideInspection(result: TESMachineDocumentResult): Promise<AutoSaveResult> {
  try {
    // 1. Map to roadside source record
    const draft = mapMachineResultToRoadsideSource(result)

    // 2. Evaluate confidence. MachineObservation carries the raw extracted
    // value as `rawValue`, not `value` — adapt to the shape
    // evaluateIngestionConfidence expects.
    const decision = evaluateIngestionConfidence(
      result.observations.map((o) => ({ dataPointId: o.dataPointId, confidence: o.confidence, value: o.rawValue })),
      ROADSIDE_REQUIRED_FIELDS
    )

    if (decision.action === "REVIEW_REQUIRED") {
      return {
        status: "REVIEW_REQUIRED",
        reason: decision.reason,
        draft,
      }
    }

    // A canonical event requires the actual occurrence date. Processing time
    // belongs to ingestion metadata and cannot stand in for this source fact.
    const occurrence = resolveRoadsideCanonicalOccurrence(draft)
    const eventDate = occurrence.eventDate
    const dateRequired = !eventDate
    const canonicalFacts = resolveRoadsideCanonicalFacts(draft)

    // 3. Resolve entities. carrierNscNumber isn't a field on
    // RoadsideMachineSourceRecord (the mapper doesn't surface it), so it's
    // read directly off the raw observations.
    const firstEquipment = draft.equipment?.[0]
    const entities = resolveEntities({
      carrierName: draft.carrierName,
      nscNumber: observationValue(result, "roadside.carrier_nsc_number"),
      usdotNumber: undefined,
      driverLicenceNumber: draft.driverLicenceNumber,
      driverLicenceJurisdiction: draft.driverLicenceJurisdiction,
      driverName: draft.driverName,
      vin: firstEquipment?.vinSerialNumberCompleteness === "FULL" ? firstEquipment.vinSerialNumber : undefined,
      plateNumber: firstEquipment?.plateNumber,
      plateJurisdiction: firstEquipment?.plateJurisdiction,
    })

    // Company must resolve — we cannot save without knowing which company
    if (!entities.company) {
      return {
        status: "ENTITY_UNRESOLVED",
        reason: `Cannot resolve company from: carrier="${draft.carrierName ?? ""}"`,
        draft,
      }
    }

    const driver = entities.driver
    const driverLinkingRequired = !driver
    if (!eventDate || !driver) {
      return {
        status: "REVIEW_REQUIRED",
        reason: [
          dateRequired && "Inspection Date Required",
          driverLinkingRequired && "Driver Linking Required",
        ].filter(Boolean).join("; "),
        draft,
      }
    }
    const driverMasterId = driver.id
    const powerUnitResolution = firstEquipment ? resolveCanonicalVehicleByIdentifiers(
      entities.company.id,
      {
        vin: firstEquipment.vinSerialNumber,
        vinMatchMode: firstEquipment.vinSerialNumberCompleteness === "PARTIAL_LAST_6" ? "LAST_6" : "FULL",
        plate: firstEquipment.plateNumber,
        plateJurisdiction: firstEquipment.plateJurisdiction,
        unitNumber: firstEquipment.sourceUnitNumber,
      },
      eventDate
    ) : undefined

    const missingCanonicalFacts = [
      ["Jurisdiction", canonicalFacts.jurisdiction],
      ["Inspection Regime", canonicalFacts.inspectionRegime],
      ["Inspection Scope", canonicalFacts.inspectionScope],
      ["Source-Reported Overall Result", canonicalFacts.inspectionResult],
      ["Driver Inspection Result", canonicalFacts.inspectionScope === "DRIVER" || canonicalFacts.inspectionScope === "BOTH" ? canonicalFacts.driverInspectionResult : "NOT_APPLICABLE"],
      ["Driver OOS", canonicalFacts.driverInspectionResult === "VIOLATIONS_FOUND" ? canonicalFacts.driverOOSState : "NOT_APPLICABLE"],
      ["Vehicle Inspection Result", canonicalFacts.inspectionScope === "VEHICLE" || canonicalFacts.inspectionScope === "BOTH" ? canonicalFacts.vehicleInspectionResult : "NOT_APPLICABLE"],
      ["Vehicle OOS", canonicalFacts.vehicleInspectionResult === "VIOLATIONS_FOUND" ? canonicalFacts.vehicleOOSState : "NOT_APPLICABLE"],
      ["Source-Reported Total Violations", canonicalFacts.inspectionResult === "VIOLATIONS_FOUND" ? canonicalFacts.sourceReportedViolationCount : "NOT_APPLICABLE"],
    ].filter(([, value]) => !value).map(([label]) => label)
    if (missingCanonicalFacts.length) {
      return {
        status: "REVIEW_REQUIRED",
        reason: `Required source facts were not deterministically resolved: ${missingCanonicalFacts.join(", ")}`,
        draft,
      }
    }

    // 4. Build the canonical Performance Event payload using only fields
    // this draft can confidently supply. addPerformanceEvent supplies its
    // own defaults for chronology/provenance/recordProcessingState/
    // workflowState when omitted (see lib/driver-data.ts), so this stays
    // deliberately minimal rather than guessing values for the rest.
    const structuredEventFacts: StructuredEventFact[] = []
    const canonicalFactValues = {
      jurisdiction: canonicalFacts.jurisdiction,
      inspectionRegime: canonicalFacts.inspectionRegime,
      inspectionClassification: canonicalFacts.inspectionClassification,
      inspectionScope: canonicalFacts.inspectionScope,
      inspectionResult: canonicalFacts.inspectionResult,
      driverInspectionResult: canonicalFacts.driverInspectionResult,
      driverOOSState: canonicalFacts.driverOOSState,
      vehicleInspectionResult: canonicalFacts.vehicleInspectionResult,
      vehicleOOSState: canonicalFacts.vehicleOOSState,
      sourceReportedViolationCount: canonicalFacts.sourceReportedViolationCount,
    }
    for (const [key, value] of Object.entries(canonicalFactValues)) {
      if (!value) continue
      const fact = buildFact(key, value)
      if (fact) structuredEventFacts.push(fact)
    }
    if (draft.agency) {
      const fact = buildFact("agency", draft.agency)
      if (fact) structuredEventFacts.push(fact)
    }
    if (draft.reportNumber) {
      const fact = buildFact("inspectionReportNumber", draft.reportNumber)
      if (fact) structuredEventFacts.push(fact)
    }
    const equipmentRows = (draft.equipment || []).filter((item) => Boolean(item.vinSerialNumber || item.plateNumber || item.sourceUnitNumber))
    const equipmentCollectionItems = equipmentRows.map((item, index) => {
      const itemId = `RIE-AUTO-${index + 1}`
      const role = index === 0 ? "POWER_UNIT" : "TOWED_UNIT"
      return createRoadsideEquipmentItem({
        itemId,
        role,
        equipmentType: inferredRoadsideEquipmentType(role, item.equipmentType),
        sourceVin: item.vinSerialNumber || undefined,
        sourcePlate: item.plateNumber || undefined,
        plateJurisdiction: item.plateJurisdiction || undefined,
        sourceUnitNumber: item.sourceUnitNumber || undefined,
        evidenceIds: [result.sourceEvidenceId],
      })
    })
    const equipmentCollection = createRoadsideEquipmentCollection(
      equipmentCollectionItems,
      equipmentCollectionItems.length ? "COMPLETE" : "NOT_PROVIDED"
    )
    const violationCollectionItems = (draft.findings || [])
      .filter((finding) => {
        const code = (finding.sourceResultCode || "").trim().toUpperCase()
        return code === "X" || code === "O" || code === "N" || finding.outOfService === true || finding.majorDefect === true
      })
      .map((finding, index) => {
        const code = (finding.sourceResultCode || "").trim().toUpperCase()
        const subjectType = roadsideSubjectFromFinding(finding)
        return createRoadsideViolationItem({
          itemId: `RVI-AUTO-${index + 1}`,
          ruleRegulationCode: finding.violationCode || finding.sourceReferenceNumber || finding.defectCode || undefined,
          description: roadsideFindingDescription(finding),
          regulatoryCategory: finding.inspectionItem || finding.defectCategory || (code === "N" ? "Inspection Note" : undefined),
          subjectType,
          subjectEquipmentId: subjectType === "POWER_UNIT" || subjectType === "TOWED_UNIT" ? roadsideEquipmentIdForFinding(finding, equipmentCollectionItems.map((item) => ({ itemId: item.itemId, role: item.facts.role as "POWER_UNIT" | "TOWED_UNIT" }))) : undefined,
          componentSystem: subjectType === "POWER_UNIT" || subjectType === "TOWED_UNIT" ? undefined : finding.sourceEquipmentReference || undefined,
          oosState: code === "O" || finding.outOfService === true ? "YES" : "NO",
          regulatorSeverityWeight: finding.sourcePoints,
          evidenceIds: [result.sourceEvidenceId],
          ingestionOrigin: "DOCUMENT_OCR",
        })
      })
    const violationCollection = canonicalFacts.inspectionResult === "VIOLATIONS_FOUND" ? createRoadsideViolationCollection(
      violationCollectionItems,
      violationCollectionItems.length && canonicalFacts.sourceReportedViolationCount === violationCollectionItems.length ? "COMPLETE" : violationCollectionItems.length ? "PARTIAL" : "NOT_PROVIDED"
    ) : undefined
    const childCollections = violationCollection ? [equipmentCollection, violationCollection] : [equipmentCollection]
    const processedAt = new Date().toISOString()

    const eventPayload: Omit<DriverPerformanceEvent, "id" | "companyId" | "driverMasterId" | "createdAt" | "updatedAt" | "isArchived"> = {
      eventType: "Roadside Inspection",
      eventDate,
      eventTime: occurrence.eventTime || undefined,
      vehicleId: (powerUnitResolution?.state === "AUTO_RESOLVED" ? powerUnitResolution.canonicalVehicle?.id : undefined) || entities.vehicle?.id,
      severity: "Not Applicable",
      status: "Not Applicable",
      summary: `Roadside Inspection auto-saved from OCR (${draft.reportNumber || "no report number"})`,
      description: `Automatically created from a machine-processed Roadside Inspection document. Officer: ${draft.officerName || "not extracted"}${draft.officerNumber ? ` (${draft.officerNumber})` : ""}.`,
      descriptionOrigin: "SYSTEM_GENERATED",
      structuredEventFacts,
      childCollections,
      linkedRecords: [],
      chronology: [{
        id: `CHRON-${Date.now().toString(36)}`,
        timestamp: processedAt,
        action: "EVENT_INGESTED",
        actor: null,
        details: `Machine-ingested Roadside Inspection from OCR source ${draft.reportNumber || result.sourceEvidenceId}.`,
      }],
      recordProcessingState: "EXTRACTED",
      evidenceIds: [result.sourceEvidenceId],
      provenance: {
        sourceType: "SOURCE_FACT",
        source: "Roadside Inspection",
        sourceRecordId: draft.reportNumber,
        ingestionOrigin: "DOCUMENT_OCR",
        capturedAt: processedAt,
        sourceEvidenceIds: [result.sourceEvidenceId],
        sourceConfidence: "HIGH",
        dataQuality: "HIGH",
      },
      ingestion: {
        origin: "DOCUMENT_OCR",
        sourceType: "Roadside Inspection",
        sourceEvidenceIds: [result.sourceEvidenceId],
        receivedAt: result.providerMetadata.processedAt,
        processedAt,
        processorVersion: result.providerMetadata.processorVersion,
      },
    }

    // 5. Save the event. If the canonical schema rejects it (missing
    // required category fields this OCR pipeline doesn't extract yet — see
    // the module docblock), fall through to human review instead of
    // fabricating the missing data.
    let saved: DriverPerformanceEvent
    try {
      saved = addPerformanceEvent(entities.company.id, driverMasterId, eventPayload)
      const equipmentRelationshipResolutions = equipmentRows.map((item, index) => {
        const itemId = equipmentCollectionItems[index]?.itemId || `RIE-AUTO-${index + 1}`
        const vehicleResolution = resolveCanonicalVehicleByIdentifiers(
          entities.company.id,
          {
            vin: item.vinSerialNumber,
            vinMatchMode: item.vinSerialNumberCompleteness === "PARTIAL_LAST_6" ? "LAST_6" : "FULL",
            plate: item.plateNumber,
            plateJurisdiction: item.plateJurisdiction,
            unitNumber: item.sourceUnitNumber,
          },
          eventDate
        )
        return buildEquipmentVehicleResolution(saved.id, itemId, vehicleResolution, result.sourceEvidenceId)
      })
      if (equipmentRelationshipResolutions.length) {
        saved = persistPerformanceRelationshipResolutions(entities.company.id, saved.id, equipmentRelationshipResolutions) || saved
      }
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
      entityLabel: `Roadside Inspection — ${draft.reportNumber || saved.id}`,
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
