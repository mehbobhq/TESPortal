// Pure tests (no database) for address validation, display cleaning and ADVISORY match keys.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

async function load() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    addr: await import("@/lib/organization-locations/address-normalization"),
    errors: await import("@/lib/organization-locations/errors"),
  };
}
const K = {} as Awaited<ReturnType<typeof load>>;

const base = { country: "CA", region: "AB", locality: "Calgary", postalCode: "T2E 1A1", addressLine1: "123 Example Road" };

describe("Location address preparation", () => {
  before(async () => {
    Object.assign(K, await load());
  });

  const invalid = (input: unknown, field?: string) =>
    assert.throws(
      () => K.addr.prepareAddress(input),
      (error: unknown) => {
        assert.ok(error instanceof K.errors.OrganizationLocationValidationError, String(error));
        if (field) assert.equal((error as { field: string }).field, field);
        return true;
      },
    );

  it("preserves displayable values (trimmed, whitespace collapsed) and derives separate normalized values", () => {
    const prepared = K.addr.prepareAddress({ ...base, locality: "  Calgary ", postalCode: " t2e  1a1 ", addressLine1: "  123   Example   Road ", unit: " Suite 100 " });
    assert.equal(prepared.locality, "Calgary");
    assert.equal(prepared.postalCode, "t2e 1a1");
    assert.equal(prepared.postalCodeNormalized, "T2E1A1");
    assert.equal(prepared.addressLine1, "123 Example Road");
    assert.equal(prepared.unit, "Suite 100");
    assert.equal(prepared.addressLine2, null);
    assert.equal(prepared.countryCode, "CA");
    assert.equal(prepared.regionCode, "AB");
  });

  it("canonical codes only; unsupported countries and mismatched regions fail clearly", () => {
    invalid({ ...base, country: "MX" }, "address.country");
    invalid({ ...base, country: "Canada" }, "address.country");
    invalid({ ...base, country: undefined }, "address.country");
    invalid({ ...base, region: "TX" }, "address.region");
    invalid({ ...base, country: "US", region: "AB" }, "address.region");
    assert.equal(K.addr.prepareAddress({ ...base, country: "us", region: "tx", postalCode: "75001" }).countryCode, "US");
  });

  it("postal codes: valid forms accepted, malformed rejected, absent allowed (rural / non-standard addresses)", () => {
    for (const postalCode of ["T2E1A1", "t2e-1a1", "K1A 0B1"]) assert.ok(K.addr.prepareAddress({ ...base, postalCode }).postalCodeNormalized);
    for (const postalCode of ["D2E 1A1", "T2E 1A", "123456", "T2E 1AI"]) invalid({ ...base, postalCode }, "address.postalCode");
    const us = { ...base, country: "US", region: "TX" };
    assert.equal(K.addr.prepareAddress({ ...us, postalCode: "75001-1234" }).postalCodeNormalized, "750011234");
    assert.equal(K.addr.prepareAddress({ ...us, postalCode: "75001" }).postalCodeNormalized, "75001");
    invalid({ ...us, postalCode: "7500" }, "address.postalCode");
    const rural = K.addr.prepareAddress({ ...base, postalCode: null, addressLine1: "NE 12-034-05 W4M" });
    assert.equal(rural.postalCode, null);
    assert.equal(rural.postalCodeNormalized, null);
  });

  it("required fields, length limits, control characters and unknown keys", () => {
    invalid({ ...base, locality: "  " }, "address.locality");
    invalid({ ...base, addressLine1: "" }, "address.addressLine1");
    invalid({ ...base, addressLine1: "x".repeat(201) }, "address.addressLine1");
    invalid({ ...base, addressLine1: "a\u0000b" }, "address.addressLine1");
    invalid({ ...base, unit: 5 }, "address.unit");
    for (const extra of [{ matchKeyBuilding: "x" }, { postalCodeNormalized: "X" }, { latitude: 51 }, { timezone: "MST" }, { facilityId: "F1" }, { source: "ocr" }]) {
      invalid({ ...base, ...extra });
    }
    invalid(null);
    invalid("123 Example Road");
    invalid([]);
  });

  it("building key: formatting differences collapse; the unit does not enter it", () => {
    const a = K.addr.prepareAddress({ ...base, addressLine1: "123 Example Road" });
    const b = K.addr.prepareAddress({ ...base, addressLine1: "123 example rd.", postalCode: "t2e1a1", locality: "CALGARY" });
    const c = K.addr.prepareAddress({ ...base, addressLine1: "123 Example Road", unit: "Suite 100" });
    assert.equal(a.matchKeyBuilding, b.matchKeyBuilding);
    assert.equal(a.matchKeyBuilding, c.matchKeyBuilding);
    const directional = K.addr.prepareAddress({ ...base, addressLine1: "100 N Main St" }).matchKeyBuilding;
    assert.equal(directional, K.addr.prepareAddress({ ...base, addressLine1: "100 North Main Street" }).matchKeyBuilding);
    const accented = K.addr.prepareAddress({ ...base, locality: "Québec City", addressLine1: "5 Rue Saint-Jean" }).matchKeyBuilding;
    assert.equal(accented, K.addr.prepareAddress({ ...base, locality: "Quebec City", addressLine1: "5 rue saint jean" }).matchKeyBuilding);
  });

  it("unit key keeps distinct suites distinct and equates formatting of the same suite", () => {
    const s100 = K.addr.prepareAddress({ ...base, unit: "Suite 100" });
    const s100b = K.addr.prepareAddress({ ...base, unit: "STE 100" });
    const hash100 = K.addr.prepareAddress({ ...base, unit: "#100" });
    const s200 = K.addr.prepareAddress({ ...base, unit: "Suite 200" });
    const none = K.addr.prepareAddress({ ...base });
    assert.equal(s100.matchKeyUnit, s100b.matchKeyUnit);
    assert.equal(s100.matchKeyUnit, hash100.matchKeyUnit);
    assert.notEqual(s100.matchKeyUnit, s200.matchKeyUnit);
    assert.notEqual(s100.matchKeyUnit, none.matchKeyUnit);
    assert.equal(s100.matchKeyBuilding, s200.matchKeyBuilding);
  });

  it("different places do not share a building key (street, locality, postal base, region)", () => {
    const key = (over: object) => K.addr.prepareAddress({ ...base, ...over }).matchKeyBuilding;
    const a = key({});
    assert.notEqual(a, key({ addressLine1: "124 Example Road" }));
    assert.notEqual(a, key({ locality: "Airdrie" }));
    assert.notEqual(a, key({ postalCode: "T2E 1A2" }));
    assert.notEqual(a, key({ region: "BC" }));
    assert.notEqual(a, key({ postalCode: null }));
  });

  it("a leading ST is a saint or a name word, not a street suffix", () => {
    assert.notEqual(
      K.addr.prepareAddress({ ...base, addressLine1: "10 St Albert Trail" }).matchKeyBuilding,
      K.addr.prepareAddress({ ...base, addressLine1: "10 Street Albert Trail" }).matchKeyBuilding,
    );
    assert.equal(
      K.addr.prepareAddress({ ...base, addressLine1: "10 St Albert Trail" }).matchKeyBuilding,
      K.addr.prepareAddress({ ...base, addressLine1: "10 Saint Albert Trail" }).matchKeyBuilding,
    );
    assert.equal(
      K.addr.prepareAddress({ ...base, addressLine1: "100 Main St NW" }).matchKeyBuilding,
      K.addr.prepareAddress({ ...base, addressLine1: "100 Main Street Northwest" }).matchKeyBuilding,
    );
  });

  it("content comparison ignores match keys but not displayed values", () => {
    const a = K.addr.prepareAddress(base);
    assert.equal(K.addr.sameAddressContent(a, K.addr.prepareAddress({ ...base })), true);
    assert.equal(K.addr.sameAddressContent(a, K.addr.prepareAddress({ ...base, addressLine1: "123 example rd" })), false);
  });
});
