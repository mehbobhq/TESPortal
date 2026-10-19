import assert from "node:assert/strict"
import { before, describe, it } from "node:test"

/** Pure unit tests for the contact corrections: identity-detail validation, the title rule, exclusion-aware routing and business-operation history. */
describe("contact identity details and routing (pure)", () => {
  let identity: typeof import("../../../lib/contact-identity/identity-details.ts")
  let save: typeof import("../../../lib/contacts/contact-save.ts")
  let routing: typeof import("../../../lib/contacts/communication-routing.ts")
  let adapter: typeof import("../../../src/components/contacts/canonical-adapter.ts")
  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs")
    identity = await import("@/lib/contact-identity/identity-details")
    save = await import("@/lib/contacts/contact-save")
    routing = await import("@/lib/contacts/communication-routing")
    adapter = await import("@/src/components/contacts/canonical-adapter")
  })

  it("accepts only real, plausible, past dates of birth", () => {
    assert.equal(identity.parseDateOfBirth("1985-03-09"), "1985-03-09")
    for (const bad of ["1985-02-30", "85-03-09", "1899-12-31", "2999-01-01", "", null, 5]) assert.throws(() => identity.parseDateOfBirth(bad), /date|plausible|future/i, String(bad))
  })

  it("prepares a licence: normalised number, issuing jurisdiction required, expiry not before issue", () => {
    const ok = identity.prepareLicence({ number: " d1234-56789 ", country: "ca", region: "on", licenceClass: "AZ", expiryDate: "2030-01-31" })
    assert.deepEqual([ok.normalized, ok.country, ok.region, ok.licenceClass, ok.expiryDate], ["D123456789", "CA", "ON", "AZ", "2030-01-31"])
    assert.throws(() => identity.prepareLicence({ number: "", country: "CA", region: "ON" }), /licence number/i)
    assert.throws(() => identity.prepareLicence({ number: "X1", country: "", region: "" }), /jurisdiction/i)
    assert.throws(() => identity.prepareLicence({ number: "X1", country: "CA", region: "ON", issueDate: "2025-01-01", expiryDate: "2024-01-01" }), /expire/i)
  })

  it("Primary Contact and Driver are not job titles", () => {
    assert.equal(save.isDesignationNotTitle(" Primary Contact "), true)
    assert.equal(save.isDesignationNotTitle("driver"), true)
    assert.equal(save.isDesignationNotTitle("Dispatcher"), false)
  })

  const base = (over: Record<string, unknown> = {}) => ({
    relationship: { id: "r1", organizationId: "o", personId: "p1", effectiveFrom: "2026-01-01T00:00:00.000000Z", effectiveTo: null, recordStatus: "active" },
    person: { id: "p1" },
    current: {
      name: { givenName: "Riley", familyName: "Hart" },
      channels: [{ channelType: "EMAIL", ownerType: "PERSON", valueDisplay: "riley@example.test", isPreferred: true }],
      titles: [],
      purposes: [{ purpose: "PRIMARY", isPrimary: true, effectiveFrom: "2026-01-01T00:00:00.000000Z" }],
    },
    asOf: null,
    ...over,
  })
  const view = (exclusions: unknown[] = []) => ({ organizationId: "o", channels: [], currentChannels: [], asOfChannels: null, contacts: [base()], operationalEmailExclusions: exclusions }) as never

  it("an exclusion keeps the primary contact off OPERATIONAL email without any other change, and ending it resumes the default", () => {
    const none = routing.resolveCommunicationRouting(view())
    assert.deepEqual(none.operational.recipients.map((r) => r.address), ["riley@example.test"])
    const excluded = routing.resolveCommunicationRouting(view([{ id: "x", relationshipId: "r1", recordStatus: "active", effectiveFrom: "2026-02-01T00:00:00.000000Z", effectiveTo: null, instructionSource: "COMPANY_WRITTEN_REQUEST" }]))
    assert.deepEqual([excluded.operational.recipients.length, excluded.operational.gap, excluded.operational.excluded?.source], [0, "PRIMARY_CONTACT_EXCLUDED", "COMPANY_WRITTEN_REQUEST"])
    const resumed = routing.resolveCommunicationRouting(view([{ id: "x", relationshipId: "r1", recordStatus: "active", effectiveFrom: "2026-02-01T00:00:00.000000Z", effectiveTo: "2026-03-01T00:00:00.000000Z", instructionSource: "COMPANY_WRITTEN_REQUEST" }]))
    assert.equal(resumed.operational.recipients.length, 1)
    // billing is never affected
    assert.deepEqual(excluded.billing, none.billing)
    assert.deepEqual(routing.applyOperationalRouting({ to: ["a@example.test"], cc: [] }, excluded, "OPERATIONAL"), { to: ["a@example.test"], cc: [] })
  })

  it("a corrected or voided exclusion never applies", () => {
    for (const recordStatus of ["corrected", "voided"]) {
      const r = routing.resolveCommunicationRouting(view([{ id: "x", relationshipId: "r1", recordStatus, effectiveFrom: "2026-02-01T00:00:00.000000Z", effectiveTo: null, instructionSource: "TES_DECISION" }]))
      assert.equal(r.operational.recipients.length, 1, recordStatus)
    }
  })

  it("creating a contact shows as ONE 'Contact Created' operation; later edits are separate meaningful revisions", () => {
    const t0 = "2026-05-01T10:00:00.000000Z"
    const contact = {
      relationship: { id: "r1", effectiveFrom: t0, effectiveTo: null, createdAt: t0 },
      person: { id: "p1", createdAt: t0 },
      names: [{ id: "n1", givenName: "Riley", familyName: "Hart", effectiveFrom: t0, effectiveTo: null, recordStatus: "active", changeReason: "INITIAL", createdAt: t0 }],
      channels: [
        { id: "c1", channelType: "EMAIL", usage: null, valueDisplay: "a@example.test", effectiveFrom: t0, effectiveTo: "2026-05-02T09:00:00.100000Z", recordStatus: "active", changeReason: "INITIAL", createdAt: t0 },
        { id: "c2", channelType: "EMAIL", usage: null, valueDisplay: "b@example.test", effectiveFrom: "2026-05-02T09:00:00.100000Z", effectiveTo: null, recordStatus: "active", changeReason: "CHANGE", createdAt: "2026-05-02T09:00:00.050000Z" },
      ],
      titles: [{ id: "t1", titleDisplay: "Dispatcher", effectiveFrom: t0, effectiveTo: null, recordStatus: "active", changeReason: "INITIAL", createdAt: t0 }],
      purposes: [{ id: "u1", purpose: "PRIMARY", isPrimary: true, effectiveFrom: t0, effectiveTo: null, recordStatus: "active", changeReason: "INITIAL", createdAt: t0 }],
      current: { name: null, channels: [], titles: [], purposes: [] },
    } as never
    const events = adapter.eventsOf(contact, "Acme")
    assert.equal(events.length, 2, JSON.stringify(events.map((e) => e.label)))
    assert.equal(events[1].label, "Contact Created")
    assert.match(events[1].summary, /Riley Hart was added/)
    assert.equal(events[0].label, "Contact Updated")
    assert.match(events[0].summary, /Email changed/)
  })

  it("a 'Primary Contact' title saved earlier is shown as General Contact, never as a role", () => {
    const [c] = adapter.toUiContacts({ currentChannels: [], contacts: [base({ current: { name: { givenName: "A", familyName: "B" }, channels: [], titles: [{ id: "t", titleDisplay: "Primary Contact" }], purposes: [{ id: "u", purpose: "PRIMARY", isPrimary: true }] } }) as never] }, { id: "o", name: "Acme" })
    assert.deepEqual([c.role, c.isPrimary], ["General Contact", true])
  })
})
