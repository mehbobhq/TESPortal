/* eslint-disable @typescript-eslint/no-explicit-any */
import "../../helpers/register-alias-loader.mjs";
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  CARGO_PRIMARY_FAMILIES,
  CARGO_SECONDARY_BY_FAMILY,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-cargo-taxonomy.ts";
import {
  CARGO_DATA_POINTS as DP,
  appendCargoItemStatusChange,
  buildCargoSummary,
  cargoDraftToChildren,
  deriveCargoControlGap,
  deriveCargoCustodyDiscrepancy,
  deriveCargoTimingDelays,
  describeCargoIncident,
  describeLegacyCargo,
  emptyCargoControl,
  emptyCargoCustody,
  emptyCargoDamage,
  emptyCargoDraft,
  emptyCargoItem,
  emptyCargoTemperature,
  emptyCargoTheft,
  readCargoControls,
  readCargoCustody,
  readCargoDamage,
  readCargoItems,
  readCargoStatusHistory,
  readCargoTemperatures,
  readCargoTheft,
  validateNewCargoIncident,
  validateNewCargoIncidentDetailed,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-cargo.ts";
import {
  closePerformanceEventWorkflow,
  setPerformanceInvestigationRequirement,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow.ts";
import {
  deriveEventWorkflow,
  getWorkflowProvidersForEventType,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-workflow-registry.ts";
import {
  CONTRIBUTING_FACTOR_DOMAINS,
  completePerformanceInvestigation,
  getInvestigationsForEvent,
  openPerformanceInvestigation,
  recordPerformanceDetermination,
  resolvePreventability,
  setInvestigationContributingFactors,
  updatePerformanceInvestigation,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-investigation.ts";
import {
  createPerformanceEventRelationship,
  getEventRelationships,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/performance-event-relationships.ts";

let dd: any;
let schema: any;
before(async () => {
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  dd = await import("../../../lib/driver-data.ts");
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
  schema = await import("../../../lib/driver-performance-schema.ts");
});

const COMPANY = "C-CARGO";
const STAMP = "2026-09-28T12:00:00.000Z";
const VEHICLES = [{ id: "VEH-1", label: "Unit 101" }, { id: "TRL-1", label: "Unit T-9" }];
const fact = (dataPointId: string, value: string) => ({ dataPointId, value, valueType: "string" });
const item = (patch: Record<string, unknown> = {}) => ({ ...emptyCargoItem(), itemId: "ITM-1", commodity: "Frozen seafood", quantity: "20", quantityUnit: "PALLETS", ...patch });

function newCargo(opts: { facts?: Array<[string, string]>; draft?: Record<string, unknown>; extra?: Record<string, unknown> } = {}): any {
  const d = { ...emptyCargoDraft(), powerUnitId: "VEH-1", items: [item()], ...(opts.draft || {}) } as any;
  const children = cargoDraftToChildren(d, VEHICLES);
  const base: Array<[string, string]> = [[DP.primaryFamily, "DAMAGE"], ...(opts.facts || [])];
  const facts = [...new Map(base).entries()].map(([id, value]) => fact(id, value));
  return {
    id: "CGO-1", eventType: "Cargo Incident", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: STAMP,
    eventDate: "2026-09-28", eventTime: "14:05", occurrencePrecision: children.occurrencePrecision, location: "Hwy 2", stateProvince: "AB", country: "Canada",
    vehicleId: children.vehicleId, canonicalLinks: children.canonicalLinks, structuredEventFacts: facts, childCollections: children.collections,
    provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" }, evidenceIds: ["EV-1", "EV-2"],
    ...(opts.extra || {}),
  };
}
const messages = (event: any) => validateNewCargoIncident(event);
const state = (events: any[], extra: Record<string, unknown> = {}): any => ({ events, performanceInvestigations: [], companyActions: [], companyDeterminations: [], eventRelationships: [], ...extra });
const labels = (workflow: { reasons: Array<{ label: string }> }) => workflow.reasons.map((reason) => reason.label);
const provs = () => getWorkflowProvidersForEventType("Cargo Incident");
const action = (extra: Record<string, unknown> = {}) => ({ id: "ACT-1", companyId: COMPANY, driverMasterId: "DRV-1", actionType: "COACHING", title: "Seal training", decidedBy: "M", factualBasis: "f", effectiveDate: "2026-09-29", status: "Active", linkedEventIds: ["CGO-1"], closureRequirement: "REQUIRED", isArchived: false, createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T00:00:00.000Z", ...extra });

const VEH_KEY = `tes_company_vehicles_${COMPANY}`;
const seedVehicles = () => localStorage.setItem(VEH_KEY, JSON.stringify({ version: 1, vehicles: [{ id: "VEH-1", unitNumber: "101", equipmentType: "Tractor" }, { id: "TRL-1", unitNumber: "T-9", equipmentType: "Trailer - Reefer" }] }));
const payloadFrom = (event: any) => { const { id: _i, companyId: _c, driverMasterId: _d, createdAt: _t, ...rest } = event; return { ...rest, severity: "Not Applicable", status: "Not Applicable", summary: "Cargo incident", description: "d", chronology: [], linkedRecords: [] }; };

// 1-3 -------------------------------------------------------------------------
test("1. a new Cargo Incident persists through addPerformanceEvent with every child structure intact after reload", () => {
  localStorage.clear(); seedVehicles();
  const event = newCargo({
    facts: [[DP.custodyStage, "REST_STOP_PARKING"], [DP.loadReference, "LD-7731"], [DP.bolPro, "BOL-99"], [DP.dispatchNotified, "YES"]],
    draft: { trailerIds: ["TRL-1"], damage: { ...emptyCargoDamage(), damageType: "WATER_MOISTURE_DAMAGE", affectedItemIds: ["ITM-1"] }, temperatures: [{ ...emptyCargoTemperature(), setpoint: "-18", maximum: "-9", unit: "C", source: "REEFER_CONTROLLER" }], custody: [{ ...emptyCargoCustody(1), role: "LAST_KNOWN_GOOD", event: "Sealed at shipper" }], controls: [{ ...emptyCargoControl(), controlType: "SEAL", expectedState: "IN_PLACE_FUNCTIONING", actualState: "NOT_IN_PLACE" }] },
  });
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(event));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id);
  assert.equal(loaded.eventType, "Cargo Incident");
  assert.equal(loaded.vehicleId, "VEH-1");
  assert.deepEqual(loaded.canonicalLinks.map((link: any) => [link.entityType, link.recordId, link.relationshipKey]), [["Vehicle", "VEH-1", "vehicle"], ["Trailer", "TRL-1", "trailer"]]);
  assert.equal(readCargoItems(loaded).length, 1);
  assert.equal(readCargoDamage(loaded)?.damageType, "WATER_MOISTURE_DAMAGE");
  assert.equal(readCargoTemperatures(loaded)[0].source, "REEFER_CONTROLLER");
  assert.equal(readCargoCustody(loaded)[0].role, "LAST_KNOWN_GOOD");
  assert.equal(readCargoControls(loaded)[0].controlType, "SEAL");
  assert.equal(describeCargoIncident(loaded).classification.custodyStage, "Rest Stop / Parking");
  assert.equal(describeCargoIncident(loaded).shipment.find((row: any) => row.label === "BOL / PRO")?.value, "BOL-99");
});

test("2. required parent fields are enforced individually; time is required only when the occurrence is exact", () => {
  assert.deepEqual(messages(newCargo()), []);
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["date", { eventDate: "" }, /Event Date/], ["exact time", { eventTime: "" }, /Event Time is required when the occurrence is exact/], ["driver", { driverMasterId: "" }, /Driver/], ["location", { location: "" }, /Location/], ["country", { country: "" }, /Country/],
    ["source", { provenance: { sourceType: "SOURCE_FACT", source: "Dashcam / AI" } }, /Source/], ["precision", { occurrencePrecision: "SOMETIME" }, /precision/],
  ];
  for (const [name, extra, pattern] of cases) assert.match(messages(newCargo({ extra })).join(" "), pattern, name);
  assert.match(messages(newCargo({ draft: { powerUnitId: "" } })).join(" "), /Power Unit is required/);
  assert.deepEqual(messages(newCargo({ draft: { precision: "DATE_ONLY" }, extra: { eventTime: "" } })), [], "date-only precision needs no time");
  assert.deepEqual(messages(newCargo({ draft: { precision: "UNKNOWN" }, extra: { eventTime: "" } })), []);
  const noFamily = newCargo(); noFamily.structuredEventFacts = [];
  assert.match(messages(noFamily).join(" "), /Primary Incident Family is required/);
  assert.equal(validateNewCargoIncidentDetailed(newCargo({ draft: { powerUnitId: "" } })).find((i: any) => /Power Unit/.test(i.message))?.step, "CARGO_CARRIER");
});

test("3. Cargo Items are OPTIONAL: a Cargo Incident saves with zero items; when an item exists its ids are unique and its commodity is required", () => {
  const none = newCargo({ draft: { items: [] } });
  assert.deepEqual(messages(none), [], "no minimum item count");
  assert.deepEqual(readCargoItems(none), []);
  assert.ok(!none.childCollections.some((c: any) => c.collectionId.endsWith("ITEMS") && !c.collectionId.includes("STATUS")), "no empty or fake item collection is fabricated");
  assert.match(messages(newCargo({ draft: { items: [item({ commodity: "" })] } })).join(" "), /commodity/);
  assert.match(messages(newCargo({ draft: { items: [item(), item()] } })).join(" "), /ids must be present and unique/);
  assert.ok(!validateNewCargoIncidentDetailed(none).some((issue: any) => issue.step === "CARGO_ITEMS"), "no wizard step is blocked by a missing item");
});

test("3b. lightweight cargo context is recorded without a CargoItem; unknown stays unknown and never becomes a fake item", () => {
  const known = newCargo({ draft: { items: [] }, facts: [[DP.cargoContextStatus, "KNOWN_GENERAL"], [DP.cargoGeneralDescription, "Frozen seafood"]] });
  assert.deepEqual(messages(known), []);
  assert.deepEqual(describeCargoIncident(known).cargoContext, { status: "General cargo description known", description: "Frozen seafood" });
  assert.deepEqual(readCargoItems(known), [], "the general description did not create an item");
  const unknown = newCargo({ draft: { items: [] }, facts: [[DP.cargoContextStatus, "NOT_ESTABLISHED"]] });
  assert.deepEqual(messages(unknown), []);
  assert.equal(describeCargoIncident(unknown).cargoContext.status, "Cargo not yet established");
  assert.deepEqual(readCargoItems(unknown), [], "unknown cargo is not converted into an empty fake item");
  const silent = describeCargoIncident(newCargo({ draft: { items: [] } }));
  assert.deepEqual(silent.cargoContext, { status: undefined, description: undefined }, "nothing recorded is simply nothing recorded");
  assert.deepEqual(silent.items, []);
  assert.match(messages(newCargo({ draft: { items: [] }, facts: [[DP.cargoContextStatus, "KNOWN_GENERAL"]] })).join(" "), /Describe the general cargo/);
  assert.match(messages(newCargo({ draft: { items: [] }, facts: [[DP.cargoContextStatus, "SOMETHING"]] })).join(" "), /Cargo context must be a controlled value/);
  assert.match(messages(newCargo({ draft: { items: [] }, facts: [[DP.cargoContextStatus, "NOT_ESTABLISHED"], [DP.cargoGeneralDescription, "Frozen seafood"]] })).join(" "), /cannot accompany/);
  assert.ok(!/compliant/i.test(JSON.stringify(silent)), "absence of items is not presented as compliant or non-compliant");
});

test("3c. a CargoItem can be added later; existing item validation still applies; child references still need an existing item", () => {
  const early = newCargo({ draft: { items: [] } });
  assert.deepEqual(messages(early), []);
  const later = newCargo({ draft: { items: [item({ condition: "LOADED" })] } });
  assert.deepEqual(messages(later), []);
  assert.equal(readCargoItems(later).length, 1);
  const moved = appendCargoItemStatusChange(later, { cargoItemId: "ITM-1", toStatus: "MISSING", changedBy: "Dispatcher" });
  assert.equal(readCargoStatusHistory(moved).length, 1, "item status history still works");
  assert.throws(() => appendCargoItemStatusChange(early, { cargoItemId: "ITM-1", toStatus: "MISSING", changedBy: "Dispatcher" }), /not found/, "no item, nothing to change");
  assert.match(messages(newCargo({ draft: { items: [item({ quantity: "5", quantityUnit: "" })] } })).join(" "), /need a unit/);
  assert.match(messages(newCargo({ draft: { items: [item({ quantity: "10", damagedQuantity: "11" })] } })).join(" "), /cannot exceed/);
  // Without any items, a child that names an item still cannot reference one that does not exist.
  assert.match(messages(newCargo({ draft: { items: [], damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE", affectedItemIds: ["ITM-GHOST"] } } })).join(" "), /Cargo Item that does not exist/);
  assert.match(messages(newCargo({ draft: { items: [], custody: [{ ...emptyCargoCustody(1), event: "x", itemIds: ["ITM-GHOST"] }] } })).join(" "), /Cargo Item that does not exist/);
  // Damage / Theft / Custody / Security architecture needs no items.
  const rich = newCargo({ facts: [[DP.primaryFamily, "THEFT"]], draft: { items: [], damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE" }, theft: { ...emptyCargoTheft(), status: "SUSPECTED", timeCertainty: "UNKNOWN" }, custody: [{ ...emptyCargoCustody(1), role: "LAST_KNOWN_GOOD", event: "Sealed" }], controls: [{ ...emptyCargoControl(), controlType: "SEAL", expectedState: "IN_PLACE_FUNCTIONING", actualState: "NOT_IN_PLACE" }] } });
  assert.deepEqual(messages(rich), []);
  assert.equal(describeCargoIncident(rich).controls[0].gap, "GAP");
});

test("3d. a Cargo Incident with no items persists through the data layer, reloads, and an item can be added later without rewriting the incident", () => {
  localStorage.clear(); seedVehicles();
  const saved = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo({ draft: { items: [] }, facts: [[DP.cargoContextStatus, "KNOWN_GENERAL"], [DP.cargoGeneralDescription, "Mixed retail freight"]] })));
  const loaded = dd.loadCompanyDriverStore(COMPANY).events.find((entry: any) => entry.id === saved.id);
  assert.deepEqual(readCargoItems(loaded), []);
  assert.equal(describeCargoIncident(loaded).cargoContext.description, "Mixed retail freight");
  assert.equal(deriveEventWorkflow(loaded, dd.loadCompanyDriverStore(COMPANY)).state, "NOT_REQUIRED", "missing item detail creates no obligation");
});

// 4 ---------------------------------------------------------------------------
test("4. Primary family is single-valued and controlled; Secondary classification must belong to it; values display as labels", () => {
  assert.equal(CARGO_PRIMARY_FAMILIES.length, 10);
  for (const family of CARGO_PRIMARY_FAMILIES) assert.deepEqual(messages(newCargo({ facts: [[DP.primaryFamily, family.value]] })), [], family.value);
  assert.match(messages(newCargo({ facts: [[DP.primaryFamily, "SABOTAGE"]] })).join(" "), /Primary Incident Family must be a controlled value/);
  assert.deepEqual(messages(newCargo({ facts: [[DP.primaryFamily, "THEFT"], [DP.secondaryClassification, "PILFERAGE"]] })), []);
  assert.match(messages(newCargo({ facts: [[DP.primaryFamily, "THEFT"], [DP.secondaryClassification, "TEMPERATURE_EXCURSION"]] })).join(" "), /does not belong to the selected Primary Incident Family/);
  for (const [family, secondaries] of Object.entries(CARGO_SECONDARY_BY_FAMILY) as unknown as Array<[string, Array<{ value: string }>]>) {
    assert.ok(secondaries.some((entry) => entry.value === "OTHER") && secondaries.some((entry) => entry.value === "UNKNOWN"), `${family} has Other and Unknown`);
  }
  const d = describeCargoIncident(newCargo({ facts: [[DP.primaryFamily, "TEMPERATURE_COLD_CHAIN"], [DP.secondaryClassification, "REEFER_INTERRUPTION_FAILURE"]] }));
  assert.deepEqual([d.classification.family, d.classification.secondary], ["Temperature / Cold Chain", "Reefer Interruption / Failure"]);
  assert.ok(!JSON.stringify(d.classification).includes("TEMPERATURE_COLD_CHAIN"));
  assert.match(messages(newCargo({ facts: [[DP.custodyStage, "ON_THE_MOON"]] })).join(" "), /Custody Stage/);
});

// 5-7 -------------------------------------------------------------------------
test("5. a Damage-only incident has a damage outcome and no theft outcome", () => {
  const event = newCargo({ draft: { damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE", scope: "PARTIAL", origin: "NEW_INCIDENT", affectedItemIds: ["ITM-1"] } } });
  assert.deepEqual(messages(event), []);
  assert.ok(readCargoDamage(event)); assert.equal(readCargoTheft(event), undefined);
  assert.equal(buildCargoSummary(event).outcomeLine, "Outcomes: Damage");
});

test("6. a Theft-only incident has a theft outcome and no damage outcome", () => {
  const event = newCargo({ facts: [[DP.primaryFamily, "THEFT"]], draft: { theft: { ...emptyCargoTheft(), status: "CONFIRMED", method: "SEAL_TAMPERING", timeCertainty: "UNKNOWN" } } });
  assert.deepEqual(messages(event), []);
  assert.ok(readCargoTheft(event)); assert.equal(readCargoDamage(event), undefined);
  assert.equal(buildCargoSummary(event).outcomeLine, "Outcomes: Theft");
});

test("7. Damage AND Theft coexist on ONE parent event (Primary Family = Theft, both outcomes present)", () => {
  const event = newCargo({ facts: [[DP.primaryFamily, "THEFT"]], draft: { damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE" }, theft: { ...emptyCargoTheft(), status: "CONFIRMED", timeCertainty: "UNKNOWN" } } });
  assert.deepEqual(messages(event), []);
  assert.ok(readCargoDamage(event) && readCargoTheft(event));
  assert.equal(event.eventType, "Cargo Incident", "one top-level event, not two");
  assert.equal(buildCargoSummary(event).outcomeLine, "Outcomes: Damage + Theft");
  const neither = newCargo({ facts: [[DP.primaryFamily, "OTHER_UNKNOWN"]] });
  assert.deepEqual(messages(neither), [], "neither outcome is valid while the facts are still being established");
});

// 8-10 ------------------------------------------------------------------------
test("8. item quantities and values: unknown stays unknown, never zero; quantity relationships are checked only where both sides are known", () => {
  const blank = readCargoItems(newCargo({ draft: { items: [item({ quantity: "", quantityUnit: "", affectedQuantity: "", stolenQuantity: "" })] } }))[0];
  assert.deepEqual([blank.quantity, blank.affectedQuantity, blank.stolenQuantity, blank.declaredValue], [undefined, undefined, undefined, undefined]);
  assert.deepEqual(messages(newCargo({ draft: { items: [item({ quantity: "", quantityUnit: "" })] } })), []);
  const zero = readCargoItems(newCargo({ draft: { items: [item({ stolenQuantity: "0" })] } }))[0];
  assert.equal(zero.stolenQuantity, 0, "an explicit zero is kept as zero");
  assert.match(messages(newCargo({ draft: { items: [item({ quantity: "-1" })] } })).join(" "), /zero or greater/);
  assert.match(messages(newCargo({ draft: { items: [item({ quantity: "10", damagedQuantity: "11" })] } })).join(" "), /damaged quantity cannot exceed/);
  assert.match(messages(newCargo({ draft: { items: [item({ stolenQuantity: "5", recoveredQuantity: "6", quantity: "" , quantityUnit: "PALLETS" })] } })).join(" "), /recovered quantity cannot exceed the stolen quantity/);
  assert.deepEqual(messages(newCargo({ draft: { items: [item({ quantity: "", quantityUnit: "PALLETS", damagedQuantity: "50" })] } })), [], "no cross-check when the item quantity is unknown");
  assert.match(messages(newCargo({ draft: { items: [item({ quantity: "5", quantityUnit: "" })] } })).join(" "), /need a unit/);
  const rich = describeCargoIncident(newCargo({ draft: { items: [item({ hazmat: "NO", temperatureSensitive: "YES", condition: "LOADED" })] } })).items[0];
  assert.deepEqual([rich.hazmat, rich.temperatureSensitive, rich.status, rich.quantity], ["No", "Yes", "Loaded", "20 Pallets"]);
});

test("9. amounts keep their ISO currency code; invalid or missing codes and negative amounts are rejected; Potential exposure is not a computed loss", () => {
  const event = newCargo({ draft: { items: [item({ declaredValue: "125000.5", declaredCurrency: "USD", insuredValue: "100000", insuredCurrency: "CAD", affectedValue: "8000", affectedCurrency: "CAD" })] } });
  assert.deepEqual(messages(event), []);
  const [row] = readCargoItems(event);
  assert.deepEqual(row.declaredValue, { value: 125000.5, currencyCode: "USD" });
  assert.deepEqual(row.insuredValue, { value: 100000, currencyCode: "CAD" });
  assert.equal(describeCargoIncident(event).items[0].declared, "125,000.50 USD");
  assert.match(messages(newCargo({ draft: { items: [item({ declaredValue: "10", declaredCurrency: "XXQ" })] } })).join(" "), /valid ISO 4217/);
  assert.match(messages(newCargo({ draft: { items: [item({ declaredValue: "10", declaredCurrency: "" })] } })).join(" "), /ISO currency code/);
  assert.match(messages(newCargo({ draft: { items: [item({ declaredValue: "-5" })] } })).join(" "), /zero or greater/);
  assert.equal(readCargoItems(newCargo({ draft: { items: [item({ declaredValue: "", declaredCurrency: "CAD" })] } }))[0].declaredValue, undefined, "a currency without an amount is not an amount");
  const text = JSON.stringify(describeCargoIncident(event));
  assert.ok(!/net.?loss|reserve|chargeback/i.test(text), "no accounting conclusions are derived");
  const money = { value: 1, currencyCode: "EUR" };
  assert.deepEqual(readCargoItems(newCargo({ draft: { items: [item({ declaredValue: "1", declaredCurrency: "EUR" })] } }))[0].declaredValue, money, "the representation is extensible beyond CAD / USD");
});

test("10. item status is stored on the item and every change is preserved in an append-only history; no artificial history at creation", () => {
  const event = newCargo({ draft: { items: [item({ condition: "LOADED" })] } });
  assert.deepEqual(readCargoStatusHistory(event), [], "no history rows are required at creation");
  const moved = appendCargoItemStatusChange(event, { cargoItemId: "ITM-1", toStatus: "MISSING", changedBy: "Dispatcher", at: "2026-09-29T10:00:00.000Z", note: "Not on delivery" });
  const recovered = appendCargoItemStatusChange(moved, { cargoItemId: "ITM-1", toStatus: "RECOVERED", changedBy: "Safety Manager", at: "2026-09-30T10:00:00.000Z" });
  assert.equal(readCargoItems(recovered)[0].condition, "RECOVERED");
  assert.deepEqual(readCargoStatusHistory(recovered).map((entry: any) => [entry.fromStatus, entry.toStatus, entry.changedBy]), [["LOADED", "MISSING", "Dispatcher"], ["MISSING", "RECOVERED", "Safety Manager"]]);
  assert.equal(readCargoStatusHistory(event).length, 0, "the original event is not mutated");
  assert.deepEqual(messages(recovered), []);
  assert.throws(() => appendCargoItemStatusChange(event, { cargoItemId: "ITM-1", toStatus: "VANISHED", changedBy: "x" }), /controlled value/);
  assert.throws(() => appendCargoItemStatusChange(event, { cargoItemId: "NOPE", toStatus: "MISSING", changedBy: "x" }), /not found/);
  assert.throws(() => appendCargoItemStatusChange(event, { cargoItemId: "ITM-1", toStatus: "MISSING", changedBy: " " }), /changedBy/);
  assert.equal(describeCargoIncident(recovered).statusHistory.length, 2);
});

// 11 --------------------------------------------------------------------------
test("11. temperature observations keep their own source; contradictory readings stay separate; a reefer failure is never inferred", () => {
  const event = newCargo({ draft: { temperatures: [
    { ...emptyCargoTemperature(), itemId: "T1", setpoint: "-18", minimum: "-19", maximum: "-8", unit: "C", excursionMinutes: "95", source: "TELEMATICS", reeferStatus: "RUNNING", doorOpen: "NO" },
    { ...emptyCargoTemperature(), itemId: "T2", setpoint: "-18", maximum: "-12", unit: "C", source: "CUSTOMER_READING" },
  ] } });
  assert.deepEqual(messages(event), []);
  const observations = readCargoTemperatures(event);
  assert.deepEqual(observations.map((entry: any) => [entry.maximum, entry.source]), [[-8, "TELEMATICS"], [-12, "CUSTOMER_READING"]]);
  assert.equal(describeCargoIncident(event).temperature[0].reefer, "Running", "an excursion with a running reefer is recorded as observed, not as a failure");
  assert.ok(!/fail/i.test(JSON.stringify(describeCargoIncident(event).temperature[1])));
  assert.match(messages(newCargo({ draft: { temperatures: [{ ...emptyCargoTemperature(), maximum: "-8", unit: "", source: "TELEMATICS" }] } })).join(" "), /need a unit/);
  assert.match(messages(newCargo({ draft: { temperatures: [{ ...emptyCargoTemperature(), minimum: "-5", maximum: "-9", unit: "C", source: "TELEMATICS" }] } })).join(" "), /minimum temperature cannot exceed/);
  assert.match(messages(newCargo({ draft: { temperatures: [{ ...emptyCargoTemperature(), maximum: "-9", unit: "C", source: "" }] } })).join(" "), /needs its measurement source/);
  assert.match(messages(newCargo({ draft: { temperatures: [{ ...emptyCargoTemperature(), maximum: "-9", unit: "C", source: "OBSERVED_BY_GUESS" }] } })).join(" "), /Measurement source must be a controlled value/);
});

// 12-15 -----------------------------------------------------------------------
test("12. theft with an exact time", () => {
  const ok = newCargo({ facts: [[DP.primaryFamily, "THEFT"]], draft: { theft: { ...emptyCargoTheft(), status: "CONFIRMED", timeCertainty: "EXACT", exactTime: "2026-09-28T03:15" } } });
  assert.deepEqual(messages(ok), []);
  assert.equal(readCargoTheft(ok)?.exactTime, "2026-09-28T03:15");
  assert.match(messages(newCargo({ draft: { theft: { ...emptyCargoTheft(), timeCertainty: "EXACT" } } })).join(" "), /exact theft time is required/);
  assert.match(messages(newCargo({ draft: { theft: { ...emptyCargoTheft(), timeCertainty: "EXACT", exactTime: "2026-09-28T03:15", windowStart: "2026-09-28T01:00", windowEnd: "2026-09-28T02:00" } } })).join(" "), /cannot also carry an estimated window/);
});

test("13. theft with an estimated window; an exact time is never fabricated", () => {
  const ok = newCargo({ draft: { theft: { ...emptyCargoTheft(), timeCertainty: "ESTIMATED_WINDOW", windowStart: "2026-09-27T22:00", windowEnd: "2026-09-28T05:00", windowBasis: "Parked overnight at truck stop" } } });
  assert.deepEqual(messages(ok), []);
  assert.equal(describeCargoIncident(ok).theft?.time, "2026-09-27 22:00 to 2026-09-28 05:00 (Parked overnight at truck stop)");
  assert.match(messages(newCargo({ draft: { theft: { ...emptyCargoTheft(), timeCertainty: "ESTIMATED_WINDOW", windowStart: "2026-09-28T05:00", windowEnd: "2026-09-27T22:00" } } })).join(" "), /window end cannot be before its start/);
  assert.match(messages(newCargo({ draft: { theft: { ...emptyCargoTheft(), timeCertainty: "ESTIMATED_WINDOW", windowStart: "2026-09-28T05:00" } } })).join(" "), /needs both a start and an end/);
  assert.match(messages(newCargo({ draft: { theft: { ...emptyCargoTheft(), timeCertainty: "UNKNOWN", exactTime: "2026-09-28T03:15" } } })).join(" "), /exact time is never assumed/);
  // Occurrence window on the parent follows the same ordering rule.
  assert.match(messages(newCargo({ facts: [[DP.windowStart, "2026-09-28T09:00"], [DP.windowEnd, "2026-09-28T08:00"]] })).join(" "), /occurrence window end cannot be before its start/);
  assert.deepEqual(messages(newCargo({ draft: { precision: "APPROXIMATE" }, facts: [[DP.windowStart, "2026-09-27T20:00"], [DP.windowEnd, "2026-09-28T06:00"], [DP.windowBasis, "Overnight stop"]] })), []);
});

test("14. Last Known Good is a typed custody record; at most one", () => {
  const event = newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), role: "LAST_KNOWN_GOOD", event: "Seal verified at yard gate", timestamp: "2026-09-27T21:30", location: "Calgary yard", sealState: "INTACT", gpsState: "ACTIVE", verificationMethod: "SEAL_NUMBER_CHECK", itemIds: ["ITM-1"], linkedVehicleId: "VEH-1" }] } });
  assert.deepEqual(messages(event), []);
  const [entry] = readCargoCustody(event);
  assert.deepEqual([entry.role, entry.sealState, entry.itemIds, entry.linkedVehicleId], ["LAST_KNOWN_GOOD", "INTACT", ["ITM-1"], "VEH-1"]);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), role: "LAST_KNOWN_GOOD", event: "a" }, { ...emptyCargoCustody(2), role: "LAST_KNOWN_GOOD", event: "b" }] } })).join(" "), /Only one Last Known Good/);
});

test("15. First Security Anomaly keeps a controlled anomaly type that is an observation, not a theft method", () => {
  const event = newCargo({ facts: [[DP.primaryFamily, "THEFT"]], draft: { theft: { ...emptyCargoTheft(), status: "SUSPECTED", method: "UNKNOWN", timeCertainty: "UNKNOWN" }, custody: [{ ...emptyCargoCustody(2), role: "FIRST_SECURITY_ANOMALY", event: "GPS dropped", anomalyType: "GPS_SIGNAL_LOST" }] } });
  assert.deepEqual(messages(event), []);
  assert.equal(readCargoCustody(event)[0].anomalyType, "GPS_SIGNAL_LOST");
  assert.equal(readCargoTheft(event)?.method, "UNKNOWN", "the anomaly does not set the theft method");
  assert.equal(describeCargoIncident(event).custody[0].anomaly, "GPS Signal Lost");
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), role: "FIRST_SECURITY_ANOMALY", event: "x", anomalyType: "" }] } })).join(" "), /needs an anomaly type/);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), role: "NORMAL_CUSTODY", event: "x", anomalyType: "DOOR_OPENED" }] } })).join(" "), /belongs only on the First Security Anomaly/);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), role: "FIRST_SECURITY_ANOMALY", event: "x", anomalyType: "ABDUCTION" }] } })).join(" "), /Anomaly type must be a controlled value/);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), role: "FIRST_SECURITY_ANOMALY", event: "a", anomalyType: "OTHER" }, { ...emptyCargoCustody(2), role: "FIRST_SECURITY_ANOMALY", event: "b", anomalyType: "OTHER" }] } })).join(" "), /Only one First Security Anomaly/);
});

