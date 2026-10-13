import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { before, describe, it } from "node:test"

type Input = typeof import("../../../lib/company-directory/creation-input.ts")
let I: Input

const ROOT = process.cwd()
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

const base = { companyName: "Acme Transport Ltd", companyType: "Owner Operator", opRegion: "Canada Only" }
const customer = { ...base, companyType: "Customer", startDate: "2024-01-15" }
const issuesOf = (payload: unknown): Array<{ field: string; message: string }> => {
  try {
    I.parseCreateCompanyInput(payload)
  } catch (error) {
    if (error instanceof I.CompanyCreationValidationError) return error.issues
    throw error
  }
  return []
}

describe("company creation input contract", () => {
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs")
    I = await import("@/lib/company-directory/creation-input")
  })

  it("every input the creation form renders is either persisted or explicitly refused (nothing can be dropped silently)", () => {
    const code = source("app/companies/new/page.tsx")
    const names = new Set<string>()
    for (const match of code.matchAll(/\bname="([A-Za-z0-9_]+)"/g)) names.add(match[1])
    for (const prefix of ["reg", "mail", "yard"]) for (const part of ["street", "city", "state", "zip", "country"]) names.add(`${prefix}_${part}`)
    assert.ok(names.size > 30, "the form fields were found")
    for (const name of names) {
      assert.ok(I.SUPPORTED_FIELD_KEYS.has(name), `form field '${name}' has no canonical owner in the creation contract`)
      assert.ok(!(name in I.UNSUPPORTED_FIELDS), `form field '${name}' is declared unsupported but still rendered`)
    }
  })

  it("the page posts only what the form holds and never recomputes one identifier from another", () => {
    const code = source("app/companies/new/page.tsx")
    assert.doesNotMatch(code, /businessNo:\s*\n?\s*opRegion === "US Only"/)
    assert.doesNotMatch(code, /cargoTypes/)
    assert.match(code, /businessNo: isCanada \? businessNumber : ""/)
    assert.match(code, /ein: isUS \? einNumber : ""/)
  })

  it("maps a full customer submission to every canonical domain", () => {
    const plan = I.parseCreateCompanyInput({
      ...customer,
      dba: "Acme", opRegion: "Cross-Border", regCorpState: "ON", regCorpCountry: "Canada", incorpNo: "1234567", businessNo: "123456782", ein: "12-3456789",
      contactGivenName: "Jane", contactFamilyName: "Roe", phone: "+1 416 555 0123", email: "ops@example.test", billingEmail: "billing@example.test",
      reg_street: "100 King St W", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada",
      mail_street: "PO Box 12", mail_city: "Ottawa", mail_state: "ON", mail_zip: "K1P 5G3", mail_country: "Canada",
      yard_street: "55 Yard Rd", yard_city: "Chicago", yard_state: "IL", yard_zip: "60601", yard_country: "United States",
      usdot: "1234567", mc: "654321", mvid: "A1", mvidKind: "MVID", mvidRegion: "ON", nsc: "ON1", nscKind: "CVOR", accIrp: "IRP1", irpBase: "IL", accIfta: "IF1", iftaBase: "ON",
      accNyhut: "NY1", accNm: "NM1", accKyu: "KY1", accOr: "OR1", accCt: "CT1", scac: "ABCD", carrierCode: "1234",
    })
    assert.equal(plan.isCustomer, true)
    assert.equal(plan.customerStartedAt, "2024-01-15T00:00:00.000Z")
    assert.equal(plan.operatingScope, "CANADA_AND_UNITED_STATES")
    assert.deepEqual(plan.organization.identifiers?.map((i) => i.kind), ["INCORPORATION", "CRA_BN", "IRS_EIN"])
    assert.deepEqual(plan.addresses.map((a) => [a.role, a.address.region, a.address.country]), [["REGISTERED", "ON", "CA"], ["MAILING", "ON", "CA"], ["HOME_YARD", "IL", "US"]])
    assert.deepEqual(plan.channels.map((c) => [c.type, c.usage]), [["PHONE", "GENERAL"], ["EMAIL", "GENERAL"], ["EMAIL", "ACCOUNTING"]])
    assert.deepEqual(plan.contact, { givenName: "Jane", familyName: "Roe" })
    assert.deepEqual(plan.authorities.map((a) => [a.kind, a.jurisdiction?.region ?? null]), [["USDOT", null], ["MC", null], ["MVID", "ON"], ["CVOR", "ON"], ["IRP", "IL"]])
    assert.deepEqual(plan.registrations.map((r) => r.program), ["IFTA", "NY_HUT", "NM_WDT", "KYU", "OR_WMT", "CT_HUF", "SCAC", "CA_CARRIER_CODE"])
  })

  it("never fabricates: blank optional fields produce no records, and a business number is never derived from an EIN", () => {
    const plan = I.parseCreateCompanyInput({ ...base, businessNo: "", ein: "12-3456789", phone: "  ", reg_street: "" })
    assert.deepEqual(plan.organization.identifiers?.map((i) => i.kind), ["IRS_EIN"])
    assert.equal(plan.contact, null)
    assert.equal(plan.channels.length, 0)
    assert.equal(plan.addresses.length, 0)
    assert.equal(plan.authorities.length + plan.registrations.length, 0)
  })

  it("refuses unsupported and unknown fields explicitly instead of discarding them", () => {
    const issues = issuesOf({ ...base, gstHst: "123456789 RT 0001", website: "https://x.test", cargoTypes: ["General Freight"], payMethod: "Cheque", svcType: "Premium", mystery: "x" })
    const fields = issues.map((issue) => issue.field).sort()
    assert.deepEqual(fields, ["cargoTypes", "gstHst", "mystery", "payMethod", "svcType", "website"])
    for (const issue of issues) assert.ok(issue.message.length > 10)
    // empty values for unsupported fields are ignored (a browser form posts blanks)
    assert.deepEqual(issuesOf({ ...base, gstHst: "", website: "", cargoTypes: [], payMethod: "" }), [])
  })

  it("refuses a full-name contact, an incomplete address, and an incorporation number without its jurisdiction", () => {
    assert.deepEqual(issuesOf({ ...base, contactPerson: "Jane Roe" }).map((i) => i.field), ["contactPerson"])
    assert.match(issuesOf({ ...base, reg_street: "1 Main St" })[0].message, /incomplete/)
    assert.deepEqual(issuesOf({ ...base, incorpNo: "123" }).map((i) => i.field), ["incorpNo"])
    assert.deepEqual(issuesOf({ ...base, reg_street: "1 Main", reg_city: "X", reg_state: "ZZ" }).map((i) => i.field), ["reg_state"])
    assert.deepEqual(issuesOf({ ...base, regCorpState: "TX", regCorpCountry: "Canada" }).map((i) => i.field), ["regCorpState"])
  })

  it("mailing and yard addresses, and a service start date, are Customer-only", () => {
    const address = { mail_street: "1 A", mail_city: "B", mail_state: "ON" }
    assert.deepEqual(issuesOf({ ...base, ...address }).map((i) => i.field), ["mail_street"])
    assert.deepEqual(issuesOf({ ...base, startDate: "2024-01-01" }).map((i) => i.field), ["startDate"])
    assert.deepEqual(issuesOf({ ...customer, ...address }), [])
    assert.deepEqual(issuesOf({ ...base, companyType: "Customer" }).map((i) => i.field), ["startDate"])
    assert.deepEqual(issuesOf({ ...customer, startDate: "2024-02-31" }).map((i) => i.field), ["startDate"])
  })

  it("never infers the issuing jurisdiction or number type of a carrier number", () => {
    assert.deepEqual(issuesOf({ ...base, mvid: "A1" }).map((i) => i.field), ["mvidRegion"])
    assert.deepEqual(issuesOf({ ...base, nsc: "N1" }).map((i) => i.field), ["nscRegion"])
    assert.deepEqual(issuesOf({ ...base, accIrp: "I1" }).map((i) => i.field), ["irpBase"])
    assert.deepEqual(issuesOf({ ...base, accIfta: "F1" }).map((i) => i.field), ["iftaBase"])
    assert.deepEqual(issuesOf({ ...base, mvidKind: "BOGUS", mvid: "A1" }).map((i) => i.field), ["mvidKind"])
    assert.deepEqual(issuesOf({ ...base, mvidRegion: "ON" }).map((i) => i.field), ["mvidRegion"])
    assert.deepEqual(issuesOf({ ...base, mvid: "A1", mvidKind: "RIN" }), [], "an Ontario RIN needs no further information")
  })

  it("rejects unknown record types and operating regions, and non-object bodies", () => {
    assert.deepEqual(issuesOf({ ...base, companyType: "Bogus" }).map((i) => i.field), ["companyType"])
    assert.deepEqual(issuesOf({ ...base, opRegion: "Mars" }).map((i) => i.field), ["opRegion"])
    assert.deepEqual(issuesOf(null).map((i) => i.field), ["body"])
    assert.deepEqual(issuesOf([]).map((i) => i.field), ["body"])
    assert.deepEqual(issuesOf({}).map((i) => i.field).sort(), ["companyName", "companyType"])
  })

  it("reports every problem at once", () => {
    assert.ok(issuesOf({ companyName: "", companyType: "", gstHst: "x", mvid: "1" }).length >= 4)
  })
})
