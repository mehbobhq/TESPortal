import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()
const form = readFileSync(path.join(ROOT, "app/companies/new/page.tsx"), "utf8")

/** Every field of the original (main) company creation form. Removing any of them is a regression. */
const ORIGINAL_FIELDS = [
  "accCt", "accIfta", "accIrp", "accKyu", "accNm", "accNyhut", "accOr", "assessmentDate", "billingEmail", "businessNo", "cargoTypes",
  "carrierCode", "companyName", "companyType", "contactPerson", "dba", "ein", "email", "endDate", "fuelProvider", "gpsProvider", "gstHst",
  "incorpNo", "mc", "mvid", "nsc", "opRegion", "payMethod", "phone", "regCorpCountry", "regCorpState", "scac", "startDate", "status",
  "svcType", "usdot", "website",
]
/** Fields with no canonical storage: kept on the form with their definition, disabled and labelled, never silently dropped. */
const UNAVAILABLE_FIELDS = ["gstHst"]
/** Fields whose value is owned by another workflow (contract, engagement lifecycle, assessment): shown read-only, never posted. */
const DERIVED_READ_ONLY_FIELDS = ["assessmentDate", "endDate", "status", "svcType"]
/** Fields that now persist to a canonical owner: they must be live (not disabled) and post their value. */
const PERSISTED_FIELDS = ["cargoTypes", "fuelProvider", "gpsProvider", "payMethod", "website"]

describe("company creation form keeps every original field", () => {
  for (const field of ORIGINAL_FIELDS) {
    it(`keeps ${field}`, () => {
      assert.ok(form.includes(`name="${field}"`) || form.includes(`"${field}"`) || form.includes(`id="${field}"`), `${field} is no longer on the form`)
    })
  }

  it("disables each unavailable field in place and labels it before submission", () => {
    for (const field of UNAVAILABLE_FIELDS) {
      const at = form.indexOf(`name="${field}"`)
      assert.ok(at >= 0, field)
      const block = form.slice(at, at + 700)
      assert.match(block, /disabled/, `${field} must be disabled, not removed`)
      assert.match(form.slice(at, at + 1800), /UnavailableNote/, `${field} must be labelled`)
    }
    assert.match(form, /UnavailableFieldsBanner/, "the form announces unavailable fields up front")
  })

  it("shows contract-, lifecycle- and assessment-owned fields read-only and never posts them", () => {
    for (const field of DERIVED_READ_ONLY_FIELDS) {
      const at = form.indexOf(`name="${field}"`)
      assert.ok(at >= 0, field)
      assert.match(form.slice(at, at + 300), /disabled/, `${field} must not be editable`)
      assert.match(form.slice(at, at + 1200), /DerivedNote/, `${field} must say where its value comes from`)
    }
  })

  it("makes every persisted field live: not disabled, not marked unavailable", () => {
    for (const field of PERSISTED_FIELDS) {
      const at = form.indexOf(`name="${field}"`)
      assert.ok(at >= 0, field)
      assert.doesNotMatch(form.slice(at, at + 160), /\bdisabled\b/, `${field} must be live`)
      assert.doesNotMatch(form.slice(at, at + 900), /UnavailableNote/, `${field} must not be marked unavailable`)
    }
  })

  it("enforces the original cargo rule now that cargo has a canonical owner", () => {
    assert.match(form, /const CARGO_STORAGE_AVAILABLE = true/)
    assert.match(form, /Cargo Information is mandatory for a Customer record\./)
    assert.match(form, /CARGO_OPTIONS/)
  })

  it("never derives a Business Number from an EIN, and sends the confirmed contact names", () => {
    assert.doesNotMatch(form, /businessNo:\s*\n?\s*opRegion === "US Only"/)
    assert.match(form, /businessNo: isCanada \? businessNumber : ""/)
    assert.match(form, /contactGivenName/)
    assert.match(form, /formData\.delete\("contactPerson"\)/)
  })
})