// 16-18 -----------------------------------------------------------------------
test("16. custody records are ordered by an explicit ordinal; ordinals are positive and unique; items, vehicles and evidence must resolve", () => {
  const event = newCargo({ draft: { trailerIds: ["TRL-1"], custody: [
    { ...emptyCargoCustody(3), itemId: "C3", role: "DELIVERY", event: "Delivered" },
    { ...emptyCargoCustody(1), itemId: "C1", role: "NORMAL_CUSTODY", event: "Loaded", linkedVehicleId: "TRL-1", itemIds: ["ITM-1"] },
    { ...emptyCargoCustody(2), itemId: "C2", role: "TRANSFER", event: "Handed to receiver agent", custodian: "Receiver agent (free text)" },
  ] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readCargoCustody(event).map((entry: any) => entry.ordinal), [1, 2, 3], "stored out of order, read in ordinal order");
  assert.equal(readCargoCustody(event)[1].custodian, "Receiver agent (free text)", "external custodians stay free text");
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), event: "a" }, { ...emptyCargoCustody(1), event: "b" }] } })).join(" "), /ordinals must be unique/);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(0), event: "a" }] } })).join(" "), /positive whole numbers/);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), event: "a", itemIds: ["ITM-GHOST"] }] } })).join(" "), /Cargo Item that does not exist/);
  assert.match(messages(newCargo({ draft: { custody: [{ ...emptyCargoCustody(1), event: "a", linkedVehicleId: "VEH-OTHER" }] } })).join(" "), /not linked to this Cargo Incident/);
  const state1 = describeCargoIncident(event).custody;
  assert.deepEqual(state1.map((entry: any) => entry.ordinal), [1, 2, 3]);
});

