import {
  ROADSIDE_EQUIPMENT_COLLECTION_ID, ROADSIDE_STATEMENT_COLLECTION_ID, ROADSIDE_VIOLATION_COLLECTION_ID,
  validateRoadsideEquipmentCollection, validateRoadsideInspectionConsistency, validateRoadsideStatementCollection, validateRoadsideViolationCollection,
} from "@/lib/driver-performance-child-facts"
import type { PerformanceChildCollection } from "@/types/drivers"

/**
 * Child collections (parties, injured persons, violations, inspected equipment, items, materials, ...) hold material facts of the six detailed workflows.
 * The server validates their STRUCTURE for every category and, where a collection has an existing pure validator (Roadside Inspection), that validator too.
 * The cross-field rules of the Collision / Cargo / Spill / Customer wizards reference browser-held evidence ids, so they are not re-run here (see the
 * architecture document, "Not verified or not done").
 */

export type Issue = { field: string; message: string }
const MAX_COLLECTIONS = 40
const MAX_ITEMS = 500

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export function validateChildCollections(categoryCode: string, facts: Record<string, unknown>, collections: Record<string, unknown>): Issue[] {
  const issues: Issue[] = []
  const keys = Object.keys(collections)
  if (keys.length > MAX_COLLECTIONS) issues.push({ field: "childCollections", message: "Too many detail collections." })
  for (const key of keys) {
    const where = `childCollections.${key}`
    const c = collections[key]
    if (!isObject(c)) { issues.push({ field: where, message: "A detail collection must be an object." }); continue }
    if (c.collectionId !== key) issues.push({ field: where, message: "The collection id must match its key." })
    const owned = key.startsWith(`DRV.PERF.${categoryCode}.`) || key.startsWith("DRV.PERF.INVESTIGATION.") || key === "DRV.PERF.ADAPTER.ORIGINAL_WORDING"
    if (!owned) { issues.push({ field: where, message: `"${key}" is not a detail collection of this category.` }); continue }
    if (key === "DRV.PERF.ADAPTER.ORIGINAL_WORDING") continue
    if (!Array.isArray(c.items)) { issues.push({ field: where, message: "A collection lists its items." }); continue }
    if (c.items.length > MAX_ITEMS) issues.push({ field: where, message: "Too many items in a collection." })
    if (typeof c.collectionVersion !== "string" || typeof c.itemType !== "string") issues.push({ field: where, message: "A collection states its version and item type." })
    const seen = new Set<string>()
    c.items.forEach((item, i) => {
      if (!isObject(item) || typeof item.itemId !== "string" || !item.itemId || !isObject(item.facts)) { issues.push({ field: `${where}.items[${i}]`, message: "An item has an id and its facts." }); return }
      if (seen.has(item.itemId)) issues.push({ field: `${where}.items[${i}]`, message: `Item id ${item.itemId} appears twice.` })
      seen.add(item.itemId)
      for (const [k, v] of Object.entries(item.facts)) if (v !== null && !["string", "number", "boolean"].includes(typeof v)) issues.push({ field: `${where}.items[${i}].facts.${k}`, message: "An item fact is a text, number, yes/no or empty." })
    })
  }
  if (categoryCode === "ROADSIDE_INSPECTION") {
    const equipment = collections[ROADSIDE_EQUIPMENT_COLLECTION_ID] as PerformanceChildCollection | undefined
    if (!equipment) issues.push({ field: `childCollections.${ROADSIDE_EQUIPMENT_COLLECTION_ID}`, message: "Every Roadside Inspection lists the inspected equipment." })
    else for (const m of validateRoadsideEquipmentCollection(equipment, typeof facts.inspectionScope === "string" ? facts.inspectionScope : undefined)) issues.push({ field: `childCollections.${ROADSIDE_EQUIPMENT_COLLECTION_ID}`, message: m })
    const violations = collections[ROADSIDE_VIOLATION_COLLECTION_ID] as PerformanceChildCollection | undefined
    if (violations) for (const m of validateRoadsideViolationCollection(violations)) issues.push({ field: `childCollections.${ROADSIDE_VIOLATION_COLLECTION_ID}`, message: m })
    const statements = collections[ROADSIDE_STATEMENT_COLLECTION_ID] as PerformanceChildCollection | undefined
    if (statements) for (const m of validateRoadsideStatementCollection(statements)) issues.push({ field: `childCollections.${ROADSIDE_STATEMENT_COLLECTION_ID}`, message: m })
    for (const m of validateRoadsideInspectionConsistency(facts, violations)) issues.push({ field: "childCollections", message: m })
  }
  return issues
}

