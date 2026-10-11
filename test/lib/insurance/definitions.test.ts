// Pure tests (no database): vocabularies, versioned policy-number normalization, date derivation and the legacy mapping.
// The drift test that proves these agree with the seeded PostgreSQL catalogue lives in insurance.db.test.ts.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

type Defs = typeof import("../../../lib/insurance/definitions.ts");
type Errs = typeof import("../../../lib/insurance/errors.ts");
type Legacy = typeof import("../../../lib/insurance/legacy.ts");

let D = {} as Defs;
let E = {} as Errs;
let L = {} as Legacy;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/insurance/definitions")) as Defs;
  E = (await import("@/lib/insurance/errors")) as Errs;
  L = (await import("@/lib/insurance/legacy")) as Legacy;
});

const invalid = (fn: () => unknown) => assert.throws(fn, (error) => error instanceof E.InsuranceValidationError);

describe("vocabularies", () => {
  it("has exactly the ten coverage / account / bond types, in catalogue order, each in one family", () => {
    assert.deepEqual(D.COVERAGE_TYPES, [
      "AUTO_LIABILITY", "MOTOR_TRUCK_CARGO", "GENERAL_LIABILITY", "PHYSICAL_DAMAGE", "UMBRELLA_EXCESS", "REEFER_BREAKDOWN",
      "WORKERS_COMPENSATION", "BOND_FREIGHT_BROKER", "BOND_CUSTOMS", "BOND_PERFORMANCE",
    ]);
    assert.deepEqual([...D.FAMILIES], ["INSURANCE", "WORKERS_COMPENSATION", "BOND"]);
    assert.deepEqual(D.coverageTypesOfFamily("INSURANCE").length, 6);
    assert.deepEqual(D.coverageTypesOfFamily("WORKERS_COMPENSATION"), ["WORKERS_COMPENSATION"]);
    assert.deepEqual(D.coverageTypesOfFamily("BOND"), ["BOND_FREIGHT_BROKER", "BOND_CUSTOMS", "BOND_PERFORMANCE"]);
  });

  it("a limit is required for insurance and bonds and not applicable to workers' compensation", () => {
    for (const type of D.COVERAGE_TYPES) {
      assert.equal(D.COVERAGE_TYPE_DEFINITIONS[type].limitRequired, type !== "WORKERS_COMPENSATION", type);
    }
  });

  it("cancellation reasons, endorsement kinds, limit bases, currencies and term reasons are closed lists with no catch-all", () => {
    assert.deepEqual([...D.CANCELLATION_REASONS], ["INSURED_REQUEST", "INSURER_CANCELLATION", "NON_PAYMENT", "REPLACED_BY_NEW_POLICY"]);
    assert.deepEqual([...D.ENDORSEMENT_KINDS], ["COVERAGE_ADDED", "COVERAGE_CHANGED", "COVERAGE_REMOVED"]);
    assert.deepEqual([...D.LIMIT_BASES], ["COMBINED_SINGLE_LIMIT", "PER_OCCURRENCE", "PER_VEHICLE", "AGGREGATE", "PENAL_SUM"]);
    assert.deepEqual([...D.CURRENCIES], ["CAD", "USD"]);
    assert.deepEqual([...D.TERM_REASONS], ["INITIAL", "RENEWAL", "CORRECTION"]);
    for (const list of [D.CANCELLATION_REASONS, D.ENDORSEMENT_KINDS, D.LIMIT_BASES, D.TERM_REASONS]) {
      for (const code of list) assert.doesNotMatch(code, /OTHER|UNKNOWN|UNSPECIFIED/, code);
    }
  });

  it("type guards reject lookalikes and prototype keys", () => {
    assert.equal(D.isCoverageType("AUTO_LIABILITY"), true);
    for (const bad of ["auto_liability", "Auto Liability", "toString", "__proto__", "constructor", "", 7, null, undefined]) assert.equal(D.isCoverageType(bad), false, String(bad));
    assert.equal(D.isFamily("BOND"), true);
    assert.equal(D.isFamily("bond"), false);
    assert.equal(D.isCurrency("CAD"), true);
    assert.equal(D.isCurrency("EUR"), false);
    assert.equal(D.isEndorsementKind("COVERAGE_ADDED"), true);
    assert.equal(D.isEndorsementKind("COVERAGE_RENEWED"), false);
    assert.equal(D.isCancellationReason("NON_PAYMENT"), true);
    assert.equal(D.isLimitBasis("PENAL_SUM"), true);
  });

  it("limit bases fit their family: a bond's limit is a penal sum, insurance limits never are, workers' compensation has none", () => {
    assert.deepEqual([...D.limitBasesOfFamily("BOND")], ["PENAL_SUM"]);
    assert.equal(D.limitBasesOfFamily("INSURANCE").includes("PENAL_SUM"), false);
    assert.equal(D.limitBasesOfFamily("INSURANCE").length, 4);
    assert.deepEqual([...D.limitBasesOfFamily("WORKERS_COMPENSATION")], []);
  });

  it("there is no stored status vocabulary: no EXPIRED / IN_FORCE / ACTIVE policy statuses are exported as data", () => {
    assert.deepEqual(Object.keys(D).filter((key) => /^(POLICY_)?STATUS|STATUSES$/.test(key)), []);
  });
});

