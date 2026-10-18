// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Company creation, reopening and editing through the REAL authorization wrappers and the RUNTIME role (row-level security
// applies), with the real Master Register. Fixtures use the admin pool. Everything a creation submits is persisted to its
// canonical domain in one transaction; a failure anywhere rolls the whole record back.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    create: await import("@/lib/company-directory/create-company"),
    authz: await import("@/lib/auth/tes-authorization"),
    input: await import("@/lib/company-directory/creation-input"),
    corp: await import("@/lib/corporate-identity/errors"),
    authErrors: await import("@/lib/operating-authorities/errors"),
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

const ALL = ["ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ", "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ"];

const digits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join("");
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("");

describe("Company creation, reopening and editing (real authorization, real Master Register)", { skip: !enabled }, () => {
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

  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows[0] as T;
  const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);

  function fullPayload(label: string, overrides: Record<string, unknown> = {}) {
    const tag = `${label}${digits(4)}`;
    return {
      companyName: `Recovery ${run} ${tag} Transport Ltd`, dba: `Recovery ${tag}`, companyType: "Customer", opRegion: "Cross-Border",
      regCorpState: "ON", regCorpCountry: "Canada", incorpNo: digits(7), businessNo: "", ein: `${digits(2)}-${digits(7)}`, startDate: "2024-01-15",
      contactGivenName: "Jane", contactFamilyName: "Roe", phone: `+1 416 555 ${digits(4)}`, email: `ops-${tag.toLowerCase()}@example.test`, billingEmail: `billing-${tag.toLowerCase()}@example.test`,
      reg_street: "100 King St W", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada",
      mail_street: "PO Box 12", mail_city: "Ottawa", mail_state: "ON", mail_zip: "K1P 5G3", mail_country: "Canada",
      yard_street: "55 Yard Rd", yard_city: "Chicago", yard_state: "IL", yard_zip: "60601", yard_country: "United States",
      usdot: digits(7), mc: digits(6), mvid: `MV${digits(5)}`, mvidKind: "MVID", mvidRegion: "ON", nsc: `NS${digits(5)}`, nscKind: "NSC", nscRegion: "AB",
      accIrp: `IRP${digits(6)}`, irpBase: "IL", accIfta: `IFTA${digits(6)}`, iftaBase: "ON",
      accNyhut: `NY${digits(6)}`, accNm: `NM${digits(6)}`, accKyu: `KY${digits(6)}`, accOr: `OR${digits(6)}`, accCt: `CT${digits(6)}`,
      scac: letters(4), carrierCode: digits(6),
      ...overrides,
    };
  }

  const orgCount = () => count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Recovery ${run}%`]);

  it("persists every supported field of a Customer to its canonical domain, and the profile reads the same values back", async () => {
    await signInWith(...ALL);
    const businessNo = digits(9);
    const payload = fullPayload("A", { businessNo });
    const created = await K.dir.createCompanyDirectoryRecord(payload);
    const id = created.company.id;
    assert.equal(created.company.kind, "Customer");
    assert.deepEqual(created.recorded.addresses, ["REGISTERED", "MAILING", "HOME_YARD"]);

    // canonical rows, straight from PostgreSQL
    const org = await one<{ legal_name: string; country_code: string; region_code: string }>(`SELECT legal_name, country_code, region_code FROM public.organizations WHERE id = $1`, [id]);
    assert.equal(org.legal_name, payload.companyName);
    assert.deepEqual([org.country_code, org.region_code], ["CA", "ON"]);
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [id]), 1);
    assert.equal(await count(`SELECT count(*) AS n FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1 AND e.started_at = '2024-01-15T00:00:00Z'`, [id]), 1);
    const assignments = (await pools.admin.query(`SELECT role, location_id FROM public.organization_location_assignments WHERE organization_id = $1 AND effective_to IS NULL ORDER BY role`, [id])).rows as Array<{ role: string; location_id: string }>;
    assert.deepEqual(assignments.map((a) => a.role), ["HOME_YARD", "MAILING", "REGISTERED"]);
    assert.equal(new Set(assignments.map((a) => a.location_id)).size, 3, "three independent locations");
    assert.equal(await count(`SELECT count(*) AS n FROM public.operating_authorities WHERE organization_id = $1`, [id]), 5);
    assert.equal(await count(`SELECT count(*) AS n FROM public.registrations WHERE organization_id = $1`, [id]), 8);
    assert.equal(await count(`SELECT count(*) AS n FROM public.organization_channels WHERE organization_id = $1`, [id]), 3);
    assert.equal(await count(`SELECT count(*) AS n FROM public.organization_person_relationships WHERE organization_id = $1`, [id]), 1);
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_operating_scope_periods WHERE organization_id = $1 AND operating_scope = 'CANADA_AND_UNITED_STATES'`, [id]), 1);

    // reopening: the profile is assembled from those rows
    const profile = await K.dir.getCompanyProfile(id);
    assert.ok(profile);
    assert.equal(profile.name, payload.companyName);
    assert.equal(profile.kind, "Customer");
    assert.equal(profile.dba, payload.dba);
    assert.equal(profile.contact, "Jane Roe");
    assert.equal(profile.phone, payload.phone);
    assert.equal(profile.email, payload.email);
    assert.equal(profile.billingEmail, payload.billingEmail);
    assert.equal(profile.opRegion, "Cross-Border");
    assert.equal(profile.incorpNo, payload.incorpNo);
    assert.equal(profile.businessNo, businessNo);
    assert.equal(profile.ein, payload.ein);
    assert.equal(profile.regCorpState, "ON");
    assert.equal(profile.regCorpCountry, "Canada");
    assert.match(String(profile.usdot), new RegExp(String(payload.usdot).replace(/^0+/, "")));
    assert.match(String(profile.mc), /\d/);
    assert.match(String(profile.mvid), /MVID .*MV.*\(ON\)/);
    assert.match(String(profile.nsc), /NSC .*\(AB\)/);
    assert.match(String(profile.accIrp), /IRP/);
    assert.match(String(profile.accIfta), /\(ON\)/);
    for (const field of ["accNyhut", "accNm", "accKyu", "accOr", "accCt", "scac", "carrierCode"] as const) assert.ok(profile[field], `${field} is persisted and read back`);
    assert.equal(profile.reg_street, "100 King St W");
    assert.equal(profile.reg_city, "Toronto");
    assert.equal(profile.reg_state, "ON");
    assert.equal(profile.reg_country, "Canada");
    assert.equal(profile.mail_street, "PO Box 12");
    assert.equal(profile.mail_city, "Ottawa");
    assert.equal(profile.yard_street, "55 Yard Rd");
    assert.equal(profile.yard_state, "IL");
    assert.equal(profile.yard_country, "United States");
    assert.equal(profile.startDate, "2024-01-15");
    assert.equal(profile.serviceStage, "ONBOARDING");
    assert.ok(Object.values(profile.sections).every((state) => state === "ok"), JSON.stringify(profile.sections));

    // accountability: every domain wrote its Master Register event in the same transaction
    const events = await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [id]);
    assert.ok(events >= 10, `expected at least 10 Master Register events that reference the new organization, found ${events}`);
  });

  it("creates a non-Customer with only its registered address, and refuses mailing/yard addresses it cannot hold", async () => {
    await signInWith(...ALL);
    const base = { companyName: `Recovery ${run} B${digits(4)} Haulage`, companyType: "Owner Operator", opRegion: "US Only", regCorpState: "TX", regCorpCountry: "United States", ein: `${digits(2)}-${digits(7)}`, reg_street: "1 Main St", reg_city: "Austin", reg_state: "TX", reg_zip: "73301", reg_country: "United States" };
    const created = await K.dir.createCompanyDirectoryRecord(base);
    const profile = await K.dir.getCompanyProfile(created.company.id);
    assert.equal(profile?.kind, "owner_operator");
    assert.equal(profile?.opRegion, "US Only");
    assert.equal(profile?.reg_city, "Austin");
    assert.equal(profile?.mail_street, null);
    assert.equal(profile?.startDate, null);
    assert.equal(profile?.businessNo, null, "an EIN is never copied into the Canadian Business Number");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [created.company.id]), 0);
    const before = await orgCount();
    await assert.rejects(K.dir.createCompanyDirectoryRecord({ ...base, companyName: `${base.companyName} 2`, mail_street: "2 Main", mail_city: "X", mail_state: "TX" }), (e: unknown) => e instanceof K.input.CompanyCreationValidationError);
    assert.equal(await orgCount(), before);
  });

  it("refuses unsupported fields explicitly and creates nothing", async () => {
    await signInWith(...ALL);
    const before = await orgCount();
    await assert.rejects(
      K.dir.createCompanyDirectoryRecord(fullPayload("C", { gstHst: "123456789 RT 0001", cargoTypes: ["General Freight"], payMethod: "Cheque", website: "https://x.test" })),
      (error: unknown) => error instanceof K.input.CompanyCreationValidationError && ["cargoTypes", "gstHst", "payMethod", "website"].every((f) => error.issues.some((i) => i.field === f)),
    );
    assert.equal(await orgCount(), before);
  });

  it("rolls the whole record back when a late step fails, and a corrected retry then succeeds exactly once", async () => {
    await signInWith(...ALL);
    const taken = await K.dir.createCompanyDirectoryRecord(fullPayload("D1"));
    const takenProfile = await K.dir.getCompanyProfile(taken.company.id);
    const usdot = String(takenProfile?.usdot);

    const before = {
      orgs: await orgCount(),
      locations: await count(`SELECT count(*) AS n FROM public.locations`),
      people: await count(`SELECT count(*) AS n FROM public.persons`),
      channels: await count(`SELECT count(*) AS n FROM public.organization_channels`),
      events: await count(`SELECT count(*) AS n FROM public.master_register_events`),
      customers: await count(`SELECT count(*) AS n FROM public.customers`),
    };
    // Everything up to the authority step is valid; the USDOT number belongs to another company, so the 8th step fails.
    const failing = fullPayload("D2", { usdot });
    await assert.rejects(K.dir.createCompanyDirectoryRecord(failing), (e: unknown) => e instanceof K.authErrors.AuthorityNumberCollisionError);
    const after = {
      orgs: await orgCount(),
      locations: await count(`SELECT count(*) AS n FROM public.locations`),
      people: await count(`SELECT count(*) AS n FROM public.persons`),
      channels: await count(`SELECT count(*) AS n FROM public.organization_channels`),
      events: await count(`SELECT count(*) AS n FROM public.master_register_events`),
      customers: await count(`SELECT count(*) AS n FROM public.customers`),
    };
    assert.deepEqual(after, before, "no organization, customer, location, person, channel or Master Register event survived the failure");

    // retry with the corrected number: exactly one organization, complete
    const retried = await K.dir.createCompanyDirectoryRecord({ ...failing, usdot: digits(7) });
    assert.equal(await orgCount(), before.orgs + 1);
    const profile = await K.dir.getCompanyProfile(retried.company.id);
    assert.equal(profile?.reg_city, "Toronto");
    assert.equal(profile?.contact, "Jane Roe");
  });

  it("refuses a second company with the same strong identifier (EIN), leaving exactly one", async () => {
    await signInWith(...ALL);
    const ein = `${digits(2)}-${digits(7)}`;
    const first = { companyName: `Recovery ${run} E1${digits(3)} Inc`, companyType: "Owner Operator", opRegion: "US Only", ein };
    await K.dir.createCompanyDirectoryRecord(first);
    const before = await orgCount();
    await assert.rejects(K.dir.createCompanyDirectoryRecord({ ...first, companyName: `Recovery ${run} E2${digits(3)} Inc` }), (e: unknown) => e instanceof K.corp.CorporateIdentifierCollisionError);
    assert.equal(await orgCount(), before);
  });

  it("is authorized per field: a missing capability names itself and creates nothing; no ORGANIZATION_CREATE is denied", async () => {
    const before = await orgCount();
    await signInWith("ORGANIZATION_CREATE", "COMPANY_PROFILE_MANAGE", "ORGANIZATION_REGISTRY_READ");
    await assert.rejects(
      K.dir.createCompanyDirectoryRecord({ companyName: `Recovery ${run} F${digits(4)} Co`, companyType: "Owner Operator", phone: "+1 416 555 0100" }),
      (error: unknown) => error instanceof K.create.CompanyCreationCapabilityError && error.missing.includes("CONTACT_MANAGE"),
    );
    // without the optional contact fields the same actor can create
    await K.dir.createCompanyDirectoryRecord({ companyName: `Recovery ${run} F${digits(4)} Co`, companyType: "Owner Operator" });
    assert.equal(await orgCount(), before + 1);

    await signInWith("ORGANIZATION_REGISTRY_READ");
    await assert.rejects(K.dir.createCompanyDirectoryRecord({ companyName: `Recovery ${run} G Co`, companyType: "Owner Operator" }), (e: unknown) => e instanceof K.authz.TesAuthorizationDeniedError);
    assert.equal(await orgCount(), before + 1);
  });

  it("reports a section the reader may not see as not permitted, never as empty, and still opens the company", async () => {
    await signInWith(...ALL);
    const created = await K.dir.createCompanyDirectoryRecord(fullPayload("H"));
    await signInWith("ORGANIZATION_REGISTRY_READ");
    const profile = await K.dir.getCompanyProfile(created.company.id);
    assert.ok(profile);
    assert.equal(profile.name, created.company.name);
    assert.equal(profile.reg_city, "Toronto", "organization locations are covered by ORGANIZATION_REGISTRY_READ");
    assert.equal(profile.sections.contacts, "not_permitted");
    assert.equal(profile.sections.registrations, "not_permitted");
    assert.equal(profile.sections.operatingProfile, "not_permitted");
    assert.equal(profile.contact, null);
    assert.equal(profile.opRegion, null);
  });

  it("opens an unknown or malformed id as not found (no 500) and a company created with nothing optional as legitimately empty", async () => {
    await signInWith(...ALL);
    assert.equal(await K.dir.getCompanyProfile(randomUUID()), null);
    assert.equal(await K.dir.getCompanyProfile("not-a-uuid"), null);
    const bare = await K.dir.createCompanyDirectoryRecord({ companyName: `Recovery ${run} I${digits(4)} Bare`, companyType: "Other" });
    const profile = await K.dir.getCompanyProfile(bare.company.id);
    assert.ok(profile);
    for (const field of ["dba", "contact", "phone", "email", "usdot", "reg_street", "mail_street", "yard_street", "accIfta", "startDate"] as const) assert.equal(profile[field], null, field);
    assert.equal(profile.opRegion, "Canada Only", "the operating region is the one submitted (the form defaults it)");
  });

  it("edits identity fields and the profile shows the update (round trip)", async () => {
    await signInWith(...ALL);
    const created = await K.dir.createCompanyDirectoryRecord(fullPayload("J"));
    const id = created.company.id;
    const renamed = `Recovery ${run} J${digits(4)} Renamed Ltd`;
    const edited = await K.dir.updateCompanyDirectoryRecord(id, { companyName: renamed, dba: "New Trade Name", ein: "" });
    assert.equal(edited.companyName, renamed);
    const profile = await K.dir.getCompanyProfile(id);
    assert.equal(profile?.name, renamed);
    assert.equal(profile?.dba, "New Trade Name");
    assert.equal(profile?.ein, null);
    assert.equal(profile?.reg_city, "Toronto", "an identity edit leaves addresses, contacts and registrations untouched");
    assert.equal(profile?.contact, "Jane Roe");
  });

  it("edits operating region and addresses independently: change keeps history, correct flags the wrong version, unchanged is not re-saved", async () => {
    const editorId = await signInWith(...ALL);
    const id = (await K.dir.createCompanyDirectoryRecord(fullPayload("K"))).company.id;

    const moved = await K.dir.editCompany(id, { opRegion: "Canada Only", reg_street: "200 Bay St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5J 2J2", reg_country: "Canada", addressMode: "change" });
    assert.equal(moved.details?.operatingScope.changed, true);
    assert.deepEqual(moved.details?.addresses, [{ role: "REGISTERED", action: "changed" }]);
    let profile = await K.dir.getCompanyProfile(id);
    assert.equal(profile?.opRegion, "Canada Only");
    assert.equal(profile?.reg_street, "200 Bay St");
    assert.equal(profile?.mail_street, "PO Box 12", "mailing address untouched");
    assert.equal(profile?.yard_city, "Chicago", "yard address untouched");
    assert.equal(await count(`SELECT count(*) AS n FROM public.location_addresses la JOIN public.organization_location_assignments a ON a.location_id = la.location_id WHERE a.organization_id = $1 AND a.role = 'REGISTERED'`, [id]), 2, "the previous registered address stays as history");

    const corrected = await K.dir.editCompany(id, { mail_street: "PO Box 99", mail_city: "Ottawa", mail_state: "ON", mail_zip: "K1P 5G3", mail_country: "Canada", addressMode: "correct" });
    assert.deepEqual(corrected.details?.addresses, [{ role: "MAILING", action: "corrected" }]);
    assert.equal((await K.dir.getCompanyProfile(id))?.mail_street, "PO Box 99");
    assert.equal(await count(`SELECT count(*) AS n FROM public.location_addresses la JOIN public.organization_location_assignments a ON a.location_id = la.location_id WHERE a.organization_id = $1 AND a.role = 'MAILING' AND la.status = 'corrected'`, [id]), 1);

    const same = await K.dir.editCompany(id, { opRegion: "Canada Only", mail_street: "PO Box 99", mail_city: "Ottawa", mail_state: "ON", mail_zip: "K1P 5G3", mail_country: "Canada" });
    assert.equal(same.details?.operatingScope.changed, false);
    assert.deepEqual(same.details?.addresses, [{ role: "MAILING", action: "unchanged" }]);

    const editorEvents = await count(`SELECT count(*) AS n FROM public.master_register_events WHERE actor_id = $1::uuid`, [editorId]);
    assert.ok(editorEvents >= 3, `the edit recorded Master Register events for the acting user (found ${editorEvents})`);
  });

  it("validates an edit before writing anything: an invalid address or unsupported field changes nothing, identity included", async () => {
    await signInWith(...ALL);
    const created = await K.dir.createCompanyDirectoryRecord(fullPayload("L"));
    const id = created.company.id;
    await assert.rejects(K.dir.editCompany(id, { companyName: `Recovery ${run} L${digits(4)} Nope`, reg_street: "1 Main", reg_city: "Toronto" }), (e: unknown) => e instanceof K.input.CompanyCreationValidationError);
    await assert.rejects(K.dir.editCompany(id, { companyName: `Recovery ${run} L${digits(4)} Nope`, website: "https://x.test" }), (e: unknown) => e instanceof K.input.CompanyCreationValidationError);
    await assert.rejects(K.dir.editCompany(id, { opRegion: "Mars Only" }), (e: unknown) => e instanceof K.input.CompanyCreationValidationError);
    assert.equal((await K.dir.getCompanyProfile(id))?.name, created.company.name, "identity unchanged after a refused edit");
  });

  it("refuses a mailing address on a non-Customer and an edit without the needed capability", async () => {
    await signInWith(...ALL);
    const supplier = await K.dir.createCompanyDirectoryRecord(fullPayload("M", { companyType: "Sub Contractor", startDate: "", mail_street: "", mail_city: "", mail_state: "", mail_zip: "", mail_country: "", yard_street: "", yard_city: "", yard_state: "", yard_zip: "", yard_country: "", ein: "" }));
    await assert.rejects(K.dir.editCompany(supplier.company.id, { mail_street: "PO Box 1", mail_city: "Ottawa", mail_state: "ON" }), (e: unknown) => e instanceof K.input.CompanyCreationValidationError);
    await signInWith("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ");
    await assert.rejects(K.dir.editCompany(supplier.company.id, { opRegion: "US Only" }), (e: unknown) => e instanceof K.create.CompanyCreationCapabilityError);
  });

  it("the capability switch inside a transaction is re-proven by row-level security: a capability the actor lacks is denied and writes nothing", async () => {
    const { withAuthorizedSystem } = await import("@/lib/auth/tes-system-context");
    const { enterSystemCapability } = await import("@/lib/company-directory/capability-context");
    await signInWith("ORGANIZATION_CREATE");
    await assert.rejects(
      withAuthorizedSystem("ORGANIZATION_CREATE", async (client) => {
        await enterSystemCapability(client, "CONTACT_MANAGE");
      }),
      (error: unknown) => error instanceof K.create.CompanyCreationCapabilityError && (error as { missing: string[] }).missing[0] === "CONTACT_MANAGE",
    );
    // the app-level pre-check refuses first, and a refused creation leaves nothing and records nothing
    const beforeOrgs = await orgCount();
    const beforeEvents = await count(`SELECT count(*) AS n FROM public.master_register_events`);
    await assert.rejects(K.dir.createCompanyDirectoryRecord(fullPayload("N")), (e: unknown) => e instanceof K.create.CompanyCreationCapabilityError);
    assert.equal(await orgCount(), beforeOrgs);
    assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events`), beforeEvents);
  });

  it("a successful creation records every domain write under the acting user, and a failed one records none", async () => {
    const actorId = await signInWith(...ALL);
    const before = await count(`SELECT count(*) AS n FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId]);
    await K.dir.createCompanyDirectoryRecord(fullPayload("O"));
    const afterCreate = await count(`SELECT count(*) AS n FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId]);
    assert.ok(afterCreate - before >= 10, `expected at least 10 events by the creator, found ${afterCreate - before}`);

    await assert.rejects(K.dir.createCompanyDirectoryRecord(fullPayload("P", { usdot: "not-a-number" })));
    assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId]), afterCreate, "a failed creation records nothing");
  });
});