/**
 * Evidence references inside detail items. A reference is valid only to a document that is ACTIVELY LINKED to this event (stored, scanned, same company: linking
 * guarantees that). At creation nothing can be linked yet, so no item may carry one; on a correction the linked set is the event's active links.
 * This closes a forged-reference path (an item naming a document that was never linked, or another company's) without requiring evidence anywhere it is not required.
 */
export function referencedEvidenceIds(collections: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const c of Object.values(collections)) {
    const items = isObject(c) && Array.isArray(c.items) ? c.items : []
    for (const item of items) if (isObject(item) && Array.isArray(item.evidenceIds)) for (const id of item.evidenceIds) if (typeof id === "string") out.add(id)
  }
  return out
}

export function validateItemEvidenceReferences(collections: Record<string, unknown>, linked: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = []
  for (const [key, c] of Object.entries(collections)) {
    const items = isObject(c) && Array.isArray(c.items) ? c.items : []
    items.forEach((item, i) => {
      if (!isObject(item) || item.evidenceIds === undefined) return
      if (!Array.isArray(item.evidenceIds) || item.evidenceIds.some((id) => typeof id !== "string")) { issues.push({ field: `childCollections.${key}.items[${i}]`, message: "An item's evidence references must be a list of document ids." }); return }
      for (const id of item.evidenceIds as string[]) if (!linked.has(id)) issues.push({ field: `childCollections.${key}.items[${i}]`, message: "An item can reference evidence only after that document is linked to this event." })
    })
  }
  return issues
}

/** An obtained Driver Statement whose method is an uploaded document must reference its evidence before the event is closed. */
export function closureEvidenceIssues(collections: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const c of Object.values(collections)) {
    const items = isObject(c) && Array.isArray(c.items) ? c.items : []
    for (const item of items) {
      if (!isObject(item) || !isObject(item.facts)) continue
      if (item.facts.method === "UPLOADED_DOCUMENT" && item.facts.status === "OBTAINED" && !(Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0)) out.push(`The uploaded-document Driver Statement ${String(item.itemId)} must reference its linked evidence before the event is closed.`)
    }
  }
  return out
}

export type ChildChange = { field: string; before: unknown; after: unknown; change: "ADDED" | "REMOVED" | "CHANGED"; itemId: string; facts?: string[] }

/** Item-level differences between two versions of the collections, for the immutable history ("what changed in which item"). */
export function diffChildCollections(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): ChildChange[] {
  const out: ChildChange[] = []
  const a = before ?? {}
  const b = after ?? {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    // an item's evidence references are part of the record: a correction that only adds or removes one is a change and appears in the history as the pseudo-fact "evidenceIds"
    const itemsOf = (c: unknown) => new Map((((c as { items?: { itemId: string; facts: Record<string, unknown>; evidenceIds?: unknown }[] })?.items) ?? []).map((i): [string, { itemId: string; facts: Record<string, unknown> }] => [i.itemId, { itemId: i.itemId, facts: { ...i.facts, ...(Array.isArray(i.evidenceIds) && i.evidenceIds.length ? { evidenceIds: [...(i.evidenceIds as string[])].sort().join(",") } : {}) } }]))
    const x = itemsOf(a[id]), y = itemsOf(b[id])
    for (const itemId of new Set([...x.keys(), ...y.keys()])) {
      const p = x.get(itemId), q = y.get(itemId)
      const field = `childCollections.${id}.${itemId}`
      if (!p && q) out.push({ field, change: "ADDED", itemId, before: null, after: q.facts })
      else if (p && !q) out.push({ field, change: "REMOVED", itemId, before: p.facts, after: null })
      else if (p && q) {
        const names = [...new Set([...Object.keys(p.facts), ...Object.keys(q.facts)])].filter((k) => JSON.stringify(p.facts[k] ?? null) !== JSON.stringify(q.facts[k] ?? null))
        if (names.length) out.push({ field, change: "CHANGED", itemId, facts: names, before: Object.fromEntries(names.map((k) => [k, p.facts[k] ?? null])), after: Object.fromEntries(names.map((k) => [k, q.facts[k] ?? null])) })
      }
    }
    // collection-level metadata (completeness) is part of the record too
    const ca = (a[id] as { completeness?: string } | undefined)?.completeness, cb = (b[id] as { completeness?: string } | undefined)?.completeness
    if (a[id] && b[id] && ca !== cb) out.push({ field: `childCollections.${id}.completeness`, change: "CHANGED", itemId: "", before: ca ?? null, after: cb ?? null })
  }
  return out
}
