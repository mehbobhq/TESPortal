// Definitions tests: programs, versioned number normalization, jurisdiction resolution, status vocabulary, the legacy
// vocabulary mapping (pure), and (when a disposable database is configured) the drift check against the seeded catalogue.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type * as Defs from "../../../lib/tax-registrations/definitions.ts";
import type * as Errs from "../../../lib/tax-registrations/errors.ts";
import type * as Legacy from "../../../lib/tax-registrations/legacy.ts";

// Loaded in before(): the alias loader must be registered before the "@/..." imports resolve.
let D = {} as typeof Defs;
let E = {} as typeof Errs;
let L = {} as typeof Legacy;
before(async () => {
  await import("../../helpers/register-auth-test-loader.mjs");
  D = (await import("@/lib/tax-registrations/definitions")) as typeof Defs;
  E = (await import("@/lib/tax-registrations/errors")) as typeof Errs;
  L = (await import("@/lib/tax-registrations/legacy")) as typeof Legacy;
});

const invalid = (fn: () => unknown) => assert.throws(fn, (error) => error instanceof E.RegistrationValidationError);
const PROGRAMS = ["IFTA", "CT_HUF", "NY_HUT", "KYU", "NM_WDT", "OR_WMT", "FUEL_CHARGE", "TX_EXCISE", "AR_MFT", "ON_TOBACCO", "SCAC", "CA_CARRIER_CODE"] as const;
/** The twelve programs of migration 0016 plus GST_HST (migration 0034). */
const ALL_PROGRAMS = [...PROGRAMS, "GST_HST"] as const;

describe("registration programs and statuses", () => {
  it("has exactly the twelve programs of 0016 plus GST_HST (0034), in catalogue order", () => {
    assert.deepEqual([...D.PROGRAM_CODES], [...ALL_PROGRAMS]);
    assert.deepEqual(Object.keys(D.PROGRAM_DEFINITIONS), [...ALL_PROGRAMS]);
    for (const program of ALL_PROGRAMS) assert.equal(D.PROGRAM_DEFINITIONS[program].program, program);
    const orders = ALL_PROGRAMS.map((program) => D.PROGRAM_DEFINITIONS[program].sortOrder);
    assert.deepEqual(orders, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130]);
  });

  it("is not an authority register: no operating-authority kind and no Form 2290 is a program", () => {
    for (const authorityKind of ["USDOT", "MC", "MVID", "RIN", "CVOR", "SAFETY_FITNESS", "IRP"]) assert.equal(D.isProgramCode(authorityKind), false, authorityKind);
    for (const notRegistration of ["FORM_2290", "CUSTOMS", "CTPAT", "C_TPAT", "PIP", "FAST", "SMARTWAY", "UCR"]) assert.equal(D.isProgramCode(notRegistration), false, notRegistration);
    assert.equal(D.isProgramCode("ifta"), false);
    assert.equal(D.isProgramCode("toString"), false);
    assert.equal(D.isProgramCode(null), false);
  });

  it("has exactly the five registration statuses, with no REVOKED / CANCELED / EXPIRED / ARCHIVED", () => {
    assert.deepEqual([...D.REGISTRATION_STATUSES], ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE", "CLOSED"]);
    for (const bad of ["REVOKED", "CANCELED", "EXPIRED", "ARCHIVED", "active", ""]) assert.equal(D.isRegistrationStatus(bad), false, bad);
  });

  it("exports no transition matrix, expiry gating or archive-by-status policy", () => {
    const exported = Object.keys(D);
    for (const forbidden of ["isAllowedTransition", "isReactivation", "ARCHIVABLE_STATUSES", "TRANSITIONS", "hasExpiry", "isExpired"]) assert.ok(!exported.includes(forbidden), forbidden);
    for (const program of PROGRAMS) assert.equal("hasExpiry" in D.PROGRAM_DEFINITIONS[program], false);
  });

  it("namespaces: SCAC global, FUEL_CHARGE / CA_CARRIER_CODE national (CA), IFTA base jurisdiction, the rest country+region with a fixed region", () => {
    assert.equal(D.PROGRAM_DEFINITIONS.SCAC.jurisdictionScope, "GLOBAL");
    assert.equal(D.PROGRAM_DEFINITIONS.SCAC.issuerCountry, null);
    for (const program of ["FUEL_CHARGE", "CA_CARRIER_CODE"] as const) {
      assert.equal(D.PROGRAM_DEFINITIONS[program].jurisdictionScope, "NATIONAL");
      assert.equal(D.PROGRAM_DEFINITIONS[program].issuerCountry, "CA");
      assert.equal(D.PROGRAM_DEFINITIONS[program].regionRequired, false);
    }
    assert.equal(D.PROGRAM_DEFINITIONS.IFTA.jurisdictionScope, "BASE_JURISDICTION");
    assert.equal(D.PROGRAM_DEFINITIONS.IFTA.fixedRegion, null);
    const fixed = { CT_HUF: ["US", "CT"], NY_HUT: ["US", "NY"], KYU: ["US", "KY"], NM_WDT: ["US", "NM"], OR_WMT: ["US", "OR"], TX_EXCISE: ["US", "TX"], AR_MFT: ["US", "AR"], ON_TOBACCO: ["CA", "ON"] } as const;
    for (const [program, [country, region]] of Object.entries(fixed)) {
      const def = D.PROGRAM_DEFINITIONS[program as keyof typeof fixed];
      assert.equal(def.jurisdictionScope, "COUNTRY_REGION", program);
      assert.equal(def.issuerCountry, country, program);
      assert.equal(def.fixedRegion, region, program);
    }
  });

  it("only BASE_JURISDICTION programs (IFTA) allow an in-place number / jurisdiction change", () => {
    assert.deepEqual(PROGRAMS.filter((program) => D.allowsInPlaceIdentityChange(program)), ["IFTA"]);
  });
});

