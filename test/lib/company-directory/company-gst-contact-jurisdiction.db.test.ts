// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Add Company simplification (migration 0034): the GST/HST program account, the single Primary Contact field, and explicitly
// unresolved MVID / NSC / IRP / IFTA jurisdictions. Everything runs through the REAL authorization wrappers and the RUNTIME role
// (row-level security applies) with the real Master Register; fixtures and owner-level checks use the admin pool.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    input: await import("@/lib/company-directory/creation-input"),
    create: await import("@/lib/company-directory/create-company"),
    authorities: await import("@/lib/operating-authorities/service"),
    tax: await import("@/lib/tax-registrations/service"),
    contacts: await import("@/lib/contacts/service"),
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
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("");

describe("Add Company: GST/HST, Primary Contact and unresolved jurisdictions (migration 0034)", { skip: !enabled }, () => {
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
  const rejected = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error & { issues?: Array<{ field: string; message: string }>; missing?: string[]; code?: string };
    }
    assert.fail("expected the operation to be refused");
  };

  const payload = (label: string, overrides: Record<string, unknown> = {}) => ({
    companyName: `Gst ${run} ${label}${digits(4)} Transport Ltd`,
    companyType: "Owner Operator",
    opRegion: "Canada Only",
    regCorpState: "ON",
    regCorpCountry: "Canada",
    ...overrides,
  });
  const gstFor = (bn: string, reference = "0001") => `${bn} RT ${reference}`;
  const eventCount = (organizationId: string) => count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [organizationId]);
  const registrationRows = (organizationId: string, program: string) =>
    rows<{ id: string; record_status: string; number_display: string; number_normalized: string; jurisdiction_country: string | null; jurisdiction_region: string | null; version_status: string; reason: string }>(
      `SELECT r.id, r.record_status, v.number_display, v.number_normalized, v.jurisdiction_country, v.jurisdiction_region, v.record_status AS version_status, v.version_reason AS reason
         FROM public.registrations r JOIN public.registration_versions v ON v.registration_id = r.id
        WHERE r.organization_id = $1 AND r.program_code = $2 ORDER BY v.created_at, v.id`,
      [organizationId, program],
    );

  // ===========================================================================================================
  describe("GST/HST account", () => {
    it("is saved on creation as a GST_HST tax registration, shown on the profile, and recorded in the Master Register", async () => {
      await signInWith(...ALL);
      const bn = digits(9);
      const created = await K.dir.createCompanyDirectoryRecord(payload("A", { businessNo: bn, gstHst: gstFor(bn) }));
      const id = created.company.id;
      const registrations = await registrationRows(id, "GST_HST");
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0].number_display, gstFor(bn));
      assert.equal(registrations[0].number_normalized, `${bn}RT0001`);
      assert.deepEqual([registrations[0].jurisdiction_country, registrations[0].jurisdiction_region], ["CA", null], "a national Canadian program: no region is invented");
      assert.equal(await count(`SELECT count(*) AS n FROM public.registration_status_periods p JOIN public.registrations r ON r.id = p.registration_id WHERE r.organization_id = $1 AND r.program_code = 'GST_HST'`, [id]), 1);
      const events = await rows<{ event_type: string }>(`SELECT e.event_type FROM public.master_register_events e WHERE e::text LIKE '%createRegistration%' AND e::text LIKE '%' || $1 || '%'`, [id]);
      assert.ok(events.length >= 1, "creating the registration is recorded");

      const profile = await K.dir.getCompanyProfile(id);
      assert.equal(profile?.gstHst, gstFor(bn));
      assert.ok(profile?.gstHstRegistrationId);
      assert.deepEqual(profile?.notRecordedYet, []);
    });

    it("is optional and never invented: no field, no registration", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("B"));
      assert.equal(await count(`SELECT count(*) AS n FROM public.registrations WHERE organization_id = $1`, [created.company.id]), 0);
      assert.equal((await K.dir.getCompanyProfile(created.company.id))?.gstHst, null);
    });

    it("refuses a malformed account, or one that contradicts the Business Number, and creates nothing", async () => {
      await signInWith(...ALL);
      const before = await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Gst ${run}%`]);
      const malformed = await rejected(K.dir.createCompanyDirectoryRecord(payload("C", { gstHst: "123456789" })));
      assert.deepEqual(malformed.issues?.map((issue) => issue.field), ["gstHst"]);
      const contradiction = await rejected(K.dir.createCompanyDirectoryRecord(payload("C", { businessNo: "111111118", gstHst: gstFor("123456782") })));
      assert.match(contradiction.issues?.[0].message ?? "", /Business Number/);
      assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Gst ${run}%`]), before);
    });

    it("an account already registered to another company is refused, and the new company is not created", async () => {
      await signInWith(...ALL);
      const bn = digits(9);
      await K.dir.createCompanyDirectoryRecord(payload("D1", { gstHst: gstFor(bn, "0002") }));
      const before = await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Gst ${run}%`]);
      const clash = await rejected(K.dir.createCompanyDirectoryRecord(payload("D2", { gstHst: gstFor(bn, "0002") })));
      assert.ok(clash, "the shared number namespace refuses a second holder");
      assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Gst ${run}%`]), before, "all or nothing");
    });

    it("can be added, corrected, replaced and cleared by an authorized editor, keeping history and recording each change", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("E"));
      const id = created.company.id;
      const first = gstFor(digits(9));
      const second = gstFor(digits(9));
      const third = gstFor(digits(9), "0003");

      const added = await K.dir.editCompany(id, { gstHst: first });
      assert.equal(added.details?.gstHst, "created");
      assert.equal((await K.dir.getCompanyProfile(id))?.gstHst, first);

      assert.equal((await K.dir.editCompany(id, { gstHst: first })).details?.gstHst, "unchanged");
      assert.equal((await K.dir.editCompany(id, { gstHst: first.replace(/ /g, "") })).details?.gstHst, "unchanged", "spacing alone is not a change");

      const corrected = await K.dir.editCompany(id, { gstHst: second, factMode: "correct" });
      assert.equal(corrected.details?.gstHst, "corrected");
      let versions = await registrationRows(id, "GST_HST");
      assert.deepEqual(versions.map((v) => v.version_status), ["corrected", "active"], "the wrong number is kept and flagged");
      assert.equal((await K.dir.getCompanyProfile(id))?.gstHst, second);

      const replaced = await K.dir.editCompany(id, { gstHst: third, factMode: "change" });
      assert.equal(replaced.details?.gstHst, "replaced");
      const all = await rows<{ record_status: string }>(`SELECT record_status FROM public.registrations WHERE organization_id = $1 AND program_code = 'GST_HST' ORDER BY created_at`, [id]);
      assert.deepEqual(all.map((r) => r.record_status), ["archived", "active"], "a different account is a different registration; the earlier one is archived");
      assert.equal((await K.dir.getCompanyProfile(id))?.gstHst, third);

      const cleared = await K.dir.editCompany(id, { gstHst: "" });
      assert.equal(cleared.details?.gstHst, "archived");
      assert.equal((await K.dir.getCompanyProfile(id))?.gstHst, null);
      assert.equal(await count(`SELECT count(*) AS n FROM public.registrations WHERE organization_id = $1 AND program_code = 'GST_HST'`, [id]), 2, "nothing was deleted");
      versions = await registrationRows(id, "GST_HST");
      assert.equal(versions.length, 3, "every version ever recorded is still on file");
      assert.ok((await eventCount(id)) >= 6, "each step produced Master Register events");
    });

    it("an invalid account in an edit changes nothing, identity included", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("F"));
      const id = created.company.id;
      const events = await eventCount(id);
      const error = await rejected(K.dir.editCompany(id, { companyName: `Gst ${run} renamed`, gstHst: "nope" }));
      assert.deepEqual(error.issues?.map((issue) => issue.field), ["gstHst"]);
      assert.equal((await K.dir.getCompanyEditRecord(id)).companyName, created.company.name);
      assert.equal(await eventCount(id), events);
    });

    it("needs TAX_REGISTRATION_MANAGE to save, TAX_REGISTRATION_READ to see it, and never leaks across companies", async () => {
      await signInWith(...ALL);
      const bn = digits(9);
      const mine = (await K.dir.createCompanyDirectoryRecord(payload("G1", { businessNo: bn, gstHst: gstFor(bn) }))).company.id;
      const other = (await K.dir.createCompanyDirectoryRecord(payload("G2"))).company.id;

      await signInWith(...without("TAX_REGISTRATION_MANAGE"));
      const create = await rejected(K.dir.createCompanyDirectoryRecord(payload("G3", { gstHst: gstFor(digits(9)) })));
      assert.ok(create.missing?.includes("TAX_REGISTRATION_MANAGE"), "creation names the missing capability");
      const edit = await rejected(K.dir.editCompany(other, { gstHst: gstFor(digits(9)) }));
      assert.ok(edit.missing?.includes("TAX_REGISTRATION_MANAGE"));
      assert.equal(await count(`SELECT count(*) AS n FROM public.registrations WHERE organization_id = $1`, [other]), 0);

      await signInWith(...without("TAX_REGISTRATION_READ", "TAX_REGISTRATION_MANAGE"));
      const hidden = await K.dir.getCompanyProfile(mine);
      assert.equal(hidden?.sections.registrations, "not_permitted");
      assert.equal(hidden?.gstHst, null, "withheld, not shown as empty");

      await signInWith(...ALL);
      assert.equal((await K.dir.getCompanyProfile(other))?.gstHst, null, "another company's account is not shown here");
      assert.equal((await K.dir.getCompanyProfile(mine))?.gstHst, gstFor(bn));
    });

    it("is not stored in browser storage: the page code only talks to the server APIs", async () => {
      const fs = await import("node:fs");
      for (const file of ["app/companies/new/page.tsx", "app/companies/[id]/edit/page.tsx", "app/companies/[id]/profile/page.tsx"]) {
        assert.doesNotMatch(fs.readFileSync(file, "utf8"), /localStorage|sessionStorage|indexedDB/i, file);
      }
    });
  });

  // ===========================================================================================================
  describe("Primary Contact", () => {
    const personCount = () => count(`SELECT count(*) AS n FROM public.persons`);
    const namedLike = (name: string) =>
      count(`SELECT count(*) AS n FROM public.person_name_versions WHERE name_normalized = $1`, [name.toLowerCase().replace(/\s+/g, " ")]);

    it("a typed full name creates ONE canonical person, stored as typed, related to the company as its primary contact", async () => {
      await signInWith(...ALL);
      const name = `Pat Quill${digits(4)}`;
      const created = await K.dir.createCompanyDirectoryRecord(payload("H", { contactPerson: name }));
      const id = created.company.id;
      const person = await one<{ person_id: string; given_name: string; family_name: string | null }>(
        `SELECT n.person_id, n.given_name, n.family_name FROM public.organization_person_relationships r JOIN public.person_name_versions n ON n.person_id = r.person_id WHERE r.organization_id = $1`,
        [id],
      );
      assert.equal(person.given_name, name, "the name is kept exactly as typed");
      assert.equal(person.family_name, null, "it is not split by guesswork");
      assert.equal(await count(`SELECT count(*) AS n FROM public.contact_purpose_assignments a JOIN public.organization_person_relationships r ON r.id = a.relationship_id WHERE r.organization_id = $1 AND a.purpose_code = 'PRIMARY' AND a.is_primary`, [id]), 1);
      const profile = await K.dir.getCompanyProfile(id);
      assert.equal(profile?.contact, name);
      assert.equal(profile?.contactPersonId, person.person_id, "the profile can navigate to the person in Contacts");
      assert.ok((await eventCount(id)) >= 3, "the person, the link and the purpose are recorded");
    });

    it("needs no contact details: no phone, email or title is required or invented", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("I", { contactPerson: `Sam Rowe${digits(4)}` }));
      assert.equal(await count(`SELECT count(*) AS n FROM public.person_channels c JOIN public.organization_person_relationships r ON r.person_id = c.person_id WHERE r.organization_id = $1`, [created.company.id]), 0);
    });

    it("an existing person is linked only when the user chooses them: the same person, no duplicate, no merge", async () => {
      await signInWith(...ALL);
      const name = `Alex Frame${digits(4)}`;
      const first = (await K.dir.createCompanyDirectoryRecord(payload("J1", { contactPerson: name }))).company.id;
      const personId = (await one<{ person_id: string }>(`SELECT person_id FROM public.organization_person_relationships WHERE organization_id = $1`, [first])).person_id;

      // the lookup the form uses: an advisory suggestion, nothing is linked by it
      const matches = await K.contacts.findPersonMatches({ givenName: name });
      assert.ok(matches.some((match) => match.personId === personId), "found by the typed name");

      // typing the same name again WITHOUT choosing: a separate person (no automatic merge by name)
      const before = await personCount();
      const second = (await K.dir.createCompanyDirectoryRecord(payload("J2", { contactPerson: name }))).company.id;
      assert.equal(await personCount(), before + 1, "a name alone never establishes identity");
      assert.notEqual((await K.dir.getCompanyProfile(second))?.contactPersonId, personId);

      // choosing the existing person: linked, not duplicated
      const afterTyped = await personCount();
      const third = (await K.dir.createCompanyDirectoryRecord(payload("J3", { contactPersonId: personId }))).company.id;
      assert.equal(await personCount(), afterTyped, "no second person record");
      assert.equal(await namedLike(name), 2, "only the two earlier name rows exist");
      const profile = await K.dir.getCompanyProfile(third);
      assert.equal(profile?.contactPersonId, personId);
      assert.equal(profile?.contact, name);
      assert.equal(await count(`SELECT count(*) AS n FROM public.organization_person_relationships WHERE person_id = $1`, [personId]), 2, "the one person is related to both companies");
    });

    it("an unknown person, or one the creator may not see, is refused and the company is not created", async () => {
      await signInWith(...ALL);
      const name = `Robin Vale${digits(4)}`;
      const owner = (await K.dir.createCompanyDirectoryRecord(payload("K1", { contactPerson: name }))).company.id;
      const personId = (await one<{ person_id: string }>(`SELECT person_id FROM public.organization_person_relationships WHERE organization_id = $1`, [owner])).person_id;
      const before = await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Gst ${run}%`]);

      const unknown = await rejected(K.dir.createCompanyDirectoryRecord(payload("K2", { contactPersonId: randomUUID() })));
      assert.ok(unknown);
      await signInWith(...without("PERSON_REGISTRY_READ"));
      const hidden = await rejected(K.dir.createCompanyDirectoryRecord(payload("K3", { contactPersonId: personId })));
      assert.ok(hidden, "without the people registry the person cannot be linked");
      assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Gst ${run}%`]), before, "all or nothing");
    });

    it("without CONTACT_MANAGE the contact cannot be saved", async () => {
      await signInWith(...without("CONTACT_MANAGE"));
      const error = await rejected(K.dir.createCompanyDirectoryRecord(payload("L", { contactPerson: "Casey Noble" })));
      assert.ok(error.missing?.includes("CONTACT_MANAGE"));
    });

    it("Contacts stays authoritative: the name can be restructured there without a second person", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("M", { contactPerson: `Jo Anne Hart${digits(3)}` }));
      const id = created.company.id;
      const personId = (await K.dir.getCompanyProfile(id))?.contactPersonId as string;
      const before = await personCount();
      await K.contacts.correctPersonName({ organizationId: id, personId, givenName: "Jo Anne", familyName: `Hart${digits(3)}` });
      assert.equal(await personCount(), before);
      assert.match((await K.dir.getCompanyProfile(id))?.contact ?? "", /^Jo Anne Hart/);
    });
  });

  // ===========================================================================================================
  describe("unresolved issuing / base jurisdiction", () => {
    const unresolvedPayload = (label: string) =>
      payload(label, {
        companyType: "Customer", startDate: "2024-01-15", cargoTypes: JSON.stringify(["General Freight"]), opRegion: "Cross-Border",
        mvid: `MV${digits(5)}`, mvidKind: "MVID", nsc: `NS${digits(5)}`, nscKind: "NSC", accIrp: `IRP${digits(6)}`, accIfta: `IFTA${digits(6)}`,
        // the fixed kinds are derived, not asked for
      });

    it("records the number with its jurisdiction UNRESOLVED instead of guessing one, and the profile says so", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(unresolvedPayload("N"));
      const id = created.company.id;
      const authorities = await rows<{ kind: string; country: string | null; region: string | null; reason: string }>(
        `SELECT a.kind, v.jurisdiction_country AS country, v.jurisdiction_region AS region, v.version_reason AS reason
           FROM public.operating_authorities a JOIN public.operating_authority_versions v ON v.authority_id = a.id WHERE a.organization_id = $1 ORDER BY a.kind`,
        [id],
      );
      assert.deepEqual(authorities.map((a) => [a.kind, a.country, a.region, a.reason]), [
        ["IRP", null, null, "INITIAL"],
        ["MVID", "CA", null, "INITIAL"],
        ["SAFETY_FITNESS", "CA", null, "INITIAL"],
      ], "the formation jurisdiction (ON) was not borrowed");
      const ifta = await registrationRows(id, "IFTA");
      assert.deepEqual([ifta[0].jurisdiction_country, ifta[0].jurisdiction_region], [null, null]);

      const profile = await K.dir.getCompanyProfile(id);
      assert.match(profile?.mvid ?? "", /\(jurisdiction not set\)$/);
      assert.match(profile?.nsc ?? "", /\(jurisdiction not set\)$/);
      assert.match(profile?.accIrp ?? "", /\(jurisdiction not set\)$/);
      assert.match(profile?.accIfta ?? "", /\(jurisdiction not set\)$/);
    });

    it("kinds whose jurisdiction is fixed are still derived (RIN and CVOR are Ontario)", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("O", { companyType: "Customer", startDate: "2024-01-15", cargoTypes: JSON.stringify(["General Freight"]), mvid: `RN${digits(6)}`, mvidKind: "RIN", nsc: `${digits(9)}`, nscKind: "CVOR" }));
      const fixed = await rows<{ kind: string; region: string | null }>(`SELECT a.kind, v.jurisdiction_region AS region FROM public.operating_authorities a JOIN public.operating_authority_versions v ON v.authority_id = a.id WHERE a.organization_id = $1 ORDER BY a.kind`, [created.company.id]);
      assert.deepEqual(fixed.map((row) => [row.kind, row.region]), [["CVOR", "ON"], ["RIN", "ON"]]);
    });

    it("a stated jurisdiction (API use) is used as given, and the unresolved state is explicit-only", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(payload("P", { companyType: "Customer", startDate: "2024-01-15", cargoTypes: JSON.stringify(["General Freight"]), mvid: `MV${digits(5)}`, mvidKind: "MVID", mvidRegion: "AB", accIrp: `IRP${digits(6)}`, irpBase: "IL" }));
      const stated = await rows<{ kind: string; country: string | null; region: string | null }>(`SELECT a.kind, v.jurisdiction_country AS country, v.jurisdiction_region AS region FROM public.operating_authorities a JOIN public.operating_authority_versions v ON v.authority_id = a.id WHERE a.organization_id = $1 ORDER BY a.kind`, [created.company.id]);
      assert.deepEqual(stated.map((row) => [row.kind, row.country, row.region]), [["IRP", "US", "IL"], ["MVID", "CA", "AB"]]);
    });

    it("the jurisdiction is set later by a correction in the registration workflow; the unresolved version stays as history", async () => {
      await signInWith(...ALL);
      const created = await K.dir.createCompanyDirectoryRecord(unresolvedPayload("Q"));
      const id = created.company.id;
      const view = await K.authorities.getOrganizationAuthorities(id);
      const mvid = view.authorities.find((entry) => entry.authority.kind === "MVID")!;
      const irp = view.authorities.find((entry) => entry.authority.kind === "IRP")!;

      // a plain change cannot be recorded against an unresolved jurisdiction
      const change = await rejected(K.authorities.changeAuthorityVersion({ organizationId: id, authorityId: mvid.authority.id, number: `MV${digits(6)}` } as never));
      assert.match(change.message, /not established yet/);
      // nor can a jurisdiction be erased back to unknown
      const erase = await rejected(K.authorities.correctAuthorityVersion({ organizationId: id, authorityId: mvid.authority.id, number: `MV${digits(6)}` } as never));
      assert.match(erase.message, /not established yet/);

      await K.authorities.correctAuthorityVersion({ organizationId: id, authorityId: mvid.authority.id, jurisdiction: { region: "BC" } } as never);
      await K.authorities.correctAuthorityVersion({ organizationId: id, authorityId: irp.authority.id, jurisdiction: { country: "CA", region: "ON" } } as never);
      const profile = await K.dir.getCompanyProfile(id);
      assert.match(profile?.mvid ?? "", /\(BC\)$/);
      assert.match(profile?.accIrp ?? "", /^IRP\d+ \(ON\)$/);
      const history = await rows<{ record_status: string; region: string | null }>(`SELECT v.record_status, v.jurisdiction_region AS region FROM public.operating_authority_versions v WHERE v.authority_id = $1 ORDER BY v.created_at, v.id`, [mvid.authority.id]);
      assert.deepEqual(history.map((row) => [row.record_status, row.region]), [["corrected", null], ["active", "BC"]]);

      const registrationView = await K.tax.getOrganizationRegistrations(id);
      const ifta = registrationView.registrations.find((entry) => entry.registration.program === "IFTA")!;
      const noBase = await rejected(K.tax.changeRegistrationVersion({ organizationId: id, registrationId: ifta.registration.id, issuedOn: "2025-01-01" } as never));
      assert.match(noBase.message, /not established yet/);
      await K.tax.correctRegistrationVersion({ organizationId: id, registrationId: ifta.registration.id, jurisdiction: { country: "CA", region: "AB" } } as never);
      assert.match((await K.dir.getCompanyProfile(id))?.accIfta ?? "", /\(AB\)$/);
    });

    it("the database only accepts an unresolved jurisdiction on an INITIAL version of a kind that does not fix its own", async () => {
      await signInWith(...ALL);
      const id = (await K.dir.createCompanyDirectoryRecord(unresolvedPayload("R"))).company.id;
      const rin = await K.authorities.createAuthority({ organizationId: id, kind: "RIN", number: `R${digits(7)}` } as never);
      const mvid = (await K.authorities.getOrganizationAuthorities(id)).authorities.find((entry) => entry.authority.kind === "MVID")!;

      const client = await pools.admin.connect();
      try {
        const insert = (authorityId: string, kind: string, country: string | null, region: string | null, reason: string) =>
          client.query(
            `INSERT INTO public.operating_authority_versions (authority_id, organization_id, kind, number_display, number_normalized, normalization_rule_version, jurisdiction_country, jurisdiction_region, version_reason, effective_from, record_status)
             VALUES ($1, $2, $3, 'X1', $4, 'test', $5, $6, $7, now(), 'active')`,
            [authorityId, id, kind, `UNRES${digits(6)}`, country, region, reason],
          );
        // RIN is Ontario by definition: it can never be unresolved
        await client.query("BEGIN");
        await assert.rejects(insert(rin.view.authority.id, "RIN", "CA", null, "INITIAL"), /jurisdiction does not satisfy/);
        await client.query("ROLLBACK");
        // a later version of an unresolved-capable kind must name its jurisdiction
        await client.query("BEGIN");
        await assert.rejects(insert(mvid.authority.id, "MVID", "CA", null, "CORRECTION"), /jurisdiction does not satisfy/);
        await client.query("ROLLBACK");
        // a region without a country is meaningless
        await client.query("BEGIN");
        await assert.rejects(insert(mvid.authority.id, "MVID", null, "ON", "INITIAL"), /region_needs_country|jurisdiction does not satisfy/);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    });

    it("existing authority and registration records are untouched by the migration and by company creation", async () => {
      await signInWith(...ALL);
      const id = (await K.dir.createCompanyDirectoryRecord(payload("S", { companyType: "Customer", startDate: "2024-01-15", cargoTypes: JSON.stringify(["General Freight"]), usdot: digits(7), mc: digits(6), scac: letters(4), carrierCode: digits(6), mvid: `MV${digits(5)}`, mvidKind: "MVID", mvidRegion: "ON" }))).company.id;
      const before = await rows(`SELECT v.id, v.number_display, v.jurisdiction_country, v.jurisdiction_region FROM public.operating_authority_versions v WHERE v.organization_id = $1 ORDER BY v.id`, [id]);
      await K.dir.createCompanyDirectoryRecord(unresolvedPayload("S2"));
      assert.deepEqual(await rows(`SELECT v.id, v.number_display, v.jurisdiction_country, v.jurisdiction_region FROM public.operating_authority_versions v WHERE v.organization_id = $1 ORDER BY v.id`, [id]), before);
      assert.equal(before.length, 3);
    });
  });
});
