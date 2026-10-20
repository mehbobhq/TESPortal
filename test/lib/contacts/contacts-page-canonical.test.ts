import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { before, describe, it } from "node:test"

const ROOT = process.cwd()
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")
const page = read("app/companies/[id]/contacts/page.tsx")
const adapter = read("src/components/contacts/canonical-adapter.ts")

describe("Contacts page: one interface on canonical PostgreSQL records", () => {
  it("offers the original browser-local workspace first and this canonical page second, as two clearly labelled workspaces", () => {
    assert.match(page, /section="Contacts"/)
    assert.match(page, /<LegacyWorkspaceGate/)
    assert.match(page, /canonical=\{<CanonicalContactsPage \/>\}/)
    assert.match(page, /<LegacyContactsPage \/>/)
    assert.match(page, /testing\/prototype data, not canonical Production records/)
    // the canonical page itself is a separate function; the old second canonical interface stays gone
    assert.match(page, /function CanonicalContactsPage\(\)/)
    assert.equal(existsSync(path.join(ROOT, "app/companies/[id]/contacts/canonical-contacts.tsx")), false, "the second canonical interface is gone")
    assert.equal(existsSync(path.join(ROOT, "app/companies/[id]/contacts/legacy-contacts.tsx")), true, "the original workspace is restored")
  })

  it("keeps the established design: stats, directory with search and filters, inspector, manual add dialog", () => {
    for (const name of ["ContactStats", "ContactDirectory", "ContactInspector", "ManualContactDialog"]) assert.match(page, new RegExp(`<${name}`), name)
    assert.match(page, /CompanyWorkspaceHeader/)
  })

  it("holds no data of its own: no browser storage, no prototype keys, no local evidence store", () => {
    for (const code of [page, adapter]) assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|tes_contacts|tes_companies|evidence-storage/i)
    assert.match(page, /fetch\(base/)
    assert.match(page, /const base = `\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/contacts`/)
    assert.doesNotMatch(page, /generateContactId|generateGlobalUserId|simulateOCRExtraction|persistContacts/)
  })

  it("disables Document / OCR with an explanation, and gates identity fields on the actor's permissions (never on browser state)", () => {
    assert.match(page, /OCR_UNAVAILABLE/)
    assert.match(page, /<button\s+type="button"\s+disabled\s+title=\{OCR_UNAVAILABLE\}/)
    assert.match(page, /identityFieldsNote=\{identityAccess\?\.licenceManage \? undefined : IDENTITY_NO_PERMISSION\}/)
    assert.match(page, /\/identity/)
    const inspector = read("src/components/contacts/ContactInspector.tsx")
    const dialog = read("src/components/contacts/ManualContactDialog.tsx")
    assert.match(inspector, /<fieldset disabled=\{!!identityFieldsNote\}/)
    assert.match(dialog, /<fieldset disabled=\{!!identityFieldsNote\}/)
  })

  it("keeps identity verification separate from data entry, and has no Restrictions field", () => {
    assert.match(page, /does not verify identity/)
    for (const file of ["app/companies/[id]/contacts/page.tsx", "src/components/contacts/ContactInspector.tsx", "src/components/contacts/ManualContactDialog.tsx"]) {
      assert.doesNotMatch(read(file), /Restrictions|dlRestrictions/, file)
    }
    assert.doesNotMatch(adapter, /"verified"|identityStatus: "documented"/)
  })

  it("never merges people by name and never recreates a person: duplicates are advisory, a restored contact is the same person", () => {
    assert.match(page, /nothing was merged/)
    assert.match(page, /action: "restoreContact", personId/)
    assert.doesNotMatch(page, /existingPerson|applyPrimaryRule/)
  })

  it("saves a contact as ONE request (atomic on the server) and never repeats a save already in flight", () => {
    assert.match(page, /action: "saveContact"/)
    assert.match(page, /action: "createContactFull"/)
    assert.match(page, /if \(busy\) return false/)
    // the page no longer chains per-field requests for a save
    assert.doesNotMatch(page, /"changeName"|"correctName"|"addPersonChannel"|"endPersonChannel"|"changePersonChannel"|"addTitle"|"changeTitle"/)
    const route = read("app/api/companies/[id]/contacts/route.ts")
    for (const action of ["saveContact", "createContactFull", "restoreContact", "excludeFromOperationalEmail", "resumeOperationalEmail", "changePersonChannel", "correctPersonChannel", "addRelationship", "changeTitle"]) assert.match(route, new RegExp(`case "${action}"`), action)
    assert.match(route, /organizationId: id/)
    assert.doesNotMatch(route, /body\.organizationId/)
  })

  it("keeps Primary Contact a separate designation: not a title, not a dropdown option, and one badge/list/stat source", () => {
    const helpers = read("src/components/contacts/contact-helpers.ts")
    const roles = helpers.slice(helpers.indexOf("export const STANDARD_ROLES"), helpers.indexOf("];", helpers.indexOf("export const STANDARD_ROLES")))
    assert.doesNotMatch(roles, /Primary Contact"|"Driver"/)
    assert.match(read("src/components/contacts/ContactInspector.tsx"), /id="edit-is-primary"/)
    assert.match(read("src/components/contacts/ManualContactDialog.tsx"), /id="manual-primary"/)
    assert.doesNotMatch(read("src/components/contacts/ContactStats.tsx"), /Source|PostgreSQL records/)
  })

  it("the company profile links to the retained Contacts page", () => {
    assert.match(read("app/companies/[id]/profile/page.tsx"), /\/contacts\?person=/)
  })
})

describe("canonical adapter", () => {
  let A: typeof import("../../../src/components/contacts/canonical-adapter.ts")
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs")
    A = await import("@/src/components/contacts/canonical-adapter")
  })
  const channel = (over: Record<string, unknown>) => ({ id: "c", channelType: "EMAIL", usage: null, valueDisplay: "a@example.test", effectiveFrom: "2026-01-01T00:00:00Z", ...over }) as never
  const contact = (over: Record<string, unknown> = {}) =>
    ({
      relationship: { id: "r1", effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null },
      person: { id: "p1", recordStatus: "active" },
      current: { name: { givenName: "Jane Roe", familyName: null }, channels: [], titles: [], purposes: [{ id: "u", purpose: "PRIMARY", isPrimary: true }] },
      ...over,
    }) as never

  it("maps a person with only a name; identity is Unverified and nothing is invented", () => {
    const [c] = A.toUiContacts({ currentChannels: [], contacts: [contact()] }, { id: "o", name: "Acme" })
    assert.deepEqual([c.firstName, c.lastName, c.email, c.phone, c.identityStatus, c.isPrimary, c.role], ["Jane Roe", "", "", "", "unverified", true, "General Contact"])
    assert.deepEqual([c.dob, c.dlNumber, c.notes, c.evidence.length], ["", "", "", 0])
  })

  it("the person's designated email wins; company channels are never read as the person's", () => {
    const view = { currentChannels: [channel({ id: "org", usage: "ACCOUNTING", valueDisplay: "billing@example.test" })], contacts: [contact({ current: { name: { givenName: "A", familyName: "B" }, channels: [channel({ id: "x", valueDisplay: "other@example.test" }), channel({ id: "y", valueDisplay: "main@example.test", isPreferred: true })], titles: [], purposes: [] } })] }
    const [c] = A.toUiContacts(view, { id: "o", name: "Acme" })
    assert.equal(c.email, "main@example.test")
    assert.equal(c.phone, "")
  })

  it("one entry per person: the open relationship wins over an earlier ended one; an ended contact is shown as archived", () => {
    const ended = contact({ relationship: { id: "r0", effectiveFrom: "2025-01-01T00:00:00Z", effectiveTo: "2025-06-01T00:00:00Z" } })
    const reopened = contact({ relationship: { id: "r1", effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null } })
    const both = A.toUiContacts({ currentChannels: [], contacts: [ended, reopened] }, { id: "o", name: "Acme" })
    assert.equal(both.length, 1)
    assert.equal(both[0].isArchived, false)
    const only = A.toUiContacts({ currentChannels: [], contacts: [ended] }, { id: "o", name: "Acme" })
    assert.equal(only[0].isArchived, true)
    assert.equal(only[0].isPrimary, false, "an ended relationship is not a current primary designation")
  })
})

