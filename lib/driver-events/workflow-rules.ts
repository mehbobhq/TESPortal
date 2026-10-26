import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY } from "@/lib/driver-performance-schema"
import { validateNewCargoIncidentDetailed } from "@/lib/performance-cargo"
import { validateNewCollisionDetailed } from "@/lib/performance-collision"
import { validateNewCustomerEventDetailed } from "@/lib/performance-customer-event"
import { validateNewNearMiss } from "@/lib/performance-near-miss"
import { validateNewSpillReleaseDetailed } from "@/lib/performance-spill"
import type { Issue } from "./child-collections"

/**
 * Server-side rules of the detailed workflows (Collision, Near Miss, Cargo Incident, Spill or Release, Customer Event). The browser wizards already run these rules before
 * saving; the server runs the SAME pure validators on a candidate rebuilt from the canonical record, so a request that never touched the wizard is held to them too:
 * controlled values against the taxonomies (including inside child-collection items), duplicate item ids, required parties and combinations that contradict each other.
 *
 * One rule family is deliberately NOT applied at creation: a rule that a child item "references evidence linked to this event". Evidence is stored, scanned and linked to the
 * saved event afterwards (the evidence lifecycle), so at creation there is nothing to be linked yet. Those messages are dropped, and nothing else is.
 * Roadside Inspection has its own server rules in child-collections.ts.
 */

export const DETAILED_WORKFLOW_CATEGORIES = ["COLLISION", "NEAR_MISS", "CARGO_INCIDENT", "SPILL_RELEASE", "CUSTOMER_EVENT"] as const

export type WorkflowCandidateSource = {
  category: string
  /** the header source (the registry's label, e.g. "Driver Report") */
  sourceType: string | null
  date: string | null
  time: string | null
  reportedDate: string | null
  occurrencePrecision: "EXACT_DATETIME" | "DATE_ONLY" | "APPROXIMATE" | "UNKNOWN"
  locationText: string | null
  city: string | null
  stateProvince: string | null
  country: string | null
  vehicleRelationshipId: string | null
  trailerRelationshipId: string | null
  facts: Record<string, unknown>
  factUnits: Record<string, string>
  childCollections: Record<string, unknown>
  /** the original wording of a source the workflow offered, kept by the adapter */
  originalSourceType: string | null
}

const EVIDENCE_REFERENCE = /references evidence that is not linked|must reference its evidence/i

export function workflowCandidate(s: WorkflowCandidateSource): Record<string, unknown> {
  const definition = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.find((d) => d.code === s.category)
  const structuredEventFacts = (definition?.fields ?? []).filter((f) => s.facts[f.key] !== undefined && s.facts[f.key] !== null && s.facts[f.key] !== "").map((f) => ({
    dataPointId: f.dataPointId, value: s.facts[f.key], valueType: f.valueType, ...(s.factUnits[f.key] ? { unit: s.factUnits[f.key] } : {}),
  }))
  const links: Record<string, unknown>[] = []
  // a Customer Event carries no canonical links of its own (its customer, site and shipment are free text); the header vehicle is not one of them
  if (s.category !== "CUSTOMER_EVENT" && s.vehicleRelationshipId) links.push({ relationshipKey: "vehicle", entityType: "Vehicle", recordId: s.vehicleRelationshipId })
  if (s.category !== "CUSTOMER_EVENT" && s.trailerRelationshipId) links.push({ relationshipKey: "trailer", entityType: "Trailer", recordId: s.trailerRelationshipId })
  return {
    driverMasterId: "SERVER_RESOLVED",
    eventDate: s.date ?? "", eventTime: s.time ?? "", reportedDate: s.reportedDate ?? undefined,
    occurrencePrecision: s.occurrencePrecision,
    location: s.locationText ?? "", city: s.city ?? undefined, stateProvince: s.stateProvince ?? undefined, country: s.country ?? "",
    vehicleId: s.vehicleRelationshipId ?? undefined,
    canonicalLinks: links,
    structuredEventFacts,
    // the candidate is a COPY: an item that omits its evidence list is read as having none (evidence is linked afterwards, to the saved event)
    childCollections: Object.values(s.childCollections).filter((c) => (c as { collectionId?: string })?.collectionId !== "DRV.PERF.ADAPTER.ORIGINAL_WORDING").map((c) => {
      const collection = c as { items?: unknown }
      return Array.isArray(collection.items) ? { ...collection, items: collection.items.map((i) => (i && typeof i === "object" ? { ...(i as object), evidenceIds: Array.isArray((i as { evidenceIds?: unknown }).evidenceIds) ? (i as { evidenceIds: unknown[] }).evidenceIds : [] } : i)) } : c
    }),
    evidenceIds: [],
    provenance: { source: s.originalSourceType ?? s.sourceType ?? "" },
  }
}

export function validateDetailedWorkflow(s: WorkflowCandidateSource): Issue[] {
  if (!(DETAILED_WORKFLOW_CATEGORIES as readonly string[]).includes(s.category)) return []
  const candidate = workflowCandidate(s) as never
  let messages: string[]
  try {
    messages = runWorkflowValidator(s.category, candidate)
  } catch {
    // a structure the workflow's own reader cannot interpret is a refused record, never a server fault
    return [{ field: "workflow", message: "The detail collections are not in the structure this workflow expects." }]
  }
  return messages.filter((m) => !EVIDENCE_REFERENCE.test(m)).map((message) => ({ field: "workflow", message }))
}

function runWorkflowValidator(category: string, candidate: never): string[] {
  let messages: string[]
  switch (category) {
    case "COLLISION": messages = validateNewCollisionDetailed(candidate).map((i) => i.message); break
    case "CARGO_INCIDENT": messages = validateNewCargoIncidentDetailed(candidate).map((i) => i.message); break
    case "SPILL_RELEASE": messages = validateNewSpillReleaseDetailed(candidate).map((i) => i.message); break
    case "CUSTOMER_EVENT": messages = validateNewCustomerEventDetailed(candidate).map((i) => i.message); break
    default: messages = validateNewNearMiss(candidate)
  }
  return messages
}
