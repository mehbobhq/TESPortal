import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

import { finalizeDateInput, addDays, addMonths, compareDateOnly, daysInMonth, describeDate, interpretTypedDate, isLeapYear, maskDateInput, normalizeDateOnly, parseDateOnly, todayInZone, validateDateOnly, weekdayOf } from "@/lib/dates/date-only";

describe("date-only (calendar dates, no time zone)", () => {
  it("knows leap years and month lengths (century rules included)", () => {
    for (const y of [2000, 2004, 2024, 2400]) assert.equal(isLeapYear(y), true, String(y));
    for (const y of [1900, 2100, 2023, 2026]) assert.equal(isLeapYear(y), false, String(y));
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2026, 2), 28);
    assert.deepEqual([1, 3, 4, 6, 9, 11, 12].map((m) => daysInMonth(2026, m)), [31, 31, 30, 30, 30, 30, 31]);
  });

  it("parses only real calendar dates", () => {
    assert.ok(parseDateOnly("2024-02-29"));
    for (const bad of ["2023-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-1-5", "26-01-05", "2026/01/05", "", "2026-01-05T00:00:00Z", null, undefined, 20260105]) assert.equal(parseDateOnly(bad as never), null, String(bad));
  });

  it("normalises API values by reading the date AS WRITTEN (a timestamp never shifts the day)", () => {
    assert.equal(normalizeDateOnly("1985-04-12"), "1985-04-12");
    assert.equal(normalizeDateOnly("1985-04-12T00:00:00.000Z"), "1985-04-12");
    assert.equal(normalizeDateOnly("1985-04-12T23:59:59-08:00"), "1985-04-12");
    assert.equal(normalizeDateOnly(" 1985-04-12 "), "1985-04-12");
    assert.equal(normalizeDateOnly("1985-02-30T00:00:00Z"), "");
    assert.equal(normalizeDateOnly("04/12/1985"), "");
    assert.equal(normalizeDateOnly(""), "");
  });

  it("does steps and weekdays without a local clock, including month ends and year boundaries", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
    assert.equal(addDays("2023-02-28", 1), "2023-03-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
    assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
    assert.equal(weekdayOf("2026-10-25"), 0);
    assert.equal(weekdayOf("2000-02-29"), 2);
    assert.equal(describeDate("2026-10-25"), "Sunday, 25 October 2026");
    assert.equal(compareDateOnly("2026-01-02", "2026-01-10"), -1);
    assert.equal(compareDateOnly("2026-01-10", "2026-01-10"), 0);
  });

  it("masks typing and explains why a date is wrong", () => {
    assert.equal(maskDateInput("19850412"), "1985-04-12");
    assert.equal(maskDateInput("1985"), "1985");
    assert.equal(maskDateInput("19850"), "1985-0");
    assert.equal(maskDateInput("1985/4/2"), "1985-04-02");
    assert.equal(maskDateInput("1985.04.12"), "1985-04-12");
    assert.equal(maskDateInput("2024-2/"), "2024-02-");
    assert.equal(maskDateInput("2024-2/2"), "2024-02-02");
    assert.equal(maskDateInput("2024-02-2"), "2024-02-2");
    assert.equal(finalizeDateInput("2024-02-2"), "2024-02-02");
    assert.equal(finalizeDateInput("2024-02-29"), "2024-02-29");
    assert.equal(maskDateInput("abc"), "");
    assert.deepEqual(interpretTypedDate(""), { kind: "empty" });
    assert.deepEqual(interpretTypedDate("1985-0"), { kind: "partial" });
    assert.deepEqual(interpretTypedDate("19850412"), { kind: "ok", value: "1985-04-12" });
    const feb = interpretTypedDate("2023-02-29");
    assert.ok(feb.kind === "invalid" && /not a leap year/.test(feb.message));
    const apr = interpretTypedDate("2026-04-31");
    assert.ok(apr.kind === "invalid" && /April 2026 has no day 31/.test(apr.message));
    const mon = interpretTypedDate("2026-13-01");
    assert.ok(mon.kind === "invalid" && /not a month/.test(mon.message));
    assert.deepEqual(interpretTypedDate("2024-02-29"), { kind: "ok", value: "2024-02-29" });
  });

  it("validates required and the min/max boundaries inclusively", () => {
    assert.equal(validateDateOnly("", { required: true }), "This date is required.");
    assert.equal(validateDateOnly("", {}), null);
    assert.equal(validateDateOnly("2026-01-01", { min: "2026-01-01", max: "2026-12-31" }), null);
    assert.equal(validateDateOnly("2026-12-31", { min: "2026-01-01", max: "2026-12-31" }), null);
    assert.match(validateDateOnly("2025-12-31", { min: "2026-01-01" })!, /on or after 2026-01-01/);
    assert.match(validateDateOnly("2027-01-01", { max: "2026-12-31" })!, /on or before 2026-12-31/);
    assert.match(validateDateOnly("1899-12-31", {})!, /on or after 1900-01-01/);
  });

  it("is independent of the process time zone (the same answers under UTC, Pacific, Auckland and Kiritimati)", () => {
    const script = `
      const m = await import(${JSON.stringify(new URL("../../../lib/dates/date-only.ts", import.meta.url).href)});
      const out = [m.normalizeDateOnly("1985-04-12T00:00:00.000Z"), m.normalizeDateOnly("2026-03-08T23:30:00-05:00"), m.addDays("2026-03-07", 1), m.addDays("2026-03-08", 1), m.addDays("2026-11-01", 1), m.addMonths("2026-01-31", 1), m.describeDate("2026-03-08"), m.weekdayOf("1985-04-12")];
      console.log(JSON.stringify(out));
    `;
    const results = ["UTC", "America/Los_Angeles", "Pacific/Auckland", "Pacific/Kiritimati", "Asia/Kolkata"].map((tz) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script], { env: { ...process.env, TZ: tz, NODE_OPTIONS: "" } }).toString().trim());
    for (const r of results) assert.equal(r, results[0]);
    assert.deepEqual(JSON.parse(results[0]), ["1985-04-12", "2026-03-08", "2026-03-08", "2026-03-09", "2026-11-02", "2026-02-28", "Sunday, 8 March 2026", 5]);
  });

  it("reads 'today' in a named zone, which can differ from UTC's date", () => {
    const instant = new Date("2026-06-15T02:30:00Z");
    assert.equal(todayInZone("UTC", instant), "2026-06-15");
    assert.equal(todayInZone("America/Toronto", instant), "2026-06-14");
    assert.equal(todayInZone("Pacific/Auckland", instant), "2026-06-15");
  });
});
