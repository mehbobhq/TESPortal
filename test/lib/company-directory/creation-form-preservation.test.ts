import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()
const form = readFileSync(path.join(ROOT, "app/companies/new/page.tsx"), "utf8")

/** Every field the Add Company form collects. Each has exactly one canonical owner (see FIELD_OWNERS). */
const FORM_FIELDS = [
  "accCt", "accIfta", "accIrp", "accKyu", "accNm", "accNyhut", "accOr", "billingEmail", "businessNo", "cargoTypes",
  "carrierCode", "companyName", "companyType", "contactPerson", "dba", "ein", "email", "eldProvider", "fuelProvider", "gpsProvider", "gstHst",
  "incorpNo", "mc", "mvid", "nsc", "opRegion", "payMethod", "phone", "regCorpCountry", "regCorpState", "scac", "startDate",
  "usdot", "website",
]
/**
 * Fields whose value is owned by another workflow (contract, engagement lifecycle, assessment). They are shown on the profile, never
 * typed at creation, so the creation form does not carry them.
 */
const DERIVED_FIELDS = ["assessmentDate", "endDate", "status", "svcType"]
/** The issuing province / base jurisdiction selectors the form no longer asks for: the server records them as unresolved, never guessed. */
const REMOVED_JURISDICTION_SELECTORS = ["mvidRegion", "nscRegion", "irpBase", "iftaBase"]

describe("Add Company form", () => {
  for (const field of FORM_FIELDS) {
    it(`keeps ${field}`, () => {
      assert.ok(form.includes(`name="${field}"`) || form.includes(`id="${field}"`), `${field} is no longer on the form`)
    })
  }

  it("is titled Add Company, with no introductory warning banner and no per-field instruction text", () => {
    assert.match(form, /title="Add Company"/)
    assert.doesNotMatch(form, /Create Entity Record/)
    assert.doesNotMatch(form, /UnavailableFieldsBanner|UnavailableNote|DerivedNote/)
    assert.doesNotMatch(form, /text-\[11px\] text-muted-foreground">/, "no explanatory paragraph sits under an input")
    // explanations survive only as optional tooltips on genuinely ambiguous fields
    assert.match(form, /hint="/)
    assert.ok((form.match(/hint="/g) ?? []).length <= 3, "tooltips are the exception")
  })

  it("uses short, consistent labels", () => {
    for (const label of ["Primary Contact", "Service Start Date", "ELD Provider", "GPS Provider", "Fuel Provider", "Cargo Types", "GST/HST Account", "Company Name"]) {
      assert.match(form, new RegExp(`label="${label}"`), label)
    }
    assert.doesNotMatch(form, /Contact given name|Contact family name|First Name|Last Name/)
  })

  it("does not carry the contract-, lifecycle- and assessment-owned fields, and never posts them", () => {
    for (const field of DERIVED_FIELDS) assert.ok(!form.includes(`name="${field}"`), `${field} is shown on the profile, not typed at creation`)
  })

  it("asks for no issuing province or base jurisdiction", () => {
    for (const field of REMOVED_JURISDICTION_SELECTORS) assert.ok(!form.includes(`"${field}"`), `${field} must not be asked for`)
    assert.doesNotMatch(form, /RegionSelect|issuing province|Base Province/i)
    // the distinctions between the four numbers stay visible
    for (const label of ["MVID / RIN", "NSC / CVOR", "IRP Account", "IFTA Account"]) assert.match(form, new RegExp(`label="${label}"`), label)
    // the MVID / RIN and NSC / CVOR number-type dropdowns are gone: the numbers are recorded as MVID and NSC, nothing is assumed
    assert.doesNotMatch(form, /mvidKind|nscKind|MVID \/ RIN Type|NSC \/ CVOR Type|NativeChoice|<select/)
  })

  it("makes every persisted field live: not disabled, posted with its value", () => {
    for (const field of ["cargoTypes", "eldProvider", "fuelProvider", "gpsProvider", "payMethod", "website", "gstHst"]) {
      const at = form.indexOf(`name="${field}"`)
      assert.ok(at >= 0, field)
      assert.doesNotMatch(form.slice(at, at + 160), /\bdisabled\b/, `${field} must be live`)
    }
    assert.doesNotMatch(form, /\bdisabled\s*\n?\s*(placeholder|value|\/>)/, "no input is left disabled")
  })

  it("enforces the original cargo rule now that cargo has a canonical owner", () => {
    assert.match(form, /const CARGO_STORAGE_AVAILABLE = true/)
    assert.match(form, /Cargo Information is mandatory for a Customer record\./)
    assert.match(form, /CARGO_OPTIONS/)
  })

  it("never derives a Business Number from an EIN, and posts the Primary Contact once", () => {
    assert.doesNotMatch(form, /businessNo:\s*\n?\s*opRegion === "US Only"/)
    assert.match(form, /businessNo: isCanada \? businessNumber : ""/)
    assert.match(form, /ein: isUS \? einNumber : ""/)
    assert.doesNotMatch(form, /contactGivenName|contactFamilyName/)
    assert.match(form, /formData\.delete\("contactPerson"\)/)
    assert.match(form, /name="contactPersonId"/)
  })

  it("offers the GST/HST account where the company operates in Canada, as its own field, never as the Business Number", () => {
    assert.match(form, /\{isCanada && \(\s*<Field label="GST\/HST Account"/)
    assert.match(form, /gstHst: isCanada \? gstHst\.trim\(\) : ""/)
    assert.match(form, /GST_HST_PATTERN/)
    assert.doesNotMatch(form, /State Tax Registration/)
    // the Canadian Business Number is Canada-only and the EIN is US-only
    assert.match(form, /\{isCanada && \(\s*<Field label="Business Number \(BN\)"/)
    assert.match(form, /\{isUS && \(\s*<Field label="EIN"/)
  })

  it("keeps browser storage out of the form", () => {
    assert.doesNotMatch(form, /localStorage|sessionStorage|indexedDB/i)
  })

  it("offers a person lookup only as an explicit choice: nothing is linked or merged by name", () => {
    assert.match(form, /fetch\("\/api\/people\/matches"/)
    assert.match(form, /Use this person/)
    assert.doesNotMatch(form, /setChosen\(suggestions\[0\]\)|setChosen\(person\)\s*\n?\s*\}\s*,\s*\[/, "no suggestion is selected automatically")
  })
})
