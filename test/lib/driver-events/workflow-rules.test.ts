import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DriverEventValidationError } from "@/lib/driver-events/errors";
import { prepareEvent, type EventInput } from "@/lib/driver-events/validation";
import { countryCode } from "@/lib/driver-events/legacy-adapter";
import { buildNearMissMultiValueCollection } from "@/lib/performance-near-miss";
import { DETAILED_CODES, wizardRecord } from "../../helpers/driver-event-fill";

const NOW = new Date("2026-03-10T15:00:00Z");
const DRIVER = "33333333-3333-4333-8333-333333333333";
const base = (code: string): EventInput => ({ ...wizardRecord(code), driverRelationshipId: DRIVER });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Collection = { items: { itemId: string; facts: Record<string, unknown> }[] }
const coll = (e: EventInput, id: string) => (e.childCollections as Record<string, Collection>)[id];

function issuesOf(input: EventInput): string[] {
  try { prepareEvent(input, NOW); return []; }
  catch (e) { assert.ok(e instanceof DriverEventValidationError, `expected a validation refusal, got ${(e as Error).message}`); return (e.issues ?? []).map((i: { message: string }) => i.message); }
}
function refused(input: EventInput, pattern: RegExp, why: string) {
  const messages = issuesOf(input);
  assert.ok(messages.some((m) => pattern.test(m)), `${why}: expected /${pattern.source}/ in ${JSON.stringify(messages)}`);
}