test("17. security controls record expected vs actual with source and evidence", () => {
  const event = newCargo({ draft: { controls: [
    { ...emptyCargoControl(), itemId: "S1", controlType: "SEAL", expectedState: "IN_PLACE_FUNCTIONING", actualState: "IN_PLACE_FUNCTIONING", source: "DRIVER_REPORT", evidenceIds: ["EV-1"] },
    { ...emptyCargoControl(), itemId: "S2", controlType: "GPS", expectedState: "IN_PLACE_FUNCTIONING", actualState: "IN_PLACE_NOT_FUNCTIONING", source: "TELEMATICS" },
  ] } });
  assert.deepEqual(messages(event), []);
  assert.deepEqual(readCargoControls(event).map((c: any) => [c.controlType, c.expectedState, c.actualState]), [["SEAL", "IN_PLACE_FUNCTIONING", "IN_PLACE_FUNCTIONING"], ["GPS", "IN_PLACE_FUNCTIONING", "IN_PLACE_NOT_FUNCTIONING"]]);
  assert.match(messages(newCargo({ draft: { controls: [{ ...emptyCargoControl(), controlType: "FORCE_FIELD" }] } })).join(" "), /control type must be a controlled value/);
  assert.match(messages(newCargo({ draft: { controls: [{ ...emptyCargoControl(), controlType: "SEAL", actualState: "BROKEN" }] } })).join(" "), /Actual control state must be a controlled value/);
});

