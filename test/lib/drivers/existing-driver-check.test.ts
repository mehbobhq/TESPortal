import test from "node:test";
import assert from "node:assert/strict";

import {
  existingDriverCheckKey,
  findExistingDriverCandidates,
  hasMandatoryIdentityFields,
  phoneKey,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/driver-existing-check.ts";

type AnyMaster = Parameters<typeof findExistingDriverCandidates>[1]["drivers"][number];
type AnyRel = ReturnType<Parameters<typeof findExistingDriverCandidates>[1]["relationshipsFor"]>[number];

function master(id: string, first: string, last: string, email?: string, phone?: string, archived = false): AnyMaster {
  return { id, driverMasterId: id, identity: { legalFirstName: first, legalLastName: last, dateOfBirth: "", email, phone }, archive: { isArchived: archived } } as unknown as AnyMaster;
}
function rel(companyId: string, driverMasterId: string, driverStatus = "Active", archived = false): AnyRel {
  return { id: `CDR-${companyId}-${driverMasterId}`, companyId, driverMasterId, recordType: "Employee", driverStatus, archive: { isArchived: archived } } as unknown as AnyRel;
}

const input = { legalFirstName: "Amandeep", legalLastName: "Dhillon", email: "a.dhillon@example.com", phone: "(905) 555-0192" };
const companies = [{ id: "CMP-A", name: "Alpha Freight" }, { id: "CMP-B", name: "Beta Haul" }];

function ctx(drivers: AnyMaster[], rels: Record<string, AnyRel[]> = {}, currentCompanyId = "CMP-B") {
  return { currentCompanyId, drivers, companies, relationshipsFor: (id: string) => rels[id] ?? [] };
}

test("mandatory fields: all four are required before a check can run", () => {
  assert.equal(hasMandatoryIdentityFields(input), true);
  for (const field of ["legalFirstName", "legalLastName", "email", "phone"] as const) {
    assert.equal(hasMandatoryIdentityFields({ ...input, [field]: "   " }), false, field);
  }
});

test("name + email matches; case, whitespace and email case are normalized", () => {
  const result = findExistingDriverCandidates(
    { ...input, legalFirstName: "  AMANDEEP ", legalLastName: "dhillon", email: " A.Dhillon@Example.COM ", phone: "000" },
    ctx([master("DRV-1", "Amandeep", "Dhillon", "a.dhillon@example.com")]),
  );
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0]!.matchedOn, ["EMAIL"]);
});

test("name + phone matches regardless of formatting (digits only, leading NANP 1 ignored)", () => {
  const result = findExistingDriverCandidates({ ...input, email: "other@example.com" }, ctx([master("DRV-1", "Amandeep", "Dhillon", "x@y.com", "+1 905-555-0192")]));
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0]!.matchedOn, ["PHONE"]);
  assert.equal(phoneKey("+1 (905) 555-0192"), phoneKey("9055550192"));
});

test("a name match alone is never a candidate (no email and no phone match)", () => {
  const result = findExistingDriverCandidates(input, ctx([master("DRV-1", "Amandeep", "Dhillon", "different@example.com", "4165550000")]));
  assert.equal(result.candidates.length, 0);
});

test("a contact match without the same name is never a candidate", () => {
  const result = findExistingDriverCandidates(input, ctx([master("DRV-1", "Someone", "Else", "a.dhillon@example.com", "(905) 555-0192")]));
  assert.equal(result.candidates.length, 0);
});

test("no fuzzy matching: a nickname or typo is not a candidate", () => {
  const result = findExistingDriverCandidates(input, ctx([master("DRV-1", "Aman", "Dhillon", "a.dhillon@example.com"), master("DRV-2", "Amandeep", "Dhilon", "a.dhillon@example.com")]));
  assert.equal(result.candidates.length, 0);
});

test("the search is system-wide: a driver whose only relationship is at ANOTHER company is found, with that affiliation shown", () => {
  const result = findExistingDriverCandidates(input, ctx([master("DRV-1", "Amandeep", "Dhillon", "a.dhillon@example.com")], { "CMP-A": [rel("CMP-A", "DRV-1", "Suspended")] }, "CMP-B"));
  const candidate = result.candidates[0]!;
  assert.deepEqual(candidate.affiliations, [{ companyId: "CMP-A", companyName: "Alpha Freight", recordType: "Employee", driverStatus: "Suspended" }]);
  assert.equal(candidate.activeAtCurrentCompany, false);
});

test("a candidate already active at the CURRENT company is flagged (it cannot be attached again)", () => {
  const result = findExistingDriverCandidates(input, ctx([master("DRV-1", "Amandeep", "Dhillon", "a.dhillon@example.com")], { "CMP-B": [rel("CMP-B", "DRV-1")] }, "CMP-B"));
  assert.equal(result.candidates[0]!.activeAtCurrentCompany, true);
});

test("archived relationships are not affiliations; archived masters are not candidates", () => {
  const result = findExistingDriverCandidates(
    input,
    ctx([master("DRV-1", "Amandeep", "Dhillon", "a.dhillon@example.com"), master("DRV-2", "Amandeep", "Dhillon", "a.dhillon@example.com", undefined, true)], { "CMP-A": [rel("CMP-A", "DRV-1", "Active", true)] }),
  );
  assert.deepEqual(result.candidates.map((c) => c.master.id), ["DRV-1"]);
  assert.deepEqual(result.candidates[0]!.affiliations, []);
});

test("an unreadable company is reported as UNKNOWN, never silently treated as 'no affiliations'", () => {
  const result = findExistingDriverCandidates(input, {
    currentCompanyId: "CMP-B",
    drivers: [master("DRV-1", "Amandeep", "Dhillon", "a.dhillon@example.com")],
    companies,
    relationshipsFor: (id) => {
      if (id === "CMP-A") throw new Error("corrupt store");
      return [];
    },
  });
  assert.deepEqual(result.unreadableCompanyIds, ["CMP-A"]);
});

test("the check key changes when ANY of the four mandatory fields changes (so a stale check can be invalidated)", () => {
  const base = existingDriverCheckKey(input);
  assert.equal(existingDriverCheckKey({ ...input }), base);
  assert.notEqual(existingDriverCheckKey({ ...input, legalFirstName: "Aman" }), base);
  assert.notEqual(existingDriverCheckKey({ ...input, legalLastName: "Dhillons" }), base);
  assert.notEqual(existingDriverCheckKey({ ...input, email: "new@example.com" }), base);
  assert.notEqual(existingDriverCheckKey({ ...input, phone: "(416) 555-0000" }), base);
  // Cosmetic differences do not change it.
  assert.equal(existingDriverCheckKey({ ...input, legalFirstName: " AMANDEEP  ", phone: "9055550192" }), base);
});

test("the reserved licenceNumber parameter does not change matching in this phase", () => {
  const drivers = [master("DRV-1", "Amandeep", "Dhillon", "a.dhillon@example.com")];
  assert.equal(findExistingDriverCandidates({ ...input, licenceNumber: "D1234-56789-01234" }, ctx(drivers)).candidates.length, 1);
});