describe("number normalization", () => {
  const n = (program: (typeof PROGRAMS)[number], value: unknown) => D.prepareRegistrationNumber(program, value);

  it("every program's rule is registered under its version forever; rule names are honest", () => {
    for (const program of PROGRAMS) assert.equal(D.NORMALIZATION_RULES[D.PROGRAM_DEFINITIONS[program].rule.version], D.PROGRAM_DEFINITIONS[program].rule);
    for (const rule of Object.values(D.NORMALIZATION_RULES)) {
      assert.equal(/permissive/.test(rule.version), rule.classification === "PERMISSIVE", rule.version);
      assert.equal(typeof rule.source === "string" && rule.source.length > 0, rule.classification === "AUTHORITATIVE", rule.version);
      assert.match(rule.version, /\.v\d+$/);
    }
    assert.deepEqual(ALL_PROGRAMS.filter((program) => D.PROGRAM_DEFINITIONS[program].rule.classification === "AUTHORITATIVE"), ["SCAC", "GST_HST"]);
  });

  it("GST_HST (AUTHORITATIVE, CRA): nine digits, RT, four digits; spacing and case are not significant; a national Canadian number space", () => {
    const def = D.PROGRAM_DEFINITIONS.GST_HST;
    assert.deepEqual([def.family, def.jurisdictionScope, def.issuerCountry, def.regionRequired, def.fixedRegion], ["SALES_TAX", "NATIONAL", "CA", false, null]);
    assert.equal(def.rule.classification, "AUTHORITATIVE");
    for (const ok of ["123456782 RT 0001", "123456782RT0001", "123456782-rt-0001", " 123456782 rt0001 "]) {
      assert.equal(D.prepareRegistrationNumber("GST_HST", ok).normalized, "123456782RT0001", ok);
    }
    assert.equal(D.prepareRegistrationNumber("GST_HST", "123456782 RT 0001").ruleVersion, "gst_hst.cra_program_account.v1");
    for (const bad of ["", "123456782", "12345678 RT 0001", "123456782 RC 0001", "123456782 RT 001", "123456782 RT 00012", "ABCDEFGHI RT 0001"]) invalid(() => D.prepareRegistrationNumber("GST_HST", bad));
    assert.deepEqual(D.resolveJurisdiction("GST_HST", undefined), { country: "CA", region: null });
    invalid(() => D.resolveJurisdiction("GST_HST", { country: "CA", region: "ON" }));
  });

  it("only a base-jurisdiction program (IFTA) may be explicitly unresolved, and only when stated", () => {
    assert.deepEqual(D.resolveJurisdiction("IFTA", { unresolved: true }), { country: null, region: null });
    invalid(() => D.resolveJurisdiction("IFTA", undefined));
    invalid(() => D.resolveJurisdiction("IFTA", { unresolved: false }));
    invalid(() => D.resolveJurisdiction("IFTA", { unresolved: true, region: "ON" }));
    for (const program of ["NY_HUT", "FUEL_CHARGE", "SCAC", "GST_HST"] as const) invalid(() => D.resolveJurisdiction(program, { unresolved: true }));
  });

  it("SCAC (AUTHORITATIVE, NMFTA): two to four letters, trimmed and upper-cased", () => {
    assert.equal(n("SCAC", "ab").normalized, "AB");
    assert.equal(n("SCAC", "  tesc ").normalized, "TESC");
    assert.equal(n("SCAC", "tesc").display, "tesc");
    assert.equal(n("SCAC", "ABCD").ruleVersion, "scac.nmfta_two_to_four_letters.v1");
    for (const bad of ["", "A", "ABCDE", "AB1", "A-B", "12", "AB CD", "A.B"]) invalid(() => n("SCAC", bad));
    invalid(() => n("SCAC", 1234));
    invalid(() => n("SCAC", null));
  });

  it("every other program is PERMISSIVE: letters and digits, case / space / hyphen / period / slash ignored", () => {
    for (const program of PROGRAMS.filter((p) => p !== "SCAC")) {
      assert.equal(n(program, "ab-12.3/4 5").normalized, "AB12345", program);
      assert.equal(n(program, "ab-12.3/4 5").display, "ab-12.3/4 5", program);
      assert.equal(n(program, "A").normalized, "A", `${program}: no unsupported minimum-length claim`);
      assert.equal(n(program, "ab1").ruleVersion, "registration_identifier.permissive.v1", program);
      for (const bad of ["", "!!!", "A".repeat(33), "ab#12"]) invalid(() => n(program, bad));
    }
  });

  it("display is trimmed and whitespace-collapsed, length-bounded", () => {
    assert.equal(n("IFTA", "  ab   12  345 ").display, "ab 12 345");
    invalid(() => n("IFTA", "A".repeat(41)));
  });

  it("the same text in two programs normalizes the same (namespaces, not text, keep them apart)", () => {
    assert.equal(n("CT_HUF", "AB1234").normalized, n("NY_HUT", "AB1234").normalized);
  });
});

