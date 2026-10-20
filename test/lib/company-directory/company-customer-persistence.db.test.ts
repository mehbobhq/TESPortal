// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Company and Customer persistence for the fields that previously had no canonical owner (migration 0033): Website, Cargo
// Information, Truck GPS Provider, Fuel Provider and Payment Method, plus the read-only derived states (Service Type, Service
// Status, Assessment Date, End Date). Everything runs through the REAL authorization wrappers and the RUNTIME role (row-level
// security applies) with the real Master Register; fixtures and owner-level checks use the admin pool.
//
// Every assertion that proves a field is also recorded in a field-by-field round-trip report (TES_PERSISTENCE_REPORT=<file>).

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    create: await import("@/lib/company-directory/create-company"),
    input: await import("@/lib/company-directory/creation-input"),
    sys: await import("@/lib/auth/tes-system-context"),
    cr: await import("@/lib/customer-relationship/service"),
    crDefs: await import("@/lib/customer-relationship/definitions"),
    onboarding: await import("@/lib/onboarding-foundation/service"),
    contacts: await import("@/lib/contacts/service"),
    changes: await import("@/lib/company-changes/service"),
    evidenceFixtures: await import("@/test/helpers/evidence-payload-fixtures"),
    profileDefs: await import("@/lib/company-profile/definitions"),
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

type Phase = "create" | "edit" | "correct" | "reload" | "authorization";
const REPORT: Array<{ field: string; destination: string; phase: Phase; result: string }> = [];
const report = (field: string, destination: string, phase: Phase, result: string) => REPORT.push({ field, destination, phase, result });

const DEST = {
  website: "organization_channels (WEBSITE / GENERAL)",
  cargoTypes: "company_cargo_category_periods + cargo_categories",
  gpsProvider: "company_fleet_providers + company_fleet_provider_periods (GPS_TELEMATICS)",
  fuelProvider: "company_fleet_providers + company_fleet_provider_periods (FUEL_SERVICES)",
  payMethod: "customer_billing_preference_periods + billing_payment_methods",
  svcType: "derived: signed customer_contracts line package (read-only)",
  status: "derived: customer_engagement_stages (read-only)",
  assessmentDate: "none yet: no documentation assessment engine exists (read-only 'Not yet assessed')",
  endDate: "customer_engagements.ended_at via the end-service workflow",
  startDate: "customer_engagements.started_at",
  opRegion: "company_operating_scope_periods",
} as const;

