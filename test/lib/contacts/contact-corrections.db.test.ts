// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Contacts corrections: an ATOMIC, idempotent contact save (a change that persisted is never reported as failed); restricted identity
// details (date of birth in person_birth_dates, licence in the canonical driver_licences) behind their own capabilities, tenant scoped,
// never verifying identity and never copied into the Master Register; and the audited operational-email exclusion that changes NEITHER the
// person, their email, their relationship NOR the Primary Contact designation. Real authorization, real transactions, real Master Register.

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
    ident: await import("@/lib/contact-identity/service"),
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

const BASE = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ",
  "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH",
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTRACT_READ", "EVIDENCE_READ",
];
const IDENTITY = ["PERSON_IDENTITY_READ", "PERSON_IDENTITY_MANAGE", "DRIVER_READ", "DRIVER_MANAGE"];
const ALL = [...BASE, ...IDENTITY];
const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");

describe("Contacts corrections: atomic save, identity details, operational-email exclusions", { skip: !enabled }, () => {
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
      return error as Error;
    }
    assert.fail("expected the operation to be refused");
  };

  const company = async (label: string) => {
    const tag = `${label}${digits(4)}`;
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Corr ${run} ${tag} Transport Ltd`, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      contactPerson: `Alex Ridge${digits(3)}`, email: `accounts-${tag.toLowerCase()}@example.test`, billingEmail: `billing-${tag.toLowerCase()}@example.test`, phone: `+1 416 555 ${digits(4)}`,
    });
    return { id: created.company.id as string, tag };
  };
  const view = (organizationId: string, options?: { asOf?: string }) => K.contacts.getOrganizationContacts(organizationId, options);
  const primaryOf = async (organizationId: string) => (await view(organizationId)).contacts.find((c) => c.relationship.effectiveTo === null)!;

  it("a save is ONE transaction: it applies every difference, and a refused save changes NOTHING", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("A");
    const before = await primaryOf(id);
    const personId = before.person.id;

    const saved = await K.ident.saveContact({ organizationId: id, personId, name: { givenName: "Riley", familyName: "Hart" }, email: `riley-${tag.toLowerCase()}@example.test`, phone: "+1 905 555 0111", title: "Dispatcher", primary: true });
    assert.deepEqual([...saved.changed].sort(), ["email", "name", "phone", "title"], "the primary designation already stood, so it is not rewritten");
    const after = await primaryOf(id);
    assert.equal(after.current.name?.givenName, "Riley");
    assert.equal(after.current.titles[0].titleDisplay, "Dispatcher");

    // a save with a bad value refuses as a whole: the name change that came first is rolled back with it
    const nameBefore = after.current.name?.familyName;
    const error = await refused(K.ident.saveContact({ organizationId: id, personId, name: { givenName: "Renamed", familyName: "Person" }, email: "not-an-email" }));
    assert.match(error.message, /email|valid/i);
    assert.equal((await primaryOf(id)).current.name?.familyName, nameBefore, "nothing from the refused save persisted");
    assert.equal(await count(`SELECT count(*) AS n FROM public.person_name_versions WHERE person_id = $1`, [personId]), (await rows(`SELECT 1 FROM public.person_name_versions WHERE person_id = $1`, [personId])).length);
  });

  it("repeating a save (a double click) is a harmless no-op, and concurrent identical saves both succeed without duplicating anything", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("B");
    const personId = (await primaryOf(id)).person.id;
    const payload = { organizationId: id, personId, email: `once-${tag.toLowerCase()}@example.test`, title: "Fleet Manager" };
    const [a, b] = await Promise.all([K.ident.saveContact(payload), K.ident.saveContact(payload)]);
    assert.deepEqual([a.changed.length + b.changed.length], [2], "exactly one of them applied email and title; the other found nothing to do");
    const again = await K.ident.saveContact(payload);
    assert.deepEqual(again.changed, []);
    assert.equal(await count(`SELECT count(*) AS n FROM public.person_channels WHERE person_id = $1 AND channel_type = 'EMAIL'`, [personId]), 2, "the original and the changed email only");
    assert.equal(await count(`SELECT count(*) AS n FROM public.organization_person_titles WHERE relationship_id = $1 AND record_status = 'active'`, [(await primaryOf(id)).relationship.id]), 1);
  });

  it("Primary Contact and Driver are refused as job titles, on save and on create", async () => {
    await signInWith(...ALL);
    const { id } = await company("C");
    const personId = (await primaryOf(id)).person.id;
    for (const title of ["Primary Contact", "driver"]) {
      assert.match((await refused(K.ident.saveContact({ organizationId: id, personId, title }))).message, /not job titles/i);
      assert.match((await refused(K.ident.createContactWithDetails({ organizationId: id, name: { givenName: "Sam" }, title }))).message, /not job titles/i);
    }
  });

  it("create is one operation: person, relationship, own email, title and the Primary Contact designation (the previous designation is ended, not deleted)", async () => {
    await signInWith(...ALL);
    const { id, tag } = await company("D");
    const old = await primaryOf(id);
    const created = await K.ident.createContactWithDetails({ organizationId: id, name: { givenName: "Sam", familyName: `Newman${tag}` }, email: `sam-${tag.toLowerCase()}@example.test`, phone: "+1 905 555 0222", title: "Director", primary: true });
    assert.equal(created.contact.current.purposes.some((p) => p.purpose === "PRIMARY" && p.isPrimary), true);
    const statuses = await rows<{ open: boolean }>(`SELECT (effective_to IS NULL) AS open FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'PRIMARY' AND record_status = 'active' ORDER BY effective_from, created_at`, [id]);
    assert.deepEqual(statuses.map((r) => r.open), [false, true]);
    assert.equal((await view(id)).contacts.find((c) => c.person.id === old.person.id)!.current.purposes.length, 0);
  });

  it("restoring a contact is one transaction and re-associates the SAME person", async () => {
    await signInWith(...ALL);
    const { id } = await company("E");
    const contact = await primaryOf(id);
    await K.contacts.endRelationship({ organizationId: id, relationshipId: contact.relationship.id });
    const personCount = await count(`SELECT count(*) AS n FROM public.persons`);
    const restored = await K.contacts.restoreContact({ organizationId: id, personId: contact.person.id });
    assert.equal(restored.person.id, contact.person.id);
    assert.equal(await count(`SELECT count(*) AS n FROM public.persons`), personCount, "no person was created");
    assert.equal(await count(`SELECT count(*) AS n FROM public.organization_person_relationships WHERE organization_id = $1 AND person_id = $2`, [id, contact.person.id]), 2);
  });

  describe("restricted identity details", () => {
    it("date of birth: recorded, then CORRECTED (the wrong row is kept, flagged and linked); clearing voids it; never verified; never in the Master Register", async () => {
      await signInWith(...ALL);
      const { id } = await company("F");
      const personId = (await primaryOf(id)).person.id;
      await K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: "1985-03-09" } });
      assert.equal((await K.ident.getContactIdentity(id, personId)).dateOfBirth, "1985-03-09");
      const second = await K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: "1985-09-03" } });
      assert.deepEqual(second.changed, ["dateOfBirth"]);
      const history = await rows<{ record_status: string; linked: boolean }>(`SELECT record_status, (superseded_by_id IS NOT NULL) AS linked FROM public.person_birth_dates WHERE person_id = $1 ORDER BY created_at`, [personId]);
      assert.deepEqual(history.map((r) => [r.record_status, r.linked]), [["corrected", true], ["active", false]]);
      assert.deepEqual((await K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: "1985-09-03" } })).changed, [], "the same value is not rewritten");
      const identity = await K.ident.getContactIdentity(id, personId);
      assert.equal(identity.verification, "NOT_VERIFIED");
      assert.equal(K.adapter.toUiContacts(await view(id), { id, name: "C" })[0].identityStatus, "unverified");
      assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%1985-03-09%' OR e::text LIKE '%1985-09-03%'`), 0, "a date of birth is never copied into the Master Register");
      await K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: null } });
      assert.equal((await K.ident.getContactIdentity(id, personId)).dateOfBirth, null);
      assert.equal(await count(`SELECT count(*) AS n FROM public.person_birth_dates WHERE person_id = $1 AND record_status = 'voided'`, [personId]), 1, "voided, never deleted");
    });

    it("licence: recorded in the canonical driver_licences (no company-driver relationship, no conflicting copy); corrected without losing the wrong row; a number held by ANOTHER person is refused", async () => {
      await signInWith(...ALL);
      const { id } = await company("G");
      const other = await company("H");
      const personId = (await primaryOf(id)).person.id;
      const otherPerson = (await primaryOf(other.id)).person.id;
      const number = `D${digits(9)}`;
      await K.ident.saveContact({ organizationId: id, personId, identity: { licence: { number, country: "CA", region: "ON", licenceClass: "AZ", expiryDate: "2030-01-31" } } });
      const licence = (await K.ident.getContactIdentity(id, personId)).licence!;
      assert.deepEqual([licence.number, licence.region, licence.licenceClass, licence.expiryDate], [number, "ON", "AZ", "2030-01-31"]);
      assert.equal(await count(`SELECT count(*) AS n FROM public.organization_driver_relationships WHERE person_id = $1`, [personId]), 0, "recording a licence does not make the contact a company Driver");
      assert.equal(await count(`SELECT count(*) AS n FROM public.driver_profiles WHERE person_id = $1`, [personId]), 1);

      const corrected = await K.ident.saveContact({ organizationId: id, personId, identity: { licence: { number, country: "CA", region: "ON", licenceClass: "G", expiryDate: "2031-01-31" } } });
      assert.deepEqual(corrected.changed, ["licence"]);
      assert.deepEqual((await rows<{ record_status: string }>(`SELECT record_status FROM public.driver_licences WHERE person_id = $1 ORDER BY created_at`, [personId])).map((r) => r.record_status), ["corrected", "active"]);

      const clash = await refused(K.ident.saveContact({ organizationId: other.id, personId: otherPerson, name: { givenName: "Changed", familyName: "Name" }, identity: { licence: { number, country: "CA", region: "ON" } } }));
      assert.match(clash.message, /already recorded for another person/i);
      assert.doesNotMatch(clash.message, new RegExp(personId));
      assert.notEqual((await primaryOf(other.id)).current.name?.givenName, "Changed", "the whole save rolled back");
      assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [number]), 0, "a licence number is never copied into the Master Register");
      const voided = await K.ident.saveContact({ organizationId: id, personId, identity: { licence: null } });
      assert.deepEqual(voided.changed, ["licence"]);
    });

    it("each part needs its own capability, and a refusal rolls the whole save back", async () => {
      await signInWith(...ALL);
      const { id } = await company("I");
      const personId = (await primaryOf(id)).person.id;

      await signInWith(...BASE);
      const denied = await refused(K.ident.saveContact({ organizationId: id, personId, name: { givenName: "Nope", familyName: "Nope" }, identity: { dateOfBirth: "1990-01-01" } }));
      assert.match(denied.message, /not authorized|denied/i);
      assert.notEqual((await primaryOf(id)).current.name?.givenName, "Nope", "the contact change rolled back with the refused identity part");
      const view1 = await K.ident.getContactIdentity(id, personId);
      assert.deepEqual([view1.access.read, view1.access.manage, view1.dateOfBirth, view1.licence], [false, false, null, null], "no identity data without PERSON_IDENTITY_READ");

      await signInWith(...BASE, "PERSON_IDENTITY_READ", "PERSON_IDENTITY_MANAGE");
      await K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: "1990-01-01" } });
      const noLicence = await refused(K.ident.saveContact({ organizationId: id, personId, identity: { licence: { number: "X123", country: "CA", region: "ON" } } }));
      assert.match(noLicence.message, /not authorized|denied/i, "a licence also needs DRIVER_MANAGE");
      const partial = await K.ident.getContactIdentity(id, personId);
      assert.deepEqual([partial.access.read, partial.access.licenceRead, partial.access.licenceManage, partial.dateOfBirth, partial.licence], [true, false, false, "1990-01-01", null]);

      await signInWith("CONTACT_MANAGE", "PERSON_REGISTRY_READ", "PERSON_IDENTITY_READ");
      assert.match((await refused(K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: "1991-01-01" } }))).message, /not authorized|denied/i, "read does not imply manage");
    });

    it("tenant isolation: a person of another company is never read or changed through this company", async () => {
      await signInWith(...ALL);
      const a = await company("J");
      const b = await company("K");
      const personB = (await primaryOf(b.id)).person.id;
      await K.ident.saveContact({ organizationId: b.id, personId: personB, identity: { dateOfBirth: "1980-05-05" } });
      assert.match((await refused(K.ident.getContactIdentity(a.id, personB))).message, /not found/i);
      assert.match((await refused(K.ident.saveContact({ organizationId: a.id, personId: personB, identity: { dateOfBirth: "1999-09-09" } }))).message, /not found/i);
      assert.equal((await K.ident.getContactIdentity(b.id, personB)).dateOfBirth, "1980-05-05", "unchanged");
      assert.match((await refused(K.ident.getContactIdentity(a.id, "not-a-uuid"))).message, /uuid/i);
    });

    it("the database refuses what the service would: a future date of birth, a second current one, deleting, and rewriting content", async () => {
      await signInWith(...ALL);
      const { id } = await company("L");
      const personId = (await primaryOf(id)).person.id;
      await K.ident.saveContact({ organizationId: id, personId, identity: { dateOfBirth: "1970-01-01" } });
      const dob = await one<{ id: string }>(`SELECT id FROM public.person_birth_dates WHERE person_id = $1 AND record_status = 'active'`, [personId]);
      await assert.rejects(pools.admin.query(`INSERT INTO public.person_birth_dates (person_id, date_of_birth) VALUES ($1, '2999-01-01')`, [personId]), /future|unique/i);
      await assert.rejects(pools.admin.query(`INSERT INTO public.person_birth_dates (person_id, date_of_birth) VALUES ($1, '1971-01-01')`, [personId]), /unique/i);
      await assert.rejects(pools.admin.query(`DELETE FROM public.person_birth_dates WHERE id = $1`, [dob.id]), /append-preserving/);
      await assert.rejects(pools.admin.query(`UPDATE public.person_birth_dates SET date_of_birth = '1971-01-01' WHERE id = $1`, [dob.id]), /immutable/);
    });
  });

  describe("operational-email exclusion", () => {
    it("excludes the Primary Contact from OPERATIONAL email without touching the person, their email, their relationship or the PRIMARY designation; history, as-of and resume work; billing is untouched", async () => {
      await signInWith(...ALL);
      const { id, tag } = await company("M");
      const contact = await primaryOf(id);
      const address = `accounts-${tag.toLowerCase()}@example.test`;
      const snapshot = async () => ({
        emails: await count(`SELECT count(*) AS n FROM public.person_channels WHERE person_id = $1 AND effective_to IS NULL AND record_status = 'active'`, [contact.person.id]),
        relationships: await count(`SELECT count(*) AS n FROM public.organization_person_relationships WHERE id = $1 AND effective_to IS NULL`, [contact.relationship.id]),
        primary: await count(`SELECT count(*) AS n FROM public.contact_purpose_assignments WHERE relationship_id = $1 AND purpose_code = 'PRIMARY' AND effective_to IS NULL AND record_status = 'active'`, [contact.relationship.id]),
      });
      const before = await snapshot();
      const billingBefore = (await K.contacts.getCommunicationRouting(id)).billing;
      await new Promise((resolve) => setTimeout(resolve, 30));
      const beforeInstruction = (await one<{ now: Date }>(`SELECT now() AS now`)).now.toISOString();
      await new Promise((resolve) => setTimeout(resolve, 30));

      assert.match((await refused(K.contacts.excludeFromOperationalEmail({ organizationId: id, relationshipId: contact.relationship.id, source: "COMPANY_WRITTEN_REQUEST", reference: "x" }))).message, /how the instruction/i, "a reference to the instruction is required");
      await K.contacts.excludeFromOperationalEmail({ organizationId: id, relationshipId: contact.relationship.id, source: "COMPANY_WRITTEN_REQUEST", reference: "email from the company, subject: stop copying the account mailbox" });

      const routing = await K.contacts.getCommunicationRouting(id);
      assert.deepEqual([routing.operational.recipients.length, routing.operational.gap, routing.operational.excluded?.source], [0, "PRIMARY_CONTACT_EXCLUDED", "COMPANY_WRITTEN_REQUEST"]);
      assert.deepEqual(await snapshot(), before, "the person's email, the relationship and the PRIMARY designation are all unchanged");
      assert.deepEqual(routing.billing, billingBefore, "billing routing is separate and untouched");
      assert.deepEqual(K.routing.applyOperationalRouting({ to: ["dispatch@example.test"], cc: [] }, routing, "OPERATIONAL"), { to: ["dispatch@example.test"], cc: [] });
      assert.deepEqual((await K.contacts.getCommunicationRouting(id, { asOf: beforeInstruction })).operational.recipients.map((r) => r.address), [address], "the earlier routing can be reproduced as of a date");
      assert.match((await refused(K.contacts.excludeFromOperationalEmail({ organizationId: id, relationshipId: contact.relationship.id, source: "TES_DECISION", reference: "again" }))).message, /already excluded/i);

      const event = await one<{ n: string }>(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%excludeFromOperationalEmail%' AND e::text LIKE '%' || $1 || '%'`, [id]);
      assert.ok(Number(event.n) >= 1, "the instruction is in the Master Register with its actor");

      const exclusion = (await view(id)).operationalEmailExclusions.find((e) => e.effectiveTo === null)!;
      await K.contacts.resumeOperationalEmail({ organizationId: id, exclusionId: exclusion.id });
      assert.deepEqual((await K.contacts.getCommunicationRouting(id)).operational.recipients.map((r) => r.address), [address], "the default resumes");
      const kept = await rows<{ open: boolean }>(`SELECT (effective_to IS NULL) AS open FROM public.organization_person_operational_email_exclusions WHERE organization_id = $1`, [id]);
      assert.deepEqual(kept.map((r) => r.open), [false], "the exclusion is ended, never deleted");
      assert.deepEqual(await snapshot(), before);
    });

    it("needs CONTACT_MANAGE, is tenant scoped, and its evidence must belong to the same company", async () => {
      await signInWith(...ALL);
      const a = await company("N");
      const b = await company("O");
      const contactA = await primaryOf(a.id);
      const contactB = await primaryOf(b.id);
      const evidenceB = await one<{ id: string }>(
        `INSERT INTO public.evidence_documents (organization_id, document_type, document_title, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel)
         VALUES ($1, 'WRITTEN_REQUEST', 'Request', 'tes-test-bucket', $2, $3, 'application/pdf', 100, 'staff_upload') RETURNING id`,
        [b.id, `evidence/${randomUUID()}.pdf`, "a".repeat(64)],
      );
      const wrongCompany = await refused(K.contacts.excludeFromOperationalEmail({ organizationId: a.id, relationshipId: contactA.relationship.id, source: "COMPANY_WRITTEN_REQUEST", reference: "letter on file", evidenceDocumentId: evidenceB.id }));
      assert.match(wrongCompany.message, /not found|evidence/i);
      assert.equal(await count(`SELECT count(*) AS n FROM public.organization_person_operational_email_exclusions WHERE organization_id = $1`, [a.id]), 0);
      assert.match((await refused(K.contacts.excludeFromOperationalEmail({ organizationId: a.id, relationshipId: contactB.relationship.id, source: "TES_DECISION", reference: "other company relationship" }))).message, /not found/i);

      await signInWith("PERSON_REGISTRY_READ");
      assert.match((await refused(K.contacts.excludeFromOperationalEmail({ organizationId: a.id, relationshipId: contactA.relationship.id, source: "TES_DECISION", reference: "no authority" }))).message, /not authorized|denied/i);
    });
  });
});
