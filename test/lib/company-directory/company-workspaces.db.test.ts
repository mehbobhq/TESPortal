// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Company-scoped workspaces resolve the SAME canonical organization and never touch another company's records: contacts,
// insurance, credentials and vehicles, through the REAL authorization wrappers and the RUNTIME role.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    contacts: await import("@/lib/contacts/service"),
    insurance: await import("@/lib/insurance/service"),
    credentials: await import("@/lib/company-credentials/service"),
    oi: await import("@/lib/operational-identity/service"),
    profile: await import("@/lib/company-profile/service"),
    reads: await import("@/lib/operational-identity/reads"),
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

const ALL = ["CONTACT_MANAGE", "PERSON_REGISTRY_READ", "INSURANCE_READ", "INSURANCE_MANAGE", "CREDENTIAL_READ", "CREDENTIAL_MANAGE", "VEHICLE_MANAGE", "VEHICLE_READ", "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ"];

describe("Company-scoped workspaces stay inside their own company", { skip: !enabled }, () => {
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
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `WS ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const notFound = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof Error && error.constructor.name.endsWith("NotFoundError"));

  it("contacts: a contact and a company line belong to one company only, and ending keeps history", async () => {
    await signInWith(...ALL);
    const a = await organization("ContactsA");
    const b = await organization("ContactsB");
    const created = await K.contacts.createContact({ organizationId: a, name: { givenName: "Ada", familyName: `Scoped${run}` }, titles: ["Dispatcher"], purposes: [{ purpose: "PRIMARY", primary: true }], channels: [{ type: "EMAIL", value: `ada-${run.toLowerCase()}@example.test` }] });
    assert.equal(created.contact.current.name?.givenName, "Ada");

    await K.contacts.addOrganizationChannel({ organizationId: a, channel: { type: "PHONE", value: `+1 416 555 ${randomInt(1000, 9999)}`, usage: "DISPATCH" } });
    const viewA = await K.contacts.getOrganizationContacts(a);
    const viewB = await K.contacts.getOrganizationContacts(b);
    assert.equal(viewA.contacts.length, 1);
    assert.equal(viewA.currentChannels.length, 1);
    assert.equal(viewB.contacts.length, 0, "the other company has an honest empty list");
    assert.equal(viewB.currentChannels.length, 0);

    await notFound(K.contacts.endOrganizationChannel({ organizationId: b, channelId: viewA.currentChannels[0].id }));
    await K.contacts.endOrganizationChannel({ organizationId: a, channelId: viewA.currentChannels[0].id });
    assert.equal((await K.contacts.getOrganizationContacts(a)).currentChannels.length, 0);
    assert.equal(await count(`SELECT count(*) FROM public.organization_channels WHERE organization_id = $1`, [a]), 1, "the ended line is kept as history");

    await K.contacts.endRelationship({ organizationId: a, relationshipId: viewA.contacts[0].relationship.id });
    assert.equal(await count(`SELECT count(*) FROM public.persons WHERE id = $1`, [viewA.contacts[0].person.id]), 1, "the person record is never deleted");
  });

  it("insurance: a policy can only be changed through its own company", async () => {
    await signInWith(...ALL);
    const insured = await organization("Insured");
    const other = await organization("OtherInsured");
    const insurer = await organization("Insurer");
    const view = await K.insurance.createPolicy({
      organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: `POL-${run}-${randomInt(1000, 9999)}`,
      termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT" }],
    });
    await notFound(K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: other }));
    assert.equal((await K.insurance.getOrganizationInsurance(insured)).policies[0].policy.recordStatus, "active", "a wrong-company request changed nothing");
    await K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: insured });
    assert.equal((await K.insurance.getOrganizationInsurance(other)).policies.length, 0);
  });

  it("credentials: a credential can only be changed through its own company", async () => {
    await signInWith(...ALL);
    const owner = await organization("CredOwner");
    const other = await organization("CredOther");
    const system = await K.credentials.createSystem({ name: `WS ${run} Portal ${randomInt(1000, 9999)}` });
    const created = await K.credentials.createCredential({ organizationId: owner, systemId: system.id, category: "FLEET", username: `user-${run}` });
    const credentialId = created.credential.id;
    await notFound(K.credentials.archiveCredential({ credentialId, organizationId: other }));
    assert.equal((await K.credentials.getOrganizationCredentials(owner)).credentials[0].credential.recordStatus, "active", "a wrong-company request changed nothing");
    await K.credentials.archiveCredential({ credentialId, organizationId: owner });
    assert.equal((await K.credentials.getOrganizationCredentials(owner)).credentials[0].credential.recordStatus, "archived");
    assert.equal((await K.credentials.getOrganizationCredentials(other)).credentials.length, 0);
  });

  it("vehicles: creating a vehicle for a company is atomic and the vehicle appears only under that company", async () => {
    await signInWith(...ALL);
    const a = await organization("FleetA");
    const b = await organization("FleetB");
    const vin = `WS${run}${String(Date.now() % 10000000).padStart(7, "0")}`.slice(0, 17).padEnd(17, "0");

    await assert.rejects(K.oi.createVehicleForOrganization({ vehicleTypeCode: "TRUCK_TRACTOR", vin, make: "Testmake" }, { organizationId: randomUUID(), relationshipType: "OPERATES", unitNumber: "x-1", effectiveFrom: "2024-01-01T00:00:00Z" }));
    assert.equal(await count(`SELECT count(*) FROM public.vehicles WHERE vin_normalized = $1`, [vin]), 0, "a failed relationship leaves no orphan vehicle");

    const made = await K.oi.createVehicleForOrganization({ vehicleTypeCode: "TRUCK_TRACTOR", vin, make: "Testmake" }, { organizationId: a, relationshipType: "OPERATES", unitNumber: "ws-1", effectiveFrom: "2024-01-01T00:00:00Z" });
    assert.ok(made.vehicle.vehicleId);
    assert.equal((await K.reads.listOrganizationVehicles(a)).length, 1);
    assert.deepEqual(await K.reads.listOrganizationVehicles(b), []);
    assert.equal(await count(`SELECT count(*) FROM public.vehicles WHERE vin_normalized = $1`, [vin]), 1);
  });

  it("settings: operating scope, driver minimums and rule applicability are per company and 'not configured' stays honest", async () => {
    await signInWith(...ALL);
    const a = await organization("SettingsA");
    const b = await organization("SettingsB");
    const rule = (await K.profile.listRules())[0].code;

    assert.equal((await K.profile.getCompanyProfile(a)).operatingScope.assertion, null, "nothing is defaulted");
    await K.profile.setOperatingScope({ organizationId: a, operatingScope: "CANADA_AND_UNITED_STATES" });
    await K.profile.setDriverRequirements({ organizationId: a, minimumDriverAgeYears: 23, minimumDriverExperienceMonths: 24 });
    await K.profile.setRuleApplicability({ organizationId: a, ruleCode: rule, applicability: "DOES_NOT_APPLY" });

    const viewA = await K.profile.getCompanyProfile(a);
    assert.equal(viewA.operatingScope.assertion?.operatingScope, "CANADA_AND_UNITED_STATES");
    assert.equal(viewA.driverRequirements.assertion?.minimumDriverAgeYears, 23);
    assert.equal(viewA.rules.find((entry) => entry.rule.code === rule)?.assertion?.applicability, "DOES_NOT_APPLY");

    const viewB = await K.profile.getCompanyProfile(b);
    assert.equal(viewB.operatingScope.assertion, null);
    assert.equal(viewB.driverRequirements.assertion, null);
    assert.equal(viewB.rules.find((entry) => entry.rule.code === rule)?.assertion, null);

    await K.profile.clearRuleApplicability({ organizationId: a, ruleCode: rule });
    assert.equal((await K.profile.getCompanyProfile(a)).rules.find((entry) => entry.rule.code === rule)?.assertion, null);
    assert.ok((await count(`SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1`, [a])) >= 1, "the cleared assertion stays as history");
  });

  it("contacts: name change vs correction, titles, primary purpose and archive/restore keep history and stay inside the company", async () => {
    await signInWith(...ALL);
    const a = await organization("ContactOpsA");
    const b = await organization("ContactOpsB");
    const made = await K.contacts.createContact({ organizationId: a, name: { givenName: "Pat", familyName: `Ops${run}` }, titles: ["Dispatcher"], purposes: [{ purpose: "OPERATIONS" }] });
    const personId = made.contact.person.id;
    const relationshipId = made.contact.relationship.id;

    await K.contacts.changePersonName({ organizationId: a, personId, givenName: "Patricia", familyName: `Ops${run}` });
    await K.contacts.correctPersonName({ organizationId: a, personId, givenName: "Patricia", familyName: `Opsy${run}` });
    assert.equal(await count(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1`, [personId]), 3, "every name version is kept");
    assert.equal(await count(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1 AND record_status = 'corrected'`, [personId]), 1, "the wrong name is flagged, not deleted");

    await K.contacts.assignPurpose({ organizationId: a, relationshipId, purpose: "PRIMARY", primary: true });
    await K.contacts.makePrimary({ organizationId: a, relationshipId, purpose: "OPERATIONS" });
    const view = (await K.contacts.getOrganizationContacts(a)).contacts[0];
    assert.equal(view.current.purposes.find((p) => p.purpose === "OPERATIONS")?.isPrimary, true);
    const title = view.current.titles[0];
    await K.contacts.endTitle({ organizationId: a, titleId: title.id });
    assert.equal((await K.contacts.getOrganizationContacts(a)).contacts[0].current.titles.length, 0);
    assert.equal(await count(`SELECT count(*) FROM public.organization_person_titles WHERE relationship_id = $1`, [relationshipId]), 1, "the ended title is kept");

    await assert.rejects(K.contacts.archivePerson({ organizationId: a, personId }), (e: unknown) => e instanceof Error && e.constructor.name === "ContactStateError", "a person with an open relationship cannot be archived");
    await notFound(K.contacts.endRelationship({ organizationId: b, relationshipId }));
    await K.contacts.endRelationship({ organizationId: a, relationshipId });
    await notFound(K.contacts.archivePerson({ organizationId: b, personId }));
    await K.contacts.archivePerson({ organizationId: a, personId });
    assert.equal((await K.contacts.getOrganizationContacts(a)).contacts[0].person.recordStatus, "archived");
    await K.contacts.restorePerson({ organizationId: a, personId });
    assert.equal((await K.contacts.getOrganizationContacts(a)).contacts[0].person.recordStatus, "active");
  });

  it("insurance: renewal and cancellation are scoped to the URL company; a renewal adds a term and keeps the earlier one", async () => {
    await signInWith(...ALL);
    const insured = await organization("RenewInsured");
    const other = await organization("RenewOther");
    const insurer = await organization("RenewInsurer");
    const view = await K.insurance.createPolicy({
      organizationId: insured, insurerOrganizationId: insurer, family: "INSURANCE", policyNumber: `RN-${run}-${randomInt(1000, 9999)}`,
      termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT" }],
    });
    const renewal = { policyId: view.policy.id, termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "2000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT" }] };
    await notFound(K.insurance.renewPolicy({ ...renewal, organizationId: other }));
    assert.equal(await count(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [view.policy.id]), 1, "a wrong-company renewal changed nothing");
    await K.insurance.renewPolicy({ ...renewal, organizationId: insured });
    assert.equal(await count(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [view.policy.id]), 2, "the earlier term is kept");
  });
});
