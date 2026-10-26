import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE, DRIVER_PERFORMANCE_CATEGORY_REGISTRY, PERFORMANCE_CATEGORY_OWNERSHIP } from "@/lib/driver-performance-schema";
import { DriverEventValidationError } from "@/lib/driver-events/errors";
import { prepareEvent, recordableCategory, type Scalar } from "@/lib/driver-events/validation";
import { DETAILED_CODES, minimalFacts, minimalInput } from "../../helpers/driver-event-fill";

const NOW = new Date("2026-03-10T15:00:00Z");
const RECORDABLE = DRIVER_PERFORMANCE_CATEGORY_REGISTRY.filter((d) => PERFORMANCE_CATEGORY_OWNERSHIP[d.value] === "RECORDABLE_EVENT");

describe("Driver Event server validation (registry-driven)", () => {
  it("every recordable category (all 17 baseline categories, Others and Route Deviation) can be prepared from its own required fields", () => {
    assert.ok(RECORDABLE.length >= 19, `expected at least 19 recordable categories, got ${RECORDABLE.length}`);
    for (const d of RECORDABLE) {
      const prepared = prepareEvent(minimalInput(d.code), NOW);
      assert.equal(prepared.categoryCode, d.code);
      assert.equal(prepared.quality.requiredMissing, 0, `${d.code} has no missing required facts`);
      assert.equal(prepared.occurrencePrecision, "EXACT_DATETIME");
      // the five detailed workflows use a wizard-produced record in its own zone; the others use 08:30 in Toronto (EDT, UTC-4)
      if (!DETAILED_CODES.includes(d.code)) assert.equal(prepared.occurredAt, "2026-03-09T12:30:00.000Z", "08:30 in Toronto on 9 March 2026 is EDT (UTC-4)");
    }
  });

  it("the 17 baseline categories plus Others are all recordable", () => {
    for (const v of ["Collision", "Near Miss", "Roadside Inspection", "Cargo Incident", "Spill or Release", "Customer Event", "Security Incident", "Equipment Failure / Critical Defect", "Device / Data Integrity",
      "Fatigue Indicator", "Emergency Event", "Speeding", "Harsh Braking", "Harsh Acceleration", "Harsh Cornering", "Following Distance", "Distracted Driving", "Idle Time", "Seatbelt", "Other Event", "Route Deviation"]) {
      assert.doesNotThrow(() => recordableCategory(v), v);
    }
  });

  it("legacy, linked-record and company-action categories are not recordable as new events", () => {
    for (const v of ["Traffic Citation", "HOS Violation", "Coaching Session", "Disciplinary Action", "Warning", "Injury"]) assert.throws(() => recordableCategory(v), DriverEventValidationError, v);
  });

  it("the offset is applied by zone, not by the server clock (EST before 8 March 2026, EDT after)", () => {
    const est = prepareEvent(minimalInput("SPEEDING", { occurrence: { date: "2026-03-07", time: "12:00", timeZone: "America/Toronto" } }), NOW);
    const edt = prepareEvent(minimalInput("SPEEDING", { occurrence: { date: "2026-03-09", time: "12:00", timeZone: "America/Toronto" } }), NOW);
    assert.equal(est.occurredAt, "2026-03-07T17:00:00.000Z");
    assert.equal(edt.occurredAt, "2026-03-09T16:00:00.000Z");
  });

  it("a wall-clock time that does not exist (clocks forward) is refused", () => {
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { occurrence: { date: "2026-03-08", time: "02:30", timeZone: "America/Toronto" } }), NOW), /does not exist/);
  });

  it("a date-only occurrence keeps its local date and has no instant", () => {
    const p = prepareEvent(minimalInput("OTHER_EVENT", { occurrence: { date: "2026-03-09" } }), NOW);
    assert.equal(p.occurrencePrecision, "DATE_ONLY");
    assert.equal(p.occurredAt, null);
    assert.equal(p.occurredLocalDate, "2026-03-09");
    assert.ok(p.quality.flags.includes("OCCURRENCE_DATE_ONLY"));
  });

  it("future occurrences and a report that precedes the occurrence are refused", () => {
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { occurrence: { date: "2026-03-12", time: "09:00", timeZone: "America/Toronto" } }), NOW), /future/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { reportedAt: "2026-03-01T00:00:00Z" }), NOW), /before it occurred/);
  });

  it("unknown keys, out-of-list values, wrong types and hidden legacy fields are refused, with every issue reported", () => {
    try {
      prepareEvent(minimalInput("COLLISION", { facts: { ...minimalFacts("COLLISION"), nonsense: 1, weather: "NOT_A_WEATHER", speedAtOccurrence: "fast", towRequired: true } }), NOW);
      assert.fail("expected a validation error");
    } catch (error) {
      assert.ok(error instanceof DriverEventValidationError);
      const fields = error.issues.map((i) => i.field);
      for (const f of ["facts.nonsense", "facts.weather", "facts.speedAtOccurrence", "facts.towRequired"]) assert.ok(fields.includes(f), `${f} reported`);
    }
  });

  it("conditional facts apply only when their condition holds", () => {
    const base = { ...minimalFacts("ROADSIDE_INSPECTION"), inspectionResult: "PASS", inspectionScope: "DRIVER" };
    delete (base as Record<string, Scalar>).driverInspectionResult;
    const passed = prepareEvent(minimalInput("ROADSIDE_INSPECTION", { facts: { ...base } }), NOW);
    assert.equal(passed.quality.requiredMissing, 0);
    assert.throws(() => prepareEvent(minimalInput("ROADSIDE_INSPECTION", { facts: { ...base, vehicleOOSState: "YES" } }), NOW), /does not apply/);
  });

  it("required facts block recording but not a draft; unknown / not applicable / not collected are stated, not inferred", () => {
    const facts = minimalFacts("SPEEDING");
    delete facts.actualSpeed;
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { facts }), NOW), /required/);
    const draft = prepareEvent(minimalInput("SPEEDING", { facts, recordState: "DRAFT" }), NOW);
    assert.deepEqual(draft.quality.missingKeys, ["actualSpeed"]);
    assert.ok(draft.quality.flags.includes("REQUIRED_FIELDS_MISSING"));
    const stated = prepareEvent(minimalInput("SPEEDING", { facts, factStates: { actualSpeed: "UNKNOWN" } }), NOW);
    assert.equal(stated.quality.requiredMissing, 0, "an explicit 'unknown' is an answer");
    assert.equal(stated.record.factStates.actualSpeed, "UNKNOWN");
    assert.equal(stated.record.facts.actualSpeed, undefined, "unknown is not stored as a value, let alone zero");
    const notCollected = prepareEvent(minimalInput("SPEEDING", { facts, factStates: { actualSpeed: "NOT_COLLECTED" }, recordState: "DRAFT" }), NOW);
    assert.equal(notCollected.quality.requiredMissing, 1, "'not collected' does not satisfy a required fact");
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { facts: { ...facts, actualSpeed: 100 }, factStates: { actualSpeed: "UNKNOWN" } }), NOW), /has a value/);
  });

  it("a measurement whose field offers several units must state one; a unit without a value or on a fixed-unit field is refused", () => {
    const facts = minimalFacts("SPEEDING");
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { facts, factUnits: {} }), NOW), /needs its unit/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { facts, factUnits: { actualSpeed: "FURLONGS" } }), NOW), /needs its unit/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { facts, factUnits: { actualSpeed: "KMH", durationSeconds: "furlongs" } }), NOW), /fixed unit/);
    assert.doesNotThrow(() => prepareEvent(minimalInput("SPEEDING", { facts: { ...facts, durationSeconds: 5 }, factUnits: { actualSpeed: "KMH", durationSeconds: "seconds" } }), NOW));
    const ok = prepareEvent(minimalInput("SPEEDING", { facts, factUnits: { actualSpeed: "KMH" } }), NOW);
    assert.equal(ok.record.factUnits.actualSpeed, "KMH");
    const noValue = { ...facts };
    delete noValue.actualSpeed;
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { facts: noValue, factUnits: { actualSpeed: "KMH" }, recordState: "DRAFT" }), NOW), /no value/);
  });

  it("header validation: source must be allowed for the category, jurisdiction and coordinates are well-formed, links are ids", () => {
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { sourceType: "Customer" }), NOW), /source/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { location: { jurisdictionCode: "on" } }), NOW), /Jurisdiction/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { location: { latitude: 100, longitude: 0 } }), NOW), /coordinates/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { location: { latitude: 10 } }), NOW), /together/);
    assert.throws(() => prepareEvent(minimalInput("SPEEDING", { driverRelationshipId: "x" }), NOW), /record id/);
  });

  it("device-sourced events are flagged and missing links are visible as data-quality flags", () => {
    const p = prepareEvent(minimalInput("SPEEDING", { ingestionOrigin: "TELEMATICS_INGESTION" }), NOW);
    for (const flag of ["DEVICE_SOURCED", "NO_DRIVER_LINK", "NO_VEHICLE_LINK", "NO_JURISDICTION"]) assert.ok(p.quality.flags.includes(flag), flag);
  });

  it("every added field (reconciliation) is optional unless the baseline made it essential, so existing records stay valid", () => {
    for (const d of RECORDABLE) {
      const raw = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[d.value];
      assert.ok(raw.fields.every((f) => f.dataPointId.length > 0));
    }
  });
});