describe("policy-number normalization (insurance_policy_number.permissive.v1)", () => {
  it("is versioned, permissive and registered forever", () => {
    assert.equal(D.CURRENT_NUMBER_RULE.version, "insurance_policy_number.permissive.v1");
    assert.equal(D.CURRENT_NUMBER_RULE.classification, "PERMISSIVE");
    assert.match(D.CURRENT_NUMBER_RULE.version, /permissive\.v\d+$/);
    assert.equal(D.NORMALIZATION_RULES[D.CURRENT_NUMBER_RULE.version], D.CURRENT_NUMBER_RULE);
  });

  it("NFKC, upper case, and spaces - . / _ are removed", () => {
    for (const raw of ["pol-123 456", "POL.123/456", "pol_123_456", " Pol 123-456 ", "ＰＯＬ１２３４５６", "p o l 1 2 3 4 5 6"]) {
      assert.equal(D.prepareNumber(raw).normalized, "POL123456", raw);
    }
    const prepared = D.prepareNumber("  CA-0012 / 3  ");
    assert.deepEqual(prepared, { display: "CA-0012 / 3", normalized: "CA00123", ruleVersion: "insurance_policy_number.permissive.v1" });
  });

  it("keeps leading zeros (they can be significant to an insurer)", () => {
    assert.equal(D.prepareNumber("000123").normalized, "000123");
    assert.notEqual(D.prepareNumber("000123").normalized, D.prepareNumber("123").normalized);
  });

  it("must be 1-40 letters or digits after normalization", () => {
    assert.equal(D.prepareNumber("A".repeat(40)).normalized.length, 40);
    invalid(() => D.prepareNumber("A".repeat(41)));
    for (const bad of ["", "   ", "---", "...", "A#1", "A,1", "A(1)", "PÓL1", 42, null, undefined, {}]) invalid(() => D.prepareNumber(bad));
  });

  it("limits the printed form too", () => {
    invalid(() => D.prepareNumber(`${"A ".repeat(40)}`.trim() + " B".repeat(10)));
  });

  it("names the failing field", () => {
    assert.throws(
      () => D.prepareNumber("", "endorsementNumber"),
      (error) => error instanceof E.InsuranceValidationError && error.field === "endorsementNumber",
    );
  });
});

describe("calendar dates and amounts", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    for (const ok of ["2024-02-29", "2023-12-31", "2000-01-01"]) assert.equal(D.parseCalendarDate(ok, "d"), ok);
    for (const bad of ["2023-02-29", "2023-13-01", "2023-00-10", "2023-1-1", "20230101", "2023-01-01T00:00:00Z", "", " ", 20230101, null, undefined]) {
      invalid(() => D.parseCalendarDate(bad, "d"));
    }
    assert.equal(D.isCalendarDate("2023-04-31"), false);
  });

  it("amounts are canonical two-decimal strings, never floats", () => {
    assert.equal(D.parseAmount("1000000", "a", { allowZero: false }), "1000000.00");
    assert.equal(D.parseAmount(2500.5, "a", { allowZero: false }), "2500.50");
    assert.equal(D.parseAmount("0001.1", "a", { allowZero: false }), "1.10");
    assert.equal(D.parseAmount("0", "a", { allowZero: true }), "0.00");
    for (const bad of ["0", "0.00", "-1", "1e6", "1.234", "1,000", "NaN", "", " ", 1e21, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "1234567890123"]) {
      invalid(() => D.parseAmount(bad, "a", { allowZero: false }));
    }
    invalid(() => D.parseAmount("-0", "a", { allowZero: true }));
    assert.equal(D.parseAmount("999999999999.99", "a", { allowZero: false }), "999999999999.99");
  });
});

