// Run with `pnpm test:auth`. Incident repair: the Company Profile and Contacts reads must keep working when migration 0035 has NOT been
// applied (ledger ending at 0034), must expose 0035's features only once it is, and must preserve existing data across the upgrade.
// The test detects which schema state the disposable database is in (MIGRATIONS_DIR can stop the runner at 0034) and asserts accordingly; when the
// database is at 0034 it then APPLIES 0035 to the same database and proves the same rows read back unchanged.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
const BASE = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ", "COMPANY_PROFILE_MANAGE",
  "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE",
  "CONTRACT_READ", "EVIDENCE_READ", "DRIVER_READ", "DRIVER_MANAGE",
];
const K: Record<string, any> = {};

describe("Company Profile and Contacts across the 0034 / 0035 schema states", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 6);

  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    K.db = await import("@/test/helpers/auth-db");
    K.dir = await import("@/lib/company-directory/service");
    K.contacts = await import("@/lib/contacts/service");
    K.ident = await import("@/lib/contact-identity/service");
    K.contracts = await import("@/lib/contracts/service");
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
  }
  const one = async <T = Record<string, any>>(sql: string) => ((await pools.admin.query(sql)).rows as T[])[0];
  const has0035 = async () => (await one<{ p: boolean }>(`SELECT to_regclass('public.organization_person_operational_email_exclusions') IS NOT NULL AS p`)).p;
  const refused = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error;
    }
    assert.fail("expected the operation to be refused");
  };

  const seed = async (label: string) => {
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Compat ${run} ${label} Transport Ltd`, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      contactPerson: `Pat Primary${label}`, email: `acct-${label.toLowerCase()}@example.test`, phone: "+1 416 555 0143", website: `https://${label.toLowerCase()}.example.test`, dba: "Compat Trading",
    });
    return created.company.id as string;
  };
  const pageData = async (id: string) => {
    const profile = await K.dir.getCompanyProfile(id);
    const view = await K.contacts.getOrganizationContacts(id);
    return {
      profile: { name: profile?.name, dba: profile?.dba, phone: profile?.phone, email: profile?.email, website: profile?.website, contact: profile?.contact, sections: profile?.sections },
      lookup: (await K.dir.getCompanyEditRecord(id)).companyName,
      contacts: view.contacts.map((c: any) => [c.person.id, c.current.name?.givenName, c.current.channels.map((x: any) => x.valueDisplay), c.current.purposes.map((p: any) => `${p.purpose}:${p.isPrimary}`)]),
      companyChannels: view.currentChannels.map((c: any) => [c.channelType, c.usage, c.valueDisplay]).sort(),
      features: view.features,
    };
  };

  it("both pages' reads work in whichever schema state the database is in, existing data is preserved across the 0035 upgrade, and 0035 features appear only once it exists", async () => {
    await signInWith(...BASE);
    const atStart = await has0035();
    const id = await seed("A");
    const other = await seed("B");
    const added = await K.contacts.createContact({ organizationId: id, name: { givenName: "Sam", familyName: "Second" }, titles: ["Dispatcher"], channels: [{ type: "EMAIL", value: "sam@example.test", preferred: true }] });
    await K.contacts.makePrimary({ organizationId: id, relationshipId: added.contact.relationship.id, purpose: "PRIMARY" });

    // --- the state the database is in now
    let before = await pageData(id);
    assert.ok(before.profile.name && before.lookup && before.contacts.length === 2, "profile, company lookup and contacts list all load");
    assert.equal(before.features.operationalEmailExclusions, atStart, "the view says what the schema supports");
    assert.deepEqual((await K.contacts.getOrganizationContacts(id)).operationalEmailExclusions, []);
    const identity = await K.ident.getContactIdentity(id, null);
    assert.equal(identity.verification, "NOT_VERIFIED");
    if (!atStart) {
      assert.equal(identity.available, false);
      assert.deepEqual(identity.access, { read: false, manage: false, licenceRead: false, licenceManage: false });
      // restricted / new features are refused EXPLICITLY, nothing is half-saved, nothing is silently skipped
      const person = before.contacts[0][0];
      assert.match((await refused(K.ident.saveContact({ organizationId: id, personId: person, name: { givenName: "Changed", familyName: "Name" }, identity: { dateOfBirth: "1990-01-01" } }))).message, /migration 0035/);
      assert.deepEqual((await pageData(id)).contacts, before.contacts, "the refused save rolled the contact change back");
      assert.match((await refused(K.contacts.excludeFromOperationalEmail({ organizationId: id, relationshipId: added.contact.relationship.id, source: "TES_DECISION", reference: "should be refused" }))).message, /migration 0035/);
    }

    // ordinary Contacts behaviour in EVERY schema state: atomic save, title, primary designation, routing
    const saved = await K.ident.saveContact({ organizationId: id, personId: added.contact.person.id, email: "sam2@example.test", title: "Director" });
    assert.deepEqual([...saved.changed].sort(), ["email", "title"]);
    assert.equal((await K.contacts.getCommunicationRouting(id)).operational.recipients[0].address, "sam2@example.test");
    assert.equal((await K.contacts.getOrganizationContacts(id)).contacts.filter((c: any) => c.current.purposes.some((p: any) => p.purpose === "PRIMARY" && p.isPrimary)).length, 1);
    // the contracts workspace (another caller of the contacts read) loads in every state and lists the company's people
    const workspace = await K.contracts.getContractsWorkspace(id);
    assert.equal(workspace.people.length, 2);
    // a missing company is a not-found in every state
    assert.match((await refused(K.contacts.getOrganizationContacts(randomUUID()))).message, /not found/i);
    assert.equal(await K.dir.getCompanyProfile(randomUUID()), null);
    const events = async () => Number((await one<{ n: string }>(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%${id}%'`)).n);
    const eventsBefore = await events();
    assert.ok(eventsBefore > 0);

    before = await pageData(id); // the state that must survive the upgrade

    // --- authorization and tenant isolation hold in either state
    const mine = (await K.contacts.getOrganizationContacts(id)).contacts.map((c: any) => c.person.id);
    const theirs = (await K.contacts.getOrganizationContacts(other)).contacts.map((c: any) => c.person.id);
    assert.equal(mine.some((p: string) => theirs.includes(p)), false, "another company's contacts never appear");
    assert.match((await refused(K.ident.getContactIdentity(id, theirs[0]))).message, /not found/i, "a person of another company is not readable through this company");
    await signInWith("ORGANIZATION_REGISTRY_READ");
    const limited = await K.dir.getCompanyProfile(id);
    assert.equal(limited?.sections.contacts, "not_permitted", "no PERSON_REGISTRY_READ: the section is withheld, not guessed");
    assert.match((await refused(K.contacts.getOrganizationContacts(id))).message, /not authorized|denied/i);
    await signInWith(...BASE);

    // --- apply 0035 to the SAME database (what the migration runner does in production) and prove nothing changed
    if (!atStart) {
      const sql = readFileSync(path.join(process.cwd(), "database/migrations/0035_person_identity_details_and_operational_email_exclusions.sql"), "utf8");
      await pools.admin.query(sql);
      for (const code of ["PERSON_IDENTITY_READ", "PERSON_IDENTITY_MANAGE"]) {
        // the capability exists but nobody holds it yet: the page loads, identity stays restricted
        assert.equal((await one<{ n: string }>(`SELECT count(*) AS n FROM public.capabilities WHERE code = '${code}'`)).n, "1");
      }
    }
    const after = await pageData(id);
    assert.deepEqual(after.profile, before.profile, "profile values are identical before and after the upgrade");
    assert.equal(after.lookup, before.lookup);
    assert.deepEqual(after.contacts, before.contacts, "contacts, their emails and the primary designation are identical");
    assert.deepEqual(after.companyChannels, before.companyChannels);
    assert.equal(await events(), eventsBefore, "existing Master Register events are preserved");
    assert.deepEqual([after.features.operationalEmailExclusions, after.features.migration0035], [true, "COMPLETE"]);
    const unprivileged = await K.ident.getContactIdentity(id, after.contacts[0][0]);
    assert.equal(unprivileged.available === false, false);
    assert.deepEqual([unprivileged.access.read, unprivileged.dateOfBirth, unprivileged.licence], [false, null, null], "without PERSON_IDENTITY_READ nothing identity-related is returned");
    // 0035 features now work for the same data
    const view = await K.contacts.excludeFromOperationalEmail({ organizationId: id, relationshipId: added.contact.relationship.id, source: "TES_DECISION", reference: "post-upgrade exclusion" });
    assert.equal(view.operationalEmailExclusions.length, 1);
    assert.equal((await K.contacts.getCommunicationRouting(id)).operational.gap, "PRIMARY_CONTACT_EXCLUDED");
    // an actor without CONTACT_MANAGE cannot exclude or resume
    await signInWith("PERSON_REGISTRY_READ", "ORGANIZATION_REGISTRY_READ");
    assert.match((await refused(K.contacts.resumeOperationalEmail({ organizationId: id, exclusionId: view.operationalEmailExclusions[0].id }))).message, /not authorized|denied/i);
    await signInWith(...BASE);

    // a GENUINE database error is not disguised as a missing feature: with SELECT revoked the read fails loudly, then recovers when restored
    const runtime = '"tes-backend@tes-production-510007.iam"';
    await pools.admin.query(`REVOKE SELECT ON public.organization_person_operational_email_exclusions FROM ${runtime}`);
    try {
      assert.match((await refused(K.contacts.getOrganizationContacts(id))).message, /permission denied/i);
    } finally {
      await pools.admin.query(`GRANT SELECT ON public.organization_person_operational_email_exclusions TO ${runtime}`);
    }
    assert.equal((await K.contacts.getOrganizationContacts(id)).operationalEmailExclusions.length, 1);

    // FAIL CLOSED after having been complete: an inconsistency appearing LATER is detected immediately (no stale "complete"), and a holder of the
    // identity capabilities gets no identity access until the schema is whole again
    await pools.admin.query(`ALTER TABLE public.person_birth_dates DISABLE ROW LEVEL SECURITY`);
    try {
      await signInWith(...BASE, "PERSON_IDENTITY_READ", "PERSON_IDENTITY_MANAGE");
      const broken = await K.contacts.getOrganizationContacts(id);
      assert.deepEqual([broken.features.migration0035, broken.features.operationalEmailExclusions], ["INCONSISTENT", false]);
      const noAccess = await K.ident.getContactIdentity(id, broken.contacts[0].person.id);
      assert.deepEqual([noAccess.available, noAccess.access.read, noAccess.access.manage], [false, false, false]);
      assert.match((await refused(K.ident.saveContact({ organizationId: id, personId: broken.contacts[0].person.id, identity: { dateOfBirth: "1991-02-03" } }))).message, /partly applied migration 0035/);
    } finally {
      await pools.admin.query(`ALTER TABLE public.person_birth_dates ENABLE ROW LEVEL SECURITY`);
    }
    const healed = await K.ident.getContactIdentity(id, after.contacts[0][0]);
    assert.deepEqual([healed.available === false, healed.access.read, healed.access.manage], [false, true, true], "capabilities are enforced again once the schema is complete (this actor holds them)");
    await signInWith(...BASE);
  });
});
