import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { before, describe, it } from "node:test"

type V = typeof import("../../../lib/company-directory/edit-validation.ts")
let V: V

const ROOT = process.cwd()
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

const profile = {
  dba: "Maple Haulage", incorpNo: "123456", businessNo: "123456789", ein: "", gstHst: "123456789 RT 0001", opRegion: "Canada Only",
  website: "https://maple.example.test", phone: "+1 416 555 0142", email: "acct@example.test", billingEmail: "",
  eldProvider: "Samsara", gpsProvider: "", fuelProvider: "", payMethod: "Cheque", cargoTypes: ["General Freight"],
  reg_street: "1 King St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada",
  mail_street: "PO Box 10", mail_city: "Toronto", mail_state: "ON", mail_zip: "M5X 1A1", mail_country: "Canada",
  yard_street: "", yard_city: "", yard_state: "", yard_zip: "", yard_country: "",
}
const ctx = { isCustomer: true, formationCountry: "CA", contactsWithheld: false, registrationsWithheld: false }
const options = (over: Record<string, unknown> = {}) => ({
  includeContacts: true, includeRegistrations: true, isCustomer: true,
  replacement: { source: "COMPANY_WRITTEN_REQUEST", reference: "", sender: "" }, dbaBasis: { kind: "", reference: "" }, ...over,
}) as Parameters<V["buildPatch"]>[2]

