// Run with `pnpm test:auth`. A PARTLY applied migration 0035 (here: row-level security switched off on one of its tables) must never be represented
// as supported and must never widen access: ordinary reads keep working, the 0035 features are reported off, 0035-only writes are refused
// explicitly with nothing changed, and an actor who HOLDS the identity capabilities still gets no identity access.
// (Own file: the schema state is read once per process when complete, so the inconsistency is created before the first service call.)

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
const ALL = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ", "COMPANY_PROFILE_MANAGE",
  "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE",
  "CONTRACT_READ", "EVIDENCE_READ", "DRIVER_READ", "DRIVER_MANAGE", "PERSON_IDENTITY_READ", "PERSON_IDENTITY_MANAGE",
];
const K: Record<string, any> = {};

describe("partly applied migration 0035", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];

  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    K.db = await import("@/test/helpers/auth-db");
    pools = K.db.openPools();
    // the inconsistency, BEFORE anything reads the schema state
    await pools.admin.query(`ALTER TABLE public.person_birth_dates DISABLE ROW LEVEL SECURITY`);
    K.dir = await import("@/lib/company-directory/service");
    K.contacts = await import("@/lib/contacts/service");
    K.ident = await import("@/lib/contact-identity/service");
  });
  after(async () => {
    await pools.admin.query(`ALTER TABLE public.person_birth_dates ENABLE ROW LEVEL SECURITY`);
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  it("is reported INCONSISTENT, keeps ordinary reads, refuses 0035-only writes, and grants no identity access even to a holder of the capabilities", async () => {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const rel = await fx.relationship(actor.actorId, "TES_STAFF");
    const asg = await fx.assignment(rel, { type: "SYSTEM" });
    for (const c of ALL) await fx.grant(rel, c, { assignmentId: asg });
    K.db.setClerkUser(actor.clerkSubject);

    const created = await K.dir.createCompanyDirectoryRecord({ companyName: `Incons ${Date.now()} Ltd`, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada", contactPerson: "Pat Primary", email: "a@example.test" });
    const id = created.company.id as string;
    const view = await K.contacts.getOrganizationContacts(id);
    assert.equal(view.features.migration0035, "INCONSISTENT");
    assert.equal(view.features.operationalEmailExclusions, false);
    assert.ok(await K.dir.getCompanyProfile(id), "the profile still loads");
    const person = view.contacts[0].person.id;
    const identity = await K.ident.getContactIdentity(id, person);
    assert.deepEqual([identity.available, identity.access, identity.dateOfBirth, identity.licence], [false, { read: false, manage: false, licenceRead: false, licenceManage: false }, null, null]);

    const nameBefore = view.contacts[0].current.name.givenName;
    const dob = await K.ident.saveContact({ organizationId: id, personId: person, name: { givenName: "Changed", familyName: "Name" }, identity: { dateOfBirth: "1990-01-01" } }).then(() => "saved", (e: Error) => e.message);
    assert.match(dob, /partly applied migration 0035/);
    assert.equal((await K.contacts.getOrganizationContacts(id)).contacts[0].current.name.givenName, nameBefore, "no partial write");
    const excl = await K.contacts.excludeFromOperationalEmail({ organizationId: id, relationshipId: view.contacts[0].relationship.id, source: "TES_DECISION", reference: "refused" }).then(() => "saved", (e: Error) => e.message);
    assert.match(excl, /partly applied migration 0035/);
    assert.equal((await pools.admin.query(`SELECT count(*) AS n FROM public.organization_person_operational_email_exclusions WHERE organization_id = $1`, [id])).rows[0].n, "0");
    // ordinary Contacts work continues
    assert.deepEqual((await K.ident.saveContact({ organizationId: id, personId: person, title: "Dispatcher" })).changed, ["title"]);
  });
});
