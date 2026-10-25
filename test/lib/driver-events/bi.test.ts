import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BI_CONTRACT_VERSION, deriveFact, deriveReliability, type FactConsequence, type FactEvent } from "@/lib/driver-events/bi";
import { deriveObligations } from "@/lib/driver-events/obligations";

const event = (over: Partial<FactEvent> = {}): FactEvent => ({
  id: "e1", organization_id: "o1", category: "Collision", category_code: "COLLISION", schema_version: "1.2", status: "Open", record_state: "RECORDED", current_version: 1,
  occurrence_precision: "EXACT_DATETIME", occurred_at: "2026-03-09T12:30:00.000Z", occurred_time_zone: "America/Toronto", occurred_local_date: "2026-03-09", reported_at: "2026-03-09T14:30:00.000Z",
  observed_severity: "High", potential_severity: null, source_type: "Driver Report", ingestion_origin: "MANUAL_ENTRY", driver_relationship_id: "d1", driver_person_id: "p1", vehicle_id: "v1", trailer_vehicle_id: null,
  jurisdiction_code: "CA-ON", country: "CA", state_province: "ON", load_reference: null, shipment_reference: null, customer_reference: null, verification_state: "UNVERIFIED", closed_at: null,
  created_at: "2026-03-09T14:31:00.000Z", record: { facts: {} }, data_quality: { requiredTotal: 5, requiredMissing: 1, flags: [] }, ...over,
});
const cons = (over: Partial<FactConsequence>): FactConsequence => ({ kind: "COST_ACTUAL", measurement_state: "MEASURED", confidence: "CONFIRMED", quantity: null, unit: null, amount_minor: null, currency: null, started_at: null, ended_at: null, state: "ACTIVE", ...over });
const fact = (over: { event?: Partial<FactEvent>; consequences?: FactConsequence[]; evidence?: Parameters<typeof deriveFact>[0]["evidence"]; actions?: Parameters<typeof deriveFact>[0]["actions"]; restrictions?: Parameters<typeof deriveFact>[0]["restrictions"] } = {}) =>
  deriveFact({ event: event(over.event), evidence: over.evidence ?? [], consequences: over.consequences ?? [], actions: over.actions ?? [], restrictions: over.restrictions ?? [], corrections: 0 });