test("18. a control gap is DERIVED from expected vs actual and can never be stored as an operator determination", () => {
  assert.equal(deriveCargoControlGap({ expectedState: "IN_PLACE_FUNCTIONING", actualState: "NOT_IN_PLACE" }), "GAP");
  assert.equal(deriveCargoControlGap({ expectedState: "IN_PLACE_FUNCTIONING", actualState: "IN_PLACE_NOT_FUNCTIONING" }), "GAP");
  assert.equal(deriveCargoControlGap({ expectedState: "IN_PLACE_FUNCTIONING", actualState: "IN_PLACE_FUNCTIONING" }), "NO_GAP");
  assert.equal(deriveCargoControlGap({ expectedState: "NOT_REQUIRED", actualState: "NOT_IN_PLACE" }), "NO_GAP");
  assert.equal(deriveCargoControlGap({ expectedState: "IN_PLACE_FUNCTIONING", actualState: "UNKNOWN" }), "UNDETERMINED");
  assert.equal(deriveCargoControlGap({ expectedState: "IN_PLACE_FUNCTIONING", actualState: "" }), "UNDETERMINED");
  const event = newCargo({ draft: { controls: [{ ...emptyCargoControl(), controlType: "CAMERA", expectedState: "IN_PLACE_FUNCTIONING", actualState: "NOT_IN_PLACE" }] } });
  assert.equal(describeCargoIncident(event).controls[0].gap, "GAP");
  assert.ok(!Object.keys(event.childCollections.find((c: any) => c.collectionId.endsWith("SECURITY_CONTROLS")).items[0].facts).some((key) => /gap/i.test(key)), "nothing named gap is stored");
  const tampered = newCargo({ draft: { controls: [{ ...emptyCargoControl(), controlType: "CAMERA" }] } });
  tampered.childCollections.find((c: any) => c.collectionId.endsWith("SECURITY_CONTROLS")).items[0].facts.controlGap = "YES";
  assert.match(messages(tampered).join(" "), /control gap is derived/);
  assert.equal(deriveCargoCustodyDiscrepancy({ expectedState: "Seal 4471 intact", observedState: "Seal 9902" }), true);
  assert.equal(deriveCargoCustodyDiscrepancy({ expectedState: "Seal intact", observedState: " seal INTACT " }), false);
  assert.equal(deriveCargoCustodyDiscrepancy({ expectedState: "Seal intact", observedState: "" }), false);
});