describe("derived state (nothing is stored)", () => {
  const term = { recordStatus: "active" as const, termStart: "2024-01-01", termEnd: "2025-01-01" as string | null, cancelledOn: null as string | null };

  it("a term runs from its start up to, not including, its end", () => {
    assert.equal(D.termStateOn(term, "2023-12-31"), "NOT_STARTED");
    assert.equal(D.termStateOn(term, "2024-01-01"), "IN_FORCE");
    assert.equal(D.termStateOn(term, "2024-12-31"), "IN_FORCE");
    assert.equal(D.termStateOn(term, "2025-01-01"), "EXPIRED");
  });

  it("a cancellation takes effect on its date and beats expiry", () => {
    const cancelled = { ...term, cancelledOn: "2024-06-15" };
    assert.equal(D.termStateOn(cancelled, "2024-06-14"), "IN_FORCE");
    assert.equal(D.termStateOn(cancelled, "2024-06-15"), "CANCELLED");
    assert.equal(D.termStateOn(cancelled, "2025-06-01"), "CANCELLED");
  });

  it("a corrected term never counts, whatever its dates", () => {
    assert.equal(D.termStateOn({ ...term, recordStatus: "corrected" }, "2024-06-01"), "CORRECTED");
  });

  it("a continuous bond is in force until cancelled", () => {
    const bond = { ...term, termEnd: null };
    assert.equal(D.termStateOn(bond, "2099-01-01"), "IN_FORCE");
    assert.equal(D.termStateOn({ ...bond, cancelledOn: "2030-01-01" }, "2030-01-01"), "CANCELLED");
  });

  it("a coverage row is in force only inside its own period AND while its term is in force", () => {
    const row = { recordStatus: "active" as const, effectiveFrom: "2024-03-01", effectiveTo: "2024-09-01" as string | null };
    assert.equal(D.coverageInForce(row, "IN_FORCE", "2024-02-28"), false);
    assert.equal(D.coverageInForce(row, "IN_FORCE", "2024-03-01"), true);
    assert.equal(D.coverageInForce(row, "IN_FORCE", "2024-08-31"), true);
    assert.equal(D.coverageInForce(row, "IN_FORCE", "2024-09-01"), false);
    assert.equal(D.coverageInForce({ ...row, effectiveTo: null }, "IN_FORCE", "2024-12-31"), true);
    for (const state of ["CORRECTED", "NOT_STARTED", "EXPIRED", "CANCELLED"] as const) assert.equal(D.coverageInForce(row, state, "2024-05-01"), false, state);
    assert.equal(D.coverageInForce({ ...row, recordStatus: "corrected" }, "IN_FORCE", "2024-05-01"), false);
  });
});