describe("jurisdiction resolution", () => {
  it("SCAC (GLOBAL) takes no jurisdiction at all", () => {
    assert.deepEqual(D.resolveJurisdiction("SCAC", undefined), { country: null, region: null });
    assert.deepEqual(D.resolveJurisdiction("SCAC", null), { country: null, region: null });
    for (const bad of [{}, { country: "US" }, { region: "TX" }, { country: "US", region: "TX" }, "US"]) invalid(() => D.resolveJurisdiction("SCAC", bad));
  });

  it("NATIONAL programs resolve to Canada and reject any region", () => {
    for (const program of ["FUEL_CHARGE", "CA_CARRIER_CODE"] as const) {
      assert.deepEqual(D.resolveJurisdiction(program, undefined), { country: "CA", region: null });
      assert.deepEqual(D.resolveJurisdiction(program, { country: "ca" }), { country: "CA", region: null });
      invalid(() => D.resolveJurisdiction(program, { region: "ON" }));
      invalid(() => D.resolveJurisdiction(program, { country: "CA", region: "ON" }));
      invalid(() => D.resolveJurisdiction(program, { country: "US" }));
      invalid(() => D.resolveJurisdiction(program, { extra: 1 }));
    }
  });

  it("COUNTRY_REGION programs default to their fixed region and reject any other", () => {
    const fixed = { CT_HUF: ["US", "CT", "NY"], NY_HUT: ["US", "NY", "CT"], KYU: ["US", "KY", "TN"], NM_WDT: ["US", "NM", "TX"], OR_WMT: ["US", "OR", "WA"], TX_EXCISE: ["US", "TX", "OK"], AR_MFT: ["US", "AR", "TX"], ON_TOBACCO: ["CA", "ON", "QC"] } as const;
    for (const [program, [country, region, other]] of Object.entries(fixed)) {
      const p = program as keyof typeof fixed;
      assert.deepEqual(D.resolveJurisdiction(p, undefined), { country, region }, program);
      assert.deepEqual(D.resolveJurisdiction(p, { region: region.toLowerCase() }), { country, region }, program);
      assert.deepEqual(D.resolveJurisdiction(p, { country, region }), { country, region }, program);
      invalid(() => D.resolveJurisdiction(p, { region: other }));
      invalid(() => D.resolveJurisdiction(p, { country: country === "US" ? "CA" : "US", region }));
      invalid(() => D.resolveJurisdiction(p, { region, extra: 1 } as never));
      invalid(() => D.resolveJurisdiction(p, region));
    }
  });

  it("IFTA requires a base jurisdiction: a US state or a Canadian province", () => {
    assert.deepEqual(D.resolveJurisdiction("IFTA", { country: "US", region: "tx" }), { country: "US", region: "TX" });
    assert.deepEqual(D.resolveJurisdiction("IFTA", { country: "CA", region: "AB" }), { country: "CA", region: "AB" });
    invalid(() => D.resolveJurisdiction("IFTA", undefined));
    invalid(() => D.resolveJurisdiction("IFTA", { region: "TX" }));
    invalid(() => D.resolveJurisdiction("IFTA", { country: "US" }));
    invalid(() => D.resolveJurisdiction("IFTA", { country: "MX", region: "TX" }));
    invalid(() => D.resolveJurisdiction("IFTA", { country: "US", region: "ON" }));
  });
});