describe("server-side rules of the detailed workflows", () => {
  it("a record produced by each real wizard is accepted", () => {
    for (const code of DETAILED_CODES) assert.deepEqual(issuesOf(base(code)), [], code);
  });

  it("a controlled value is checked against the workflow's taxonomy, at the top level and inside child-collection items", () => {
    const collision = base("COLLISION");
    coll(collision, "DRV.PERF.COLLISION.INVOLVED_PARTIES").items[0].facts.damageStatus = "NOT_A_DAMAGE_STATUS";
    refused(collision, /Damage status must be a controlled value/, "party damage status");
    const statementStatus = base("COLLISION");
    coll(statementStatus, "DRV.PERF.COLLISION.DRIVER_STATEMENTS").items[0].facts.status = "MAYBE";
    refused(statementStatus, /Driver Statement status must be a controlled value/, "statement status");
    const manner = base("COLLISION");
    manner.facts = { ...manner.facts, collisionManner: "SIDEWAYS_IN_SPACE" };
    assert.ok(issuesOf(manner).length > 0, "a controlled fact outside its options is refused");
  });

  it("cross-field rules: parties, injuries and statements must agree with each other and with the header", () => {
    const noPower = base("COLLISION");
    coll(noPower, "DRV.PERF.COLLISION.INVOLVED_PARTIES").items[0].facts.role = "OTHER_VEHICLE";
    refused(noPower, /Exactly one Carrier Power Unit/, "no power unit party");
    const wrongUnit = base("COLLISION");
    coll(wrongUnit, "DRV.PERF.COLLISION.INVOLVED_PARTIES").items[0].facts.linkedVehicleId = "99999999-9999-4999-8999-999999999999";
    refused(wrongUnit, /must reference the selected Power Unit/, "party points at another vehicle");
    const duplicate = base("COLLISION");
    const parties = coll(duplicate, "DRV.PERF.COLLISION.INVOLVED_PARTIES");
    parties.items.push({ ...clone(parties.items[0]), facts: { ...clone(parties.items[0].facts), role: "OTHER_VEHICLE" } });
    refused(duplicate, /ids must be present and unique/, "duplicate item id");
    const obtainedWithoutContent = base("COLLISION");
    coll(obtainedWithoutContent, "DRV.PERF.COLLISION.DRIVER_STATEMENTS").items[0].facts.content = "";
    refused(obtainedWithoutContent, /content is required when the status is Obtained/, "obtained statement with no content");
    const noInjuryButPerson = base("COLLISION");
    (noInjuryButPerson.childCollections as Record<string, unknown>)["DRV.PERF.COLLISION.INJURED_PERSONS"] = { collectionId: "DRV.PERF.COLLISION.INJURED_PERSONS", collectionVersion: "1.0", itemType: "COLLISION_INJURED_PERSON", completeness: "COMPLETE", items: [{ itemId: "P1", facts: { role: "DRIVER", injurySeverity: "MINOR" }, evidenceIds: [] }] };
    refused(noInjuryButPerson, /Injured persons cannot be recorded when Injury Status is No injury reported/, "injured person against a no-injury header");
  });

  it("Near Miss, Cargo, Spill and Customer rules run on the server", () => {
    const nearMiss = base("NEAR_MISS");
    nearMiss.facts = { ...nearMiss.facts, nearMissPrimaryType: "NOT_A_TYPE" };
    assert.ok(issuesOf(nearMiss).length > 0, "primary type outside the taxonomy");
    const secondary = base("NEAR_MISS");
    (secondary.childCollections as Record<string, unknown>)["DRV.PERF.NEAR_MISS.SECONDARY_TYPES"] = buildNearMissMultiValueCollection("DRV.PERF.NEAR_MISS.SECONDARY_TYPES", [String(secondary.facts?.nearMissPrimaryType)]);
    refused(secondary, /cannot also be a Secondary Near-Miss Type/, "secondary equals primary");
    const cargo = base("CARGO_INCIDENT");
    delete (cargo.facts as Record<string, unknown>).occurrenceWindowEnd;
    refused(cargo, /needs both a start and an end/, "half an occurrence window");
    const customer = base("CUSTOMER_EVENT");
    delete (customer.facts as Record<string, unknown>).discoveryDate;
    refused(customer, /discovery time needs a discovery date/i, "discovery time without a date");
    const spill = base("SPILL_RELEASE");
    coll(spill, "DRV.PERF.SPILL_RELEASE.FINANCIAL_FACTS").items[0].facts.cleanupCost = -5;
    assert.ok(issuesOf(spill).length > 0, "a negative cost is refused");
  });

  it("a child-collection structure the workflow cannot read is refused, never a server fault", () => {
    const odd = base("COLLISION");
    (odd.childCollections as Record<string, unknown>)["DRV.PERF.COLLISION.INVOLVED_PARTIES"] = { collectionId: "DRV.PERF.COLLISION.INVOLVED_PARTIES", collectionVersion: "1.0", itemType: "COLLISION_INVOLVED_PARTY", items: [{ itemId: "x", facts: { role: "CARRIER_POWER_UNIT", linkedVehicleId: odd.vehicleRelationshipId } }] };
    assert.doesNotThrow(() => issuesOf(odd), "an item without an evidence list is read as having none");
  });

  it("a DRAFT is not held to the completion rules; the same record RECORDED is", () => {
    const incomplete = base("COLLISION");
    coll(incomplete, "DRV.PERF.COLLISION.INVOLVED_PARTIES").items[0].facts.role = "OTHER_VEHICLE";
    assert.doesNotThrow(() => prepareEvent({ ...incomplete, recordState: "DRAFT" }, NOW));
    refused({ ...incomplete, recordState: "RECORDED" }, /Exactly one Carrier Power Unit/, "recorded");
  });

  it("a correction is held to the same rules (the corrected record is validated, not only the change)", () => {
    const corrected = base("COLLISION");
    coll(corrected, "DRV.PERF.COLLISION.INVOLVED_PARTIES").items[0].facts.impactPoint = "TOP_OF_THE_WORLD";
    refused(corrected, /Impact point must be a controlled value/, "corrected record");
  });

  it("the country name a workflow holds becomes the two-letter code instead of being dropped", () => {
    assert.equal(countryCode("Canada"), "CA");
    assert.equal(countryCode("United States"), "US");
    assert.equal(countryCode("ca"), "CA");
    assert.equal(countryCode("Atlantis"), null, "an unrecognised name is not guessed");
    assert.equal(countryCode(undefined), null);
  });
});