describe("legacy mapping (pure; reads no browser storage and no database)", () => {
  const mapped = <T extends { status: string }>(value: T) => {
    assert.equal(value.status, "MAPPED", JSON.stringify(value));
    return value as Extract<T, { status: "MAPPED" }>;
  };
  const unmapped = (value: { status: string }) => assert.equal(value.status, "UNMAPPABLE", JSON.stringify(value));

  it("maps the legacy transportation insurance labels to coverage type codes", () => {
    const expected: Array<[string, string, string | null]> = [
      ["Auto Liability", "AUTO_LIABILITY", null],
      ["Auto Liability CSL", "AUTO_LIABILITY", "COMBINED_SINGLE_LIMIT"],
      ["Motor Truck Cargo", "MOTOR_TRUCK_CARGO", null],
      ["General Liability", "GENERAL_LIABILITY", null],
      ["Physical Damage", "PHYSICAL_DAMAGE", null],
      ["Umbrella", "UMBRELLA_EXCESS", null],
      ["Reefer Breakdown", "REEFER_BREAKDOWN", null],
      ["  motor   truck cargo ", "MOTOR_TRUCK_CARGO", null],
      ["AUTO-LIABILITY", "AUTO_LIABILITY", null],
    ];
    for (const [label, code, basis] of expected) {
      const result = mapped(L.mapLegacyCoverageType(label));
      assert.equal(result.coverageType, code, label);
      assert.equal(result.limitBasis, basis, label);
      assert.ok(D.isCoverageType(result.coverageType));
    }
  });

  it("unknown coverage labels are UNMAPPABLE, never guessed", () => {
    for (const bad of ["Cyber Liability", "Pollution", "", "Auto", "Truck", 5, null, undefined, {}]) unmapped(L.mapLegacyCoverageType(bad));
    const result = L.mapLegacyCoverageType("Cyber Liability");
    assert.equal(result.status, "UNMAPPABLE");
    assert.equal((result as { input: unknown }).input, "Cyber Liability");
  });

  it("maps the legacy bond types to bond codes with a penal-sum basis", () => {
    for (const [label, code] of [
      ["BMC-84 (Freight Broker)", "BOND_FREIGHT_BROKER"],
      ["Customs / In-Transit Bond", "BOND_CUSTOMS"],
      ["Performance Bond", "BOND_PERFORMANCE"],
    ] as const) {
      const result = mapped(L.mapLegacyBondType(label));
      assert.equal(result.coverageType, code);
      assert.equal(result.limitBasis, "PENAL_SUM");
      assert.equal(D.COVERAGE_TYPE_DEFINITIONS[result.coverageType].family, "BOND");
    }
    for (const bad of ["Bid Bond", "BMC-85", "", null]) unmapped(L.mapLegacyBondType(bad));
  });

  it("every canonical coverage type is reachable from a legacy label", () => {
    const reached = new Set<string>();
    for (const label of ["Auto Liability", "Motor Truck Cargo", "General Liability", "Physical Damage", "Umbrella", "Reefer Breakdown"]) reached.add(mapped(L.mapLegacyCoverageType(label)).coverageType);
    for (const label of ["BMC-84 (Freight Broker)", "Customs / In-Transit Bond", "Performance Bond"]) reached.add(mapped(L.mapLegacyBondType(label)).coverageType);
    reached.add("WORKERS_COMPENSATION"); // the workers' record maps to its account type
    assert.deepEqual([...reached].sort(), [...D.COVERAGE_TYPES].sort());
  });

  it("currency, amount and date mapping is strict", () => {
    assert.equal(mapped(L.mapLegacyCurrency("CAD")).currency, "CAD");
    assert.equal(mapped(L.mapLegacyCurrency("USD")).currency, "USD");
    for (const bad of ["cad", "EUR", "", null, undefined, 1]) unmapped(L.mapLegacyCurrency(bad));
    assert.equal(mapped(L.mapLegacyAmount(1000000)).amount, "1000000.00");
    assert.equal(mapped(L.mapLegacyAmount("2500.5")).amount, "2500.50");
    assert.equal(mapped(L.mapLegacyAmount(0, { allowZero: true })).amount, "0.00");
    for (const bad of [0, -5, 1.005, "abc", "", null, undefined, Number.NaN]) unmapped(L.mapLegacyAmount(bad));
    assert.equal(mapped(L.mapLegacyDate("2024-02-29")).date, "2024-02-29");
    for (const bad of ["2023-02-29", "01/02/2024", "", null, 20240101]) unmapped(L.mapLegacyDate(bad));
  });

  it("status: Active and Archived map to the record lifecycle; Expired is NOT stored but derived from dates", () => {
    const active = mapped(L.mapLegacyStatus("Active"));
    assert.deepEqual([active.recordStatus, active.derivedFromDates], ["active", false]);
    const archived = mapped(L.mapLegacyStatus("Archived"));
    assert.deepEqual([archived.recordStatus, archived.derivedFromDates], ["archived", false]);
    const expired = mapped(L.mapLegacyStatus("Expired"));
    assert.deepEqual([expired.recordStatus, expired.derivedFromDates], ["active", true]);
    assert.match(expired.note, /not stored/i);
    for (const bad of ["active", "Cancelled", "Pending", "", null, undefined]) unmapped(L.mapLegacyStatus(bad));
  });

  it("previousRecordId becomes a typed renewal strategy", () => {
    assert.deepEqual(L.mapLegacyRenewal(undefined, { insurerId: "CMP-1", policyNumber: "A1" }, null), { strategy: "NONE" });
    assert.deepEqual(L.mapLegacyRenewal("", { insurerId: "CMP-1", policyNumber: "A1" }, null), { strategy: "NONE" });
    // same insurer, same normalized number (different punctuation) -> the carrier kept one identity: a new term
    assert.deepEqual(
      L.mapLegacyRenewal("INS-OLD", { insurerId: "CMP-1", policyNumber: "pol-123" }, { insurerId: "CMP-1", policyNumber: "POL 123" }),
      { strategy: "NEW_TERM_SAME_POLICY", predecessorLegacyId: "INS-OLD" },
    );
    // different number -> a new policy that renews the predecessor
    assert.deepEqual(
      L.mapLegacyRenewal("INS-OLD", { insurerId: "CMP-1", policyNumber: "POL-124" }, { insurerId: "CMP-1", policyNumber: "POL-123" }),
      { strategy: "NEW_POLICY_RENEWS_POLICY", predecessorLegacyId: "INS-OLD" },
    );
    // different insurer -> a new policy
    assert.equal(L.mapLegacyRenewal("INS-OLD", { insurerId: "CMP-2", policyNumber: "POL-123" }, { insurerId: "CMP-1", policyNumber: "POL-123" }).strategy, "NEW_POLICY_RENEWS_POLICY");
    // missing information is never guessed
    assert.equal(L.mapLegacyRenewal("INS-OLD", { insurerId: "CMP-1", policyNumber: "POL-123" }, null).strategy, "UNRESOLVED");
    assert.equal(L.mapLegacyRenewal("INS-OLD", { insurerId: "CMP-1", policyNumber: "###" }, { insurerId: "CMP-1", policyNumber: "POL-123" }).strategy, "UNRESOLVED");
    assert.equal(L.mapLegacyRenewal("INS-OLD", { policyNumber: "POL-123" }, { insurerId: "CMP-1", policyNumber: "POL-123" }).strategy, "UNRESOLVED");
    assert.equal(L.mapLegacyRenewal(42, {}, null).strategy, "UNRESOLVED");
  });

  it("a legacy transportation record maps to an INSURANCE draft; Expired stays an active record; evidence and notes are reported, not migrated", () => {
    const draft = mapped(
      L.mapLegacyTransportationRecord({
        id: "INS-1", insuranceType: "Auto Liability", policyNumber: " POL-1 ", insurerId: "CMP-10", insurerName: "Acme", effectiveDate: "2023-01-01", expiryDate: "2024-01-01",
        coverageAmount: 1000000, status: "Expired", evidenceId: "DOC-1", groupId: "COI-1", notes: "n", previousRecordId: "INS-0",
        coverageItems: [
          { id: "COV-1", coverageType: "Auto Liability CSL", limitAmount: 1000000, deductibleAmount: 1000, currency: "CAD" },
          { id: "COV-2", coverageType: "Motor Truck Cargo", limitAmount: "100000", currency: "USD", scheduledVehiclesOnly: true },
        ],
      }),
    );
    assert.equal(draft.family, "INSURANCE");
    assert.equal(draft.recordStatus, "active");
    assert.equal(draft.policyNumber, "POL-1");
    assert.equal(draft.legacyInsurerId, "CMP-10");
    assert.deepEqual([draft.termStart, draft.termEnd], ["2023-01-01", "2024-01-01"]);
    assert.deepEqual(draft.coverages, [
      { coverageType: "AUTO_LIABILITY", limitBasis: "COMBINED_SINGLE_LIMIT", limitAmount: "1000000.00", deductibleAmount: "1000.00", currency: "CAD", scheduledVehiclesOnly: false },
      { coverageType: "MOTOR_TRUCK_CARGO", limitBasis: null, limitAmount: "100000.00", deductibleAmount: null, currency: "USD", scheduledVehiclesOnly: true },
    ]);
    assert.deepEqual(draft.unresolved, []);
    assert.deepEqual(Object.keys(draft.notMigrated).sort(), ["evidenceId", "groupId", "notes"]);
  });

  it("without coverage items the record's own type and amount are used, with the currency reported as unresolved", () => {
    const draft = mapped(L.mapLegacyTransportationRecord({ insuranceType: "General Liability", policyNumber: "GL1", insurerId: "CMP-1", effectiveDate: "2024-01-01", expiryDate: "2025-01-01", coverageAmount: 2000000, status: "Active" }));
    assert.deepEqual(draft.coverages, [{ coverageType: "GENERAL_LIABILITY", limitBasis: null, limitAmount: "2000000.00", deductibleAmount: null, currency: null, scheduledVehiclesOnly: false }]);
    assert.deepEqual(draft.unresolved, ["currency"]);
  });

  it("a record with any unmappable member is UNMAPPABLE as a whole", () => {
    const base = { insuranceType: "Auto Liability", policyNumber: "A1", insurerId: "CMP-1", effectiveDate: "2024-01-01", expiryDate: "2025-01-01", coverageAmount: 1, status: "Active" };
    unmapped(L.mapLegacyTransportationRecord({ ...base, insuranceType: "Pollution" }));
    unmapped(L.mapLegacyTransportationRecord({ ...base, status: "Cancelled" }));
    unmapped(L.mapLegacyTransportationRecord({ ...base, expiryDate: "soon" }));
    unmapped(L.mapLegacyTransportationRecord({ ...base, effectiveDate: undefined }));
    unmapped(L.mapLegacyTransportationRecord({ ...base, coverageItems: [{ coverageType: "Auto Liability", limitAmount: 1, currency: "EUR" }] }));
    unmapped(L.mapLegacyTransportationRecord({ ...base, coverageItems: [{ coverageType: "Auto Liability", limitAmount: 1, currency: "CAD" }, { coverageType: "Auto Liability CSL", limitAmount: 2, currency: "CAD" }] }));
    unmapped(L.mapLegacyTransportationRecord("not a record"));
    unmapped(L.mapLegacyTransportationRecord(null));
  });

  it("a legacy workers' record maps to the WORKERS_COMPENSATION family with no limit", () => {
    const draft = mapped(L.mapLegacyWorkersRecord({ id: "WCB-1", jurisdiction: "ON", providerId: "CMP-9", providerName: "WSIB", accountNumber: "ACC 123", effectiveDate: "2024-01-01", expiryDate: "2025-01-01", status: "Active", evidenceId: "DOC-2" }));
    assert.equal(draft.family, "WORKERS_COMPENSATION");
    assert.equal(draft.policyNumber, "ACC 123");
    assert.equal(draft.legacyInsurerId, "CMP-9");
    assert.deepEqual(draft.coverages, [{ coverageType: "WORKERS_COMPENSATION", limitBasis: null, limitAmount: null, deductibleAmount: null, currency: null, scheduledVehiclesOnly: false }]);
    assert.deepEqual(Object.keys(draft.notMigrated).sort(), ["evidenceId", "jurisdiction"]);
    unmapped(L.mapLegacyWorkersRecord({ accountNumber: "A", effectiveDate: "2024-01-01", expiryDate: "never", status: "Active" }));
  });

  it("a legacy bond maps to the BOND family; the currency is unresolved; no expiry means a continuous bond", () => {
    const draft = mapped(L.mapLegacyBondRecord({ id: "BND-1", bondType: "BMC-84 (Freight Broker)", suretyOrganizationId: "CMP-5", bondNumber: "BND-77", principalName: "Me", bondAmount: "75000", effectiveDate: "2024-01-01", source: "OCR", status: "Active" }));
    assert.equal(draft.family, "BOND");
    assert.equal(draft.termEnd, null);
    assert.deepEqual(draft.coverages, [{ coverageType: "BOND_FREIGHT_BROKER", limitBasis: "PENAL_SUM", limitAmount: "75000.00", deductibleAmount: null, currency: null, scheduledVehiclesOnly: false }]);
    assert.deepEqual(draft.unresolved, ["currency"]);
    assert.deepEqual(Object.keys(draft.notMigrated).sort(), ["principalName", "source"]);
    assert.equal(mapped(L.mapLegacyBondRecord({ bondType: "Performance Bond", bondNumber: "B", bondAmount: 5000, effectiveDate: "2024-01-01", expiryDate: "2026-01-01", status: "Archived" })).termEnd, "2026-01-01");
    unmapped(L.mapLegacyBondRecord({ bondType: "Bid Bond", bondNumber: "B", bondAmount: 5000, effectiveDate: "2024-01-01", status: "Active" }));
    unmapped(L.mapLegacyBondRecord({ bondType: "Performance Bond", bondNumber: "B", bondAmount: "lots", effectiveDate: "2024-01-01", status: "Active" }));
  });

  it("drafts carry only canonical vocabulary: every mapped coverage type belongs to the draft's family", () => {
    const transport = mapped(L.mapLegacyTransportationRecord({ insuranceType: "Umbrella", policyNumber: "U1", insurerId: "CMP-1", effectiveDate: "2024-01-01", expiryDate: "2025-01-01", coverageAmount: 5, status: "Active" }));
    const workers = mapped(L.mapLegacyWorkersRecord({ accountNumber: "W", effectiveDate: "2024-01-01", expiryDate: "2025-01-01", status: "Active" }));
    const bond = mapped(L.mapLegacyBondRecord({ bondType: "Customs / In-Transit Bond", bondNumber: "B", bondAmount: 1, effectiveDate: "2024-01-01", status: "Active" }));
    for (const draft of [transport, workers, bond]) {
      for (const coverage of draft.coverages) assert.equal(D.COVERAGE_TYPE_DEFINITIONS[coverage.coverageType].family, draft.family);
    }
  });
});