// 19-21 -----------------------------------------------------------------------
test("19. child evidence references must belong to the event's single canonical evidence set", () => {
  const ok = newCargo({ draft: { items: [item({ evidenceIds: ["EV-1"] })], damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE", evidenceIds: ["EV-2"] }, theft: { ...emptyCargoTheft(), timeCertainty: "UNKNOWN", evidenceIds: ["EV-1"] }, temperatures: [{ ...emptyCargoTemperature(), setpoint: "4", unit: "C", source: "UNKNOWN", evidenceIds: ["EV-2"] }], custody: [{ ...emptyCargoCustody(1), event: "x", evidenceIds: ["EV-1"] }], controls: [{ ...emptyCargoControl(), controlType: "SEAL", evidenceIds: ["EV-2"] }] } });
  assert.deepEqual(messages(ok), []);
  assert.deepEqual(ok.evidenceIds, ["EV-1", "EV-2"], "evidence is stored once, on the event");
  for (const [name, patch] of [["item", { items: [item({ evidenceIds: ["EV-X"] })] }], ["damage", { damage: { ...emptyCargoDamage(), evidenceIds: ["EV-X"] } }], ["theft", { theft: { ...emptyCargoTheft(), timeCertainty: "UNKNOWN", evidenceIds: ["EV-X"] } }], ["temperature", { temperatures: [{ ...emptyCargoTemperature(), evidenceIds: ["EV-X"] }] }], ["custody", { custody: [{ ...emptyCargoCustody(1), event: "x", evidenceIds: ["EV-X"] }] }], ["control", { controls: [{ ...emptyCargoControl(), controlType: "SEAL", evidenceIds: ["EV-X"] }] }]] as Array<[string, Record<string, unknown>]>) {
    assert.match(messages(newCargo({ draft: patch })).join(" "), /not linked to this Cargo Incident/, name);
  }
});

test("20. Reported / Suspected Cause is occurrence data and never a root cause or a determination", () => {
  const event = newCargo({ draft: { damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE", reportedCause: "LOAD_SHIFT" } } });
  assert.equal(describeCargoIncident(event).damage?.reportedCause, "Load Shift");
  assert.match(messages(newCargo({ draft: { damage: { ...emptyCargoDamage(), reportedCause: "OTHER" } } })).join(" "), /Describe the Other Reported \/ Suspected Cause/);
  assert.equal(describeCargoIncident(newCargo({ draft: { damage: { ...emptyCargoDamage(), reportedCause: "OTHER", reportedCauseOther: "Forklift tine" } } })).damage?.reportedCause, "Other: Forklift tine");
  assert.match(messages(newCargo({ draft: { damage: { ...emptyCargoDamage(), reportedCause: "DRIVER_ERROR" } } })).join(" "), /Reported \/ Suspected Cause must be a controlled value/);
  const s = state([event]);
  assert.deepEqual(getInvestigationsForEvent(s, "CGO-1"), [], "recording a reported cause creates no investigation");
  assert.deepEqual(s.companyDeterminations, [], "and no root-cause determination");
  assert.deepEqual(deriveEventWorkflow(event, s).reasons, []);
});

test("21. the common investigation engine works for a Cargo Incident, including the additive contributing-factor domains", () => {
  const event = newCargo();
  const opened = openPerformanceInvestigation(state([event]), { eventId: "CGO-1", openedBy: "SM" });
  const rootCause = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "ROOT_CAUSE", category: "Securement", finding: "Straps under-tensioned at loading", status: "DETERMINED", role: "PRIMARY" }, determinedBy: "SM", determinationDate: "2026-09-30" });
  const preventable = recordPerformanceDetermination(rootCause.state, { investigationId: opened.investigation.id, assessment: { subject: "PREVENTABILITY", value: "PREVENTABLE" }, determinedBy: "SM", determinationDate: "2026-09-30" });
  assert.equal(resolvePreventability(preventable.state, event)?.value, "PREVENTABLE");
  const domains: readonly string[] = CONTRIBUTING_FACTOR_DOMAINS;
  for (const domain of ["LOADING_UNLOADING", "CARGO_SECUREMENT", "SECURITY", "FRAUD_CRIME", "PROCESS_POLICY"]) assert.ok(domains.includes(domain), domain);
  for (const domain of ["DRIVER_STATE", "DRIVER_BEHAVIOR", "OTHER_ROAD_USER", "ROAD_WEATHER", "VEHICLE_EQUIPMENT", "OPERATIONS", "SITE_CUSTOMER"]) assert.ok(domains.includes(domain), `existing domain kept: ${domain}`);
  const factors = setInvestigationContributingFactors(preventable.state, opened.investigation.id, [{ domain: "CARGO_SECUREMENT", factor: "Strap tension", role: "PRIMARY" }, { domain: "LOADING_UNLOADING", factor: "Shipper loaded without a spotter", role: "SECONDARY" }, { domain: "SECURITY", factor: "Unattended overnight parking", role: "SECONDARY" }], { by: "SM" });
  const inv = getInvestigationsForEvent(factors.state, "CGO-1")[0];
  assert.deepEqual(inv.contributingFactors!.items.map((entry: any) => [entry.facts.domain, entry.facts.role]), [["CARGO_SECUREMENT", "PRIMARY"], ["LOADING_UNLOADING", "SECONDARY"], ["SECURITY", "SECONDARY"]]);
  assert.throws(() => setInvestigationContributingFactors(factors.state, opened.investigation.id, [{ domain: "DRIVER_ERROR" as never, factor: "x", role: "PRIMARY" }], { by: "SM" }), /Unknown contributing-factor domain/);
});

// 22-26 -----------------------------------------------------------------------
test("22. workflow: a bare Cargo Incident creates NO obligation; outcomes, severity and facts alone are not obligations", () => {
  const event = newCargo();
  const workflow = deriveEventWorkflow(event, state([event]));
  assert.equal(workflow.state, "NOT_REQUIRED");
  assert.deepEqual(workflow.reasons, []);
  assert.deepEqual(provs().flatMap((provider: any) => provider.collect(event, state([event]))), []);
  const loaded = newCargo({ facts: [[DP.primaryFamily, "THEFT"]], draft: { damage: { ...emptyCargoDamage(), damageType: "PHYSICAL_DAMAGE" }, theft: { ...emptyCargoTheft(), status: "CONFIRMED", timeCertainty: "UNKNOWN" }, custody: [{ ...emptyCargoCustody(1), role: "FIRST_SECURITY_ANOMALY", event: "x", anomalyType: "GPS_SIGNAL_LOST" }], controls: [{ ...emptyCargoControl(), controlType: "SEAL", expectedState: "IN_PLACE_FUNCTIONING", actualState: "NOT_IN_PLACE" }] } });
  assert.equal(deriveEventWorkflow(loaded, state([loaded])).state, "NOT_REQUIRED", "a theft, an anomaly and a control gap are facts, not obligations");
  assert.equal(provs().length, getWorkflowProvidersForEventType("Roadside Inspection").length + 1, "Cargo Incident is registered with the common engine");
});

test("23. an explicit obligation drives the workflow: reviewer-required investigation, required Company Action, pending verification", () => {
  const event = newCargo();
  const required = setPerformanceInvestigationRequirement(state([event]), "CGO-1", { required: true, reason: "High-value load", setBy: "SM" });
  const investigation = deriveEventWorkflow(required.event as any, required.state);
  assert.equal(investigation.state, "OPEN");
  assert.deepEqual(labels(investigation), ["Investigation incomplete"]);
  const withAction = deriveEventWorkflow(event, state([event], { companyActions: [action()] }));
  assert.equal(withAction.state, "OPEN");
  assert.deepEqual(labels(withAction), ["Corrective action outstanding"]);
  assert.ok(withAction.openReasons.every((reason: any) => reason.source.type && reason.source.id));
  const verifying = deriveEventWorkflow(event, state([event], { companyActions: [action({ status: "Completed", verification: { required: true, status: "PENDING" } })] }));
  assert.equal(verifying.state, "IN_REVIEW");
  assert.ok(verifying.openReasons.some((reason: any) => /verification pending/.test(String(reason.detail))));
});

test("24. once every applicable obligation is resolved the Cargo Incident is Ready to Close, not Closed", () => {
  const event = newCargo();
  const done = state([event], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" })] });
  const ready = deriveEventWorkflow(event, done);
  assert.equal(ready.state, "READY_TO_CLOSE");
  assert.notEqual(ready.state, "CLOSED");
  assert.equal((done.events[0].workflowClosures || []).length, 0);
  assert.equal(resolvePreventability(done, event), null, "no preventability decision was required");
  const required = setPerformanceInvestigationRequirement(state([event]), "CGO-1", { required: true, setBy: "SM" });
  const opened = openPerformanceInvestigation(required.state, { eventId: "CGO-1", openedBy: "SM" });
  const classified = recordPerformanceDetermination(opened.state, { investigationId: opened.investigation.id, assessment: { subject: "CLASSIFICATION", outcome: "CONFIRMED_AS_REPORTED" }, determinedBy: "SM", determinationDate: "2026-09-30" });
  const concluded = updatePerformanceInvestigation(classified.state, opened.investigation.id, { by: "SM", conclusion: { summary: "Reviewed." } });
  const completed = completePerformanceInvestigation(concluded.state, opened.investigation.id, { by: "SM" });
  assert.equal(deriveEventWorkflow(required.event as any, completed.state).state, "READY_TO_CLOSE");
});

test("25. closure is deliberate: it needs a named closer and is refused while obligations remain; nothing closes automatically", () => {
  const event = newCargo();
  const open = state([event], { companyActions: [action()] });
  assert.throws(() => closePerformanceEventWorkflow(open, "CGO-1", { closedBy: "SM", providers: provs() }), /cannot be closed/);
  const done = state([event], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" })] });
  assert.throws(() => closePerformanceEventWorkflow(done, "CGO-1", { closedBy: " ", providers: provs() }), /closedBy/);
  const closed = closePerformanceEventWorkflow(done, "CGO-1", { closedBy: "SM", note: "Reviewed", providers: provs() });
  assert.equal(deriveEventWorkflow(closed.state.events[0], closed.state).state, "CLOSED");
  assert.equal(closed.closure.closedBy, "SM");
  assert.throws(() => closePerformanceEventWorkflow(state([event]), "CGO-1", { closedBy: "SM", providers: provs() }), /cannot be closed/, "a Cargo Incident with no obligation is not closed by default");
});

test("26. a later obligation reopens a closed Cargo Incident; the closure record is kept", () => {
  const event = newCargo();
  const done = state([event], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" })] });
  const closed = closePerformanceEventWorkflow(done, "CGO-1", { closedBy: "SM", providers: provs() });
  const later = state([closed.state.events[0]], { companyActions: [action({ status: "Completed", actualCompletionDate: "2026-10-01" }), action({ id: "ACT-2", createdAt: "2027-01-01T00:00:00.000Z" })] });
  const reopened = deriveEventWorkflow(closed.state.events[0], later);
  assert.equal(reopened.state, "OPEN");
  assert.equal(reopened.closureSuperseded, true);
  assert.equal(reopened.closure?.closedBy, "SM");
});

// 27 --------------------------------------------------------------------------
test("27. equipment theft is a Security Incident, not cargo loss; the two can be related without duplicating or merging them", () => {
  const cargoEvent = newCargo({ facts: [[DP.primaryFamily, "THEFT"]] });
  const security = { id: "SEC-1", companyId: COMPANY, eventType: "Security Incident", driverMasterId: "DRV-1" };
  const related = createPerformanceEventRelationship(state([cargoEvent, security]), { fromEventId: "CGO-1", toEventId: "SEC-1", type: "SAME_OCCURRENCE_AS", createdBy: "SM", note: "Tractor and cargo taken together" });
  assert.equal(related.state.events.length, 2, "no event was created or duplicated");
  assert.deepEqual(getEventRelationships(related.state, "CGO-1").map((view: any) => [view.effectiveType, view.otherEventId]), [["SAME_OCCURRENCE_AS", "SEC-1"]]);
  assert.deepEqual(getEventRelationships(related.state, "SEC-1").map((view: any) => [view.effectiveType, view.otherEventId]), [["SAME_OCCURRENCE_AS", "CGO-1"]], "the inverse view is derived, not stored twice");
  assert.equal(related.state.eventRelationships.length, 1);
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Security Incident"], "RECORDABLE_EVENT", "Security Incident remains the home for equipment theft");
  const description = JSON.stringify(describeCargoIncident(cargoEvent));
  assert.ok(!/tractor theft|trailer theft/i.test(description));
  assert.equal(cargoEvent.eventType, "Cargo Incident");
});

// 28-30 -----------------------------------------------------------------------
const legacyDamage = (): any => ({
  id: "OLD-DMG", eventType: "Cargo Damage", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2024-02-01T00:00:00.000Z", eventDate: "2024-02-01", summary: "Old damage", description: "Old record", severity: "Not Applicable", status: "Not Applicable", evidenceIds: ["EV-OLD"], chronology: [], isArchived: false,
  structuredEventFacts: [
    { dataPointId: "DRV.PERF.CARGO_DAMAGE.CARGOISSUETYPE", value: "SECUREMENT_CONCERN", valueType: "string" }, { dataPointId: "DRV.PERF.CARGO_DAMAGE.CARGODESCRIPTION", value: "Pallets of canned goods", valueType: "string" },
    { dataPointId: "DRV.PERF.CARGO_DAMAGE.QUANTITYAFFECTED", value: 6, valueType: "measurement", unit: "count" }, { dataPointId: "DRV.PERF.CARGO_DAMAGE.ESTIMATEDLOSSAMOUNT", value: 4200, valueType: "measurement", unit: "currency" },
    { dataPointId: "DRV.PERF.CARGO_DAMAGE.PACKAGINGFAILURE", value: true, valueType: "boolean" }, { dataPointId: "DRV.PERF.CARGO_DAMAGE.SECUREMENTCONCERN", value: true, valueType: "boolean" }, { dataPointId: "DRV.PERF.CARGO_DAMAGE.DAMAGENOTES", value: "Strap snapped", valueType: "string" },
  ],
  provenance: { sourceType: "SOURCE_FACT", source: "Driver Report" },
});
const legacyTheft = (): any => ({
  id: "OLD-THF", eventType: "Cargo Theft", companyId: COMPANY, driverMasterId: "DRV-1", createdAt: "2024-03-01T00:00:00.000Z", eventDate: "2024-03-01", summary: "Old theft", description: "Old record", severity: "Not Applicable", status: "Not Applicable", evidenceIds: [], chronology: [], isArchived: false,
  structuredEventFacts: [
    { dataPointId: "DRV.PERF.CARGO_THEFT.ESTIMATEDLOSSAMOUNT", value: 18000, valueType: "measurement", unit: "currency" }, { dataPointId: "DRV.PERF.CARGO_THEFT.LASTKNOWNLOCATION", value: "Flying J, Red Deer", valueType: "string" },
    { dataPointId: "DRV.PERF.CARGO_THEFT.LASTKNOWNDATE", value: "2024-02-29", valueType: "date" }, { dataPointId: "DRV.PERF.CARGO_THEFT.SEALCOMPROMISED", value: true, valueType: "boolean" }, { dataPointId: "DRV.PERF.CARGO_THEFT.THEFTNARRATIVE", value: "Seal cut overnight", valueType: "string" },
  ],
  provenance: { sourceType: "SOURCE_FACT", source: "Customer" },
});

test("28. legacy Cargo Damage reads back exactly as recorded and is not reinterpreted into the new model", () => {
  const old = legacyDamage();
  const view = describeLegacyCargo(old);
  assert.deepEqual([view.kind, view.cargoIssue, view.description, view.quantityAffected, view.estimatedLoss, view.packagingFailure, view.securementConcern, view.damageNarrative, view.source], ["DAMAGE", "Securement Concern", "Pallets of canned goods", 6, "4200", "Yes", "Yes", "Strap snapped", "Driver Report"]);
  assert.equal(describeCargoIncident(old).classification.family, undefined, "the old Cargo Issue is NOT mapped into the Primary Incident Family");
  assert.deepEqual(readCargoItems(old), [], "no fake CargoItem was created from the old description");
  assert.equal(readCargoDamage(old), undefined, "no fake Damage outcome was created");
  assert.deepEqual(old.evidenceIds, ["EV-OLD"]);
  assert.equal(schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Cargo Damage"].label, "Cargo Damage");
  const performanceFamilies = (): Promise<any> => import("../../../lib/driver-performance-families.ts" as string);
  return performanceFamilies().then((families) => assert.equal(families.performanceEventTitle("Cargo Damage"), "Cargo Incident: Damage"));
});

test("29. legacy Cargo Theft reads back exactly as recorded", () => {
  const view = describeLegacyCargo(legacyTheft());
  assert.deepEqual([view.kind, view.estimatedLoss, view.lastKnownLocation, view.lastKnownDate, view.sealCompromised, view.theftNarrative, view.source], ["THEFT", "18000", "Flying J, Red Deer", "2024-02-29", "Yes", "Seal cut overnight", "Customer"]);
  assert.equal(readCargoTheft(legacyTheft()), undefined, "no fake Theft outcome was created");
  assert.equal(readCargoCustody(legacyTheft()).length, 0, "the old last-known location did not become a custody record");
  assert.equal(describeLegacyCargo({ id: "x", eventType: "Cargo Damage", structuredFacts: {} } as any).cargoIssue, undefined, "a sparse legacy record is still readable");
});

test("30. no destructive migration: stored legacy Cargo records load and reload byte-for-byte; they can no longer be created; new records use the new type", () => {
  localStorage.clear(); seedVehicles();
  const records = [legacyDamage(), legacyTheft()];
  localStorage.setItem(`tes_company_drivers_${COMPANY}`, JSON.stringify({ version: 2, companyId: COMPANY, relationships: [], events: records }));
  const store = dd.loadCompanyDriverStore(COMPANY);
  dd.saveCompanyDriverStore(store);
  const reloaded = dd.loadCompanyDriverStore(COMPANY);
  for (const original of records) {
    const after = reloaded.events.find((entry: any) => entry.id === original.id);
    assert.equal(after.eventType, original.eventType, "stored eventType is untouched");
    assert.deepEqual(after.structuredEventFacts, original.structuredEventFacts, "facts are untouched");
    assert.equal(after.childCollections, undefined, "no child collections were fabricated");
  }
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Cargo Damage"], "LEGACY_READ_ONLY");
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Cargo Theft"], "LEGACY_READ_ONLY");
  assert.equal(schema.PERFORMANCE_CATEGORY_OWNERSHIP["Cargo Incident"], "RECORDABLE_EVENT");
  assert.ok(!schema.RECORDABLE_PERFORMANCE_CATEGORIES.includes("Cargo Damage") && !schema.RECORDABLE_PERFORMANCE_CATEGORIES.includes("Cargo Theft") && schema.RECORDABLE_PERFORMANCE_CATEGORIES.includes("Cargo Incident"));
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", { eventType: "Cargo Damage", eventDate: "2026-09-28", structuredEventFacts: [], evidenceIds: [], severity: "Not Applicable", status: "Not Applicable", summary: "s", description: "d", chronology: [] }), /cannot be created as a new Performance Event/);
  const created = dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo()));
  assert.equal(created.eventType, "Cargo Incident");
  assert.equal(dd.loadCompanyDriverStore(COMPANY).events.length, 3, "legacy records are still there beside the new one");
});

// extras ----------------------------------------------------------------------
test("registry: ids used by the logic exist in the schema; steps cover the agreed sections with a single item workflow", () => {
  const def = schema.DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Cargo Incident"];
  for (const [key, id] of Object.entries(DP)) assert.ok(def.fields.some((field: any) => field.dataPointId === id), `schema is missing ${key} (${id})`);
  assert.equal(def.fields.find((field: any) => field.key === "primaryFamily")?.required, true);
  const steps = schema.resolvePerformanceSteps(def, {}).map((step: any) => step.key);
  assert.deepEqual(steps, ["CATEGORY", "OCCURRENCE", "CARGO_SHIPMENT", "CARGO_CARRIER", "CARGO_ITEMS", "CARGO_CLASSIFICATION", "CARGO_RESPONSE", "CARGO_OUTCOMES", "CARGO_CUSTODY", "EVIDENCE", "REVIEW"]);
  assert.equal(steps.filter((key: string) => /ITEMS/.test(key)).length, 1, "one coherent item workflow");
});

test("the data layer rejects invalid new Cargo Incidents (rules are not UI-only), including a missing Power Unit record", () => {
  localStorage.clear(); seedVehicles();
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo({ draft: { items: [item({ commodity: "" })] } }))), /commodity/);
  assert.doesNotThrow(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo({ draft: { items: [] } }))), "an incident without items is accepted by the data layer");
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo({ draft: { powerUnitId: "VEH-GHOST" } }))), /does not exist in the company Vehicle store/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo({ draft: { trailerIds: ["TRL-GHOST"] } }))), /does not exist in the company Vehicle store/);
  assert.throws(() => dd.addPerformanceEvent(COMPANY, "DRV-1", payloadFrom(newCargo({ extra: { provenance: { sourceType: "SOURCE_FACT", source: "Anonymous" } } }))), /Source/);
});

