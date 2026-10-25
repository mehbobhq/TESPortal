import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { instantToZonedLocal, isValidTimeZone, offsetMinutesAt, zoneLabel, zonedLocalToInstant } from "@/lib/dates/zoned";

describe("zoned timestamps (instants kept apart from calendar dates)", () => {
  it("converts wall-clock time in a zone to the UTC instant and back", () => {
    const winter = zonedLocalToInstant("2026-01-15T09:30", "America/Toronto");
    assert.deepEqual(winter, { ok: true, instant: "2026-01-15T14:30:00.000Z", ambiguous: false });
    const summer = zonedLocalToInstant("2026-07-15T09:30", "America/Toronto");
    assert.deepEqual(summer, { ok: true, instant: "2026-07-15T13:30:00.000Z", ambiguous: false });
    assert.equal(instantToZonedLocal("2026-07-15T13:30:00.000Z", "America/Toronto"), "2026-07-15T09:30");
    assert.equal(instantToZonedLocal("2026-01-15T14:30:00.000Z", "America/Toronto"), "2026-01-15T09:30");
    // The same instant is a different calendar day in another zone: exactly why an event time must not be stored as a date.
    assert.equal(instantToZonedLocal("2026-07-15T02:30:00.000Z", "America/Toronto"), "2026-07-14T22:30");
    assert.equal(instantToZonedLocal("2026-07-15T02:30:00.000Z", "Asia/Kolkata"), "2026-07-15T08:00");
  });

  it("reports the hour that does not exist when clocks go forward", () => {
    assert.deepEqual(zonedLocalToInstant("2026-03-08T02:30", "America/Toronto"), { ok: false, reason: "gap" });
    assert.deepEqual(zonedLocalToInstant("2026-03-08T03:00", "America/Toronto"), { ok: true, instant: "2026-03-08T07:00:00.000Z", ambiguous: false });
    assert.deepEqual(zonedLocalToInstant("2026-03-08T01:59", "America/Toronto"), { ok: true, instant: "2026-03-08T06:59:00.000Z", ambiguous: false });
  });

  it("flags the hour that happens twice when clocks go back and uses the earlier instant", () => {
    const r = zonedLocalToInstant("2026-11-01T01:30", "America/Toronto");
    assert.deepEqual(r, { ok: true, instant: "2026-11-01T05:30:00.000Z", ambiguous: true });
    assert.deepEqual(zonedLocalToInstant("2026-11-01T02:30", "America/Toronto"), { ok: true, instant: "2026-11-01T07:30:00.000Z", ambiguous: false });
  });

  it("handles zones without daylight time, half-hour offsets and the date line", () => {
    assert.deepEqual(zonedLocalToInstant("2026-07-01T12:00", "Asia/Kolkata"), { ok: true, instant: "2026-07-01T06:30:00.000Z", ambiguous: false });
    assert.deepEqual(zonedLocalToInstant("2026-07-01T00:00", "Pacific/Kiritimati"), { ok: true, instant: "2026-06-30T10:00:00.000Z", ambiguous: false });
    assert.deepEqual(zonedLocalToInstant("2026-07-01T12:00", "America/Phoenix"), { ok: true, instant: "2026-07-01T19:00:00.000Z", ambiguous: false });
    assert.equal(offsetMinutesAt(Date.parse("2026-07-01T00:00:00Z"), "Asia/Kolkata"), 330);
  });

  it("rejects impossible input and unknown zones", () => {
    assert.deepEqual(zonedLocalToInstant("2026-02-30T10:00", "UTC"), { ok: false, reason: "invalid" });
    assert.deepEqual(zonedLocalToInstant("2026-02-10T24:00", "UTC"), { ok: false, reason: "invalid" });
    assert.deepEqual(zonedLocalToInstant("2026-02-10 10:00", "UTC"), { ok: false, reason: "invalid" });
    assert.deepEqual(zonedLocalToInstant("2026-02-10T10:00", "Mars/Olympus"), { ok: false, reason: "zone" });
    assert.equal(isValidTimeZone("America/Toronto"), true);
    assert.equal(isValidTimeZone("Nowhere/Land"), false);
    assert.match(zoneLabel("America/Toronto", Date.parse("2026-07-01T12:00:00Z")), /EDT \(UTC−04:00\)/);
  });
});
