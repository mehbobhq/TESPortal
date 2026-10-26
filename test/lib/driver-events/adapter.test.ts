import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRIVER_PERFORMANCE_CATEGORY_BY_VALUE } from "@/lib/driver-performance-schema";
import { wizardPayloadToEventInput, type WizardPayload } from "@/lib/driver-events/legacy-adapter";
import { prepareEvent } from "@/lib/driver-events/validation";
import { minimalFacts } from "../../helpers/driver-event-fill";

const NOW = new Date("2026-03-10T15:00:00Z");
const VEHICLE = "11111111-1111-4111-8111-111111111111";
const TRAILER = "22222222-2222-4222-8222-222222222222";
const DRIVER = "33333333-3333-4333-8333-333333333333";

function payloadFor(category: "Collision" | "Roadside Inspection" | "Speeding"): WizardPayload {
  const definition = DRIVER_PERFORMANCE_CATEGORY_BY_VALUE[category];
  const facts = minimalFacts(definition.code);
  return {
    eventType: category, eventDate: "2026-03-09", eventTime: "08:30", severity: "High", status: "Open", summary: `${category} on Highway 401`, description: "Narrative", country: "CA", stateProvince: "ON", city: "Milton", location: "Hwy 401 km 320",
    reportedDate: "2026-03-09", vehicleId: VEHICLE, canonicalLinks: [{ entityType: "Trailer", recordId: TRAILER, source: "CANONICAL_STORE" }], followUpActionRequired: true, followUpDueDate: "2026-03-20", followUpActionSummary: "Check the brake adjustment",
    structuredEventFacts: Object.entries(facts).map(([key, value]) => {
      const field = definition.fields.find((f) => f.key === key)!;
      return { dataPointId: field.dataPointId, value, valueType: field.valueType, unit: field.unitOptions?.[0] };
    }),
    childCollections: category !== "Collision" ? [] : [{ collectionId: "DRV.PERF.COLLISION.INVOLVED_PARTIES", collectionVersion: "1.0", itemType: "COLLISION_INVOLVED_PARTY", completeness: "COMPLETE", items: [{ itemId: "PARTY-1", facts: { role: "CARRIER_POWER_UNIT", linkedVehicleId: VEHICLE, damageStatus: "NONE", drivability: "DRIVABLE", towStatus: "NOT_TOWED", impactPoint: "FRONT" } }] }],
  } as unknown as WizardPayload;
}

describe("detailed wizard payload -> canonical event input", () => {
  it("re-keys facts by registry field, keeps units, links canonical vehicles and trailers, and the server accepts the result", () => {
    const { input, followUp } = wizardPayloadToEventInput(payloadFor("Collision"), { driverRelationshipId: DRIVER, timeZone: "America/Toronto" });
    assert.equal(input.category, "Collision");
    assert.equal(input.vehicleRelationshipId, VEHICLE);
    assert.equal(input.trailerRelationshipId, TRAILER);
    assert.equal(input.driverRelationshipId, DRIVER);
    assert.equal(input.location?.jurisdictionCode, "CA-ON");
    assert.equal(input.reportedDate, "2026-03-09");
    assert.ok("collisionClassType" in (input.facts ?? {}), "keyed by field, not by data point id");
    assert.ok(input.childCollections && "DRV.PERF.COLLISION.INVOLVED_PARTIES" in input.childCollections, "child collections are keyed by collection id");
    assert.deepEqual(followUp, { title: "Check the brake adjustment", dueDate: "2026-03-20" });
    const prepared = prepareEvent(input, NOW);
    assert.equal(prepared.occurredAt, "2026-03-09T12:30:00.000Z");
    assert.equal(prepared.reportedLocalDate, "2026-03-09");
  });

  it("keeps the measurement unit the wizard collected", () => {
    const { input } = wizardPayloadToEventInput(payloadFor("Speeding"), { driverRelationshipId: DRIVER, timeZone: "America/Toronto" });
    assert.ok(input.factUnits && Object.keys(input.factUnits).length > 0);
    assert.doesNotThrow(() => prepareEvent(input, NOW));
  });

  it("a fact the registry does not define reaches the server unchanged, so it is refused by name rather than lost", () => {
    const payload = payloadFor("Collision");
    (payload.structuredEventFacts as unknown[]).push({ dataPointId: "DRV.PERF.COLLISION.NOT_A_FIELD", value: "x", valueType: "string" });
    const { input } = wizardPayloadToEventInput(payload, { driverRelationshipId: DRIVER, timeZone: "America/Toronto" });
    assert.throws(() => prepareEvent(input, NOW), /not a field/);
  });

  it("a local, non-canonical vehicle id is not accepted as a canonical link", () => {
    const payload = { ...payloadFor("Collision"), vehicleId: "VEH-local-1", canonicalLinks: [] } as WizardPayload;
    const { input } = wizardPayloadToEventInput(payload, { driverRelationshipId: DRIVER, timeZone: "America/Toronto" });
    assert.equal(input.vehicleRelationshipId, null);
  });
});