describe("operational email inclusion is its own audited record", () => {
  const routing = read("lib/contacts/communication-routing.ts")
  it("documents the exclusion record and that it never ends an email, the relationship or the Primary Contact designation", () => {
    assert.match(routing, /organization_person_operational_email_exclusions/)
    assert.match(routing, /WITHOUT touching the person, their email, their relationship or the PRIMARY designation/)
    assert.doesNotMatch(routing, /CANNOT BE RECORDED TODAY|OPERATIONAL_INCLUSION_OVERRIDE/)
  })
  it("the page offers it as a distinct control, never as ending the email, the relationship or the designation", () => {
    assert.match(page, /action: "excludeFromOperationalEmail"/)
    assert.match(page, /action: "resumeOperationalEmail"/)
    assert.match(read("src/components/contacts/ContactInspector.tsx"), /Stop copying on operational email/)
  })
})

describe("company phone and email are managed on the Company Profile, not on Contacts", () => {
  it("has no Company phone & email section, and the page posts no company-channel action", () => {
    assert.equal(existsSync(path.join(process.cwd(), "app/companies/[id]/contacts/company-lines.tsx")), false)
    assert.doesNotMatch(page, /CompanyLines|company-lines|Company phone|Add line/i)
    assert.doesNotMatch(page, /action: "(addChannel|endChannel)"/)
  })
  it("keeps the person-level email editing (the save sends the person's own email; the server decides add, change or end)", () => {
    assert.match(page, /email: \(editFormData\.email \?\? ""\)\.trim\(\)/)
    assert.match(read("lib/contacts/contact-save.ts"), /addPersonChannel|changePersonChannel|endPersonChannel/)
  })
})