describe("Driver Event analytical fact (contract v1)", () => {
  it("states its contract version and carries the canonical join keys", () => {
    const f = fact();
    assert.equal(f.contract_version, BI_CONTRACT_VERSION);
    assert.equal(f.driver_relationship_id, "d1");
    assert.equal(f.vehicle_id, "v1");
    assert.equal(f.recurrence_driver_key, "COLLISION|driver:d1");
    assert.equal(f.reporting_lag_minutes, 120);
  });

  it("missing is never zero: nothing recorded gives NULL, only an explicit 'none confirmed' gives zero", () => {
    const empty = fact();
    for (const k of ["delay_minutes", "downtime_minutes", "cost_actual_minor", "cost_estimated_minor", "claim_amount_minor", "recovery_amount_minor", "net_impact_minor", "injuries_count", "fatalities_count", "tow_away", "currency"] as const) assert.equal(empty[k], null, k);
    const unknown = fact({ consequences: [cons({ measurement_state: "UNKNOWN" }), cons({ kind: "OPERATIONAL_DELAY", measurement_state: "NOT_COLLECTED" })] });
    assert.equal(unknown.cost_actual_minor, null);
    assert.equal(unknown.delay_minutes, null);
    const none = fact({ consequences: [cons({ kind: "RECOVERY", measurement_state: "NONE_CONFIRMED" }), cons({ kind: "INJURY", measurement_state: "NONE_CONFIRMED" })] });
    assert.equal(none.recovery_amount_minor, 0);
    assert.equal(none.injuries_count, 0);
  });

  it("durations normalise to minutes (quantity in minutes / hours / days, or a start and end)", () => {
    const f = fact({ consequences: [
      cons({ kind: "OPERATIONAL_DELAY", quantity: 1.5, unit: "hours" }),
      cons({ kind: "OPERATIONAL_DELAY", started_at: "2026-03-09T13:00:00Z", ended_at: "2026-03-09T13:30:00Z" }),
      cons({ kind: "ASSET_DOWNTIME", quantity: 2, unit: "days" }),
    ] });
    assert.equal(f.delay_minutes, 120);
    assert.equal(f.downtime_minutes, 2880);
    assert.equal(fact({ consequences: [cons({ kind: "OPERATIONAL_DELAY", quantity: 5, unit: "loads" })] }).delay_minutes, null, "a unit that is not a duration is not guessed");
  });

  it("superseded consequences do not count; money is in one currency or not summed at all", () => {
    const one = fact({ consequences: [cons({ amount_minor: 1000, currency: "CAD", state: "SUPERSEDED" }), cons({ amount_minor: 2500, currency: "CAD" })] });
    assert.equal(one.cost_actual_minor, 2500);
    assert.equal(one.currency, "CAD");
    const mixed = fact({ consequences: [cons({ amount_minor: 2500, currency: "CAD" }), cons({ kind: "COST_ESTIMATED", amount_minor: 100, currency: "USD" })] });
    assert.equal(mixed.cost_actual_minor, null);
    assert.equal(mixed.currency, null);
    assert.ok(JSON.parse(mixed.quality_flags).includes("MIXED_CURRENCY"));
  });

  it("net impact needs actual cost AND a stated recovery position", () => {
    const noRecovery = fact({ consequences: [cons({ amount_minor: 5000, currency: "CAD" })] });
    assert.equal(noRecovery.net_impact_minor, null);
    assert.ok(JSON.parse(noRecovery.quality_flags).includes("RECOVERY_NOT_COLLECTED"));
    const net = fact({ consequences: [cons({ amount_minor: 5000, currency: "CAD" }), cons({ kind: "RECOVERY", amount_minor: 1500, currency: "CAD" })] });
    assert.equal(net.net_impact_minor, 3500);
  });

  it("confirmed and estimated amounts are separable and the measurement profile keeps every state apart", () => {
    const f = fact({ consequences: [
      cons({ amount_minor: 7000, currency: "CAD", confidence: "CONFIRMED" }),
      cons({ amount_minor: 1500, currency: "CAD", confidence: "ESTIMATED" }),
      cons({ kind: "OPERATIONAL_DELAY", measurement_state: "NOT_COLLECTED", confidence: "UNVERIFIED" }),
      cons({ kind: "RECOVERY", measurement_state: "NONE_CONFIRMED" }),
    ] });
    assert.equal(f.cost_actual_minor, 8500);
    assert.equal(f.cost_actual_confirmed_minor, 7000);
    assert.equal(f.cost_actual_unconfirmed_minor, 1500);
    const profile = JSON.parse(f.measurement_profile);
    assert.deepEqual(profile.COST_ACTUAL, { state: { MEASURED: 2 }, confidence: { CONFIRMED: 1, ESTIMATED: 1 } });
    assert.deepEqual(profile.OPERATIONAL_DELAY.state, { NOT_COLLECTED: 1 });
    assert.equal(profile.INJURY, undefined);
    const none = fact();
    assert.equal(none.cost_actual_confirmed_minor, null);
    assert.equal(none.measurement_profile, "{}");
  });

  it("evidence counts, verification and source reliability: linked is not verified", () => {
    const linked = fact({ evidence: [{ link_status: "active", verification_state: "UNVERIFIED", lifecycle_state: "stored" }, { link_status: "unlinked", verification_state: "VERIFIED", lifecycle_state: "stored" }] });
    assert.equal(linked.evidence_links_active, 1);
    assert.equal(linked.evidence_stored, 1);
    assert.equal(linked.evidence_verified, 0);
    assert.equal(linked.source_reliability, "SELF_REPORTED");
    assert.ok(JSON.parse(linked.quality_flags).includes("EVIDENCE_UNVERIFIED"));
    assert.ok(JSON.parse(fact().quality_flags).includes("NO_EVIDENCE"));
    assert.equal(deriveReliability({ source_type: "Roadside Inspection", ingestion_origin: "MANUAL_ENTRY" }, { verified: 1, stored: 1 }), "AUTHORITATIVE");
    assert.equal(deriveReliability({ source_type: "Roadside Inspection", ingestion_origin: "MANUAL_ENTRY" }, { verified: 0, stored: 1 }), "UNKNOWN", "an authority label alone is not authority");
    assert.equal(deriveReliability({ source_type: "ELD / Telematics", ingestion_origin: "TELEMATICS_INGESTION" }, { verified: 0, stored: 0 }), "DEVICE_UNVERIFIED");
  });

  it("resolution state follows restrictions and required follow-up, not the status label", () => {
    assert.equal(fact({ restrictions: [{ state: "ACTIVE", mandatory: true }] }).resolution_state, "RESTRICTED");
    assert.equal(fact({ actions: [{ required: true, status: "OPEN", due_date: "2026-04-01" }] }).resolution_state, "AWAITING_ACTIONS");
    assert.equal(fact({ actions: [{ required: true, status: "OPEN", due_date: "2026-04-01" }] }).next_action_due, "2026-04-01");
    assert.equal(fact({ event: { record_state: "DRAFT" } }).resolution_state, "DRAFT");
    const closed = fact({ event: { status: "Closed", closed_at: "2026-03-10T14:31:00.000Z" } });
    assert.equal(closed.resolution_state, "CLOSED");
    assert.equal(closed.hours_to_close, 24);
  });

  it("data quality score reflects missing required facts; unknown precision is visible", () => {
    assert.equal(fact().data_quality_score, 0.8);
    assert.equal(fact({ event: { data_quality: {} } }).data_quality_score, null);
  });

  it("a report that precedes the occurrence is flagged, not hidden", () => {
    assert.ok(JSON.parse(fact({ event: { reported_at: "2026-03-09T10:00:00.000Z" } }).quality_flags).includes("REPORTED_BEFORE_OCCURRED"));
  });
});