describe("Company Edit: change detection, validation and the save request", () => {
  let base: ReturnType<V["valuesFromRecords"]>
  const edit = (over: Record<string, unknown>) => ({ ...base, ...over }) as typeof base

  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs")
    V = await import("@/lib/company-directory/edit-validation")
    base = V.valuesFromRecords({ dba: profile.dba, incorpNo: profile.incorpNo, businessNo: profile.businessNo, ein: profile.ein }, profile)
  })

  it("an untouched form has no changes, no problems and an empty request (nothing is rewritten)", () => {
    assert.deepEqual(V.changedFields(base, base), [])
    assert.deepEqual(V.validateEdit(base, base, ctx), [])
    assert.deepEqual(V.buildPatch(base, base, options()), {})
  })

  it("detects exactly the fields that changed, and treats formatting-only differences of a phone, URL or postal code as unchanged", () => {
    assert.deepEqual(V.changedFields(edit({ phone: "+1 (416) 555-0142", website: "HTTPS://MAPLE.example.test/", reg_zip: "m5x1a9" }), base), [])
    assert.deepEqual(V.changedFields(edit({ dba: "Maple Freight", payMethod: "Wire Transfer", mail_city: "Ottawa" }), base).sort(), ["dba", "mail_city", "payMethod"])
    assert.deepEqual(V.changedFields(edit({ cargoTypes: ["General Freight", "Household Goods"] }), base), ["cargoTypes"])
  })

  it("text typed into an empty phone is a change (and invalid), never mistaken for 'still empty'", () => {
    const empty = V.valuesFromRecords(null, { ...profile, phone: "" })
    assert.deepEqual(V.changedFields({ ...empty, phone: "abc" }, empty), ["phone"])
    assert.ok(V.validateEdit({ ...empty, phone: "abc" }, empty, ctx).some((issue) => issue.field === "phone"))
  })

  it("only changed fields are validated: an untouched legacy value never blocks a save", () => {
    const legacy = V.valuesFromRecords(null, { ...profile, email: "not-an-email", businessNo: "bad" })
    assert.deepEqual(V.validateEdit(legacy, legacy, ctx), [])
    const issues = V.validateEdit({ ...legacy, dba: "New Name" }, legacy, ctx)
    assert.deepEqual(issues, [])
  })

  it("malformed values are rejected against the field they belong to, with the same rules the server applies", () => {
    const bad = V.validateEdit(
      edit({ businessNo: "12", ein: "12-34", gstHst: "not an account", phone: "abc", email: "no-at-sign", website: "not a url", billingEmail: "x@@y", eldProvider: "x".repeat(121), payMethod: "Bitcoin" }),
      base,
      ctx,
    )
    const byField = Object.fromEntries(bad.map((issue) => [issue.field, issue.message]))
    for (const field of ["businessNo", "ein", "gstHst", "phone", "email", "website", "billingEmail", "eldProvider", "payMethod"]) assert.ok(byField[field], `${field} is rejected`)
    assert.match(byField.businessNo, /9 digits/)
    assert.ok(bad.length >= 9)
    // a well-formed GST/HST account must begin with the company's Business Number
    const mismatch = V.validateEdit(edit({ gstHst: "999999999 RT 0001" }), base, ctx)
    assert.deepEqual(mismatch.map((issue) => issue.field), ["gstHst"])
    assert.match(mismatch[0].message, /Business Number/)
  })

  it("an incomplete address is rejected naming its block, and an address can never be blanked (it would be silently ignored by the server)", () => {
    assert.ok(V.validateEdit(edit({ reg_city: "" }), base, ctx).some((issue) => issue.field.startsWith("reg_")))
    const blanked = V.validateEdit(edit({ mail_street: "", mail_city: "", mail_state: "", mail_zip: "", mail_country: "" }), base, ctx)
    assert.equal(blanked.length, 1)
    assert.equal(blanked[0].field, "mail_street")
    assert.match(blanked[0].message, /cannot be removed/)
    assert.ok(V.validateEdit(edit({ yard_street: "5 Yard Rd" }), base, ctx).some((issue) => issue.field.startsWith("yard_")), "a half-filled new address is incomplete")
    assert.deepEqual(V.validateEdit(edit({ yard_street: "5 Yard Rd", yard_city: "Guelph", yard_state: "ON", yard_zip: "N1H 1A1", yard_country: "Canada" }), base, ctx), [])
    assert.ok(V.validateEdit(edit({ reg_state: "ZZ" }), base, ctx).some((issue) => issue.field === "reg_state"), "an unknown province is rejected")
  })

  it("a Customer cannot be left without cargo information, and restricted sections are not validated or sent", () => {
    assert.ok(V.validateEdit(edit({ cargoTypes: [] }), base, ctx).some((issue) => issue.field === "cargoTypes"))
    assert.deepEqual(V.validateEdit(edit({ phone: "garbage" }), base, { ...ctx, contactsWithheld: true }), [])
    assert.deepEqual(V.validateEdit(edit({ gstHst: "garbage" }), base, { ...ctx, registrationsWithheld: true }), [])
    const patch = V.buildPatch(edit({ phone: "+1 416 555 0199", gstHst: "123456789 RT 0002", website: "https://new.example.test" }), base, options({ includeContacts: false, includeRegistrations: false, replacement: { source: "STAFF_ENTRY", reference: "ref", sender: "" } }))
    assert.equal("phone" in patch, false)
    assert.equal("gstHst" in patch, false)
    assert.equal(patch.website, "https://new.example.test", "the website is not part of the restricted contact details")
  })

  it("the request carries only what changed, never the registered legal name, and the replacement context only when an established value is replaced", () => {
    const patch = V.buildPatch(edit({ dba: "Maple Freight", payMethod: "Wire Transfer", reg_street: "2 Queen St" }), base, options())
    assert.deepEqual(Object.keys(patch).sort(), ["dba", "payMethod", "reg_city", "reg_country", "reg_state", "reg_street", "reg_zip"])
    assert.equal("companyName" in patch, false)
    assert.equal("channelChangeSource" in patch, false)

    const replaced = V.buildPatch(edit({ phone: "+1 416 555 0199", billingEmail: "bill@example.test" }), base, options({ replacement: { source: "COMPANY_VERBAL_CONFIRMED", reference: " call of Oct 19 ", sender: " a@b.test " } }))
    assert.equal(replaced.phone, "+1 416 555 0199")
    assert.equal(replaced.billingEmail, "bill@example.test")
    assert.deepEqual([replaced.channelChangeSource, replaced.channelChangeReference, replaced.channelChangeSender], ["COMPANY_VERBAL_CONFIRMED", "call of Oct 19", "a@b.test"])
    assert.deepEqual(V.channelReplacements(edit({ phone: "+1 416 555 0199", billingEmail: "bill@example.test" }), base).map((entry) => entry.name), ["phone"], "a first value is recorded directly, only the replacement waits")

    // a value set on a channel that HAD one (removed since) is a replacement too; only the very first value of a channel is direct
    const removedBefore = V.valuesFromRecords(null, { ...profile, phone: "" })
    const again = { ...removedBefore, phone: "+1 905 555 0123" }
    assert.deepEqual(V.channelReplacements(again, removedBefore, null), [])
    assert.deepEqual(V.channelReplacements(again, removedBefore, { phone: true }).map((entry) => entry.name), ["phone"])
    assert.equal(V.buildPatch(again, removedBefore, options({ everRecorded: { phone: true }, replacement: { source: "STAFF_ENTRY", reference: "re-adding", sender: "" } })).channelChangeReference, "re-adding")

    // REMOVING an established value is a sensitive change too: it needs the same request context, and is marked as a removal
    const removal = V.channelReplacements(edit({ phone: "" }), base)
    assert.deepEqual(removal.map((entry) => [entry.name, entry.removal]), [["phone", true]])
    const removalPatch = V.buildPatch(edit({ phone: "" }), base, options({ replacement: { source: "COMPANY_WRITTEN_REQUEST", reference: "letter", sender: "" } }))
    assert.deepEqual([removalPatch.phone, removalPatch.channelChangeSource, removalPatch.channelChangeReference], ["", "COMPANY_WRITTEN_REQUEST", "letter"])
    assert.deepEqual(V.channelReplacements(edit({ billingEmail: "" }), base), [], "clearing something that was never set is nothing")

    const cleared = V.buildPatch(edit({ eldProvider: "" }), base, options())
    assert.deepEqual(cleared, { eldProvider: "" }, "a cleared field is an explicit, intentional clear")
    assert.deepEqual(V.buildPatch(edit({ dba: "Maple Freight" }), base, options({ dbaBasis: { kind: "BUSINESS_CONFIRMATION", reference: "call" } })).dbaBasis, "BUSINESS_CONFIRMATION")
  })

  it("the edit page keeps nothing in browser storage, guards unsaved changes, never reports success before the server does, and disables double submission", () => {
    const page = source("app/companies/[id]/edit/page.tsx")
    assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB/)
    assert.match(page, /beforeunload/)
    assert.match(page, /popstate/)
    assert.match(page, /savingRef\.current/)
    assert.match(page, /disabled=\{saving \|\| !dirty/)
    // success is shown only after the response is ok and the canonical record has been read again
    const save = page.slice(page.indexOf("const save = async"), page.indexOf("const cancel"))
    assert.ok(save.indexOf("if (!response.ok)") < save.indexOf('kind: "success"'))
    assert.ok(save.indexOf("await load()") < save.indexOf('kind: "success"'))
    assert.match(save, /the entered values stay exactly as typed/)
    assert.doesNotMatch(page, /router\.push\(`\/companies\/\$\{[^}]+\}\/profile`\)\s*\n\s*\} catch/, "a successful save does not navigate away before reconciling")
  })

  it("ending a service is never nested inside the Save form (a form inside a form silently breaks its submit)", () => {
    const page = source("app/companies/[id]/edit/page.tsx")
    const component = page.slice(page.indexOf("export default function EditCompanyPage"), page.indexOf("function ServiceLifecycle"))
    assert.ok(component.indexOf("<ServiceLifecycle") > component.indexOf("</form>"), "the lifecycle control is rendered after the closing </form>")
    assert.equal((component.match(/<form\b/g) ?? []).length, 1)
  })

  it("the confirmation UI offers no typed text as proof and the legal-name UI knows no Primary Contact authority", () => {
    const panel = source("src/components/company/CompanyActivityPanel.tsx")
    assert.match(panel, /disabled=\{busy \|\| !chosen \|\| !document\}/, "Confirm needs an established channel AND an evidence document")
    assert.match(panel, /confirmationEvidenceDocumentId: document/)
    assert.doesNotMatch(panel, /confirmationReference/, "a typed reference is not sent as proof")
    assert.match(panel, /recordedByYou/, "the recorder is told a different user must confirm")
    const legal = source("src/components/company/LegalNameChange.tsx")
    assert.doesNotMatch(legal, /PRIMARY_CONTACT|requesterIsPrimary/)
    assert.match(legal, /CUSTOMER_AUTHORITY/)
    for (const file of ["lib/company-changes/definitions.ts", "lib/company-changes/service.ts", "database/migrations/0036_company_change_accountability.sql"]) {
      assert.doesNotMatch(source(file).replace(/Primary Contact designation[^.]*\./g, ""), /'PRIMARY_CONTACT'|"PRIMARY_CONTACT"\s*,?\s*"VERIFIED/, `${file} must not accept PRIMARY_CONTACT as a requester basis`)
    }
  })

  it("the profile page shows no disabled placeholder controls and no static 'not recorded' explanation in place of data", () => {
    const page = source("app/companies/[id]/profile/page.tsx")
    assert.doesNotMatch(page, /Not available yet|Notes have no canonical storage|Save Note|Check Status|New Case/)
    assert.doesNotMatch(page, /no canonical home yet/i)
    assert.doesNotMatch(page, /localStorage|sessionStorage/)
  })
})
