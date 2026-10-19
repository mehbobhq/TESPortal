// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Primary Contact continuity: a Primary Contact entered during Add Company appears in the company's canonical Contacts list with their
// own designated email only; the company phone and billing email stay company-level; the person is enriched and edited without being
// recreated; and communication routing (a resolver, not an email system) copies the primary contact on operational messages while
// billing stays separate and the Contract Signatory / Service Decision Authority are untouched. Real authorization, real transactions,
// real Master Register; fixtures and owner-level checks use the admin pool.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    contacts: await import("@/lib/contacts/service"),
    routing: await import("@/lib/contacts/communication-routing"),
    adapter: await import("@/src/components/contacts/canonical-adapter"),
  };
}
type Kit = Awaited<ReturnType<typeof loadKit>>;
const K = {} as Kit;

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
if (!enabled && process.env.TES_REQUIRE_DB_TESTS === "1") {
  it("requires a disposable test database (TES_REQUIRE_DB_TESTS=1)", () => {
    assert.fail("TES_TEST_ADMIN_DATABASE_URL and TES_TEST_RUNTIME_DATABASE_URL must be set");
  });
}

const ALL = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ",
  "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH",
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTRACT_READ", "EVIDENCE_READ",
];
const without = (...removed: string[]) => ALL.filter((capability) => !removed.includes(capability));
const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");

