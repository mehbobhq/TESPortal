import { BASELINE_MAPPING, existingFieldInventory, recordableCategories, type MappingRow, type Target } from "./field-reconciliation"

export const targetText = (t: Target): string => {
  switch (t.kind) {
    case "FIELD": return `${t.category}.${t.key}`
    case "COLUMN": return `driver_events.${t.name}`
    case "CONSEQUENCE": return `consequence:${t.consequence}`
    case "RELATIONSHIP": return `relationship:${t.type}`
    case "RESTRICTION": return `restriction:${t.restrictionKind}`
    case "ACTION": return `action:${t.actionType}`
    case "EVIDENCE": return `evidence:${t.role}`
    case "COLLECTION": return `collection:${t.id}`
    case "FACT": return `fact:${t.column}`
  }
}

export function reconciliationJson() {
  const inventory = existingFieldInventory()
  return {
    contract: "driver-event-field-reconciliation/1",
    baseline: "TES_Driver_Events_Field_Baseline.md (2026-10-25)",
    categories: recordableCategories(),
    totals: {
      recordableCategories: recordableCategories().length,
      fields: inventory.length,
      preserved: inventory.filter((r) => r.disposition === "PRESERVED").length,
      added: inventory.filter((r) => r.disposition === "ADDED").length,
      baselineElements: BASELINE_MAPPING.length,
      byDisposition: BASELINE_MAPPING.reduce<Record<string, number>>((m, r) => ({ ...m, [r.disposition]: (m[r.disposition] ?? 0) + 1 }), {}),
    },
    mapping: BASELINE_MAPPING.map((r) => ({ category: r.category, element: r.element, disposition: r.disposition, requirement: r.requirement, jurisdiction: r.jurisdiction, targets: r.targets.map(targetText), bi: r.bi, note: r.note ?? null })),
    inventory,
  }
}

const esc = (s: string) => s.replace(/\|/g, "\\|")

export function reconciliationMarkdown(): string {
  const json = reconciliationJson()
  const lines: string[] = []
  lines.push("# Driver Events — field reconciliation matrix", "")
  lines.push("Generated from the registry and `lib/driver-events/field-reconciliation.ts` by `scripts/driver-events/build-reconciliation.mts`. Do not edit by hand; the test suite fails if it is stale.", "")
  lines.push(`Baseline: ${json.baseline}.`, "")
  lines.push("## Totals", "")
  lines.push(`- Recordable categories: **${json.totals.recordableCategories}**`)
  lines.push(`- Registry fields in those categories: **${json.totals.fields}** — preserved unchanged: **${json.totals.preserved}**, added by this work: **${json.totals.added}**`)
  lines.push(`- Baseline elements mapped: **${json.totals.baselineElements}** (${Object.entries(json.totals.byDisposition).map(([k, v]) => `${k} ${v}`).join(", ")})`, "")
  lines.push("Dispositions: **PRESERVED** an existing field already satisfies it (unchanged); **ADDED** a new field in `category-extensions.ts`; **CANONICAL** a column/link of the event itself; **CONSEQUENCE / RELATIONSHIP / RESTRICTION / ACTION / EVIDENCE** a shared record (linked, not repeated); **CHILD_COLLECTION** an existing rich child collection; **NOT_CAPTURED** deliberately not stored here (with the reason).", "")
  lines.push("No existing field was removed, renamed or retyped. Nothing duplicates canonical TES data: drivers, vehicles, trailers and the reporter are links; costs, delays, downtime, claims and recoveries are consequence records; citations, repair orders and claims are relationship links.", "")
  const categories = [...new Set(json.mapping.map((m) => m.category))]
  lines.push("## Baseline element → where it lives", "")
  for (const c of categories) {
    lines.push(`### ${c}`, "", "| Baseline element | Disposition | Required | Jurisdiction | Where it lives | BI output | Note |", "|---|---|---|---|---|---|---|")
    for (const m of json.mapping.filter((x) => x.category === c)) {
      lines.push(`| ${esc(m.element)} | ${m.disposition} | ${m.requirement} | ${esc(m.jurisdiction)} | ${m.targets.map((t) => `\`${esc(t)}\``).join("<br>")} | ${esc(m.bi)} | ${esc(m.note ?? "")} |`)
    }
    lines.push("")
  }
  lines.push("## Existing field inventory (every recordable category)", "")
  for (const cat of json.categories) {
    const rows = json.inventory.filter((r) => r.categoryCode === cat.code)
    lines.push(`### ${cat.label} (\`${cat.code}\`, ${rows.length} fields)`, "", "| Key | Label | Type | Required | Conditional | Options | Unit | Data point | Disposition |", "|---|---|---|---|---|---|---|---|---|")
    for (const r of rows) lines.push(`| \`${r.key}\` | ${esc(r.label)} | ${r.kind} | ${r.required ? "yes" : ""} | ${r.conditional ? "yes" : ""} | ${r.options || ""} | ${r.unit ?? ""} | \`${r.dataPointId}\` | ${r.disposition}${r.legacyOnly ? " (legacy, read-only)" : ""} |`)
    lines.push("")
  }
  return lines.join("\n")
}
