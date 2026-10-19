import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { before, describe, it } from "node:test"

const ROOT = process.cwd()
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")
const page = read("app/companies/[id]/contacts/page.tsx")
const lines = read("app/companies/[id]/contacts/company-lines.tsx")
const adapter = read("src/components/contacts/canonical-adapter.ts")

describe("Contacts page: one interface on canonical PostgreSQL records", () => {
  it("is a single page titled Contacts: no workspace tabs, no gate, no second interface", () => {
    assert.match(page, /section="Contacts"/)
    assert.doesNotMatch(page, /LegacyWorkspaceGate|LegacyContactsPage|CanonicalContacts\b|role="tablist"|browser-local|TES records/i)
    assert.equal(existsSync(path.join(ROOT, "app/companies/[id]/contacts/canonical-contacts.tsx")), false, "the second interface is gone")
  })

  it("keeps the established design: stats, directory with search and filters, inspector, manual add dialog", () => {
    for (const name of ["ContactStats", "ContactDirectory", "ContactInspector", "ManualContactDialog"]) assert.match(page, new RegExp(`<${name}`), name)
    assert.match(page, /CompanyWorkspaceHeader/)
  })

  it("holds no data of its own: no browser storage, no prototype keys, no local evidence store", () => {
    for (const code of [page, lines, adapter]) assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|tes_contacts|tes_companies|evidence-storage/i)
    assert.match(page, /fetch\(base/)
    assert.match(page, /const base = `\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/contacts`/)
    assert.doesNotMatch(page, /generateContactId|generateGlobalUserId|simulateOCRExtraction|persistContacts/)
  })

  it("disables, with an explanation, what Contacts cannot store: identity documents and Document / OCR intake", () => {
    assert.match(page, /OCR_UNAVAILABLE/)
    assert.match(page, /<button\s+type="button"\s+disabled\s+title=\{OCR_UNAVAILABLE\}/)
    assert.match(page, /identityFieldsNote=\{IDENTITY_NOT_STORED\}/)
    const inspector = read("src/components/contacts/ContactInspector.tsx")
    const dialog = read("src/components/contacts/ManualContactDialog.tsx")
    assert.match(inspector, /<fieldset disabled=\{!!identityFieldsNote\}/)
    assert.match(dialog, /<fieldset disabled=\{!!identityFieldsNote\}/)
  })

  it("never merges people by name and never recreates a person: duplicates are advisory, a restored contact is the same person", () => {
    assert.match(page, /nothing was merged/)
    assert.match(page, /action: "addRelationship", personId/)
    assert.doesNotMatch(page, /existingPerson|applyPrimaryRule/)
  })

  it("routes every write through the existing contacts API actions", () => {
    for (const action of ["createContact", "changeName", "correctName", "addPersonChannel", "changePersonChannel", "endPersonChannel", "addTitle", "changeTitle", "makePrimary", "endPurpose", "endRelationship", "addRelationship", "addChannel", "endChannel"]) {
      assert.match(page, new RegExp(`"${action}"`), action)
    }
    const route = read("app/api/companies/[id]/contacts/route.ts")
    for (const action of ["changePersonChannel", "correctPersonChannel", "addRelationship", "changeTitle"]) assert.match(route, new RegExp(`case "${action}"`), action)
    assert.match(route, /organizationId: id/)
    assert.doesNotMatch(route, /body\.organizationId/)
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
    assert.deepEqual([c.firstName, c.lastName, c.email, c.phone, c.identityStatus, c.isPrimary, c.role], ["Jane Roe", "", "", "", "unverified", true, "Primary Contact"])
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

describe("operational email inclusion is a separate concept with no canonical store yet", () => {
  const routing = readFileSync(path.join(process.cwd(), "lib/contacts/communication-routing.ts"), "utf8")
  it("documents that the exclusion preference is unsupported and names the minimal schema, keeping the default", () => {
    assert.match(routing, /OPERATIONAL_INCLUSION_OVERRIDE = \{ supported: false/)
    assert.match(routing, /effective-dated, audited table/)
    assert.match(routing, /CANNOT BE RECORDED TODAY/)
    assert.match(routing, /never require removing the person's email, changing the primary contact or ending the relationship|must never require removing the person's email, changing the primary contact or ending the relationship/)
  })
  it("does not offer end-email or end-primary as a way to stop copying the primary contact", () => {
    const page = readFileSync(path.join(process.cwd(), "app/companies/[id]/contacts/page.tsx"), "utf8")
    assert.doesNotMatch(page, /stop (copying|including)|exclude from (operational )?email/i)
  })
})
