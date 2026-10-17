// Run with `TES_TEST_FILES="test/lib/ui-recovery/drivers.db.test.ts" bash scripts/test/run-auth-tests.sh` (disposable PostgreSQL, real migrations,
// RUNTIME role). Driver operations of the UI recovery: person + driver profile + licence + relationship creation, name / relationship /
// licence / medical-period change-correct-void, company isolation, authorization, Master Register events, history and rollback.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    oi: await import("@/lib/operational-identity/service"),
    reads: await import("@/lib/operational-identity/reads"),
    detail: await import("@/lib/operational-identity/driver-reads"),
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

describe("Driver operations (real authorization, real transactions, real Master Register)", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();
  let counter = 0;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_driver_event ON public.master_register_events`).catch(() => undefined);
    await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_driver_event()`).catch(() => undefined);
    for (const fx of fixtures) await fx.cleanup().catch(() => undefined);
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]) {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability as never, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  const MANAGE = ["DRIVER_MANAGE", "DRIVER_READ"];
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `DRV ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const n = () => ++counter;
  const licenceNumber = () => `D${run}${String(n()).padStart(5, "0")}`;
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const named = (name: string) => (promise: Promise<unknown>) =>
    assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error && error.constructor.name === name, `expected ${name}, got ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)}`);
      return true;
    });
  const notFound = named("DriverNotFoundError");
  const conflict = named("DriverConflictError");
  const invalid = named("DriverValidationError");
  const state = named("DriverStateError");
  const denied = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof Error && /TesAuthorizationDeniedError|TesIdentityRequiredError/.test(error.constructor.name));
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);

  const newDriver = (organizationId: string, over: Record<string, unknown> = {}) =>
    K.oi.createDriver({
      organizationId,
      givenName: `Ada${run}`,
      familyName: `Driver${n()}`,
      email: `ada.${run}.${n()}@example.test`,
      phone: `+1403555${String(1000 + (n() % 9000)).padStart(4, "0")}`,
      relationshipType: "EMPLOYEE",
      status: "ACTIVE",
      driverNumber: `N${run}${n()}`,
      effectiveFrom: "2024-01-01",
      licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licenceNumber(), licenceClass: "AZ", issueDate: "2023-01-01", expiryDate: "2028-01-01", effectiveFrom: "2024-01-01" },
      ...over,
    });

  it("authorization: nothing is written or read without the capability; read-only cannot manage", async () => {
    const org = await organization("Auth");
    await signInWith();
    await denied(newDriver(org));
    await denied(K.detail.getOrganizationDriverDetail(org, randomUUID()));
    await denied(K.oi.checkExistingDriver(org, { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: "X1" }));
    await signInWith("DRIVER_READ");
    await denied(newDriver(org));
    assert.deepEqual(await K.reads.listOrganizationDrivers(org), []);
    await signInWith("VEHICLE_MANAGE", "CONTACT_MANAGE");
    await denied(newDriver(org));
    assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE organization_id = $1`, [org]), 0);
  });

  it("create: person, name, profile, email, phone, licence and relationship in one transaction; Master Register events hold no personal data", async () => {
    const actor = await signInWith(...MANAGE);
    const org = await organization("Create");
    const licence = licenceNumber();
    const email = `private.${run}.${n()}@example.test`;
    const familyName = `Secret${run}${n()}`;
    const created = await newDriver(org, { familyName, email, licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licence, licenceClass: "AZ", effectiveFrom: "2024-01-01" } });
    assert.equal(created.kind, "CREATED");
    const rows = await K.reads.listOrganizationDrivers(org);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].personId, created.personId);
    assert.equal(rows[0].familyName, familyName);
    assert.equal(rows[0].licence?.number, licence);
    assert.equal(rows[0].effectiveTo, null, "profile driver counts read effectiveTo");
    const detail = await K.detail.getOrganizationDriverDetail(org, created.personId);
    assert.equal(detail.names.length, 1);
    assert.equal(detail.names[0].changeReason, "INITIAL");
    assert.deepEqual(detail.channels.map((c) => c.channelType).sort(), ["EMAIL", "PHONE"]);
    const events = await eventTypes(actor.actorId);
    assert.ok(events.includes("RECORD_CREATED") && events.includes("RECORD_LINK_ESTABLISHED"));
    const raw = JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actor.actorId])).rows);
    for (const secret of [familyName, licence, email]) assert.ok(!raw.includes(secret), "the Master Register never copies names, licence numbers or emails");
  });

  it("create: the existing-driver check is licence-based; a licence that already identifies a driver is a conflict, never a second person", async () => {
    await signInWith(...MANAGE);
    const a = await organization("CheckA");
    const b = await organization("CheckB");
    const lookup = { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licenceNumber() };
    const licence = { ...lookup, effectiveFrom: "2024-01-01" };
    assert.deepEqual(await K.oi.checkExistingDriver(a, lookup), { found: false });
    const first = await newDriver(a, { licence });
    // Another company's driver: minimum disclosure (no name, no person id, no counts) and no linking.
    const match = await K.oi.checkExistingDriver(b, { ...lookup, licenceNumber: lookup.licenceNumber.toLowerCase().replace(/(.{3})/, "$1-") });
    assert.deepEqual(match, { found: true, scope: "OTHER_ORGANIZATION" });
    const sameOrg = await K.oi.checkExistingDriver(a, lookup);
    assert.equal(sameOrg.found && sameOrg.scope === "THIS_ORGANIZATION" && sameOrg.activeAtThisOrganization && sameOrg.personId === first.personId, true);
    await conflict(newDriver(b, { licence }));
    assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE licence_number_normalized = $1`, [lookup.licenceNumber.toUpperCase()]), 1);

    // Linking another company's driver is refused (no consent / identity-resolution workflow exists) and looks like an unknown person.
    await notFound(K.oi.addExistingDriver({ organizationId: b, personId: first.personId, relationshipType: "CONTRACTOR", status: "ONBOARDING", effectiveFrom: "2024-06-01" }));
    await notFound(K.oi.addExistingDriver({ organizationId: b, personId: randomUUID(), relationshipType: "CONTRACTOR", status: "ACTIVE", effectiveFrom: "2024-07-01" }));
    assert.equal((await K.reads.listOrganizationDrivers(b)).length, 0);

    // Same company: a current driver cannot be added twice; after the relationship ends the same person is re-engaged (a new relationship only).
    await conflict(K.oi.addExistingDriver({ organizationId: a, personId: first.personId, relationshipType: "CONTRACTOR", status: "ACTIVE", effectiveFrom: "2024-07-01" }));
    await K.oi.endDriverRelationship({ organizationId: a, personId: first.personId, effectiveTo: "2024-03-01" });
    const rehired = await K.oi.addExistingDriver({ organizationId: a, personId: first.personId, relationshipType: "CONTRACTOR", status: "ONBOARDING", effectiveFrom: "2024-06-01" });
    assert.ok(rehired.relationshipId);
    assert.equal(await count(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1`, [first.personId]), 1);
    assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE person_id = $1 AND organization_id = $2`, [first.personId, a]), 2);
  });

  it("create rolls back completely when the Master Register write fails (no orphan person, profile or licence)", async () => {
    await signInWith(...MANAGE);
    const org = await organization("Rollback");
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_driver_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'RECORD_LINK_ESTABLISHED' THEN RAISE EXCEPTION 'test: master register write refused'; END IF; RETURN NEW; END $$`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_driver_event BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_driver_event()`);
    const familyName = `Rollback${run}${n()}`;
    const licence = licenceNumber();
    try {
      await assert.rejects(newDriver(org, { familyName, licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licence, effectiveFrom: "2024-01-01" } }));
    } finally {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_driver_event ON public.master_register_events`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_driver_event()`);
    }
    assert.equal(await count(`SELECT count(*) FROM public.person_name_versions WHERE family_name = $1`, [familyName]), 0);
    assert.equal(await count(`SELECT count(*) FROM public.driver_licences WHERE licence_number_normalized = $1`, [licence.toUpperCase()]), 0);
    assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE organization_id = $1`, [org]), 0);
    assert.deepEqual(await K.reads.listOrganizationDrivers(org), []);
  });

  it("validation: a driver needs a first and last name, a valid type and status, and a calendar date", async () => {
    await signInWith(...MANAGE);
    const org = await organization("Validation");
    await invalid(newDriver(org, { givenName: "" }));
    await invalid(newDriver(org, { familyName: undefined }));
    await invalid(newDriver(org, { relationshipType: "TEMP" }));
    await invalid(newDriver(org, { status: "ENDED" }));
    await invalid(newDriver(org, { effectiveFrom: "2024-02-30" }));
    await invalid(newDriver(org, { email: "not-an-email" }));
    await invalid(newDriver(org, { organizationId: org, bogus: true }));
    await notFound(newDriver(randomUUID()));
    assert.equal(await count(`SELECT count(*) FROM public.organization_driver_relationships WHERE organization_id = $1`, [org]), 0);
  });

  it("company isolation: every driver operation is reachable only through the driver's own company", async () => {
    await signInWith(...MANAGE);
    const owner = await organization("Owner");
    const other = await organization("Other");
    const { personId } = await newDriver(owner);
    const before = await K.detail.getOrganizationDriverDetail(owner, personId);
    await notFound(K.detail.getOrganizationDriverDetail(other, personId));
    await notFound(K.oi.changeDriverName({ organizationId: other, personId, familyName: "Hijack" }));
    await notFound(K.oi.correctDriverName({ organizationId: other, personId, familyName: "Hijack" }));
    await notFound(K.oi.setDriverChannel({ organizationId: other, personId, channelType: "EMAIL", value: "x@example.test" }));
    await notFound(K.oi.changeDriverRelationship({ organizationId: other, personId, status: "SUSPENDED", effectiveFrom: "2025-01-01" }));
    await notFound(K.oi.correctDriverRelationship({ organizationId: other, personId, status: "SUSPENDED" }));
    await notFound(K.oi.endDriverRelationship({ organizationId: other, personId, effectiveTo: "2025-01-01" }));
    await notFound(K.oi.recordDriverLicence({ organizationId: other, personId, licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "AB", licenceNumber: licenceNumber(), effectiveFrom: "2025-01-01" } }));
    await notFound(K.oi.addMedicalPeriod({ organizationId: other, personId, qualificationType: "DOT_MEDICAL_CERTIFICATE", jurisdictionCountry: "Canada", expiresOn: "2026-01-01" }));
    assert.deepEqual(await K.detail.getOrganizationDriverDetail(owner, personId), before, "a wrong-company request changed nothing");
    assert.deepEqual(await K.reads.listOrganizationDrivers(other), []);
  });

  it("name: a real-world change keeps the old name as history; a correction keeps the wrong name flagged; one current name always", async () => {
    const actor = await signInWith(...MANAGE);
    const org = await organization("Names");
    const { personId } = await newDriver(org);
    await K.oi.changeDriverName({ organizationId: org, personId, familyName: `Married${run}${n()}` });
    let detail = await K.detail.getOrganizationDriverDetail(org, personId);
    assert.equal(detail.names.length, 2);
    assert.equal(detail.names.filter((x) => x.recordStatus === "active" && x.effectiveTo === null).length, 1);
    assert.equal(detail.names[0].effectiveTo !== null, true);
    await invalid(K.oi.changeDriverName({ organizationId: org, personId, familyName: detail.names[1].familyName }));
    await K.oi.correctDriverName({ organizationId: org, personId, givenName: `Typo${run}` });
    detail = await K.detail.getOrganizationDriverDetail(org, personId);
    assert.equal(detail.names.length, 3);
    assert.equal(detail.names.filter((x) => x.recordStatus === "corrected").length, 1);
    const current = detail.names.filter((x) => x.recordStatus === "active" && x.effectiveTo === null);
    assert.equal(current.length, 1);
    assert.equal(current[0].givenName, `Typo${run}`);
    assert.equal(current[0].changeReason, "CORRECTION");
    const events = await eventTypes(actor.actorId);
    assert.ok(events.includes("RECORD_UPDATED") && events.includes("RECORD_CORRECTED"));
    assert.equal(await count(`SELECT count(*) FROM public.person_name_versions WHERE person_id = $1`, [personId]), 3, "nothing was deleted");
  });

  it("email and phone: a first value is added, a different value is real-world history, an unchanged value is refused", async () => {
    await signInWith(...MANAGE);
    const org = await organization("Channels");
    const { personId } = await newDriver(org, { email: undefined, phone: undefined });
    assert.deepEqual((await K.detail.getOrganizationDriverDetail(org, personId)).channels, []);
    await K.oi.setDriverChannel({ organizationId: org, personId, channelType: "EMAIL", value: `first.${run}@example.test` });
    await invalid(K.oi.setDriverChannel({ organizationId: org, personId, channelType: "EMAIL", value: `FIRST.${run}@example.test` }));
    await K.oi.setDriverChannel({ organizationId: org, personId, channelType: "EMAIL", value: `second.${run}@example.test` });
    await K.oi.setDriverChannel({ organizationId: org, personId, channelType: "EMAIL", value: `typo-fixed.${run}@example.test`, mode: "correct" });
    const emails = (await K.detail.getOrganizationDriverDetail(org, personId)).channels.filter((c) => c.channelType === "EMAIL");
    assert.equal(emails.length, 3);
    assert.equal(emails.filter((c) => c.recordStatus === "active" && c.effectiveTo === null).length, 1);
    assert.equal(emails.filter((c) => c.recordStatus === "corrected").length, 1);
    await invalid(K.oi.setDriverChannel({ organizationId: org, personId, channelType: "PHONE", value: "12" }));
  });

  it("relationship: change keeps history, the same day must be a correction, correction flags the wrong row, end keeps the row, a rehire is a new relationship", async () => {
    await signInWith(...MANAGE);
    const org = await organization("Relationship");
    const number = `R${run}${n()}`;
    const { personId } = await newDriver(org, { status: "ONBOARDING", driverNumber: number, effectiveFrom: "2024-01-01" });
    await invalid(K.oi.changeDriverRelationship({ organizationId: org, personId, status: "ACTIVE", effectiveFrom: "2024-01-01" }));
    await invalid(K.oi.changeDriverRelationship({ organizationId: org, personId }));
    await K.oi.changeDriverRelationship({ organizationId: org, personId, status: "ACTIVE", effectiveFrom: "2024-03-01" });
    let rows = (await K.detail.getOrganizationDriverDetail(org, personId)).relationships;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "ONBOARDING");
    assert.equal(rows[0].effectiveTo, "2024-03-01");
    assert.equal(rows[1].status, "ACTIVE");
    assert.equal(rows[1].driverNumber, number, "the number carries over");
    assert.equal((await K.reads.listOrganizationDrivers(org))[0].status, "ACTIVE");

    await K.oi.correctDriverRelationship({ organizationId: org, personId, relationshipType: "OWNER_OPERATOR" });
    rows = (await K.detail.getOrganizationDriverDetail(org, personId)).relationships;
    assert.equal(rows.length, 3);
    assert.equal(rows.filter((r) => r.recordStatus === "corrected").length, 1);
    const current = rows.filter((r) => r.recordStatus === "active" && r.effectiveTo === null);
    assert.equal(current.length, 1);
    assert.equal(current[0].relationshipType, "OWNER_OPERATOR");
    assert.equal(current[0].effectiveFrom, "2024-03-01", "a correction inherits the business start");

    // another current driver cannot take the same number
    const rival = await newDriver(org, { driverNumber: `V${run}${n()}` });
    await conflict(K.oi.correctDriverRelationship({ organizationId: org, personId: rival.personId, driverNumber: number }));

    await invalid(K.oi.endDriverRelationship({ organizationId: org, personId, effectiveTo: "2024-03-01" }));
    await K.oi.endDriverRelationship({ organizationId: org, personId, effectiveTo: "2024-09-01" });
    assert.deepEqual((await K.reads.listOrganizationDrivers(org)).map((r) => r.personId), [rival.personId], "an ended driver leaves the current list");
    const ended = (await K.detail.getOrganizationDriverDetail(org, personId)).relationships.find((r) => r.status === "ENDED");
    assert.equal(ended?.effectiveTo, "2024-09-01");
    await state(K.oi.changeDriverRelationship({ organizationId: org, personId, status: "ACTIVE", effectiveFrom: "2025-01-01" }));
    await state(K.oi.recordDriverLicence({ organizationId: org, personId, licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licenceNumber(), effectiveFrom: "2025-01-01" } }));
    // rehire = a new relationship through the same-person resolution
    await K.oi.addExistingDriver({ organizationId: org, personId, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2025-02-01" });
    assert.equal((await K.detail.getOrganizationDriverDetail(org, personId)).relationships.length, 4, "original + corrected + replacement (ended in place) + rehire");
  });

  it("licence: a same-jurisdiction licence is a replacement (history), another jurisdiction coexists, a taken number conflicts, correct and void keep the row", async () => {
    await signInWith(...MANAGE);
    const org = await organization("Licences");
    const { personId } = await newDriver(org, { licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licenceNumber(), licenceClass: "G", effectiveFrom: "2024-01-01" } });
    const stranger = await newDriver(org);
    const strangerLicence = (await K.reads.listOrganizationDrivers(org)).find((r) => r.personId === stranger.personId)!.licence!;
    const input = (over: Record<string, unknown>) => ({ organizationId: org, personId, licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: licenceNumber(), effectiveFrom: "2025-01-01", ...over } });

    await conflict(K.oi.recordDriverLicence(input({ licenceNumber: strangerLicence.number })));
    await invalid(K.oi.recordDriverLicence(input({ effectiveFrom: "2024-01-01" })));
    const replaced = await K.oi.recordDriverLicence(input({ licenceClass: "AZ" }));
    assert.ok(replaced.replacedLicenceId);
    const other = await K.oi.recordDriverLicence(input({ jurisdictionRegion: "AB" }));
    assert.equal(other.replacedLicenceId, null, "a licence in another jurisdiction coexists");
    let licences = (await K.detail.getOrganizationDriverDetail(org, personId)).licences;
    assert.equal(licences.length, 3);
    assert.equal(licences.filter((l) => l.recordStatus === "active" && l.effectiveTo === null).length, 2);

    const fixed = await K.oi.correctDriverLicence({ organizationId: org, personId, licenceId: replaced.licenceId, licenceClass: "DZ", expiryDate: "2030-01-01" });
    licences = (await K.detail.getOrganizationDriverDetail(org, personId)).licences;
    assert.equal(licences.find((l) => l.id === replaced.licenceId)?.recordStatus, "corrected");
    assert.equal(licences.find((l) => l.id === fixed.licenceId)?.licenceClass, "DZ");
    assert.equal(licences.find((l) => l.id === fixed.licenceId)?.effectiveFrom, "2025-01-01");
    await invalid(K.oi.correctDriverLicence({ organizationId: org, personId, licenceId: fixed.licenceId, licenceClass: "DZ", expiryDate: "2030-01-01" }));
    await notFound(K.oi.correctDriverLicence({ organizationId: org, personId, licenceId: replaced.licenceId, licenceClass: "A" }));

    await K.oi.voidDriverLicence({ organizationId: org, personId, licenceId: other.licenceId });
    licences = (await K.detail.getOrganizationDriverDetail(org, personId)).licences;
    assert.equal(licences.find((l) => l.id === other.licenceId)?.recordStatus, "voided");
    assert.equal(licences.length, 4, "nothing was deleted");
    await notFound(K.oi.voidDriverLicence({ organizationId: org, personId, licenceId: other.licenceId }));
  });

  it("medical qualification periods: add, duplicate refused, renewal keeps history, correct and void flag the row", async () => {
    const actor = await signInWith(...MANAGE);
    const org = await organization("Medical");
    const { personId } = await newDriver(org);
    const base = { organizationId: org, personId, qualificationType: "DOT_MEDICAL_CERTIFICATE", jurisdictionCountry: "Canada" };
    const first = await K.oi.addMedicalPeriod({ ...base, issuedOn: "2024-01-10", expiresOn: "2026-01-10", effectiveFrom: "2024-01-10" });
    await conflict(K.oi.addMedicalPeriod({ ...base, issuedOn: "2024-02-10", expiresOn: "2026-02-10", effectiveFrom: "2024-02-10" }));
    await invalid(K.oi.addMedicalPeriod({ ...base, issuedOn: "2024-02-10", expiresOn: "2024-01-01" }));
    await invalid(K.oi.addMedicalPeriod({ ...base, qualificationType: "not valid" }));
    await invalid(K.oi.changeMedicalPeriod({ organizationId: org, personId, periodId: first.periodId, issuedOn: "2025-01-10", expiresOn: "2027-01-10", effectiveFrom: "2024-01-10" }));
    const renewed = await K.oi.changeMedicalPeriod({ organizationId: org, personId, periodId: first.periodId, issuedOn: "2026-01-05", expiresOn: "2028-01-05", effectiveFrom: "2026-01-05" });
    let periods = (await K.detail.getOrganizationDriverDetail(org, personId)).medicalPeriods;
    assert.equal(periods.length, 2);
    assert.equal(periods.find((p) => p.id === first.periodId)?.effectiveTo, "2026-01-05");
    assert.equal(periods.find((p) => p.id === renewed.periodId)?.expiresOn, "2028-01-05");

    const fixed = await K.oi.correctMedicalPeriod({ organizationId: org, personId, periodId: renewed.periodId, expiresOn: "2028-01-04" });
    periods = (await K.detail.getOrganizationDriverDetail(org, personId)).medicalPeriods;
    assert.equal(periods.find((p) => p.id === renewed.periodId)?.recordStatus, "corrected");
    assert.equal(periods.find((p) => p.id === fixed.periodId)?.expiresOn, "2028-01-04");
    assert.equal(periods.find((p) => p.id === fixed.periodId)?.effectiveFrom, "2026-01-05");
    await invalid(K.oi.correctMedicalPeriod({ organizationId: org, personId, periodId: fixed.periodId, expiresOn: "2028-01-04" }));

    await K.oi.voidMedicalPeriod({ organizationId: org, personId, periodId: fixed.periodId });
    periods = (await K.detail.getOrganizationDriverDetail(org, personId)).medicalPeriods;
    assert.equal(periods.find((p) => p.id === fixed.periodId)?.recordStatus, "voided");
    assert.equal(periods.length, 3, "nothing was deleted");
    // after the void the kind has no current period, so a new one can be added
    await K.oi.addMedicalPeriod({ ...base, issuedOn: "2026-03-01", expiresOn: "2028-03-01", effectiveFrom: "2026-03-01" });
    const events = await eventTypes(actor.actorId);
    assert.ok(events.filter((t) => t === "RECORD_CORRECTED").length >= 2);
  });

  it("the runtime role cannot delete driver history and sees no driver rows outside an authorized transaction (RLS)", async () => {
    await signInWith(...MANAGE);
    const org = await organization("Backstop");
    const { personId } = await newDriver(org);
    await K.oi.addMedicalPeriod({ organizationId: org, personId, qualificationType: "DOT_MEDICAL_CERTIFICATE", jurisdictionCountry: "Canada", expiresOn: "2026-01-01", effectiveFrom: "2025-01-01" });
    for (const table of ["driver_profiles", "driver_licences", "organization_driver_relationships", "driver_medical_qualification_periods"]) {
      const visible = await pools.runtime.query(`SELECT count(*)::int AS n FROM public.${table}`);
      assert.equal(visible.rows[0].n, 0, `${table} is invisible without an authorized system context`);
      await assert.rejects(pools.runtime.query(`DELETE FROM public.${table}`));
    }
    assert.equal(await count(`SELECT count(*) FROM public.driver_medical_qualification_periods WHERE person_id = $1`, [personId]), 1);
  });
});