test("chronology: discovery and report cannot precede the occurrence; delays are derived, never stored", () => {
  assert.match(messages(newCargo({ facts: [[DP.discoveryDate, "2026-09-27"]] })).join(" "), /Discovery cannot be before the occurrence/);
  assert.match(messages(newCargo({ facts: [[DP.discoveryDate, "2026-09-29"]], extra: { reportedDate: "2026-09-28" } })).join(" "), /report cannot be dated before discovery/);
  assert.match(messages(newCargo({ facts: [[DP.discoveryTime, "10:00"]] })).join(" "), /discovery time needs a discovery date/);
  const ok = newCargo({ facts: [[DP.discoveryDate, "2026-09-28"], [DP.discoveryTime, "16:05"], [DP.reportedTime, "17:35"]], extra: { reportedDate: "2026-09-28" } });
  assert.deepEqual(messages(ok), []);
  assert.deepEqual(deriveCargoTimingDelays(ok), { occurrenceToDiscoveryMinutes: 120, discoveryToReportMinutes: 90, occurrenceToReportMinutes: 210 });
  assert.ok(!ok.structuredEventFacts.some((entry: any) => /delay/i.test(entry.dataPointId)), "no delay is stored");
  const approximate = newCargo({ draft: { precision: "APPROXIMATE" }, facts: [[DP.discoveryDate, "2026-09-28"], [DP.discoveryTime, "16:05"]] });
  assert.equal(deriveCargoTimingDelays(approximate).occurrenceToDiscoveryMinutes, undefined, "no precision is fabricated for an approximate occurrence");
});
