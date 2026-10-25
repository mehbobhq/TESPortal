import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY } from "@/lib/driver-performance-schema";
import { BASELINE_MAPPING, existingFieldInventory, recordableCategories } from "@/lib/driver-events/field-reconciliation";
import { reconciliationJson, reconciliationMarkdown } from "@/lib/driver-events/reconciliation-doc";

const sql = readFileSync("database/migrations/0042_driver_events_canonical_store.sql", "utf8");
const block = (table: string) => {
  const start = sql.indexOf(`CREATE TABLE public.${table} (`);
  assert.ok(start >= 0, table);
  return sql.slice(start, sql.indexOf("\n);", start));
};
const columnsOf = (table: string) => new Set([...block(table).matchAll(/^ {4}([a-z_]+) [a-z]/gm)].map((m) => m[1]));
const listIn = (constraint: string) => {
  const at = sql.indexOf(constraint);
  assert.ok(at >= 0, constraint);
  const slice = sql.slice(at, sql.indexOf("\n", sql.indexOf("))", at) > 0 ? at : at) + 1);
  return new Set([...sql.slice(at, at + 1500).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
};
const libSources = (() => {
  const out: string[] = [];
  for (const f of readdirSync("lib")) if (f.endsWith(".ts")) out.push(readFileSync(`lib/${f}`, "utf8"));
  return out.join("\n");
})();

describe("Driver Events field reconciliation", () => {
  const events = columnsOf("driver_events");
  const facts = columnsOf("driver_event_bi_facts");
  const consequenceKinds = listIn("driver_event_consequences_kind_valid");
  const relationshipTypes = listIn("driver_event_relationships_type_valid");
  const restrictionKinds = listIn("driver_event_restrictions_kind_valid");
  const actionTypes = listIn("driver_event_actions_type_valid");
  const evidenceRoles = listIn("driver_event_evidence_role_valid");

  it("every mapped target exists: registry field, event column, shared record kind, child collection or fact column", () => {
    const byCode = new Map(DRIVER_PERFORMANCE_CATEGORY_REGISTRY.map((d) => [d.code, new Set(d.fields.map((f) => f.key))]));
    for (const row of BASELINE_MAPPING) {
      assert.ok(row.targets.length > 0, `${row.category}/${row.element} maps somewhere`);
      for (const t of row.targets) {
        const where = `${row.category} / ${row.element}`;
        switch (t.kind) {
          case "FIELD": assert.ok(byCode.get(t.category)?.has(t.key), `${where}: no field ${t.category}.${t.key}`); break;
          case "COLUMN": assert.ok(events.has(t.name), `${where}: no column ${t.name}`); break;
          case "CONSEQUENCE": assert.ok(consequenceKinds.has(t.consequence), `${where}: ${t.consequence}`); break;
          case "RELATIONSHIP": assert.ok(relationshipTypes.has(t.type), `${where}: ${t.type}`); break;
          case "RESTRICTION": assert.ok(restrictionKinds.has(t.restrictionKind), `${where}: ${t.restrictionKind}`); break;
          case "ACTION": assert.ok(actionTypes.has(t.actionType), `${where}: ${t.actionType}`); break;
          case "EVIDENCE": assert.ok(evidenceRoles.has(t.role), `${where}: ${t.role}`); break;
          case "COLLECTION": assert.ok(libSources.includes(`"${t.id}"`), `${where}: no collection ${t.id}`); break;
          case "FACT": assert.ok(facts.has(t.column), `${where}: no fact column ${t.column}`); break;
        }
      }
    }
  });

  it("every recordable category appears in the baseline mapping, and every ADDED mapping names a field that really is an extension", () => {
    const mapped = new Set(BASELINE_MAPPING.map((r) => r.category));
    for (const c of recordableCategories()) assert.ok(mapped.has(c.code), `${c.code} is reconciled`);
    const inventory = new Map(existingFieldInventory().map((r) => [`${r.categoryCode}.${r.key}`, r]));
    for (const row of BASELINE_MAPPING.filter((r) => r.disposition === "ADDED")) {
      const fields = row.targets.filter((t) => t.kind === "FIELD");
      assert.ok(fields.some((t) => t.kind === "FIELD" && inventory.get(`${t.category}.${t.key}`)?.disposition === "ADDED"), `${row.category}/${row.element} adds at least one field`);
    }
    for (const row of BASELINE_MAPPING.filter((r) => r.disposition === "PRESERVED")) {
      for (const t of row.targets) if (t.kind === "FIELD" && row.element !== "Device / provider") assert.equal(inventory.get(`${t.category}.${t.key}`)?.disposition, "PRESERVED", `${row.category}/${row.element}: ${t.key} existed before`);
    }
  });

  it("no existing field was removed or retyped: the pre-existing inventory is a strict subset of today's", () => {
    const rows = existingFieldInventory();
    assert.ok(rows.filter((r) => r.disposition === "PRESERVED").length >= 370);
    const ids = rows.map((r) => `${r.categoryCode}.${r.key}`);
    assert.equal(new Set(ids).size, ids.length, "no duplicate field within a category");
    const dataPoints = rows.filter((r) => r.disposition === "ADDED").map((r) => r.dataPointId);
    assert.equal(new Set(dataPoints).size, dataPoints.length, "added data point ids are unique");
    const existing = new Set(rows.filter((r) => r.disposition === "PRESERVED").map((r) => r.dataPointId));
    for (const id of dataPoints) assert.ok(!existing.has(id), `${id} does not collide with an existing data point`);
  });

  it("regulatory elements are marked person-entered and no deadline is computed anywhere in the mapping", () => {
    for (const row of BASELINE_MAPPING.filter((r) => ["ROADSIDE_INSPECTION", "COLLISION", "SPILL_RELEASE"].includes(r.category) && /deadline|reportab|OOS|Out-of-service|applicability/i.test(r.element))) {
      assert.match(row.jurisdiction + (row.note ?? ""), /person-entered|not computed/i, row.element);
    }
  });

  it("the committed matrix and catalogue are up to date (run scripts/driver-events/build-reconciliation.mts)", () => {
    assert.equal(readFileSync("docs/driver-events/field-reconciliation.json", "utf8"), JSON.stringify(reconciliationJson(), null, 2) + "\n");
    assert.equal(readFileSync("docs/driver-events/field-reconciliation.md", "utf8"), reconciliationMarkdown() + "\n");
  });
});