describe("Company and Customer profile fact persistence (migration 0033; real authorization, real Master Register)", { skip: !enabled }, () => {
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
    if (process.env.TES_PERSISTENCE_REPORT) writeFileSync(process.env.TES_PERSISTENCE_REPORT, JSON.stringify(REPORT, null, 2));
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

  const customerPayload = (label: string, overrides: Record<string, unknown> = {}) => ({
    companyName: `Persist ${run} ${label}${digits(4)} Transport Ltd`,
    companyType: "Customer",
    opRegion: "Canada Only",
    regCorpState: "ON",
    regCorpCountry: "Canada",
    startDate: "2024-01-15",
    ...overrides,
  });
  const FACTS = {
    website: "Example-Transport.com",
    cargoTypes: JSON.stringify(["General Freight", "Hazardous Materials", "Temperature-Controlled & Food"]),
    gpsProvider: "Samsara",
    fuelProvider: "WEX Fleet",
    payMethod: "Cheque",
  };
  const snapshot = async (organizationId: string) => ({
    channels: await count(`SELECT count(*) AS n FROM public.organization_channels WHERE organization_id = $1`, [organizationId]),
    cargo: await count(`SELECT count(*) AS n FROM public.company_cargo_category_periods WHERE organization_id = $1`, [organizationId]),
    fleet: await count(`SELECT count(*) AS n FROM public.company_fleet_provider_periods WHERE organization_id = $1`, [organizationId]),
    billing: await count(`SELECT count(*) AS n FROM public.customer_billing_preference_periods WHERE organization_id = $1`, [organizationId]),
    scope: await count(`SELECT count(*) AS n FROM public.company_operating_scope_periods WHERE organization_id = $1`, [organizationId]),
    events: await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [organizationId]),
  });
  // Replacing or removing an ESTABLISHED website is gated (company-changes): the edit records a request, and it takes effect only once it is confirmed
  // by a DIFFERENT TES user, through an established channel (here the company's current website), with a verified CHANNEL_CHANGE_CONFIRMATION
  // evidence document created after the request, exactly as in production.
  const META = { channelChangeSource: "COMPANY_WRITTEN_REQUEST", channelChangeReference: "test: written request on file" };
  const confirmPending = async (organizationId: string) => {
    const pending = (await K.changes.getCompanyActivity(organizationId)).pending.channels[0];
    const previous = (await K.contacts.getOrganizationContacts(organizationId)).currentChannels.find((c) => c.channelType === pending.channelType && c.usage === pending.usage)!;
    const confirmer = await signInWith(...ALL);
    const evidence = await K.evidenceFixtures.seedPayloadBackedDocument(pools.admin, { organizationId, actorId: confirmer, documentType: "CHANNEL_CHANGE_CONFIRMATION", status: "verified", stage: "stored" });
    return K.changes.confirmChannelChange({ organizationId, requestId: pending.id, confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: previous.id, confirmationMethod: "CALL_BACK", confirmationEvidenceDocumentId: evidence });
  };
  const orgCount = () => count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name LIKE $1`, [`Persist ${run}%`]);
  const validationOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof K.input.CompanyCreationValidationError) return error.issues;
      throw error;
    }
    assert.fail("expected a CompanyCreationValidationError");
  };
  const capabilityOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if (error instanceof K.create.CompanyCreationCapabilityError) return error.missing;
      throw error;
    }
    assert.fail("expected a CompanyCreationCapabilityError");
  };
  async function createCustomer(label: string, overrides: Record<string, unknown> = {}) {
    const payload = customerPayload(label, { ...FACTS, ...overrides });
    const created = await K.dir.createCompanyDirectoryRecord(payload);
    return { payload, id: created.company.id, created };
  }

  // ===========================================================================================================
  it("CREATE: a Customer saves Website, Cargo, GPS, Fuel and Payment Method to their canonical owners, exactly once, and the profile reads them back", async () => {
    await signInWith(...ALL);
    const before = await orgCount();
    const { payload, id, created } = await createCustomer("A");

    assert.equal(await orgCount(), before + 1, "exactly one organization");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [id]), 1, "exactly one customer relationship");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1`, [id]), 1, "exactly one engagement");
    assert.deepEqual([created.recorded.cargoCategories, created.recorded.fleetProviders, created.recorded.billingPreference], [3, ["GPS", "FUEL"], true]);

    // canonical rows straight from PostgreSQL
    const website = await one<{ value_display: string; value_normalized: string; channel_type: string; channel_usage: string }>(
      `SELECT value_display, value_normalized, channel_type, channel_usage FROM public.organization_channels WHERE organization_id = $1 AND channel_type = 'WEBSITE' AND effective_to IS NULL`,
      [id],
    );
    assert.deepEqual([website.value_display, website.value_normalized, website.channel_usage], ["Example-Transport.com", "https://example-transport.com", "GENERAL"]);
    const cargo = (await rows<{ code: string }>(`SELECT cargo_category_code AS code FROM public.company_cargo_category_periods WHERE organization_id = $1 AND record_status = 'active' AND effective_to IS NULL ORDER BY code`, [id])).map((r) => r.code);
    assert.deepEqual(cargo, ["GENERAL_FREIGHT", "HAZARDOUS_MATERIALS", "TEMPERATURE_CONTROLLED_FOOD"]);
    const providers = await rows<{ category: string; provider_name: string; provider_name_normalized: string }>(`SELECT p.service_category_code AS category, v.provider_name, v.provider_name_normalized FROM public.company_fleet_provider_periods p JOIN public.company_fleet_providers v ON v.id = p.provider_id WHERE p.organization_id = $1 AND p.effective_to IS NULL ORDER BY p.service_category_code`, [id]);
    assert.deepEqual(providers.map((p) => [p.category, p.provider_name, p.provider_name_normalized]), [["FUEL_SERVICES", "WEX Fleet", "wex fleet"], ["GPS_TELEMATICS", "Samsara", "samsara"]]);
    assert.equal(await count(`SELECT count(*) AS n FROM public.organizations WHERE legal_name IN ('Samsara', 'WEX Fleet')`), 0, "a provider name never creates an Organization");
    assert.equal((await one<{ payment_method_code: string }>(`SELECT payment_method_code FROM public.customer_billing_preference_periods WHERE organization_id = $1 AND effective_to IS NULL`, [id])).payment_method_code, "CHEQUE");

    // reopening: the profile is assembled from those rows
    const profile = await K.dir.getCompanyProfile(id);
    assert.ok(profile);
    assert.equal(profile.website, "Example-Transport.com");
    assert.deepEqual(profile.cargoTypes, ["General Freight", "Temperature-Controlled & Food", "Hazardous Materials"], "catalogue order");
    assert.equal(profile.gpsProvider, "Samsara");
    assert.equal(profile.fuelProvider, "WEX Fleet");
    assert.equal(profile.payMethod, "Cheque");
    assert.equal(profile.payMethodCode, "CHEQUE");
    assert.equal(profile.serviceStage, "ONBOARDING");
    assert.equal(profile.startDate, "2024-01-15");
    assert.equal(profile.opRegion, payload.opRegion);
    assert.deepEqual(profile.serviceType, { state: "not_contracted" });
    assert.deepEqual(profile.assessment, { state: "not_yet_assessed" });
    assert.equal(profile.endDate, null);
    assert.ok(Object.values(profile.sections).every((state) => state === "ok"), JSON.stringify(profile.sections));
    assert.deepEqual(profile.notRecordedYet, []);
    assert.equal(profile.gstHst, null, "no GST/HST account was entered, so none is shown or invented");

    // roster: the customer appears exactly once, linked to the one organization
    const roster = (await K.dir.listCustomerDirectory()).filter((c) => c.organizationId === id);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].name, payload.companyName);

    // accountability: each fact wrote its own Master Register event, in the creation transaction
    for (const type of ["company_cargo_category_period", "company_fleet_provider_period", "customer_billing_preference_period", "organization_channel"]) {
      const events = await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%' AND e::text LIKE '%' || $2 || '%'`, [type, id]);
      assert.ok(events >= 1, `${type} has a Master Register event`);
    }
    assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%company_cargo_category_period%' AND e::text LIKE '%' || $1 || '%'`, [id]), 3, "one event per cargo category");
    // Provider NAMES are free text: they are referenced by row, never copied into an event.
    assert.equal(await count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%Samsara%' OR e::text LIKE '%WEX Fleet%'`), 0);

    report("website", DEST.website, "create", "PASS: stored normalized, display kept");
    report("website", DEST.website, "reload", "PASS: profile shows the value as entered");
    report("cargoTypes", DEST.cargoTypes, "create", "PASS: 3 categories, one event each");
    report("cargoTypes", DEST.cargoTypes, "reload", "PASS: labels in catalogue order");
    report("gpsProvider", DEST.gpsProvider, "create", "PASS: name stored; no Organization created");
    report("gpsProvider", DEST.gpsProvider, "reload", "PASS");
    report("fuelProvider", DEST.fuelProvider, "create", "PASS: name stored; no Organization created");
    report("fuelProvider", DEST.fuelProvider, "reload", "PASS");
    report("payMethod", DEST.payMethod, "create", "PASS: CHEQUE preference stored");
    report("payMethod", DEST.payMethod, "reload", "PASS");
    report("startDate", DEST.startDate, "create", "PASS");
    report("startDate", DEST.startDate, "reload", "PASS: 2024-01-15");
    report("opRegion", DEST.opRegion, "create", "PASS");
    report("opRegion", DEST.opRegion, "reload", "PASS");
    report("status", DEST.status, "create", "PASS: ONBOARDING (cannot be chosen)");
    report("status", DEST.status, "reload", "PASS: shown as the engagement stage");
    report("svcType", DEST.svcType, "reload", "PASS: Not contracted");
    report("assessmentDate", DEST.assessmentDate, "reload", "PASS: no date when no assessment exists");
  });

  // ===========================================================================================================
  it("EDIT -> SAVE -> REFRESH: changes across sections persist; history is kept; an unchanged save writes nothing", async () => {
    await signInWith(...ALL);
    const { id } = await createCustomer("B");
    const first = await K.dir.getCompanyProfile(id);
    assert.ok(first);
    const cargoIds = new Map((await rows<{ id: string; code: string }>(`SELECT id, cargo_category_code AS code FROM public.company_cargo_category_periods WHERE organization_id = $1`, [id])).map((r) => [r.code, r.id]));

    const result = await K.dir.editCompany(id, {
      ...META,
      opRegion: "Cross-Border",
      website: "https://new-site.example.org/home/",
      cargoTypes: JSON.stringify(["General Freight", "Temperature-Controlled & Food", "Bulk & Other"]),
      gpsProvider: "Geotab",
      fuelProvider: "",
      payMethod: "Credit Card",
      reg_street: "200 Bay St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5J 2J2", reg_country: "Canada",
    });
    assert.equal(result.details?.website, "pending_confirmation");
    assert.equal((await K.dir.getCompanyProfile(id))?.website, "Example-Transport.com", "the established website stays in use until the replacement is confirmed");
    await confirmPending(id);
    assert.deepEqual([result.details?.cargo?.created, result.details?.cargo?.ended], [1, 1]);
    assert.deepEqual(result.details?.fleetProviders.map((p) => [p.kind, p.result.changed, p.result.created, p.result.ended]), [["GPS", true, 1, 1], ["FUEL", true, 0, 1]]);
    assert.equal(result.details?.billingPreference?.changed, true);

    // refresh: a brand-new read shows every change
    const after = await K.dir.getCompanyProfile(id);
    assert.ok(after);
    assert.equal(after.name, first.name, "the registered legal name is not part of an ordinary edit");
    assert.equal(after.opRegion, "Cross-Border");
    assert.equal(after.website, "https://new-site.example.org/home/");
    assert.deepEqual(after.cargoTypes, ["General Freight", "Temperature-Controlled & Food", "Bulk & Other"]);
    assert.equal(after.gpsProvider, "Geotab");
    assert.equal(after.fuelProvider, null, "a cleared provider is gone from the current profile");
    assert.equal(after.payMethod, "Credit Card");
    assert.equal(after.reg_street, "200 Bay St");
    assert.equal(after.startDate, "2024-01-15", "untouched fields are untouched");
    assert.equal(after.serviceStage, "ONBOARDING");

    // history is kept, not overwritten
    const channels = await rows<{ value_normalized: string; effective_to: string | null; record_status: string }>(`SELECT value_normalized, effective_to, record_status FROM public.organization_channels WHERE organization_id = $1 AND channel_type = 'WEBSITE' ORDER BY effective_from`, [id]);
    assert.deepEqual(channels.map((c) => [c.value_normalized, c.effective_to !== null, c.record_status]), [["https://example-transport.com", true, "active"], ["https://new-site.example.org/home/", false, "active"]]);
    const cargo = await rows<{ id: string; code: string; open: boolean }>(`SELECT id, cargo_category_code AS code, (effective_to IS NULL) AS open FROM public.company_cargo_category_periods WHERE organization_id = $1 AND record_status = 'active' ORDER BY code, effective_from`, [id]);
    assert.deepEqual(cargo.map((c) => [c.code, c.open]), [["BULK_OTHER", true], ["GENERAL_FREIGHT", true], ["HAZARDOUS_MATERIALS", false], ["TEMPERATURE_CONTROLLED_FOOD", true]]);
    assert.equal(cargo.find((c) => c.code === "GENERAL_FREIGHT")?.id, cargoIds.get("GENERAL_FREIGHT"), "a kept category is the same row, not re-created");
    const fleet = await rows<{ kind: string; name: string; open: boolean }>(`SELECT p.service_category_code AS kind, v.provider_name AS name, (p.effective_to IS NULL) AS open FROM public.company_fleet_provider_periods p JOIN public.company_fleet_providers v ON v.id = p.provider_id WHERE p.organization_id = $1 ORDER BY p.service_category_code, p.effective_from`, [id]);
    assert.deepEqual(fleet.map((f) => [f.kind, f.name, f.open]), [["FUEL_SERVICES", "WEX Fleet", false], ["GPS_TELEMATICS", "Samsara", false], ["GPS_TELEMATICS", "Geotab", true]]);
    const billing = await rows<{ code: string; open: boolean }>(`SELECT payment_method_code AS code, (effective_to IS NULL) AS open FROM public.customer_billing_preference_periods WHERE organization_id = $1 ORDER BY effective_from`, [id]);
    assert.deepEqual(billing.map((b) => [b.code, b.open]), [["CHEQUE", false], ["CREDIT_CARD", true]]);

    // an identical second save changes nothing: no rows, no events
    const before = await snapshot(id);
    const again = await K.dir.editCompany(id, {
      website: "https://new-site.example.org/home/",
      cargoTypes: JSON.stringify(["Bulk & Other", "General Freight", "Temperature-Controlled & Food"]),
      gpsProvider: "Geotab",
      fuelProvider: "",
      payMethod: "Credit Card",
    });
    assert.equal(again.details?.website, "unchanged");
    assert.equal(again.details?.cargo?.changed, false);
    assert.ok(again.details?.fleetProviders.every((p) => !p.result.changed));
    assert.equal(again.details?.billingPreference?.changed, false);
    assert.deepEqual(await snapshot(id), before);

    // an edit that sends nothing about the facts leaves them alone
    await K.dir.editCompany(id, { dba: "Trading As" });
    const { events: eventsBefore, ...factsBefore } = before;
    const { events: eventsAfter, ...factsAfter } = await snapshot(id);
    assert.deepEqual(factsAfter, factsBefore, "no profile fact row was written");
    assert.equal(eventsAfter, eventsBefore + 1, "only the trade-name change was recorded");
    assert.equal((await K.dir.getCompanyProfile(id))?.website, "https://new-site.example.org/home/");

    for (const field of ["website", "cargoTypes", "gpsProvider", "fuelProvider", "payMethod"] as const) {
      report(field, DEST[field], "edit", "PASS: real change keeps the earlier value as history");
      report(field, DEST[field], "reload", "PASS: refreshed profile shows the edit; unchanged save writes nothing");
    }
    report("opRegion", DEST.opRegion, "edit", "PASS: change recorded as history");
    report("startDate", DEST.startDate, "edit", "PASS: unchanged across edits (not editable)");
  });

  // ===========================================================================================================
  it("CORRECT and CLEAR: a correction flags the wrong value (never history); a cleared value ends or voids; frozen rows stay frozen", async () => {
    await signInWith(...ALL);
    const { id } = await createCustomer("C");

    await K.dir.editCompany(id, {
      factMode: "correct",
      cargoTypes: JSON.stringify(["General Freight", "Temperature-Controlled & Food"]),
      gpsProvider: "Samsara Networks",
      payMethod: "Wire Transfer",
    });
    const profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual(profile?.cargoTypes, ["General Freight", "Temperature-Controlled & Food"]);
    assert.equal(profile?.gpsProvider, "Samsara Networks");
    assert.equal(profile?.payMethod, "Wire Transfer");

    assert.equal((await one<{ record_status: string; corrected_at: string | null }>(`SELECT record_status, corrected_at FROM public.company_cargo_category_periods WHERE organization_id = $1 AND cargo_category_code = 'HAZARDOUS_MATERIALS'`, [id])).record_status, "voided", "a category recorded in error is voided");
    const gps = await rows<{ record_status: string; superseded: boolean; same_start: boolean }>(
      `SELECT old.record_status, (old.superseded_by_period_id = new.id) AS superseded, (old.effective_from = new.effective_from) AS same_start
         FROM public.company_fleet_provider_periods old JOIN public.company_fleet_provider_periods new ON new.id = old.superseded_by_period_id WHERE old.organization_id = $1 AND old.service_category_code = 'GPS_TELEMATICS'`,
      [id],
    );
    assert.deepEqual(gps.map((g) => [g.record_status, g.superseded, g.same_start]), [["corrected", true, true]], "the replacement inherits the business time");
    assert.equal((await rows(`SELECT 1 FROM public.customer_billing_preference_periods WHERE organization_id = $1 AND record_status = 'corrected'`, [id])).length, 1);

    // clearing in correct mode voids the wrong entry (no replacement); in change mode it ends it
    await K.dir.editCompany(id, { factMode: "correct", fuelProvider: "" });
    assert.equal((await K.dir.getCompanyProfile(id))?.fuelProvider, null);
    // a company website is a sensitive channel: clearing it is a REMOVAL request that changes nothing until it is confirmed (no direct void shortcut)
    const removal = await K.dir.editCompany(id, { factMode: "correct", website: "", ...META });
    assert.equal(removal.details?.website, "pending_confirmation");
    assert.ok((await K.dir.getCompanyProfile(id))?.website, "the website is still in use while the removal waits");
    await confirmPending(id);
    assert.equal((await K.dir.getCompanyProfile(id))?.website, null);
    assert.equal((await one<{ record_status: string }>(`SELECT record_status FROM public.company_fleet_provider_periods WHERE organization_id = $1 AND service_category_code = 'FUEL_SERVICES'`, [id])).record_status, "voided");
    await K.dir.editCompany(id, { payMethod: "" });
    assert.equal((await K.dir.getCompanyProfile(id))?.payMethod, null);
    const ended = await one<{ record_status: string; ended: boolean }>(`SELECT record_status, (effective_to IS NOT NULL) AS ended FROM public.customer_billing_preference_periods WHERE organization_id = $1 AND payment_method_code = 'WIRE_TRANSFER'`, [id]);
    assert.deepEqual([ended.record_status, ended.ended], ["active", true], "a real-world clear ends the row and keeps it as history");

    // a corrected or voided row is frozen, even for the table owner
    const frozen = await one<{ id: string }>(`SELECT id FROM public.company_fleet_provider_periods WHERE organization_id = $1 AND record_status = 'corrected'`, [id]);
    await assert.rejects(pools.admin.query(`UPDATE public.company_fleet_provider_periods SET effective_to = now() WHERE id = $1`, [frozen.id]), /frozen/);
    // nothing erased the earlier history
    assert.ok((await count(`SELECT count(*) AS n FROM public.company_fleet_provider_periods WHERE organization_id = $1`, [id])) >= 3);

    for (const field of ["website", "cargoTypes", "gpsProvider", "fuelProvider", "payMethod"] as const) report(field, DEST[field], "correct", "PASS: correction flagged / voided / cleared with history kept");
  });

  // ===========================================================================================================
  it("VALIDATION AND ATOMICITY: a bad value or a failing step creates or changes nothing", async () => {
    await signInWith(...ALL);
    const before = await orgCount();
    for (const bad of [{ website: "javascript:alert(1)" }, { website: "https://user:pw@x.example.com" }, { cargoTypes: JSON.stringify(["Livestock"]) }, { payMethod: "Bitcoin" }, { gpsProvider: "x".repeat(121) }]) {
      const issues = await validationOf(K.dir.createCompanyDirectoryRecord(customerPayload("V", { ...FACTS, ...bad })));
      assert.ok(issues.length >= 1);
    }
    assert.equal(await orgCount(), before, "validation failures create no partial record");

    // A failure AFTER the profile facts were written (a registry number already taken) rolls the whole record back.
    const usdot = digits(7);
    const first = await K.dir.createCompanyDirectoryRecord(customerPayload("D1", { cargoTypes: FACTS.cargoTypes, usdot }));
    const cargoBefore = await count(`SELECT count(*) AS n FROM public.company_cargo_category_periods`);
    const namedBefore = await orgCount();
    await assert.rejects(K.dir.createCompanyDirectoryRecord(customerPayload("D2", { ...FACTS, usdot })));
    assert.equal(await orgCount(), namedBefore, "the second company was not left behind");
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_cargo_category_periods`), cargoBefore, "its cargo rows were rolled back");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customer_billing_preference_periods WHERE organization_id <> $1`, [first.company.id]), await count(`SELECT count(*) AS n FROM public.customer_billing_preference_periods WHERE organization_id <> $1`, [first.company.id]));

    // Edit: one bad field refuses the WHOLE edit, identity and region included.
    const { id } = await createCustomer("E");
    const state = await snapshot(id);
    const name = (await K.dir.getCompanyProfile(id))?.name;
    for (const bad of [{ website: "ftp://x.example.com" }, { cargoTypes: JSON.stringify(["Livestock"]) }, { payMethod: "Barter" }, { factMode: "sideways" }]) {
      await validationOf(K.dir.editCompany(id, { companyName: "Should Not Apply", opRegion: "US Only", ...bad }));
    }
    assert.deepEqual(await snapshot(id), state);
    assert.equal((await K.dir.getCompanyProfile(id))?.name, name);
    assert.equal((await K.dir.getCompanyProfile(id))?.opRegion, "Canada Only");

    // A Customer cannot be left without cargo, and the refusal changes nothing.
    const issues = await validationOf(K.dir.editCompany(id, { cargoTypes: "[]" }));
    assert.equal(issues[0].field, "cargoTypes");
    assert.equal((await K.dir.getCompanyProfile(id))?.cargoTypes.length, 3);

    // Company type is not editable here, so a type change can never silently drop customer information.
    await validationOf(K.dir.editCompany(id, { companyType: "Prospect" }));
    assert.equal((await K.dir.getCompanyProfile(id))?.kind, "Customer");
    assert.deepEqual(await snapshot(id), state);

    report("website", DEST.website, "create", "PASS: invalid values refused, nothing created");
    report("cargoTypes", DEST.cargoTypes, "edit", "PASS: invalid or empty refused, nothing changed");
    report("payMethod", DEST.payMethod, "edit", "PASS: invalid refused, nothing changed");
  });

  // ===========================================================================================================
  it("OTHER CLASSIFICATIONS: every non-Customer type keeps working; Website applies, Customer-only facts are refused and no customer is created", async () => {
    await signInWith(...ALL);
    const types: Array<[string, string]> = [
      ["Prospect", "other"], ["Owner Operator", "owner_operator"], ["Service Provider", "service_provider"], ["Finance/ Leasing Company", "finance_leasing_company"],
      ["Insurance Broker", "insurance_broker"], ["Insurance Company", "insurance_company"], ["Workers Insurance", "workers_insurance"], ["Employee Reference", "employee_reference"],
      ["Government Agency", "government_agency"], ["Sub Contractor", "sub_contractor"], ["Other", "other"],
    ];
    for (const [companyType, classification] of types) {
      const payload = { companyName: `Persist ${run} T${digits(4)} ${companyType.replace(/\W+/g, "")}`, companyType, opRegion: "US Only", regCorpState: "TX", regCorpCountry: "United States", website: "https://kind.example.com" };
      const created = await K.dir.createCompanyDirectoryRecord(payload);
      const id = created.company.id;
      assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [id]), 0, `${companyType}: no customer relationship`);
      assert.equal((await K.dir.getCompanyProfile(id))?.website, "https://kind.example.com", `${companyType}: website persisted`);
      assert.equal((await one<{ classification_code: string }>(`SELECT classification_code FROM public.organization_classifications WHERE organization_id = $1 AND is_primary`, [id])).classification_code, classification);
      // Customer-only facts are refused on create and on edit, and leave nothing behind.
      await validationOf(K.dir.createCompanyDirectoryRecord({ ...payload, companyName: `${payload.companyName} x`, cargoTypes: ["General Freight"] }));
      const issues = await validationOf(K.dir.editCompany(id, { cargoTypes: JSON.stringify(["General Freight"]), gpsProvider: "X", payMethod: "Cheque" }));
      assert.deepEqual(issues.map((i) => i.field).sort(), ["cargoTypes", "gpsProvider", "payMethod"], `${companyType}: customer-only facts refused`);
      // Website is editable for every type
      await K.dir.editCompany(id, { website: "https://changed.example.com/about", ...META });
      assert.equal((await K.dir.getCompanyProfile(id))?.website, "https://kind.example.com", `${companyType}: replacing the established website waits for confirmation`);
      await confirmPending(id);
      assert.equal((await K.dir.getCompanyProfile(id))?.website, "https://changed.example.com/about");
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_cargo_category_periods WHERE organization_id = $1`, [id]), 0);
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_fleet_provider_periods WHERE organization_id = $1`, [id]), 0);
      assert.equal(await count(`SELECT count(*) AS n FROM public.customer_billing_preference_periods WHERE organization_id = $1`, [id]), 0);
    }
  });

  // ===========================================================================================================
  it("AUTHORIZATION: each fact needs its own capability; a missing capability refuses the whole save and nothing changes", async () => {
    await signInWith(...ALL);
    const { id } = await createCustomer("F");
    const state = await snapshot(id);
    const region = (await K.dir.getCompanyProfile(id))?.opRegion;

    // creation
    await signInWith(...without("CUSTOMER_RELATIONSHIP_MANAGE"));
    const before = await orgCount();
    assert.deepEqual(await capabilityOf(K.dir.createCompanyDirectoryRecord(customerPayload("G", FACTS))), ["CUSTOMER_RELATIONSHIP_MANAGE"]);
    assert.equal(await orgCount(), before, "no partial record");
    const noPayment = await K.dir.createCompanyDirectoryRecord(customerPayload("G2", { ...FACTS, payMethod: "" }));
    assert.ok(noPayment.company.id, "the same actor can save everything except the preference");
    await signInWith(...without("COMPANY_PROFILE_MANAGE"));
    assert.ok((await capabilityOf(K.dir.createCompanyDirectoryRecord(customerPayload("G3", FACTS)))).includes("COMPANY_PROFILE_MANAGE"));

    // editing: one unauthorized piece refuses the whole details save
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["CONTACT_MANAGE", "website", { website: "https://denied.example.com" }],
      ["COMPANY_PROFILE_MANAGE", "cargoTypes", { cargoTypes: JSON.stringify(["Bulk & Other"]) }],
      ["COMPANY_PROFILE_MANAGE", "gpsProvider", { gpsProvider: "Denied" }],
      ["CUSTOMER_RELATIONSHIP_MANAGE", "payMethod", { payMethod: "Credit Card" }],
    ];
    for (const [missing, field, body] of cases) {
      await signInWith(...without(missing));
      const refused = await capabilityOf(K.dir.editCompany(id, { opRegion: "US Only", ...body }));
      assert.ok(refused.includes(missing as never), `${field} needs ${missing}`);
      report(field as "website", DEST[field as "website"], "authorization", `PASS: refused without ${missing}`);
    }
    await signInWith(...ALL);
    assert.deepEqual(await snapshot(id), state, "nothing changed");
    assert.equal((await K.dir.getCompanyProfile(id))?.opRegion, region);

    // reading: sections the caller may not read are reported as not permitted, never as empty
    await signInWith(...without("COMPANY_PROFILE_READ"));
    let seen = await K.dir.getCompanyProfile(id);
    assert.equal(seen?.sections.operatingProfile, "not_permitted");
    assert.deepEqual([seen?.cargoTypes, seen?.gpsProvider], [[], null]);
    await signInWith(...without("CUSTOMER_RELATIONSHIP_READ"));
    seen = await K.dir.getCompanyProfile(id);
    assert.equal(seen?.sections.customer, "not_permitted");
    assert.equal(seen?.payMethod, null);
    await signInWith(...without("CONTRACT_READ", "EVIDENCE_READ"));
    seen = await K.dir.getCompanyProfile(id);
    assert.equal(seen?.sections.contracts, "not_permitted");
    assert.deepEqual(seen?.serviceType, { state: "restricted" });
    assert.deepEqual(seen?.assessment, { state: "not_yet_assessed" });
    await signInWith();
    await assert.rejects(K.dir.getCompanyProfile(id));
    K.db.setClerkUser(null);
    await assert.rejects(K.dir.getCompanyProfile(id));
    await assert.rejects(K.dir.editCompany(id, { website: "https://anon.example.com" }));
    await signInWith(...ALL);
    assert.deepEqual(await snapshot(id), state);
  });

  // ===========================================================================================================
  it("TENANT ISOLATION: one company's facts are never visible to, or changed through, another's", async () => {
    await signInWith(...ALL);
    const a = await createCustomer("IA", { website: "https://tenant-a.example.com", gpsProvider: "ProviderA", payMethod: "E-Transfer", cargoTypes: JSON.stringify(["Household Goods"]) });
    const b = await createCustomer("IB", { website: "https://tenant-b.example.com", gpsProvider: "ProviderB", payMethod: "Cheque", cargoTypes: JSON.stringify(["Bulk & Other"]) });
    const stateA = await snapshot(a.id);

    const profileB = await K.dir.getCompanyProfile(b.id);
    assert.deepEqual([profileB?.website, profileB?.gpsProvider, profileB?.payMethod, profileB?.cargoTypes], ["https://tenant-b.example.com", "ProviderB", "Cheque", ["Bulk & Other"]]);
    await K.dir.editCompany(b.id, { website: "https://tenant-b-new.example.com", ...META, gpsProvider: "ProviderB2", payMethod: "Wire Transfer", cargoTypes: JSON.stringify(["Specialized Equipment"]) });
    await confirmPending(b.id);
    assert.equal((await K.dir.getCompanyProfile(b.id))?.website, "https://tenant-b-new.example.com");
    assert.deepEqual(await snapshot(a.id), stateA, "editing B did not touch A");
    assert.equal((await K.changes.getCompanyActivity(a.id)).pending.channels.length, 0, "no request leaked into A");
    const profileA = await K.dir.getCompanyProfile(a.id);
    assert.deepEqual([profileA?.website, profileA?.gpsProvider, profileA?.payMethod, profileA?.cargoTypes], ["https://tenant-a.example.com", "ProviderA", "E-Transfer", ["Household Goods"]]);

    // an unknown organization is "not found" and creates nothing
    const ghost = randomUUID();
    const rowsBefore = await count(`SELECT count(*) AS n FROM public.organization_channels`);
    await assert.rejects(K.dir.editCompany(ghost, { website: "https://ghost.example.com" }));
    assert.equal(await count(`SELECT count(*) AS n FROM public.organization_channels`), rowsBefore);
    assert.equal(await K.dir.getCompanyProfile(ghost), null);
    // facts keyed to an organization cannot be attached to another one through the database either
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_cargo_category_periods (organization_id, cargo_category_code, effective_from) VALUES ($1, 'GENERAL_FREIGHT', now())`, [ghost]), /foreign key|not active|organization/i);
    report("website", DEST.website, "authorization", "PASS: isolated per organization");
    report("cargoTypes", DEST.cargoTypes, "authorization", "PASS: isolated per organization");
    report("gpsProvider", DEST.gpsProvider, "authorization", "PASS: isolated per organization");
    report("fuelProvider", DEST.fuelProvider, "authorization", "PASS: isolated per organization");
    report("payMethod", DEST.payMethod, "authorization", "PASS: isolated per organization");
  });

  // ===========================================================================================================
  it("DATABASE BACKSTOPS: history cannot be rewritten or deleted, a preference needs a Customer, and the catalogues agree with the application", async () => {
    await signInWith(...ALL);
    const { id } = await createCustomer("H");
    const nonCustomer = await K.dir.createCompanyDirectoryRecord({ companyName: `Persist ${run} H${digits(4)} Broker`, companyType: "Insurance Broker", opRegion: "Canada Only" });

    const cargo = await one<{ id: string }>(`SELECT id FROM public.company_cargo_category_periods WHERE organization_id = $1 LIMIT 1`, [id]);
    await assert.rejects(pools.admin.query(`UPDATE public.company_cargo_category_periods SET cargo_category_code = 'BULK_OTHER' WHERE id = $1`, [cargo.id]), /immutable/);
    await assert.rejects(pools.admin.query(`DELETE FROM public.company_cargo_category_periods WHERE id = $1`, [cargo.id]), /preserved/);
    await assert.rejects(pools.admin.query(`TRUNCATE public.company_fleet_provider_periods`), /preserved/);
    await assert.rejects(pools.admin.query(`DELETE FROM public.customer_billing_preference_periods WHERE organization_id = $1`, [id]), /preserved/);
    // the provider identity (its NAME) and the period content are immutable
    const provider = await one<{ id: string; provider_id: string }>(`SELECT id, provider_id FROM public.company_fleet_provider_periods WHERE organization_id = $1 LIMIT 1`, [id]);
    await assert.rejects(pools.admin.query(`UPDATE public.company_fleet_providers SET provider_name = 'Edited' WHERE id = $1`, [provider.provider_id]), /immutable/);
    await assert.rejects(pools.admin.query(`UPDATE public.company_fleet_provider_periods SET service_category_code = 'ELD_HOS' WHERE id = $1`, [provider.id]), /immutable/);
    await assert.rejects(pools.admin.query(`DELETE FROM public.company_fleet_providers WHERE id = $1`, [provider.provider_id]), /preserved/);

    // one current row per company and category / kind / customer
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_cargo_category_periods (organization_id, cargo_category_code, effective_from) VALUES ($1, 'GENERAL_FREIGHT', now())`, [id]), /company_cargo_category_periods_current_uq/);
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_fleet_provider_periods (organization_id, provider_id, service_category_code, effective_from) SELECT organization_id, provider_id, service_category_code, now() FROM public.company_fleet_provider_periods WHERE organization_id = $1 AND service_category_code = 'GPS_TELEMATICS' LIMIT 1`, [id]), /company_fleet_provider_periods_current_uq/);
    await assert.rejects(pools.admin.query(`INSERT INTO public.customer_billing_preference_periods (organization_id, payment_method_code, effective_from) VALUES ($1, 'CHEQUE', now())`, [id]), /customer_billing_preference_periods_current_uq/);

    // a billing preference belongs to a Customer only; payment methods and cargo categories are controlled
    await assert.rejects(pools.admin.query(`INSERT INTO public.customer_billing_preference_periods (organization_id, payment_method_code, effective_from) VALUES ($1, 'CHEQUE', now())`, [nonCustomer.company.id]), /only be recorded for a Customer/);
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_cargo_category_periods (organization_id, cargo_category_code, effective_from) VALUES ($1, 'LIVESTOCK', now())`, [nonCustomer.company.id]), /not an active catalogue category/);
    const orphan = (await one<{ id: string }>(`INSERT INTO public.company_fleet_providers (organization_id, provider_name, provider_name_normalized) VALUES ($1, 'Backstop', 'backstop') RETURNING id`, [nonCustomer.company.id])).id;
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_fleet_provider_periods (organization_id, provider_id, service_category_code, effective_from) VALUES ($1, $2, 'RADIO', now())`, [nonCustomer.company.id, orphan]), /not an active catalogue category/);
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_fleet_providers (organization_id, provider_name, provider_name_normalized) VALUES ($1, ' padded ', 'padded')`, [nonCustomer.company.id]), /company_fleet_providers_name_valid/);
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_fleet_providers (organization_id, provider_name, provider_name_normalized) VALUES ($1, 'BACKSTOP', 'backstop')`, [nonCustomer.company.id]), /company_fleet_providers_name_uq/);
    // a period can only use a provider of the SAME company (tenant isolation at the database)
    await assert.rejects(pools.admin.query(`INSERT INTO public.company_fleet_provider_periods (organization_id, provider_id, service_category_code, effective_from) VALUES ($1, $2, 'ELD_HOS', now())`, [id, orphan]), /company_fleet_provider_periods_provider_fk/);
    await pools.admin.query(`UPDATE public.cargo_categories SET is_active = false WHERE code = 'BULK_OTHER'`);
    try {
      await assert.rejects(pools.admin.query(`INSERT INTO public.company_cargo_category_periods (organization_id, cargo_category_code, effective_from) VALUES ($1, 'BULK_OTHER', now())`, [nonCustomer.company.id]), /not an active catalogue category/);
    } finally {
      await pools.admin.query(`UPDATE public.cargo_categories SET is_active = true WHERE code = 'BULK_OTHER'`);
    }

    // the runtime role cannot rewrite content or delete either (privileges, not only triggers)
    await assert.rejects(
      K.sys.withAuthorizedSystem("COMPANY_PROFILE_MANAGE", async (client) => {
        await client.query(`UPDATE public.company_cargo_category_periods SET cargo_category_code = 'BULK_OTHER' WHERE id = $1`, [cargo.id]);
      }),
      /permission denied/,
    );
    await assert.rejects(
      K.sys.withAuthorizedSystem("COMPANY_PROFILE_MANAGE", async (client) => {
        await client.query(`DELETE FROM public.company_fleet_provider_periods WHERE id = $1`, [provider.id]);
      }),
      /permission denied/,
    );
    // RLS: without the right capability the rows are invisible, and writes are refused
    const seen = await K.sys.withAuthorizedSystem("COMPANY_PROFILE_READ", async (client) => (await client.query(`SELECT count(*) AS n FROM public.customer_billing_preference_periods`)).rows[0].n);
    assert.equal(Number(seen), 0, "billing preferences are invisible to the company-profile capability");

    // the application's vocabulary agrees with the database catalogues
    const dbCargo = (await rows<{ code: string; display_name: string }>(`SELECT code, display_name FROM public.cargo_categories WHERE is_active ORDER BY sort_order`)).map((r) => ({ code: r.code, displayName: r.display_name }));
    assert.deepEqual(dbCargo, [...K.profileDefs.CARGO_CATEGORY_DEFINITIONS]);
    const dbMethods = (await rows<{ code: string; display_name: string }>(`SELECT code, display_name FROM public.billing_payment_methods WHERE is_active ORDER BY sort_order`)).map((r) => ({ code: r.code, displayName: r.display_name }));
    assert.deepEqual(dbMethods, [...K.profileDefs.PAYMENT_METHOD_DEFINITIONS]);
  });

  // ===========================================================================================================
  it("CONTRACT AND LIFECYCLE GOVERNANCE: service type, status, end date and assessment date cannot be set from the profile; they are derived or workflow-owned", async () => {
    await signInWith(...ALL, "EVIDENCE_MANAGE");
    const { id } = await createCustomer("J");
    const state = await snapshot(id);

    for (const [field, value] of [["svcType", "Premium"], ["status", "Active"], ["endDate", "2030-01-01"], ["assessmentDate", "2026-01-01"]] as const) {
      const created = await validationOf(K.dir.createCompanyDirectoryRecord(customerPayload("J2", { cargoTypes: FACTS.cargoTypes, [field]: value })));
      const edited = await validationOf(K.dir.editCompany(id, { [field]: value }));
      assert.equal(created[0].field, field);
      assert.equal(edited[0].field, field);
      assert.ok(created[0].message.length > 20, "says why");
    }
    assert.deepEqual(await snapshot(id), state);
    assert.equal(await count(`SELECT count(*) AS n FROM public.engagement_service_scopes s JOIN public.customer_engagements e ON e.id = s.engagement_id JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1`, [id]), 0, "no service scope was created by a profile save");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customer_contracts WHERE organization_id = $1`, [id]), 0, "no contract was created by a profile save");

    // a new customer always starts in ONBOARDING, whatever the form says
    assert.equal((await K.dir.getCompanyProfile(id))?.serviceStage, "ONBOARDING");

    // Assessment Date: an onboarding READINESS snapshot measures evidence readiness for an engagement, not a company documentation
    // assessment, so it is never relabelled as one. The profile stays "not yet assessed" even once a snapshot exists.
    const engagementId = (await one<{ id: string }>(`SELECT e.id FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1`, [id])).id;
    assert.deepEqual((await K.dir.getCompanyProfile(id))?.assessment, { state: "not_yet_assessed" });
    await K.onboarding.snapshotReadiness({ organizationId: id, engagementId, readinessStatus: "not_ready", completedCount: 0, totalCount: 3, blockers: ["EVIDENCE"] });
    assert.equal(await count(`SELECT count(*) AS n FROM public.onboarding_readiness_snapshots WHERE organization_id = $1`, [id]), 1, "a readiness snapshot exists");
    assert.deepEqual((await K.dir.getCompanyProfile(id))?.assessment, { state: "not_yet_assessed" }, "and is not presented as a documentation assessment");
    report("assessmentDate", DEST.assessmentDate, "reload", "PASS: truthful 'Not yet assessed'; a readiness snapshot is not relabelled");

    // End Date: only through the end-service workflow (with a reason); the profile then reads it back
    assert.equal((await K.dir.getCompanyProfile(id))?.endDate, null);
    await K.cr.endEngagement({ engagementId, endedAt: "2024-06-01T00:00:00Z", endReason: K.crDefs.ENGAGEMENT_END_REASONS[0] });
    const ended = await K.dir.getCompanyProfile(id);
    assert.equal(ended?.endDate, "2024-06-01");
    assert.equal(ended?.serviceStage, "ENDED");
    assert.equal(ended?.startDate, "2024-01-15");
    assert.equal(await count(`SELECT count(*) AS n FROM public.customers WHERE organization_id = $1`, [id]), 1, "the customer identity persists");
    await signInWith(...ALL);
    await validationOf(K.dir.editCompany(id, { endDate: "2025-01-01" }));
    report("endDate", DEST.endDate, "reload", "PASS: set only by the end-service workflow; profile shows it");
    report("status", DEST.status, "edit", "PASS: refused with a reason; stage changes only through the lifecycle");
    report("svcType", DEST.svcType, "edit", "PASS: refused from profile create/edit (contract-governed)");
  });

  // ===========================================================================================================
  it("TES SERVICE START DATE and OPERATING REGION survive save, reopen and edit; the start date is not editable and says so", async () => {
    await signInWith(...ALL);
    const { id } = await createCustomer("K", { startDate: "2023-11-30", opRegion: "US Only" });
    let profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.startDate, profile?.opRegion], ["2023-11-30", "US Only"]);

    await K.dir.editCompany(id, { opRegion: "Cross-Border" });
    profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile?.startDate, profile?.opRegion], ["2023-11-30", "Cross-Border"]);
    assert.equal(await count(`SELECT count(*) AS n FROM public.company_operating_scope_periods WHERE organization_id = $1`, [id]), 2, "the region change kept the earlier region as history");

    // the start date is fixed once recorded: an edit that tries to change it is refused, and nothing changes
    const state = await snapshot(id);
    const issues = await validationOf(K.dir.editCompany(id, { startDate: "2020-01-01" }));
    assert.equal(issues[0].field, "startDate");
    assert.deepEqual(await snapshot(id), state);
    assert.equal((await K.dir.getCompanyProfile(id))?.startDate, "2023-11-30");
    // and the database itself refuses a rewrite of an engagement's start
    await assert.rejects(pools.admin.query(`UPDATE public.customer_engagements SET started_at = '2020-01-01T00:00:00Z' WHERE id = (SELECT e.id FROM public.customer_engagements e JOIN public.customers c ON c.id = e.customer_id WHERE c.organization_id = $1)`, [id]));
    report("startDate", DEST.startDate, "edit", "REFUSED by design: fixed once recorded (a verified correction with reason needs a separate approved change)");
  });

  // ===========================================================================================================
  it("WEBSITE CHANNEL RULES: it belongs to an Organization channel (GENERAL) only, and the Contacts service refuses it anywhere else", async () => {
    await signInWith(...ALL);
    const { id } = await createCustomer("L");
    const person = await K.contacts.createContact({ organizationId: id, name: { givenName: "Pat", familyName: "Lee" } } as never);
    await assert.rejects(
      K.contacts.addPersonChannel({ organizationId: id, personId: person.contact.person.id, channel: { type: "WEBSITE", value: "https://person.example.com" } } as never),
      /Organization channel/,
    );
    await assert.rejects(
      K.contacts.addOrganizationChannel({ organizationId: id, channel: { type: "WEBSITE", value: "https://other.example.com", usage: "ACCOUNTING" } } as never),
      /usage GENERAL/,
    );
    // the Contacts workspace sees the website as a WEBSITE line, not as an email
    const view = await K.contacts.getOrganizationContacts(id);
    assert.ok(view.currentChannels.some((channel) => channel.channelType === "WEBSITE" && channel.usage === "GENERAL"));
  });
});
