// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// The restored Authorities and Tax Filing workspaces are wired to the canonical operating-authorities and tax-registrations
// domains. These tests drive those domains through the REAL authorization wrappers and the RUNTIME role, exactly as the routes
// behind the restored UI do, and check the restored UI's mapping of the resulting views: company isolation, real change vs
// correction history, Master Register events, authorization and rollback.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    oa: await import("@/lib/operating-authorities/service"),
    tr: await import("@/lib/tax-registrations/service"),
    profile: await import("@/lib/company-profile/service"),
    authorityMap: await import("@/src/restored/authorities/adapter"),
    taxModel: await import("@/src/restored/tax-filing/model"),
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

const AUTHORITY_CAPS = ["ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ"];
const TAX_CAPS = ["TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ"];
const PROFILE_CAPS = ["COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ"];

describe("Restored Authorities and Tax Filing over the canonical registries", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  const run = randomUUID().slice(0, 6).toUpperCase();
  let counter = 0;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
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
    return actor;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `UIR ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const digits = () => String(2_000_000 + randomInt(0, 7_000_000)) + String(++counter);
  const alnum = (prefix: string) => `${prefix}${randomInt(100000, 999999)}${++counter}`;
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type, event_id`, [actorId])).rows.map((row) => row.event_type);
  const named = (name: string) => (error: unknown) => error instanceof Error && error.constructor.name === name;
  const endsWith = (suffix: string) => (error: unknown) => error instanceof Error && error.constructor.name.endsWith(suffix);

  async function refuseMasterRegisterEvent(eventType: string) {
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = '${eventType}' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
        RETURN NEW;
      END $$`);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
    cleanups.push(async () => {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Authorities
  // ---------------------------------------------------------------------------------------------------------------

  it("authorities: every action stays inside the URL company; another company's authority is not found and nothing changes", async () => {
    await signInWith(...AUTHORITY_CAPS);
    const a = await organization("AuthA");
    const b = await organization("AuthB");
    const { view } = await K.oa.createAuthority({ organizationId: a, kind: "MC", number: `MC-${digits()}` });
    const target = { organizationId: b, authorityId: view.authority.id };

    await assert.rejects(K.oa.changeAuthorityStatus({ ...target, status: "SUSPENDED" }), endsWith("NotFoundError"));
    await assert.rejects(K.oa.correctAuthorityStatus({ ...target, status: "PENDING" }), endsWith("NotFoundError"));
    await assert.rejects(K.oa.archiveAuthority(target), endsWith("NotFoundError"));
    await assert.rejects(K.oa.restoreAuthority(target), endsWith("NotFoundError"));
    await assert.rejects(K.oa.correctAuthorityVersion({ ...target, number: `MC-${digits()}` }), endsWith("NotFoundError"));
    await assert.rejects(K.oa.changeAuthorityVersion({ ...target, expiresOn: null }), endsWith("NotFoundError"));

    const own = (await K.oa.getOrganizationAuthorities(a)).authorities[0];
    assert.equal(own.authority.recordStatus, "active", "a wrong-company request changed nothing");
    assert.equal(own.current.status?.authorityStatus, "ACTIVE");
    assert.equal(own.statusPeriods.length, 1);
    assert.deepEqual((await K.oa.getOrganizationAuthorities(b)).authorities, [], "the other company has an honest empty list");
  });

  it("authorities: a real change keeps history, a correction flags the wrong value, a national number only corrects, and the restored mapping shows all of it", async () => {
    const actor = await signInWith(...AUTHORITY_CAPS);
    const o = await organization("AuthHistory");
    const usdot = digits();
    const created = await K.oa.createAuthority({ organizationId: o, kind: "USDOT", number: usdot });
    const usdotId = created.view.authority.id;

    // USDOT never changes in place: a "real-world change" of the number is refused, a correction is accepted and flagged.
    await assert.rejects(K.oa.changeAuthorityVersion({ organizationId: o, authorityId: usdotId, number: digits() }), endsWith("ValidationError"));
    const wrong = digits();
    const corrected = await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: usdotId, number: wrong });
    assert.equal(corrected.view.current.version?.numberDisplay, wrong);
    assert.equal(corrected.view.versions.length, 2, "both versions are kept");
    assert.equal(corrected.view.versions.filter((v) => v.recordStatus === "corrected").length, 1, "the wrong number is flagged, not deleted");

    // An IRP base move is a REAL change: the earlier base stays as genuine history.
    const irp = await K.oa.createAuthority({ organizationId: o, kind: "IRP", number: alnum("IRP"), jurisdiction: { country: "US", region: "TX" }, effectiveFrom: "2022-01-01T00:00:00Z" });
    const irpId = irp.view.authority.id;
    const moved = await K.oa.changeAuthorityVersion({ organizationId: o, authorityId: irpId, jurisdiction: { country: "US", region: "OK" } });
    assert.equal(moved.view.current.version?.jurisdictionRegion, "OK");
    assert.equal(moved.view.versions.filter((v) => v.recordStatus === "active").length, 2, "the earlier base is genuine history");
    // A wrongly recorded base is a correction instead.
    const fixed = await K.oa.correctAuthorityVersion({ organizationId: o, authorityId: irpId, jurisdiction: { country: "US", region: "KS" } });
    assert.equal(fixed.view.versions.filter((v) => v.recordStatus === "corrected").length, 1);

    // Status: a real transition and a correction; archive and restore keep everything.
    await K.oa.changeAuthorityStatus({ organizationId: o, authorityId: irpId, status: "SUSPENDED" });
    const afterCorrection = await K.oa.correctAuthorityStatus({ organizationId: o, authorityId: irpId, status: "INACTIVE" });
    assert.equal(afterCorrection.current.status?.authorityStatus, "INACTIVE");
    await K.oa.archiveAuthority({ organizationId: o, authorityId: irpId });
    await assert.rejects(K.oa.changeAuthorityStatus({ organizationId: o, authorityId: irpId, status: "ACTIVE" }), endsWith("StateError"), "an archived authority cannot change");
    await K.oa.restoreAuthority({ organizationId: o, authorityId: irpId });

    const views = (await K.oa.getOrganizationAuthorities(o)).authorities;
    const mappedIrp = K.authorityMap.mapAuthorityView(views.find((v) => v.authority.id === irpId)!);
    assert.equal(mappedIrp.authorityType, "IRP");
    assert.equal(mappedIrp.category, "operating_registration");
    assert.equal(mappedIrp.canonicalKind, "IRP");
    assert.equal(mappedIrp.status, "Inactive");
    assert.equal(mappedIrp.jurisdictionCode, "KS");
    assert.equal(mappedIrp.country, "United States");
    assert.equal(mappedIrp.isArchived, false);
    assert.ok((mappedIrp.versions ?? []).some((version) => version.corrected), "the correction is flagged in the restored history");
    assert.ok((mappedIrp.statusPeriods ?? []).some((period) => period.status === "Suspended"), "the suspension stays in the status history");
    const mappedUsdot = K.authorityMap.mapAuthorityView(views.find((v) => v.authority.id === usdotId)!);
    assert.equal(mappedUsdot.category, "us_federal");
    assert.equal(mappedUsdot.authorityType, "USDOT");
    assert.equal(mappedUsdot.number, wrong);
    assert.equal(mappedUsdot.jurisdictionCode, "US-FED");
    assert.equal(mappedUsdot.issuingAuthority, "FMCSA");
    assert.equal(mappedUsdot.expiryDate, undefined, "USDOT numbers do not expire (shown as Continuous)");

    // Every operation recorded its own Master Register event.
    const events = await eventTypes(actor.actorId);
    for (const expected of ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_ARCHIVED", "RECORD_RESTORED"]) {
      assert.ok(events.includes(expected), `${expected} was recorded`);
    }
    assert.equal(await count(`SELECT count(*) FROM public.operating_authority_versions WHERE authority_id = $1`, [usdotId]), 2, "no physical deletion");
  });

  it("authorities: the registry number check names the holder only with registry access, and a collision blocks creation", async () => {
    await signInWith(...AUTHORITY_CAPS);
    const a = await organization("CheckA");
    const b = await organization("CheckB");
    const number = `MC-${digits()}`;
    await K.oa.createAuthority({ organizationId: a, kind: "MC", number });
    const free = await K.oa.checkAuthorityNumber({ kind: "MC", number: `MC-${digits()}` });
    assert.equal(free.registered, false);
    const held = await K.oa.checkAuthorityNumber({ kind: "MC", number });
    assert.equal(held.registered, true);
    assert.ok(held.match?.organizationLegalName, "with registry access the holder is named");
    await assert.rejects(K.oa.createAuthority({ organizationId: b, kind: "MC", number }), named("AuthorityNumberCollisionError"));
    assert.deepEqual((await K.oa.getOrganizationAuthorities(b)).authorities, [], "the refused creation left nothing behind");
  });

  it("authorities: authorization is enforced for reads, writes and the number check", async () => {
    await signInWith();
    const o = await organization("AuthDenied");
    await assert.rejects(K.oa.getOrganizationAuthorities(o), named("TesAuthorizationDeniedError"));
    await assert.rejects(K.oa.createAuthority({ organizationId: o, kind: "MC", number: `MC-${digits()}` }), named("TesAuthorizationDeniedError"));
    await assert.rejects(K.oa.checkAuthorityNumber({ kind: "MC", number: `MC-${digits()}` }), named("TesAuthorizationDeniedError"));

    await signInWith("ORGANIZATION_REGISTRY_READ");
    await assert.rejects(K.oa.createAuthority({ organizationId: o, kind: "MC", number: `MC-${digits()}` }), named("TesAuthorizationDeniedError"), "reading is not writing");
    assert.deepEqual((await K.oa.getOrganizationAuthorities(o)).authorities, []);
  });

  it("authorities: a refused Master Register event rolls the whole operation back (no authority, no version, no status)", async () => {
    await signInWith(...AUTHORITY_CAPS);
    const o = await organization("AuthRollback");
    await refuseMasterRegisterEvent("RECORD_CREATED");
    const number = `MC-${digits()}`;
    await assert.rejects(K.oa.createAuthority({ organizationId: o, kind: "MC", number }));
    assert.equal(await count(`SELECT count(*) FROM public.operating_authorities WHERE organization_id = $1`, [o]), 0, "no orphan authority");
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    const retry = await K.oa.createAuthority({ organizationId: o, kind: "MC", number });
    assert.equal(retry.view.current.version?.numberDisplay, number, "the number was free after the rollback");
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Tax registrations
  // ---------------------------------------------------------------------------------------------------------------

  it("tax: every action stays inside the URL company; another company's registration is not found and nothing changes", async () => {
    await signInWith(...TAX_CAPS);
    const a = await organization("TaxA");
    const b = await organization("TaxB");
    const { view } = await K.tr.createRegistration({ organizationId: a, program: "NY_HUT", number: `NY${digits()}` });
    const target = { organizationId: b, registrationId: view.registration.id };

    await assert.rejects(K.tr.changeRegistrationStatus({ ...target, status: "SUSPENDED" }), endsWith("NotFoundError"));
    await assert.rejects(K.tr.correctRegistrationStatus({ ...target, status: "PENDING" }), endsWith("NotFoundError"));
    await assert.rejects(K.tr.archiveRegistration(target), endsWith("NotFoundError"));
    await assert.rejects(K.tr.restoreRegistration(target), endsWith("NotFoundError"));
    await assert.rejects(K.tr.correctRegistrationVersion({ ...target, number: `NY${digits()}` }), endsWith("NotFoundError"));
    await assert.rejects(K.tr.changeRegistrationVersion({ ...target, expiresOn: null }), endsWith("NotFoundError"));

    const own = (await K.tr.getOrganizationRegistrations(a)).registrations[0];
    assert.equal(own.registration.recordStatus, "active");
    assert.equal(own.current.status?.registrationStatus, "ACTIVE");
    assert.deepEqual((await K.tr.getOrganizationRegistrations(b)).registrations, []);
  });

  it("tax: a renewed period is a real change, an IFTA base move changes in place, other programs only correct, and the restored mapping shows it", async () => {
    const actor = await signInWith(...TAX_CAPS);
    const o = await organization("TaxHistory");
    const ifta = await K.tr.createRegistration({ organizationId: o, program: "IFTA", number: alnum("IF"), jurisdiction: { country: "US", region: "TX" }, issuedOn: "2023-01-01", expiresOn: "2023-12-31", effectiveFrom: "2023-01-01T00:00:00Z" });
    const iftaId = ifta.view.registration.id;
    const renewed = await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: iftaId, issuedOn: "2024-01-01", expiresOn: "2024-12-31" });
    assert.equal(renewed.view.versions.filter((v) => v.recordStatus === "active").length, 2, "the earlier licence period is history");
    const moved = await K.tr.changeRegistrationVersion({ organizationId: o, registrationId: iftaId, jurisdiction: { country: "US", region: "OK" } });
    assert.equal(moved.view.current.version?.jurisdictionRegion, "OK", "an IFTA base move changes in place");

    const nyhut = await K.tr.createRegistration({ organizationId: o, program: "NY_HUT", number: alnum("NY"), effectiveFrom: "2024-01-01T00:00:00Z" });
    const nyId = nyhut.view.registration.id;
    await assert.rejects(K.tr.changeRegistrationVersion({ organizationId: o, registrationId: nyId, number: alnum("NY") }), endsWith("ValidationError"), "a non-IFTA number cannot change in place");
    const fixed = await K.tr.correctRegistrationVersion({ organizationId: o, registrationId: nyId, number: alnum("NY") });
    assert.equal(fixed.view.versions.filter((v) => v.recordStatus === "corrected").length, 1, "the wrong number is flagged, not deleted");

    // Closing records the closure moment as the status period start; a wrong status is corrected, not overwritten.
    await K.tr.changeRegistrationStatus({ organizationId: o, registrationId: nyId, status: "CLOSED", effectiveFrom: "2024-06-30T00:00:00Z" });
    const closedView = (await K.tr.getOrganizationRegistrations(o)).registrations.find((v) => v.registration.id === nyId)!;
    const closed = K.taxModel.mapRegistrationView(closedView)!;
    assert.equal(closed.accountStatus, "Closed");
    assert.equal(closed.closureDate, "2024-06-30", "the closure date is the date the status became Closed");
    assert.equal(closed.filingFrequency, "not-set", "no filing frequency is recorded canonically, so none is shown");
    assert.deepEqual(closed.frequencyHistory, []);
    assert.equal(closed.taxCode, "ny_hut");
    await K.tr.correctRegistrationStatus({ organizationId: o, registrationId: nyId, status: "ACTIVE" });
    await K.tr.archiveRegistration({ organizationId: o, registrationId: nyId });
    await assert.rejects(K.tr.changeRegistrationStatus({ organizationId: o, registrationId: nyId, status: "SUSPENDED" }), endsWith("StateError"));
    await K.tr.restoreRegistration({ organizationId: o, registrationId: nyId });

    const views = (await K.tr.getOrganizationRegistrations(o)).registrations;
    const mappedIfta = K.taxModel.mapRegistrationView(views.find((v) => v.registration.id === iftaId)!)!;
    assert.equal(mappedIfta.taxCode, "ifta");
    assert.equal(mappedIfta.jurisdictionRegion, "OK");
    assert.equal(mappedIfta.issuedOn, "2024-01-01");
    assert.equal(mappedIfta.expiresOn, "2024-12-31");
    assert.equal(mappedIfta.persisted, true);
    assert.ok((mappedIfta.versions ?? []).length >= 3);

    const events = await eventTypes(actor.actorId);
    for (const expected of ["RECORD_CREATED", "RECORD_UPDATED", "RECORD_CORRECTED", "RECORD_STATUS_CHANGED", "RECORD_ARCHIVED", "RECORD_RESTORED"]) {
      assert.ok(events.includes(expected), `${expected} was recorded`);
    }
  });

  it("tax: SCAC and the CA carrier code are canonical but not original tax programs, and Form 2290 has no registration identity", async () => {
    await signInWith(...TAX_CAPS);
    const o = await organization("TaxExtra");
    const scac = await K.tr.createRegistration({ organizationId: o, program: "SCAC", number: "TQXZ" });
    assert.equal(K.taxModel.mapRegistrationView(scac.view), null, "not part of the original tax workspace (kept in the simplified registry list)");
    assert.equal(K.taxModel.PROGRAM_BY_TAX_CODE.form_2290, null);
    const programs = Object.values(K.taxModel.PROGRAM_BY_TAX_CODE).filter((program) => program !== null);
    assert.equal(programs.length, 10, "ten of the eleven original programs have a canonical registration program");
  });

  it("tax: applicability comes from the canonical company-profile TAX rules and 'not configured' stays honest", async () => {
    await signInWith(...TAX_CAPS, ...PROFILE_CAPS);
    const a = await organization("TaxRulesA");
    const b = await organization("TaxRulesB");
    const rule = (name: string, view: Awaited<ReturnType<Kit["profile"]["getCompanyProfile"]>>) => view.rules.find((entry) => entry.rule.code === name);

    assert.equal(K.taxModel.applicabilityFromCanonical(rule("IFTA", await K.profile.getCompanyProfile(a))?.effective), "not-configured", "nothing is assumed");
    await K.profile.setRuleApplicability({ organizationId: a, ruleCode: "IFTA", applicability: "APPLIES" });
    await K.profile.setRuleApplicability({ organizationId: a, ruleCode: "NY_HUT", applicability: "DOES_NOT_APPLY" });
    const viewA = await K.profile.getCompanyProfile(a);
    assert.equal(K.taxModel.applicabilityFromCanonical(rule("IFTA", viewA)?.effective), "applies");
    assert.equal(K.taxModel.applicabilityFromCanonical(rule("NY_HUT", viewA)?.effective), "does-not-apply");
    for (const [taxCode, ruleCode] of Object.entries(K.taxModel.RULE_CODE_BY_TAX_CODE)) {
      assert.ok(rule(ruleCode, viewA), `${taxCode} maps to catalogue rule ${ruleCode}`);
    }
    const viewB = await K.profile.getCompanyProfile(b);
    assert.equal(K.taxModel.applicabilityFromCanonical(rule("IFTA", viewB)?.effective), "not-configured", "another company's assertion does not apply here");
  });

  it("tax: authorization is enforced and a refused Master Register event rolls the creation back", async () => {
    await signInWith();
    const o = await organization("TaxDenied");
    await assert.rejects(K.tr.getOrganizationRegistrations(o), named("TesAuthorizationDeniedError"));
    await assert.rejects(K.tr.createRegistration({ organizationId: o, program: "KYU", number: alnum("KY") }), named("TesAuthorizationDeniedError"));

    await signInWith("TAX_REGISTRATION_MANAGE");
    await assert.rejects(K.tr.getOrganizationRegistrations(o), named("TesAuthorizationDeniedError"), "MANAGE alone cannot read");
    await assert.rejects(K.tr.checkRegistrationNumber({ program: "KYU", number: alnum("KY") }), named("TesAuthorizationDeniedError"));

    await signInWith(...TAX_CAPS);
    await refuseMasterRegisterEvent("RECORD_CREATED");
    const number = alnum("KY");
    await assert.rejects(K.tr.createRegistration({ organizationId: o, program: "KYU", number }));
    assert.equal(await count(`SELECT count(*) FROM public.registrations WHERE organization_id = $1`, [o]), 0, "no orphan registration");
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    const retry = await K.tr.createRegistration({ organizationId: o, program: "KYU", number });
    assert.equal(retry.view.current.version?.numberDisplay, number);
    const check = await K.tr.checkRegistrationNumber({ program: "KYU", number });
    assert.equal(check.registered, true);
  });
});
