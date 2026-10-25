import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRIVER_PERFORMANCE_CATEGORY_REGISTRY } from "@/lib/driver-performance-schema";
import { deriveObligations } from "@/lib/driver-events/obligations";
import { CATEGORY_WORKFLOWS, DETAILED_WIZARD_CATEGORIES, WORKFLOW_CODES, fieldsOf, sectionsFor } from "@/lib/driver-events/workflows";

describe("Driver Event category workflows", () => {
  it("every recordable category has either a detailed wizard or its own workflow - none falls back to a bare generic form", () => {
    const recordable = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter((d) => WORKFLOW_CODES.includes(d.code));
    assert.ok(recordable.length >= 15, `15 non-wizard categories expected, got ${recordable.length}`);
    for (const d of recordable) assert.ok(CATEGORY_WORKFLOWS[d.code], `${d.code} has a workflow`);
    for (const wizard of DETAILED_WIZARD_CATEGORIES) assert.ok(DRIVER_PERFORMANCE_CATEGORY_REGISTRY.some((d) => d.value === wizard), wizard);
    assert.equal(Object.keys(CATEGORY_WORKFLOWS).length, WORKFLOW_CODES.length, "no workflow for a category that is not recordable here");
  });

  it("every section names real fields; no field appears twice; every creatable field is reachable", () => {
    for (const code of WORKFLOW_CODES) {
      const fields = fieldsOf(code);
      const workflow = CATEGORY_WORKFLOWS[code];
      const seen = new Set<string>();
      for (const section of workflow.sections) for (const key of section.keys) {
        assert.ok(fields.has(key), `${code}: section ${section.id} names unknown field ${key}`);
        assert.ok(!seen.has(key), `${code}: ${key} appears in two sections`);
        seen.add(key);
      }
      const reachable = new Set(sectionsFor(code).flatMap((s) => s.keys));
      for (const f of fields.values()) if (!f.hiddenInCreation) assert.ok(reachable.has(f.key), `${code}.${f.key} is reachable in the form`);
      assert.ok(workflow.intro.length > 20 && workflow.boundary.length > 20, `${code} explains itself and its boundary`);
      assert.ok(workflow.sections.length >= 2, `${code} has category-specific sections`);
    }
  });

  it("a workflow that says it creates a restriction really does, and no other does", () => {
    const answers: Record<string, Record<string, string>> = { EQUIPMENT_FAILURE: { vehicleSafeToOperate: "NO" } };
    for (const code of WORKFLOW_CODES) {
      const workflow = CATEGORY_WORKFLOWS[code];
      const created = deriveObligations(code, answers[code] ?? {}).restrictions.map((r) => r.restrictionKind);
      if (workflow.createsRestriction) assert.deepEqual(created, [workflow.createsRestriction], code);
      else assert.deepEqual(created, [], code);
    }
  });
});