describe("legacy Tax Filing vocabulary mapping (pure)", () => {
  it("maps every legacy TaxCode; Form 2290 has no registration identity; unknown codes are UNMAPPABLE", () => {
    const expected = {
      ifta: "IFTA", ct_huf: "CT_HUF", ny_hut: "NY_HUT", kyu: "KYU", nm_wdt: "NM_WDT", or_wmt: "OR_WMT",
      form_2290: "NO_REGISTRATION_IDENTITY", fuel_charge_registration: "FUEL_CHARGE", texas_excise_tax: "TX_EXCISE",
      arkansas_motor_fuel_tax: "AR_MFT", ontario_tobacco_tax: "ON_TOBACCO",
    } as const;
    assert.deepEqual([...L.LEGACY_TAX_CODES].sort(), Object.keys(expected).sort());
    for (const [legacy, canonical] of Object.entries(expected)) assert.equal(L.legacyTaxCodeToProgram(legacy), canonical, legacy);
    for (const bad of ["IFTA", "Ifta", " ifta", "irp", "usdot", "", "toString", "__proto__", "constructor", 7, null, undefined]) assert.equal(L.legacyTaxCodeToProgram(bad), "UNMAPPABLE", String(bad));
  });

  it("every mapped program is a real program; only Form 2290 maps to no program", () => {
    const targets = L.LEGACY_TAX_CODES.map((code) => L.legacyTaxCodeToProgram(code));
    assert.deepEqual(targets.filter((target) => !D.isProgramCode(target)), ["NO_REGISTRATION_IDENTITY"]);
    assert.equal(new Set(targets).size, targets.length, "no two legacy codes map to one program");
  });

  it("maps the five legacy TaxProfileStatus values and nothing else", () => {
    assert.equal(L.legacyStatusToRegistrationStatus("Active"), "ACTIVE");
    assert.equal(L.legacyStatusToRegistrationStatus("Pending"), "PENDING");
    assert.equal(L.legacyStatusToRegistrationStatus("Suspended"), "SUSPENDED");
    assert.equal(L.legacyStatusToRegistrationStatus("Inactive"), "INACTIVE");
    assert.equal(L.legacyStatusToRegistrationStatus("Closed"), "CLOSED");
    for (const bad of ["active", "ACTIVE", "Expired", "Revoked", "Canceled", "", "toString", 1, null, undefined]) assert.equal(L.legacyStatusToRegistrationStatus(bad), null, String(bad));
  });

  it("maps the six company account-number fields to their programs and everything else to null", () => {
    assert.deepEqual(
      Object.fromEntries(L.LEGACY_ACCOUNT_NUMBER_FIELDS.map((field) => [field, L.legacyAccountNumberFieldToProgram(field)])),
      { accIfta: "IFTA", accCt: "CT_HUF", accNyhut: "NY_HUT", accKyu: "KYU", accNm: "NM_WDT", accOr: "OR_WMT" },
    );
    for (const bad of ["accIrp", "accUsdot", "accMc", "acc2290", "accifta", "", "constructor", 1, null, undefined]) assert.equal(L.legacyAccountNumberFieldToProgram(bad), null, String(bad));
  });

  it("the legacy module is pure: no storage, database or server imports", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../../../lib/tax-registrations/legacy.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(text, /localStorage|sessionStorage|from "pg"|server-only|withAuthorized|process\.env|fetch\(/);
    assert.deepEqual([...text.matchAll(/^import .* from "(.*)"/gm)].map((match) => match[1]), ["@/lib/tax-registrations/definitions"]);
  });
});

const dbEnabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
describe("drift against the seeded catalogue (PostgreSQL)", { skip: !dbEnabled }, () => {
  it("registration_programs rows equal PROGRAM_DEFINITIONS exactly, and the capability rows are SYSTEM-only", async () => {
    const db = await import("@/test/helpers/auth-db");
    const pools = db.openPools();
    try {
      const rows = (await pools.admin.query(`SELECT * FROM public.registration_programs ORDER BY sort_order`)).rows;
      assert.deepEqual(rows.map((row) => row.code), [...ALL_PROGRAMS]);
      for (const row of rows) {
        const def = D.PROGRAM_DEFINITIONS[row.code as (typeof ALL_PROGRAMS)[number]];
        assert.ok(def, row.code);
        assert.equal(row.program_family, def.family, row.code);
        assert.equal(row.jurisdiction_scope, def.jurisdictionScope, row.code);
        assert.equal(row.issuer_country, def.issuerCountry, row.code);
        assert.equal(row.region_required, def.regionRequired, row.code);
        assert.equal(row.fixed_region, def.fixedRegion, row.code);
        assert.equal(row.sort_order, def.sortOrder, row.code);
        assert.equal(row.is_active, true, row.code);
      }
      const statuses = (await pools.admin.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'registration_status_periods_status_valid'`)).rows[0].def;
      assert.deepEqual([...statuses.matchAll(/'([A-Z]+)'/g)].map((match) => match[1]), [...D.REGISTRATION_STATUSES]);
      const caps = (await pools.admin.query<{ code: string; description: string }>(`SELECT code, description FROM public.capabilities WHERE code LIKE 'TAX_REGISTRATION_%' ORDER BY code`)).rows;
      assert.deepEqual(caps.map((cap) => cap.code), ["TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ"]);
      for (const cap of caps) assert.match(cap.description, /Intended scope: SYSTEM only\.$/, cap.code);
    } finally {
      await db.closePools();
    }
  });
});