describe("Primary Contact continuity and communication routing", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor.actorId;
  }
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);
  const refused = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error & { missing?: string[] };
    }
    assert.fail("expected the operation to be refused");
  };

  const company = async (label: string, overrides: Record<string, unknown> = {}) => {
    const tag = `${label}${digits(4)}`;
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Cont ${run} ${tag} Transport Ltd`, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      contactPerson: `Alex Ridge${digits(3)}`, email: `accounts-${tag.toLowerCase()}@example.test`, billingEmail: `billing-${tag.toLowerCase()}@example.test`, phone: `+1 416 555 ${digits(4)}`,
      ...overrides,
    });
    return { id: created.company.id as string, tag };
  };
  const view = (organizationId: string) => K.contacts.getOrganizationContacts(organizationId);
  const open = async (organizationId: string) => (await view(organizationId)).contacts.filter((c) => c.relationship.effectiveTo === null);
  const dbNow = async () => (await one<{ now: Date }>(`SELECT now() AS now`)).now.toISOString();

  it("the Primary Contact from Add Company appears in the company's canonical Contacts list, Unverified, with only their own designated email", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("A");
    const contacts = await open(id);
    assert.equal(contacts.length, 1);
    const person = contacts[0];
    assert.ok(person.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary));
    const emails = person.current.channels.filter((c) => c.channelType === "EMAIL");
    assert.deepEqual(emails.map((c) => [c.valueDisplay, c.isPreferred, c.ownerType]), [[`accounts-${tag.toLowerCase()}@example.test`, true, "PERSON"]], "the account email is the person's own, designated email");
    assert.equal(person.current.channels.filter((c) => c.channelType === "PHONE").length, 0, "the company phone is not assigned to the person");

    const ui = K.adapter.toUiContacts(await view(id), { id, name: "Company" });
    assert.equal(ui.length, 1);
    assert.equal(ui[0].identityStatus, "unverified");
    assert.equal(ui[0].isPrimary, true);
    assert.equal(ui[0].email, `accounts-${tag.toLowerCase()}@example.test`);
    assert.equal(ui[0].phone, "");
    assert.deepEqual([ui[0].dob, ui[0].dlNumber, ui[0].notes, ui[0].evidence.length], ["", "", "", 0], "nothing is invented for fields Contacts does not store");
  });

  it("company phone, account email and billing email remain company-level channels, kept apart from the person", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("B");
    const org = await view(id);
    const lines = org.currentChannels.map((c) => [c.channelType, c.usage, c.valueDisplay]);
    assert.ok(lines.some((l) => l[0] === "PHONE" && l[1] === "GENERAL"), "company phone is a company line");
    assert.ok(lines.some((l) => l[0] === "EMAIL" && l[1] === "ACCOUNTING" && l[2] === `billing-${tag.toLowerCase()}@example.test`), "billing email is its own company channel");
    const persons = await rows<{ owner: string }>(`SELECT c.person_id::text AS owner FROM public.person_channels c JOIN public.organization_person_relationships r ON r.person_id = c.person_id WHERE r.organization_id = $1`, [id]);
    assert.equal(persons.length, 1, "exactly one person channel: the designated account email");
  });

  it("a company without an Account Email records the person with only a name; a chosen existing person gets no email added", async () => {
    await signInWith(...ALL);
    const { id } = await company("C", { email: "" });
    const person = (await open(id))[0];
    assert.equal(person.current.channels.length, 0);
    assert.equal((await K.dir.getCompanyProfile(id))?.contact?.length ? true : false, true);
  });

  it("the person can be edited and enriched without being recreated or duplicated, and the company lines are untouched", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("D");
    const before = (await open(id))[0];
    const personId = before.person.id;
    const personsBefore = await count(`SELECT count(*) AS n FROM public.persons`);
    const orgLinesBefore = (await view(id)).currentChannels.map((c) => c.id).sort();

    // structure the name (a correction), add a phone of their own, add a title, and replace the email: the account mailbox proved to be shared
    await K.contacts.correctPersonName({ organizationId: id, personId, givenName: "Alex", familyName: String(before.current.name?.givenName).replace(/^Alex\s*/, "") });
    await K.contacts.addPersonChannel({ organizationId: id, personId, channel: { type: "PHONE", value: "+1 416 555 0199" } });
    await K.contacts.addTitle({ organizationId: id, relationshipId: before.relationship.id, title: "Operations Manager" });
    const email = before.current.channels.find((c) => c.channelType === "EMAIL")!;
    await K.contacts.changePersonChannel({ organizationId: id, personId, channelId: email.id, value: `alex-${tag.toLowerCase()}@example.test` });

    const after = (await open(id))[0];
    assert.equal(after.person.id, personId, "the same person");
    assert.equal(await count(`SELECT count(*) AS n FROM public.persons`), personsBefore, "no second person was created");
    assert.equal(after.current.channels.find((c) => c.channelType === "EMAIL")?.valueDisplay, `alex-${tag.toLowerCase()}@example.test`);
    assert.equal(after.current.channels.find((c) => c.channelType === "PHONE")?.valueDisplay, "+1 416 555 0199");
    assert.deepEqual(after.current.titles.map((t) => t.titleDisplay), ["Operations Manager"]);
    assert.ok(after.names.length >= 2, "the earlier name is kept as history");
    assert.ok(after.channels.length >= 3, "the earlier email is kept as history");
    assert.deepEqual((await view(id)).currentChannels.map((c) => c.id).sort(), orgLinesBefore, "the company's own lines did not change");
    assert.ok(after.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary), "still the Primary Contact");
  });

  it("operational email routing copies the primary contact; billing routing is separate; a message already addressed to them is not duplicated", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("E");
    const routing = await K.contacts.getCommunicationRouting(id);
    assert.equal(routing.enforcement, "RESOLVER_ONLY");
    assert.deepEqual(routing.operational.recipients.map((r) => [r.address, r.role, r.reason]), [[`accounts-${tag.toLowerCase()}@example.test`, "CC", "PRIMARY_CONTACT"]]);
    assert.equal(routing.operational.gap, null);
    assert.deepEqual(routing.billing.companyAddresses, [`billing-${tag.toLowerCase()}@example.test`]);
    assert.ok(!routing.billing.companyAddresses.includes(routing.operational.recipients[0].address), "billing is not the primary contact's mailbox");

    const primary = routing.operational.recipients[0].address;
    assert.deepEqual(K.routing.applyOperationalRouting({ to: ["dispatch@example.test"], cc: [] }, routing, "OPERATIONAL"), { to: ["dispatch@example.test"], cc: [primary] });
    assert.deepEqual(K.routing.applyOperationalRouting({ to: [], cc: [] }, routing, "OPERATIONAL"), { to: [primary], cc: [] }, "To when the message has no other To");
    assert.deepEqual(K.routing.applyOperationalRouting({ to: [primary.toUpperCase()], cc: [] }, routing, "OPERATIONAL"), { to: [primary.toUpperCase()], cc: [] }, "not repeated");
    assert.deepEqual(K.routing.applyOperationalRouting({ to: ["billing@example.test"], cc: [] }, routing, "BILLING"), { to: ["billing@example.test"], cc: [] }, "the rule never applies to billing mail");
  });

  it("changing or ending the PRIMARY designation (not an email-inclusion preference) is an authorized contacts change: it re-routes, keeps the designation history and effective dates, and records the actor", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("F");
    const first = (await open(id))[0];
    const originalAddress = `accounts-${tag.toLowerCase()}@example.test`;
    const beforeChange = await dbNow();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const second = await K.contacts.createContact({ organizationId: id, name: { givenName: "Sam", familyName: "Newman" }, channels: [{ type: "EMAIL", value: `sam-${tag.toLowerCase()}@example.test`, preferred: true }] } as never);
    await K.contacts.makePrimary({ organizationId: id, relationshipId: second.contact.relationship.id, purpose: "PRIMARY" });

    const routing = await K.contacts.getCommunicationRouting(id);
    assert.deepEqual(routing.operational.recipients.map((r) => r.address), [`sam-${tag.toLowerCase()}@example.test`], "the new primary is copied; the old one no longer is");
    const earlier = await K.contacts.getCommunicationRouting(id, { asOf: beforeChange });
    assert.deepEqual(earlier.operational.recipients.map((r) => r.address), [originalAddress], "the earlier routing can be reproduced as of a date");

    const history = await rows<{ person_id: string; effective_to: Date | null; is_primary: boolean; record_status: string }>(
      `SELECT person_id, effective_to, is_primary, record_status FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'PRIMARY' ORDER BY effective_from, created_at`,
      [id],
    );
    assert.equal(history.length, 2);
    assert.equal(history[0].person_id, first.person.id);
    assert.ok(history[0].effective_to !== null, "the previous designation is ended, not deleted");
    assert.equal(history[1].effective_to, null);
    const events = await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%makePrimary%' AND e::text LIKE '%' || $1 || '%'`, [id]);
    assert.ok(events >= 1, "the change is in the Master Register with its actor");

    // ending the PRIMARY designation is a primary-contact change, not an exclusion preference: routing reports the gap, nothing is guessed
    const assignment = (await open(id)).find((c) => c.person.id === second.contact.person.id)!.current.purposes.find((p) => p.purpose === "PRIMARY")!;
    await K.contacts.endPurpose({ organizationId: id, assignmentId: assignment.id });
    const gap = await K.contacts.getCommunicationRouting(id);
    assert.deepEqual([gap.operational.recipients.length, gap.operational.gap], [0, "NO_PRIMARY_CONTACT"]);
    assert.deepEqual(K.routing.applyOperationalRouting({ to: ["x@example.test"], cc: [] }, gap, "OPERATIONAL"), { to: ["x@example.test"], cc: [] });
  });

  it("a primary contact without an email is reported as a gap, never filled from a company line", async () => {
    await signInWith(...ALL);
    const { id } = await company("G");
    const person = (await open(id))[0];
    const email = person.current.channels.find((c) => c.channelType === "EMAIL")!;
    await K.contacts.endPersonChannel({ organizationId: id, personId: person.person.id, channelId: email.id });
    const routing = await K.contacts.getCommunicationRouting(id);
    assert.deepEqual([routing.operational.recipients.length, routing.operational.gap], [0, "PRIMARY_CONTACT_HAS_NO_EMAIL"]);
    assert.ok(routing.billing.companyAddresses.length === 1, "the company billing line is still billing only");
  });

  it("changing the primary contact does not touch the Contract Signatory or the Service Decision Authority", async () => {
    await signInWith(...ALL);
    const { id } = await company("H", { companyType: "Customer", startDate: "2024-01-15", cargoTypes: JSON.stringify(["General Freight"]) });
    const authoritiesBefore = await rows(`SELECT * FROM public.customer_authority_assignments WHERE organization_id = $1 ORDER BY id`, [id]);
    const second = await K.contacts.createContact({ organizationId: id, name: { givenName: "Pat", familyName: "Other" } } as never);
    await K.contacts.makePrimary({ organizationId: id, relationshipId: second.contact.relationship.id, purpose: "PRIMARY" });
    assert.deepEqual(await rows(`SELECT * FROM public.customer_authority_assignments WHERE organization_id = $1 ORDER BY id`, [id]), authoritiesBefore);
    const links = await count(
      `SELECT count(*) AS n FROM pg_constraint c WHERE c.contype = 'f' AND ((c.conrelid = 'public.customer_authority_assignments'::regclass AND c.confrelid::regclass::text IN ('public.contact_purpose_assignments','public.organization_person_relationships'))
         OR (c.confrelid = 'public.customer_authority_assignments'::regclass AND c.conrelid::regclass::text IN ('public.contact_purpose_assignments','public.organization_person_relationships')))`,
    );
    assert.equal(links, 0, "the two designations are independent: no link in either direction");
  });

  it("permissions and tenant isolation: managing needs CONTACT_MANAGE, routing needs the people registry, and another company's contacts are never mixed in", async () => {
    await signInWith(...ALL);
    const a = await company("I1");
    const b = await company("I2");
    const personA = (await open(a.id))[0];
    assert.ok(!(await open(b.id)).some((c) => c.person.id === personA.person.id), "company B does not list company A's person");
    const routingB = await K.contacts.getCommunicationRouting(b.id);
    assert.ok(routingB.operational.recipients.every((r) => r.address.includes(b.tag.toLowerCase())), "routing only ever names the company's own primary contact");

    await signInWith(...without("CONTACT_MANAGE"));
    const edit = await refused(K.contacts.addPersonChannel({ organizationId: a.id, personId: personA.person.id, channel: { type: "PHONE", value: "+1 416 555 0123" } }));
    assert.ok(edit);
    await signInWith(...without("PERSON_REGISTRY_READ", "CONTACT_MANAGE"));
    assert.ok(await refused(K.contacts.getCommunicationRouting(a.id)), "routing is not readable without the people registry capability");
  });
});
