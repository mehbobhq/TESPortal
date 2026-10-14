// Run with `TES_TEST_FILES="test/lib/ui-recovery/contacts-settings.db.test.ts" bash scripts/test/run-auth-tests.sh`.
//
// The restored Contacts and Settings workspaces talk to PostgreSQL only through their adapters (src/restored/{contacts,settings}/adapter.ts)
// and the company routes' shared dispatch (lib/ui-recovery/*-actions.ts). These tests drive exactly that stack in process: the adapter plans
// and runs the canonical operations, the dispatch is what the route handler calls, and everything below it is the REAL service, the REAL
// authorization wrappers, the REAL Master Register and the RUNTIME database role.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    authz: await import("@/lib/auth/tes-authorization"),
    contacts: await import("@/lib/contacts/service"),
    profile: await import("@/lib/company-profile/service"),
    contactActions: await import("@/lib/ui-recovery/contacts-actions"),
    settingActions: await import("@/lib/ui-recovery/settings-actions"),
    C: await import("@/src/restored/contacts/adapter"),
    S: await import("@/src/restored/settings/adapter"),
    unavailable: await import("@/lib/canonical-ui/unavailable"),
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

const ALL = ["CONTACT_MANAGE", "PERSON_REGISTRY_READ", "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ"];
const READ_ONLY = ["PERSON_REGISTRY_READ", "COMPANY_PROFILE_READ"];

