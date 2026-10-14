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
const UNAVAILABLE_FIELDS = ["assessmentDate", "cargoTypes", "endDate", "fuelProvider", "gpsProvider", "gstHst", "payMethod", "status", "svcType", "website"]

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

  it("keeps the original cargo rule defined and switchable instead of deleting it", () => {
    assert.match(form, /CARGO_STORAGE_AVAILABLE/)
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