describe("Driver Event obligations", () => {
  it("roadside out-of-service answers oblige restrictions and a required correction; other answers oblige nothing", () => {
    assert.equal(deriveObligations("ROADSIDE_INSPECTION", { driverOOSState: "NO", vehicleOOSState: "NO" }).restrictions.length, 0);
    assert.equal(deriveObligations("ROADSIDE_INSPECTION", { driverOOSState: "UNKNOWN", vehicleOOSState: "UNKNOWN" }).restrictions.length, 0, "unknown does not invent a restriction");
    const both = deriveObligations("ROADSIDE_INSPECTION", { driverOOSState: "YES", vehicleOOSState: "YES" });
    assert.deepEqual(both.restrictions.map((r) => r.restrictionKind), ["DRIVER_OUT_OF_SERVICE", "VEHICLE_OUT_OF_SERVICE"]);
    assert.ok(both.restrictions.every((r) => r.authority === "ENFORCEMENT"));
    assert.equal(both.actions.length, 1);
  });
  it("a vehicle stated not safe to operate oblige an equipment hold; yes or unknown do not", () => {
    assert.equal(deriveObligations("EQUIPMENT_FAILURE", { vehicleSafeToOperate: "NO" }).restrictions[0].restrictionKind, "EQUIPMENT_HOLD");
    assert.equal(deriveObligations("EQUIPMENT_FAILURE", { vehicleSafeToOperate: "UNKNOWN" }).restrictions.length, 0);
    assert.equal(deriveObligations("SPEEDING", { vehicleSafeToOperate: "NO" }).restrictions.length, 0);
  });
});