describe("Restored Contacts and Settings over the canonical domains", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8);
  let counter = 0;

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]): Promise<TestActor> {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability as never, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `UR ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const n = () => ++counter;
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const eventTypes = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string }>(`SELECT event_type FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows.map((row) => row.event_type);
  const nameOf = (label: string) => ({ firstName: `${label}${run}`, lastName: `Restored${n()}` });
  const phone = () => `+1 403 555 ${String(1000 + (n() % 9000)).padStart(4, "0")}`;
  const email = () => `ur.${run}.${n()}@example.test`;

  async function refuseMasterRegisterEvent(eventType: string) {
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = '${eventType}' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
        RETURN NEW;
      END $$`);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
    return async () => {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
      await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------------------------------------------

  const contactsTransport = (organizationId: string) => ({
    read: () => K.contacts.getOrganizationContacts(organizationId),
    act: async (payload: Record<string, unknown>) => (await K.contactActions.performContactsAction({ organizationId, body: payload })).body,
  });
  const loadContacts = async (organizationId: string) => K.C.mapContacts(await K.contacts.getOrganizationContacts(organizationId), { id: organizationId, name: "Co" });
  const editFormOf = (c: ReturnType<Kit["C"]["mapContacts"]>[number], over: Record<string, unknown> = {}) => ({
    firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, companyRole: c.role, isPrimary: c.isPrimary,
    dob: "", dlNumber: "", dlState: "ON", dlExpiry: "", dlIssueDate: "", dlClass: "", dlRestrictions: "", notes: "", ...over,
  });
  const manualForm = (over: Record<string, unknown> = {}) => ({
    ...nameOf("Pat"), dob: "", dlNumber: "", dlState: "ON", dlExpiry: "", dlIssueDate: "", dlClass: "", dlRestrictions: "",
    email: email(), phone: phone(), role: "Safety Manager", isPrimary: false, notes: "", ...over,
  });
  async function addContact(organizationId: string, over: Record<string, unknown> = {}) {
    const transport = contactsTransport(organizationId);
    const report = await K.C.runSteps(transport, [K.C.planCreate(manualForm(over) as never)]);
    assert.deepEqual(report.failed, []);
    const created = report.lastView!;
    return (await loadContacts(organizationId)).find((c) => c.canonical.personId === created.person.id)!;
  }

  it("Manual Add maps the role to a title, Primary to the PRIMARY purpose and phone/email to person channels, in one operation with Master Register events", async () => {
    const actor = await signInWith(...ALL);
    const org = await organization("Add");
    const contact = await addContact(org, { isPrimary: true, role: "Dispatcher" });
    assert.equal(contact.role, "Dispatcher");
    assert.equal(contact.isPrimary, true);
    assert.match(contact.phone, /403/);
    assert.match(contact.email, /@example\.test$/);
    assert.equal(contact.canonical.purposes.length, 1);
    assert.equal(contact.canonical.purposes[0].purpose, "PRIMARY", "the role is a title, not a purpose; only Primary became a purpose");
    assert.equal(await count(`SELECT count(*) FROM public.organization_person_titles WHERE organization_id = $1`, [org]), 1);
    assert.equal(await count(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'PRIMARY'`, [org]), 1);
    const events = await eventTypes(actor.actorId);
    assert.ok(events.includes("RECORD_CREATED") && events.includes("RECORD_LINK_ESTABLISHED"), `Master Register recorded the creation: ${events.join(",")}`);
    assert.deepEqual(contact.relationships.map((r) => r.status), ["active"]);
  });

  it("licence, date of birth and notes have no canonical home: Manual Add and Edit refuse before anything is written", async () => {
    await signInWith(...ALL);
    const org = await organization("NoHome");
    assert.throws(() => K.C.planCreate(manualForm({ dlNumber: "D1234-56789-01234" }) as never), (error: unknown) => K.unavailable.isUnavailable(error) && /Driver Licence #/.test((error as Error).message));
    assert.throws(() => K.C.planCreate(manualForm({ dob: "1990-01-01" }) as never), K.unavailable.CanonicalOperationUnavailableError);
    assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE organization_id = $1`, [org]), 0, "nothing was written");

    const contact = await addContact(org);
    assert.throws(() => K.C.planEdit(contact, editFormOf(contact, { notes: "left voicemail", firstName: "Changed" }) as never), K.unavailable.CanonicalOperationUnavailableError);
    const unchanged = (await loadContacts(org))[0];
    assert.equal(unchanged.firstName, contact.firstName, "an unavailable field refuses the WHOLE save, so the name was not changed either");
    assert.equal(unchanged.dob, "", "date of birth is shown as not recorded");
  });

  it("a real-world change keeps history; a correction flags the wrong value (name, phone, role); nothing is deleted", async () => {
    await signInWith(...ALL);
    const org = await organization("History");
    const transport = contactsTransport(org);
    let contact = await addContact(org, { role: "Dispatcher" });

    // real-world change
    let report = await K.C.runSteps(transport, K.C.planEdit(contact, editFormOf(contact, { firstName: `Married${run}`, phone: phone(), companyRole: "Fleet Manager", recordAs: "change" }) as never));
    assert.deepEqual(report.failed, []);
    const names = (await pools.admin.query(`SELECT given_name, change_reason, record_status, effective_to FROM public.person_name_versions WHERE person_id = $1 ORDER BY created_at`, [contact.canonical.personId])).rows;
    assert.deepEqual(names.map((r) => r.change_reason), ["INITIAL", "CHANGE"]);
    assert.equal(names[0].record_status, "active", "the earlier name stays genuine history");
    assert.notEqual(names[0].effective_to, null, "and is ended, not overwritten");
    assert.equal(await count(`SELECT count(*) FROM public.person_channels WHERE person_id = $1 AND channel_type = 'PHONE'`, [contact.canonical.personId]), 2);
    contact = (await loadContacts(org))[0];
    assert.equal(contact.role, "Fleet Manager");

    // correction
    report = await K.C.runSteps(transport, K.C.planEdit(contact, editFormOf(contact, { firstName: `Fixed${run}`, phone: phone(), companyRole: "Safety Manager", recordAs: "correct" }) as never));
    assert.deepEqual(report.failed, []);
    const afterNames = (await pools.admin.query(`SELECT given_name, change_reason, record_status FROM public.person_name_versions WHERE person_id = $1 ORDER BY created_at`, [contact.canonical.personId])).rows;
    assert.deepEqual(afterNames.map((r) => r.record_status), ["active", "corrected", "active"]);
    assert.equal(afterNames[2].change_reason, "CORRECTION");
    const titles = (await pools.admin.query(`SELECT title_display, record_status FROM public.organization_person_titles WHERE relationship_id = $1 ORDER BY created_at`, [contact.canonical.relationshipId])).rows;
    assert.deepEqual(titles.map((r) => `${r.title_display}:${r.record_status}`), ["Dispatcher:active", "Fleet Manager:corrected", "Safety Manager:active"]);
    const phones = (await pools.admin.query(`SELECT record_status FROM public.person_channels WHERE person_id = $1 AND channel_type = 'PHONE' ORDER BY created_at`, [contact.canonical.personId])).rows;
    assert.deepEqual(phones.map((r) => r.record_status), ["active", "corrected", "active"]);

    const final = (await loadContacts(org))[0];
    assert.equal(final.firstName, `Fixed${run}`);
    assert.equal(final.role, "Safety Manager");
    assert.ok(final.events.some((e) => /recorded in error/.test(e.summary)), "the Revision Events show the flagged wrong values");
  });

  it("Primary Contact is a single PRIMARY purpose per company: designating another moves it; the star toggles it off", async () => {
    await signInWith(...ALL);
    const org = await organization("Primary");
    const transport = contactsTransport(org);
    const a = await addContact(org, { isPrimary: true });
    const b = await addContact(org);
    let report = await K.C.runSteps(transport, [K.C.planSetPrimary(b)]);
    assert.deepEqual(report.failed, []);
    let now = await loadContacts(org);
    assert.deepEqual(now.filter((c) => c.isPrimary).map((c) => c.canonical.personId), [b.canonical.personId]);
    assert.equal(now.find((c) => c.canonical.personId === a.canonical.personId)!.isPrimary, false);
    report = await K.C.runSteps(transport, [K.C.planSetPrimary(now.find((c) => c.canonical.personId === b.canonical.personId)!)]);
    assert.deepEqual(report.failed, []);
    now = await loadContacts(org);
    assert.equal(now.filter((c) => c.isPrimary).length, 0);
    assert.equal(await count(`SELECT count(*) FROM public.contact_purpose_assignments WHERE organization_id = $1 AND purpose_code = 'PRIMARY'`, [org]), 2, "both PRIMARY assignments are kept, ended, as history");
  });

  it("Archive ends the relationship and archives the person; Restore relates the person again (a new relationship) without duplicating the contact", async () => {
    const actor = await signInWith(...ALL);
    const org = await organization("Archive");
    const transport = contactsTransport(org);
    const contact = await addContact(org, { role: "Director", isPrimary: true });

    const archived = await K.C.archiveContact(transport, contact);
    assert.deepEqual(archived.failed, []);
    const afterArchive = (await loadContacts(org))[0];
    assert.equal(afterArchive.isArchived, true);
    assert.equal(afterArchive.canonical.personArchived, true);
    assert.equal(afterArchive.role, "Director", "the last title stays visible as history");
    assert.equal(await count(`SELECT count(*) FROM public.persons WHERE id = $1`, [contact.canonical.personId]), 1, "the person is never deleted");
    assert.throws(() => K.C.planEdit(afterArchive, editFormOf(afterArchive) as never), K.unavailable.CanonicalOperationUnavailableError);

    const restored = await K.C.restoreContact(transport, afterArchive, afterArchive.role);
    assert.deepEqual(restored.failed, []);
    assert.ok(restored.notices.some((notice) => /Purposes/.test(notice)));
    const afterRestore = await loadContacts(org);
    assert.equal(afterRestore.length, 1, "one contact per person");
    assert.equal(afterRestore[0].isArchived, false);
    assert.equal(afterRestore[0].role, "Director");
    assert.equal(afterRestore[0].isPrimary, false, "Primary is not silently re-assigned");
    assert.equal(afterRestore[0].relationships.length, 2, "the ended relationship stays in history");
    assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE person_id = $1`, [contact.canonical.personId]), 2);
    const events = await eventTypes(actor.actorId);
    assert.ok(events.includes("RECORD_ARCHIVED") && events.includes("RECORD_RESTORED"));
  });

  it("archiving a person who is still a contact elsewhere ends only this relationship and reports why the person stays active", async () => {
    await signInWith(...ALL);
    const a = await organization("ArchiveA");
    const b = await organization("ArchiveB");
    const contact = await addContact(a);
    await K.contacts.addRelationship({ organizationId: b, personId: contact.canonical.personId });
    const report = await K.C.archiveContact(contactsTransport(a), contact);
    assert.deepEqual(report.failed, []);
    assert.equal(report.notices.length, 1);
    assert.match(report.notices[0], /person record stays active/);
    assert.equal(await count(`SELECT count(*) FROM public.persons WHERE id = $1 AND record_status = 'active'`, [contact.canonical.personId]), 1);
    assert.equal((await loadContacts(a))[0].isArchived, true);
    assert.equal((await K.contacts.getOrganizationContacts(b)).contacts[0].relationship.effectiveTo, null, "the other company is untouched");
  });

  it("a partial failure is reported per step: the valid change is saved, the refused one is listed and not saved", async () => {
    await signInWith(...ALL);
    const org = await organization("Partial");
    const transport = contactsTransport(org);
    const contact = await addContact(org);
    const original = contact.phone;
    const plan = K.C.planEdit(contact, editFormOf(contact, { firstName: `Partial${run}`, phone: "123" }) as never);
    assert.equal(plan.length, 2);
    const report = await K.C.runSteps(transport, plan);
    assert.equal(report.results.length, 2);
    assert.equal(report.results[0].ok, true);
    assert.equal(report.results[1].ok, false);
    assert.equal(report.failed.length, 1);
    assert.match(K.C.summarize(report) ?? "", /1 of 2 changes could not be saved: Change phone/);
    const reloaded = (await loadContacts(org))[0];
    assert.equal(reloaded.firstName, `Partial${run}`, "the step that succeeded is saved");
    assert.equal(reloaded.phone, original, "the refused step changed nothing");
  });

  it("company isolation: another company's relationship, title, purpose, channel or person cannot be changed through this company", async () => {
    await signInWith(...ALL);
    const a = await organization("IsoA");
    const b = await organization("IsoB");
    const mine = await addContact(a, { isPrimary: true, role: "Director" });
    const theirs = await addContact(b, { isPrimary: true, role: "Director" });
    const t = contactsTransport(a);
    const reject = (payload: Record<string, unknown>) => assert.rejects(t.act(payload), (error: unknown) => error instanceof Error && /NotFound|not found|not a/i.test(`${error.constructor.name} ${error.message}`));
    await reject({ action: "endRelationship", relationshipId: theirs.canonical.relationshipId });
    await reject({ action: "changeTitle", titleId: theirs.canonical.title!.id, title: "Hijacked" });
    await reject({ action: "endPurpose", assignmentId: theirs.canonical.primaryAssignmentId });
    await reject({ action: "makePrimary", relationshipId: theirs.canonical.relationshipId, purpose: "PRIMARY" });
    await reject({ action: "changeName", personId: theirs.canonical.personId, givenName: "Hijacked", familyName: "Name" });
    await reject({ action: "endPersonChannel", personId: theirs.canonical.personId, channelId: theirs.canonical.phone!.channelId });
    await reject({ action: "archivePerson", personId: theirs.canonical.personId });
    const untouched = (await loadContacts(b))[0];
    assert.equal(untouched.firstName, theirs.firstName);
    assert.equal(untouched.role, "Director");
    assert.equal(untouched.isPrimary, true);
    assert.equal(untouched.isArchived, false);
    // a body can name no company: the company in the payload is ignored in favour of the URL's
    const spoof = await t.act({ action: "createContact", organizationId: b, name: { givenName: `Spoof${run}`, familyName: "Body" }, titles: [], purposes: [], channels: [] });
    assert.equal((spoof as { contact: { relationship: { organizationId: string } } }).contact.relationship.organizationId, a);
    assert.equal((await K.contacts.getOrganizationContacts(b)).contacts.length, 1);
    assert.equal(mine.isPrimary, true);
  });

  it("authorization: a reader can load contacts but every change is denied and writes nothing", async () => {
    await signInWith(...ALL);
    const org = await organization("Authz");
    const contact = await addContact(org);
    const reader = await signInWith(...READ_ONLY);
    const transport = contactsTransport(org);
    assert.equal((await transport.read()).contacts.length, 1, "PERSON_REGISTRY_READ can read");
    await assert.rejects(K.C.runSteps(transport, [K.C.planCreate(manualForm() as never)]).then((r) => { if (r.failed.length) throw new Error(r.failed[0].message); }), /not authorized|denied|permission/i);
    const report = await K.C.runSteps(transport, [{ label: "End", payload: { action: "endRelationship", relationshipId: contact.canonical.relationshipId } }]);
    assert.equal(report.failed.length, 1);
    assert.equal((await loadContacts(org))[0].isArchived, false);
    assert.deepEqual(await eventTypes(reader.actorId), [], "a denied actor leaves no Master Register events");
    K.db.setClerkUser(null);
    await assert.rejects(transport.read());
  });

  it("rollback: a refused Master Register write rolls the whole contact creation back", async () => {
    await signInWith(...ALL);
    const org = await organization("Rollback");
    const restore = await refuseMasterRegisterEvent("RECORD_LINK_ESTABLISHED");
    try {
      const report = await K.C.runSteps(contactsTransport(org), [K.C.planCreate(manualForm({ isPrimary: true }) as never)]);
      assert.equal(report.failed.length, 1, "the failure is reported, not hidden");
    } finally {
      await restore();
    }
    assert.equal(await count(`SELECT count(*) FROM public.organization_person_relationships WHERE organization_id = $1`, [org]), 0);
    assert.equal(await count(`SELECT count(*) FROM public.organization_person_titles WHERE organization_id = $1`, [org]), 0);
    assert.equal((await loadContacts(org)).length, 0);
  });

  it("company lines (organization channels) and the advisory duplicate lookup go through the same dispatch", async () => {
    await signInWith(...ALL);
    const org = await organization("Lines");
    const transport = contactsTransport(org);
    const dup = nameOf("Dup");
    const first = await addContact(org, { ...dup, email: email() });
    const report = await K.C.runSteps(transport, [{ label: "Add company line", payload: { action: "addChannel", channel: { type: "PHONE", value: phone(), usage: "DISPATCH" } } }]);
    assert.deepEqual(report.failed, []);
    assert.equal((await transport.read()).currentChannels.length, 1);
    const matches = await K.C.findMatches(transport, { givenName: dup.firstName, familyName: dup.lastName });
    assert.ok(matches.some((m) => m.personId === first.canonical.personId && m.reasons.includes("NAME")), "advisory only: nothing is merged");
    assert.equal((await loadContacts(org)).length, 1);
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------------------------------------------

  const settingsTransport = (organizationId: string) => ({
    read: () => K.profile.getCompanyProfile(organizationId),
    act: async (payload: Record<string, unknown>) => (await K.settingActions.performSettingsAction({ organizationId, body: payload })).body,
  });
  const loadSettings = async (organizationId: string) => {
    const view = await K.profile.getCompanyProfile(organizationId);
    return { view, state: K.S.toSettingsState(view) };
  };

  it("settings: an unconfigured company shows Not configured / Not recorded, never the old defaults (21 / 24, region-derived jurisdiction)", async () => {
    await signInWith(...ALL);
    const org = await organization("SettingsEmpty");
    const { view, state } = await loadSettings(org);
    for (const id of K.S.ALL_RULE_IDS) assert.ok(view.rules.some((entry) => entry.rule.code === K.S.ruleCode(id)), `original rule ${id} has a canonical catalogue code`);
    assert.equal(state.scope, null);
    assert.equal(state.minimumDriverAge, "");
    assert.equal(state.minimumDriverExperience, "");
    assert.equal(Object.keys(state.rules).length, 45);
    assert.ok(Object.values(state.rules).every((value) => value === "not-configured"), "even rules with a catalogue default are not configured until answered");
    assert.equal(K.S.jurisdictionOf(state.scope), null);
  });

  it("settings: Save profile is a batch of canonical operations with Master Register events, and reloads from PostgreSQL", async () => {
    const actor = await signInWith(...ALL);
    const org = await organization("SettingsSave");
    const transport = settingsTransport(org);
    const { view, state } = await loadSettings(org);
    const draft = K.S.cloneSettings(state);
    draft.scope = "CANADA_AND_UNITED_STATES";
    draft.minimumDriverAge = "23";
    draft.minimumDriverExperience = "30";
    draft.rules.ifta = "applies";
    draft.rules.work_permit = "does-not-apply";
    const plan = K.S.planSave(view, state, draft, "change");
    assert.equal(plan.length, 4);
    const results = await K.S.runPlan(transport, plan);
    assert.deepEqual(results.map((r) => r.status), ["saved", "saved", "saved", "saved"]);
    const reloaded = (await loadSettings(org)).state;
    assert.deepEqual({ scope: reloaded.scope, age: reloaded.minimumDriverAge, exp: reloaded.minimumDriverExperience, ifta: reloaded.rules.ifta, wp: reloaded.rules.work_permit, other: reloaded.rules.psp }, { scope: "CANADA_AND_UNITED_STATES", age: "23", exp: "30", ifta: "applies", wp: "does-not-apply", other: "not-configured" });
    assert.equal((await eventTypes(actor.actorId)).filter((t) => t === "RECORD_CREATED").length, 4, "one Master Register event per saved item");
    // saving again with no change plans nothing
    assert.equal(K.S.planSave((await loadSettings(org)).view, reloaded, K.S.cloneSettings(reloaded), "change").length, 0);
  });

  it("settings: change keeps the earlier answer as history, correction flags it, clearing keeps history, and a correction cannot clear", async () => {
    await signInWith(...ALL);
    const org = await organization("SettingsHistory");
    const transport = settingsTransport(org);
    let { view, state } = await loadSettings(org);
    let draft = K.S.cloneSettings(state);
    draft.rules.ctpat = "applies";
    draft.scope = "UNITED_STATES";
    await K.S.runPlan(transport, K.S.planSave(view, state, draft, "change"));

    ({ view, state } = await loadSettings(org));
    draft = K.S.cloneSettings(state);
    draft.rules.ctpat = "does-not-apply";
    draft.scope = "CANADA";
    assert.equal(K.S.touchesRecordedFacts(view, state, draft), true);
    assert.deepEqual((await K.S.runPlan(transport, K.S.planSave(view, state, draft, "change"))).map((r) => r.status), ["saved", "saved"]);
    let rows = (await pools.admin.query(`SELECT applicability, record_status, effective_to IS NOT NULL AS ended FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'CTPAT' ORDER BY created_at`, [org])).rows;
    assert.deepEqual(rows.map((r) => `${r.applicability}:${r.record_status}:${r.ended}`), ["APPLIES:active:true", "DOES_NOT_APPLY:active:false"], "a real-world change ends the earlier answer, which stays genuine history");

    ({ view, state } = await loadSettings(org));
    draft = K.S.cloneSettings(state);
    draft.rules.ctpat = "applies";
    draft.scope = "CANADA_AND_UNITED_STATES";
    assert.deepEqual((await K.S.runPlan(transport, K.S.planSave(view, state, draft, "correct"))).map((r) => r.status), ["saved", "saved"]);
    rows = (await pools.admin.query(`SELECT applicability, record_status FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'CTPAT' ORDER BY created_at`, [org])).rows;
    assert.deepEqual(rows.map((r) => `${r.applicability}:${r.record_status}`), ["APPLIES:active", "DOES_NOT_APPLY:corrected", "APPLIES:active"], "a correction flags the wrong answer and keeps it");
    const scopes = (await pools.admin.query(`SELECT record_status FROM public.company_operating_scope_periods WHERE organization_id = $1 ORDER BY created_at`, [org])).rows;
    assert.deepEqual(scopes.map((r) => r.record_status), ["active", "corrected", "active"], "US (ended), Canada (flagged wrong), cross-border (the correction)");

    // a correction cannot turn an answer back into Not configured: refused, nothing written
    ({ view, state } = await loadSettings(org));
    draft = K.S.cloneSettings(state);
    draft.rules.ctpat = "not-configured";
    const refused = await K.S.runPlan(transport, K.S.planSave(view, state, draft, "correct"));
    assert.equal(refused[0].status, "refused");
    assert.equal((await loadSettings(org)).state.rules.ctpat, "applies");
    // a real-world change can clear it; the history stays
    const cleared = await K.S.runPlan(transport, K.S.planSave(view, state, draft, "change"));
    assert.equal(cleared[0].status, "saved");
    assert.equal((await loadSettings(org)).state.rules.ctpat, "not-configured");
    assert.equal(await count(`SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'CTPAT'`, [org]), 3);
  });

  it("settings: a partial failure is visible per item; failed and refused items stay in the draft", async () => {
    await signInWith(...ALL);
    const org = await organization("SettingsPartial");
    const transport = settingsTransport(org);
    const { view, state } = await loadSettings(org);
    const draft = K.S.cloneSettings(state);
    draft.rules.fast = "applies";
    draft.rules.smartway = "does-not-apply";
    draft.minimumDriverAge = "12"; // below the domain minimum
    draft.minimumDriverExperience = "24";
    const plan = K.S.planSave(view, state, draft, "change");
    // inject a server-side failure for one rule (an unknown catalogue code) alongside the real items
    plan.push({ kind: "step", key: "rule:not_a_rule", label: "Unknown rule", payload: { action: "setRuleApplicability", ruleCode: "NOT_A_RULE", applicability: "APPLIES" } });
    const results = await K.S.runPlan(transport, plan);
    const by = Object.fromEntries(results.map((r) => [r.key, r]));
    assert.equal(by["rule:fast"].status, "saved");
    assert.equal(by["rule:smartway"].status, "saved");
    assert.equal(by["driver"].status, "refused");
    assert.match(by["driver"].message!, /between 16 and 100/);
    assert.equal(by["rule:not_a_rule"].status, "failed");
    assert.ok(by["rule:not_a_rule"].message);
    const fresh = (await loadSettings(org)).state;
    assert.equal(fresh.rules.fast, "applies");
    assert.equal(fresh.minimumDriverAge, "", "the refused item wrote nothing");
    const next = K.S.reconcileDraft(fresh, draft, results);
    assert.equal(next.minimumDriverAge, "12", "the refused item stays in the draft, still unsaved");
    assert.equal(K.S.settingsDirty(fresh, next), true);
    assert.equal(next.rules.fast, "applies");
  });

  it("settings: company isolation, authorization and rollback", async () => {
    const actor = await signInWith(...ALL);
    const a = await organization("SettingsIsoA");
    const b = await organization("SettingsIsoB");
    const tb = settingsTransport(b);
    await K.S.runPlan(tb, [{ kind: "step", key: "rule:csa", label: "CSA", payload: { action: "setRuleApplicability", ruleCode: "CSA", applicability: "APPLIES" } }]);
    const view = await K.profile.getCompanyProfile(b);
    const periodId = view.rules.find((entry) => entry.rule.code === "CSA")!.assertion!.id;

    // company A's route cannot correct company B's period
    await assert.rejects(K.settingActions.performSettingsAction({ organizationId: a, body: { action: "correctRuleApplicability", periodId, applicability: "DOES_NOT_APPLY" } }), (error: unknown) => error instanceof Error && /not found/i.test(error.message));
    assert.equal((await loadSettings(b)).state.rules.csa, "applies");
    assert.equal((await loadSettings(a)).state.rules.csa, "not-configured");
    // a body cannot name another company
    await K.settingActions.performSettingsAction({ organizationId: a, body: { action: "setRuleApplicability", organizationId: b, ruleCode: "PIP", applicability: "APPLIES" } as never }).catch(() => undefined);
    assert.equal((await loadSettings(b)).state.rules.pip, "not-configured");
    assert.equal((await loadSettings(a)).state.rules.pip, "applies", "the URL's company, not the body's, received the change");

    // rollback: a refused Master Register write leaves no assertion behind
    const restore = await refuseMasterRegisterEvent("RECORD_CREATED");
    try {
      const results = await K.S.runPlan(settingsTransport(a), [{ kind: "step", key: "rule:cor", label: "COR", payload: { action: "setRuleApplicability", ruleCode: "COR", applicability: "APPLIES" } }]);
      assert.equal(results[0].status, "failed");
    } finally {
      await restore();
    }
    assert.equal(await count(`SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'COR'`, [a]), 0);

    // authorization: a reader can load, but not change
    const reader = await signInWith(...READ_ONLY);
    assert.equal((await settingsTransport(a).read()).organizationId, a);
    const denied = await K.S.runPlan(settingsTransport(a), [{ kind: "step", key: "rule:cor", label: "COR", payload: { action: "setRuleApplicability", ruleCode: "COR", applicability: "APPLIES" } }]);
    assert.equal(denied[0].status, "failed");
    assert.equal(await count(`SELECT count(*) FROM public.company_rule_applicability_periods WHERE organization_id = $1 AND rule_code = 'COR'`, [a]), 0);
    assert.deepEqual(await eventTypes(reader.actorId), []);
    assert.ok((await eventTypes(actor.actorId)).length > 0);
  });
});
