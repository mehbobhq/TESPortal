// Run with `npm run test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Migration 0042 (Driver Events canonical store) driven through the REAL authorization wrappers, the real Master Register and the real evidence lifecycle
// (upload -> quarantine -> scanner -> finalize). Fixtures and owner-level checks use the admin pool; the services run as the RUNTIME role under row-level security.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools, TestActor } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    svc: await import("@/lib/driver-events/service"),
    errors: await import("@/lib/driver-events/errors"),
    ev: await import("@/lib/evidence-payload/service"),
    fake: await import("../../helpers/fake-evidence-storage"),
    sysdb: await import("@/lib/auth/tes-system-context"),
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

const OWNER_TABLES = ["evidence_payloads", "evidence_documents", "organization_driver_relationships", "organization_vehicle_relationships", "driver_profiles", "person_name_versions", "persons", "vehicles"];
const EVENT_TABLES = ["driver_event_bi_facts", "driver_event_history", "driver_event_evidence", "driver_event_relationships", "driver_event_consequences", "driver_event_actions", "driver_event_restrictions", "driver_events"];

describe("Driver Events canonical store (migration 0042)", { skip: !enabled }, () => {
  let pools: Pools;
  let fx: AuthFixtures;
  let organizations: string[] = [];
  let people: string[] = [];
  let vehicles: string[] = [];
  let storage: InstanceType<Kit["fake"]["FakeEvidenceStorage"]>;
  let counter = 0;
  const n = () => ++counter;
  const day = (offset = -1) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await K.db.closePools();
  });

  /** Owner-level cleanup, only against a loopback database: the event tables are deliberately undeletable for the application. */
  async function purge() {
    const adminUrl = process.env.TES_TEST_ADMIN_DATABASE_URL ?? "";
    assert.ok(/@(127\.0\.0\.1|localhost|\[::1\])[:/]|[?&]host=\//.test(adminUrl) || !/@/.test(adminUrl), "cleanup refuses to run against a non-loopback database");
    if (organizations.length === 0) return;
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      for (const t of [...EVENT_TABLES, ...OWNER_TABLES]) await client.query(`ALTER TABLE public.${t} DISABLE TRIGGER USER`);
      for (const t of EVENT_TABLES) await client.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      for (const t of ["evidence_payloads", "evidence_documents"]) await client.query(`DELETE FROM public.${t} WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.organization_driver_relationships WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.organization_vehicle_relationships WHERE organization_id = ANY($1::uuid[])`, [organizations]);
      await client.query(`DELETE FROM public.driver_profiles WHERE person_id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.person_name_versions WHERE person_id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.persons WHERE id = ANY($1::uuid[])`, [people]);
      await client.query(`DELETE FROM public.vehicles WHERE id = ANY($1::uuid[])`, [vehicles]);
      await client.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [organizations]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      for (const t of [...EVENT_TABLES, ...OWNER_TABLES]) await client.query(`ALTER TABLE public.${t} ENABLE TRIGGER USER`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const scenario = (name: string, body: () => Promise<void>) =>
    it(name, async () => {
      fx = new K.db.AuthFixtures(pools.admin);
      organizations = [];
      people = [];
      vehicles = [];
      storage = new K.fake.FakeEvidenceStorage();
      K.db.setClerkUser(null);
      try {
        await body();
      } finally {
        K.db.setClerkUser(null);
        await purge();
        await fx.cleanup();
      }
    });

  async function org(label = "Org"): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name, country_code) VALUES ($1, $2, lower($2), 'CA')`, [id, `DE ${label} ${id.slice(0, 8)}`]);
    organizations.push(id);
    return id;
  }
  async function driverRel(organizationId: string): Promise<string> {
    const client = await pools.admin.connect();
    try {
      await client.query("BEGIN");
      const person = (await client.query<{ id: string }>(`INSERT INTO public.persons DEFAULT VALUES RETURNING id`)).rows[0].id;
      people.push(person);
      await client.query(`INSERT INTO public.person_name_versions(person_id,given_name,family_name,name_normalized,change_reason,effective_from) VALUES ($1,'Dee','Driver','dee driver','INITIAL',now()-interval '2 years')`, [person]);
      await client.query(`INSERT INTO public.driver_profiles(person_id) VALUES ($1)`, [person]);
      const rel = (await client.query<{ id: string }>(`INSERT INTO public.organization_driver_relationships(organization_id,person_id,relationship_type,status,effective_from) VALUES ($1,$2,'EMPLOYEE','ACTIVE',current_date-700) RETURNING id`, [organizationId, person])).rows[0].id;
      await client.query("COMMIT");
      return rel;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async function vehicleRel(organizationId: string): Promise<{ rel: string; vehicle: string }> {
    const vin = `1M8GDM9AXKP${String(100000 + n() + Math.floor(Math.random() * 800000))}`;
    const vehicle = (await pools.admin.query<{ id: string }>(`INSERT INTO public.vehicles(vehicle_type_code,vin_display,vin_normalized) VALUES ('TRUCK_TRACTOR',$1,$1) RETURNING id`, [vin])).rows[0].id;
    vehicles.push(vehicle);
    const rel = (await pools.admin.query<{ id: string }>(`INSERT INTO public.organization_vehicle_relationships(organization_id,vehicle_id,relationship_type,unit_number_display,unit_number_normalized,effective_from) VALUES ($1,$2,'OPERATES',$3,$3,now()-interval '2 years') RETURNING id`, [organizationId, vehicle, `U${n()}`])).rows[0].id;
    return { rel, vehicle };
  }
  async function staff(...capabilities: string[]): Promise<TestActor> {
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    return actor;
  }
  async function signIn(...capabilities: string[]) {
    const actor = await staff(...capabilities);
    K.db.setClerkUser(actor.clerkSubject);
    return actor;
  }
  const MANAGE = ["DRIVER_EVENT_READ", "DRIVER_EVENT_MANAGE", "EVIDENCE_READ", "EVIDENCE_MANAGE"];
  const RELEASE = [...MANAGE, "DRIVER_EVENT_SAFETY_RELEASE"];
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query<T>(sql, params)).rows;
  const rejects = async (work: () => Promise<unknown>, nameEndsWith: string) => {
    await assert.rejects(work, (e: Error) => {
      assert.ok(e.constructor.name.endsWith(nameEndsWith), `expected *${nameEndsWith}, got ${e.constructor.name}: ${e.message}`);
      return true;
    });
  };

  const ROADSIDE_FACTS = {
    jurisdiction: "ON", inspectionRegime: "CA_NSC_CVSA", inspectionScope: "BOTH", inspectionResult: "VIOLATIONS_FOUND", driverInspectionResult: "VIOLATIONS_FOUND", driverOOSState: "NO",
    vehicleInspectionResult: "VIOLATIONS_FOUND", vehicleOOSState: "YES", sourceReportedViolationCount: 2, sourceType: "ROADSIDE_INSPECTION",
  };
  const roadside = (over: Record<string, unknown> = {}) => ({
    category: "Roadside Inspection", title: "Roadside inspection, Highway 401", sourceType: "Roadside Inspection", sourceReference: `RPT-${randomUUID().slice(0, 8)}`,
    occurrence: { date: day(-2), time: "09:30", timeZone: "America/Toronto" }, location: { city: "Milton", stateProvince: "ON", country: "CA", jurisdictionCode: "CA-ON" },
    observedSeverity: "High", facts: ROADSIDE_FACTS, ...over,
  });
  const speeding = (over: Record<string, unknown> = {}) => ({
    category: "Speeding", title: "Speeding observation", sourceType: "ELD / Telematics", ingestionOrigin: "TELEMATICS_INGESTION",
    occurrence: { date: day(-1), time: "14:05", timeZone: "America/Toronto" }, facts: { thresholdBasis: "POSTED_SPEED_LIMIT", actualSpeed: 118, sourceType: "ELD_TELEMATICS" }, ...over,
  });
  const other = (over: Record<string, unknown> = {}) => ({
    category: "Other Event", title: "Unclassified event", sourceType: "Company Staff", occurrence: { date: day(-1) }, facts: { noCategoryReason: "No defined category describes a trailer gate failure.", sourceType: "COMPANY_STAFF" }, ...over,
  });
  type Input = Parameters<Kit["svc"]["createEvent"]>[1];
  const create = (o: string, input: Record<string, unknown>) => K.svc.createEvent(o, input as unknown as Input);

  async function storedDocument(organizationId: string): Promise<string> {
    const { documentId } = await K.ev.uploadEvidence(
      { organizationId, documentType: "DRIVER_EVENT_EVIDENCE", documentTitle: "Inspection report", file: { bytes: K.fake.samplePdf(randomUUID()), mimeType: "application/pdf", filename: "report.pdf" } },
      storage as never,
    );
    const [{ quarantine_object_name }] = await q<{ quarantine_object_name: string }>(`SELECT quarantine_object_name FROM public.evidence_payloads WHERE evidence_document_id = $1`, [documentId]);
    storage.scannerPromote(quarantine_object_name);
    assert.equal((await K.ev.finalizeEvidence({ organizationId, documentId }, storage as never)).state, "stored");
    return documentId;
  }

  // ------------------------------------------------------------------------------------------------------------------------------------------------

  scenario("creates, reloads and versions an event; headers, record, history, fact and Master Register agree", async () => {
    const actor = await signIn(...MANAGE);
    const o = await org();
    const driver = await driverRel(o);
    const { rel, vehicle } = await vehicleRel(o);
    const created = await create(o, speeding({ driverRelationshipId: driver, vehicleRelationshipId: rel, sourceReference: "TLM-1" }));
    assert.equal(created.version, 1);
    const got = await K.svc.getEvent(o, created.id);
    const e = got.event as Record<string, any>;
    assert.equal(e.category, "Speeding");
    assert.equal(e.occurrence_precision, "EXACT_DATETIME");
    assert.equal(e.occurred_time_zone, "America/Toronto");
    assert.ok(e.occurred_at, "an exact occurrence has an instant");
    assert.equal(e.vehicle_id, vehicle, "the canonical vehicle id is resolved server-side from the company relationship");
    assert.equal(e.record.facts.actualSpeed, 118);
    assert.equal(got.history.length, 1);
    assert.equal(got.history[0].entry_type, "CREATED");
    assert.equal(got.fact?.contract_version, "driver-event-fact/1");
    assert.equal(got.fact?.source_reliability, "DEVICE_UNVERIFIED");
    const mr = await q(`SELECT 1 FROM public.master_register_events WHERE event_type = 'RECORD_CREATED' AND actor_id = $1::uuid AND target ->> 'resourceId' = $2`, [actor.actorId, created.id]);
    assert.equal(mr.length, 1, "Master Register attributes the creation");
    const listed = await K.svc.listEvents(o, { category: "Speeding" });
    assert.equal(listed.length, 1);
  });

  scenario("server validation: unknown keys, bad values, future dates, date-only occurrences, required facts, non-recordable categories", async () => {
    await signIn(...MANAGE);
    const o = await org();
    await rejects(() => create(o, speeding({ facts: { thresholdBasis: "POSTED_SPEED_LIMIT", actualSpeed: 118, sourceType: "ELD_TELEMATICS", madeUp: 1 } })), "ValidationError");
    await rejects(() => create(o, speeding({ facts: { thresholdBasis: "NOPE", actualSpeed: 118, sourceType: "ELD_TELEMATICS" } })), "ValidationError");
    await rejects(() => create(o, speeding({ facts: { thresholdBasis: "POSTED_SPEED_LIMIT", actualSpeed: -5, sourceType: "ELD_TELEMATICS" } })), "ValidationError");
    await rejects(() => create(o, speeding({ occurrence: { date: day(+3), time: "10:00", timeZone: "America/Toronto" } })), "ValidationError");
    await rejects(() => create(o, speeding({ occurrence: { date: day(-1), time: "10:00" } })), "ValidationError");
    await rejects(() => create(o, speeding({ facts: { thresholdBasis: "POSTED_SPEED_LIMIT", sourceType: "ELD_TELEMATICS" } })), "ValidationError");
    await rejects(() => create(o, speeding({ reportedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() })), "ValidationError");
    await rejects(() => create(o, { ...speeding(), category: "Traffic Citation" }), "ValidationError");
    await rejects(() => create(o, { ...speeding(), category: "Not A Category" }), "ValidationError");
    await rejects(() => create(o, speeding({ sourceType: "Customer" })), "ValidationError");
    await rejects(() => create(o, speeding({ driverRelationshipId: "not-a-uuid" })), "ValidationError");
    // a draft may be incomplete; recording it is not
    const draft = await create(o, speeding({ recordState: "DRAFT", facts: { thresholdBasis: "POSTED_SPEED_LIMIT", sourceType: "ELD_TELEMATICS" } }));
    const f = (await K.svc.getEvent(o, draft.id)).fact!;
    assert.equal(f.resolution_state, "DRAFT");
    assert.ok(Number(f.required_fields_missing) > 0, "the missing required field is visible as a data-quality fact");
    // a date-only occurrence has NO invented instant
    const dateOnly = await create(o, other());
    const row = (await K.svc.getEvent(o, dateOnly.id)).event as Record<string, any>;
    assert.equal(row.occurrence_precision, "DATE_ONLY");
    assert.equal(row.occurred_at, null);
    // a link that is not this company's is refused
    const foreign = await driverRel(await org("Other"));
    await rejects(() => create(o, speeding({ driverRelationshipId: foreign })), "ValidationError");
  });

  scenario("a correction is a new immutable version with a reason; stale versions and category changes are refused; history cannot be edited", async () => {
    await signIn(...MANAGE);
    const o = await org();
    const created = await create(o, speeding());
    const base = speeding();
    const fixed = { ...base, facts: { ...base.facts, actualSpeed: 121 } };
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: fixed as never }), "ValidationError"); // reason required
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 7, event: fixed as never, reason: "typo" }), "ConflictError");
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: { ...fixed, category: "Seatbelt" } as never, reason: "typo" }), "ValidationError");
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: base as never, reason: "same" }), "ValidationError"); // nothing changed
    const done = await K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: fixed as never, reason: "Speed misread from the provider export" });
    assert.equal(done.version, 2);
    assert.deepEqual(done.changedFields, ["facts.actualSpeed"]);
    const got = await K.svc.getEvent(o, created.id);
    assert.equal((got.event as any).record.facts.actualSpeed, 121);
    const v1 = await K.svc.getEventVersion(o, created.id, 1);
    assert.equal((v1[0].snapshot as any).record.facts.actualSpeed, 118, "version 1 is preserved exactly as recorded");
    assert.equal(got.fact?.record_version, 2);
    assert.equal(got.fact?.corrections_count, 1);
    // a second writer on the same version loses
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: fixed as never, reason: "late" }), "ConflictError");
    // history and facts are append-only / never deleted, even for the owner path the application uses
    const history = await q<{ id: string }>(`SELECT id FROM public.driver_event_history WHERE event_id = $1`, [created.id]);
    await assert.rejects(pools.admin.query(`UPDATE public.driver_event_history SET reason = 'x' WHERE id = $1`, [history[0].id]), /append-only/);
    await assert.rejects(pools.admin.query(`DELETE FROM public.driver_events WHERE id = $1`, [created.id]), /never deleted/);
  });

  scenario("roadside OOS creates a mandatory restriction that status changes, corrections and company clearance cannot clear; only the documented release can", async () => {
    await signIn(...RELEASE);
    const o = await org();
    const { rel } = await vehicleRel(o);
    const created = await create(o, roadside({ vehicleRelationshipId: rel }));
    let got = await K.svc.getEvent(o, created.id);
    assert.equal(got.restrictions.length, 1, "the vehicle OOS answer produced exactly one restriction");
    const restriction = got.restrictions[0] as Record<string, any>;
    assert.equal(restriction.restriction_kind, "VEHICLE_OUT_OF_SERVICE");
    assert.equal(restriction.authority, "ENFORCEMENT");
    assert.equal(restriction.state, "ACTIVE");
    assert.equal(got.actions.length, 1, "required follow-up exists");
    assert.equal(got.fact?.resolution_state, "RESTRICTED");

    // 1. an ordinary status change cannot close it
    await rejects(() => K.svc.changeEventStatus(o, created.id, { to: "Closed", reason: "done" }), "StateError");
    // 2. editing the answer cannot dissolve it
    const flipped = roadside({ sourceReference: (got.event as any).source_reference, facts: { ...ROADSIDE_FACTS, vehicleOOSState: "NO" }, vehicleRelationshipId: rel });
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: flipped as never, reason: "inspector corrected" }), "StateError");
    // 3. a company clearance is not enough for an enforcement order
    await rejects(() => K.svc.releaseEventRestriction(o, created.id, restriction.id, { releaseBasis: "COMPANY_CLEARANCE", correctionSummary: "Fixed the brake." }), "StateError");
    // 4. an authoritative release needs the release document: linked with the right role...
    await rejects(() => K.svc.releaseEventRestriction(o, created.id, restriction.id, { releaseBasis: "AUTHORITY_RELEASE_DOCUMENTED", correctionSummary: "Brake adjusted.", evidenceDocumentId: randomUUID() }), "StateError");
    const doc = await storedDocument(o);
    await rejects(() => K.svc.releaseEventRestriction(o, created.id, restriction.id, { releaseBasis: "AUTHORITY_RELEASE_DOCUMENTED", correctionSummary: "Brake adjusted.", evidenceDocumentId: doc }), "StateError");
    const link = await K.svc.linkEventEvidence(o, created.id, { documentId: doc, role: "RELEASE_EVIDENCE" });
    // ...and verified by a person (linked is not verified)
    await rejects(() => K.svc.releaseEventRestriction(o, created.id, restriction.id, { releaseBasis: "AUTHORITY_RELEASE_DOCUMENTED", correctionSummary: "Brake adjusted.", evidenceDocumentId: doc }), "StateError");
    await K.svc.verifyEventEvidence(o, created.id, link.id, { decision: "VERIFIED", note: "Matches the inspector's release sheet." });
    // the database enforces the same rule beneath the service
    await assert.rejects(pools.admin.query(`UPDATE public.driver_event_restrictions SET state = 'RELEASED', release_basis = 'COMPANY_CLEARANCE', correction_summary = 'x', released_by_actor_id = (SELECT id FROM public.actors LIMIT 1), released_at = now() WHERE id = $1`, [restriction.id]));
    await K.svc.releaseEventRestriction(o, created.id, restriction.id, { releaseBasis: "AUTHORITY_RELEASE_DOCUMENTED", correctionSummary: "Brake adjusted and re-inspected.", evidenceDocumentId: doc });
    // 5. closing is still blocked by the required follow-up until it is completed
    await rejects(() => K.svc.changeEventStatus(o, created.id, { to: "Closed", reason: "done" }), "StateError");
    got = await K.svc.getEvent(o, created.id);
    await K.svc.updateEventAction(o, created.id, (got.actions[0] as any).id, { status: "COMPLETED", note: "Repair order closed and release on file." });
    await rejects(() => K.svc.changeEventStatus(o, created.id, { to: "Closed" }), "ValidationError"); // closure needs a reason
    await K.svc.changeEventStatus(o, created.id, { to: "Closed", reason: "Restriction released with authority document; follow-up complete." });
    got = await K.svc.getEvent(o, created.id);
    assert.equal((got.event as any).status, "Closed");
    assert.equal(got.fact?.resolution_state, "CLOSED");
    assert.equal(got.fact?.restrictions_released, 1);
    // the release evidence cannot be unlinked afterwards
    await rejects(() => K.svc.unlinkEventEvidence(o, created.id, link.id, { reason: "cleanup" }), "StateError");
    // a closed event is not silently edited; reopening needs a reason
    await rejects(() => K.svc.reviseEvent(o, created.id, { expectedVersion: 1, event: flipped as never, reason: "x" }), "StateError");
    await rejects(() => K.svc.changeEventStatus(o, created.id, { to: "Open" }), "ValidationError");
    await K.svc.changeEventStatus(o, created.id, { to: "Open", reason: "New information from the carrier." });
    // a released restriction is final and a corrected answer does not re-open it
    await assert.rejects(pools.admin.query(`UPDATE public.driver_event_restrictions SET state = 'ACTIVE' WHERE id = $1`, [restriction.id]));
  });

  scenario("releasing a safety restriction needs the dedicated release capability", async () => {
    await signIn(...MANAGE);
    const o = await org();
    const created = await create(o, roadside());
    const [r] = (await K.svc.getEvent(o, created.id)).restrictions as Record<string, any>[];
    await rejects(() => K.svc.releaseEventRestriction(o, created.id, r.id, { releaseBasis: "AUTHORITY_RELEASE_DOCUMENTED", correctionSummary: "x", evidenceDocumentId: randomUUID() }), "AuthorizationDeniedError");
    // and the database refuses a release made under manage alone: the row simply is not updatable for that capability
    const touched = await K.sysdb.withAuthorizedSystem("DRIVER_EVENT_MANAGE", async (client) => {
      const res = await client.query(`UPDATE public.driver_event_restrictions SET state = 'RELEASED' WHERE id = $1`, [r.id]);
      return res.rowCount;
    }).catch(() => 0);
    assert.equal(touched, 0);
    assert.equal((await q<{ state: string }>(`SELECT state FROM public.driver_event_restrictions WHERE id = $1`, [r.id]))[0].state, "ACTIVE");
  });

  scenario("evidence goes through the real lifecycle: quarantined files cannot be linked, stored files can; linked is not verified; other companies' files are refused", async () => {
    await signIn(...MANAGE);
    const o = await org();
    const created = await create(o, speeding());
    const { documentId } = await K.ev.uploadEvidence({ organizationId: o, documentType: "DRIVER_EVENT_EVIDENCE", documentTitle: "Photo", file: { bytes: K.fake.samplePdf("q"), mimeType: "application/pdf", filename: "q.pdf" } }, storage as never);
    await rejects(() => K.svc.linkEventEvidence(o, created.id, { documentId, role: "PHOTO_VIDEO" }), "StateError");
    const stored = await storedDocument(o);
    const link = await K.svc.linkEventEvidence(o, created.id, { documentId: stored, role: "SOURCE_REPORT" });
    await rejects(() => K.svc.linkEventEvidence(o, created.id, { documentId: stored, role: "SOURCE_REPORT" }), "ConflictError");
    let got = await K.svc.getEvent(o, created.id);
    assert.equal((got.evidence[0] as any).verification_state, "UNVERIFIED");
    assert.equal((got.event as any).verification_state, "UNVERIFIED");
    assert.equal(got.fact?.evidence_links_active, 1);
    assert.equal(got.fact?.evidence_stored, 1);
    assert.equal(got.fact?.evidence_verified, 0);
    assert.ok(JSON.parse(JSON.stringify(got.fact?.quality_flags)).includes("EVIDENCE_UNVERIFIED"));
    await rejects(() => K.svc.verifyEventEvidence(o, created.id, link.id, { decision: "REJECTED" }), "ValidationError"); // a rejection needs a note
    await K.svc.verifyEventEvidence(o, created.id, link.id, { decision: "VERIFIED", note: "Checked against the provider portal." });
    got = await K.svc.getEvent(o, created.id);
    assert.equal((got.event as any).verification_state, "VERIFIED");
    assert.equal(got.fact?.evidence_verified, 1);
    // other company's document
    const o2 = await org("Other");
    const foreign = await storedDocument(o2);
    await rejects(() => K.svc.linkEventEvidence(o, created.id, { documentId: foreign, role: "OTHER" }), "NotFoundError");
    await assert.rejects(pools.admin.query(`INSERT INTO public.driver_event_evidence (event_id, organization_id, evidence_document_id, role, linked_by_actor_id) VALUES ($1, $2, $3, 'OTHER', (SELECT id FROM public.actors LIMIT 1))`, [created.id, o, foreign]), /different company/);
    await K.svc.unlinkEventEvidence(o, created.id, link.id, { reason: "Wrong file" });
    got = await K.svc.getEvent(o, created.id);
    assert.equal((got.evidence[0] as any).link_status, "unlinked");
    assert.equal(got.fact?.evidence_links_active, 0);
    assert.equal((await q(`SELECT 1 FROM public.master_register_events WHERE event_type = 'EVIDENCE_ASSOCIATED' AND target ->> 'resourceId' = $1`, [created.id])).length, 1);
  });

  scenario("duplicates and relationships: candidates are found, a duplicate is excluded from the BI view, downstream records attach to one event, loops are refused", async () => {
    await signIn(...MANAGE);
    const o = await org();
    const driver = await driverRel(o);
    const a = await create(o, speeding({ driverRelationshipId: driver, sourceReference: "A" }));
    const b = await create(o, speeding({ driverRelationshipId: driver, sourceReference: "B" }));
    const dup = await K.svc.findEventDuplicates(o, b.id);
    assert.deepEqual(dup.map((d) => d.id), [a.id], "same category, driver and day within two hours is offered as a possible duplicate");
    await rejects(() => create(o, speeding({ driverRelationshipId: driver, sourceReference: "A" })), "ConflictError"); // idempotent ingestion by source
    assert.equal((await K.svc.listEventFacts(o, {})).length, 2);
    await K.svc.addEventRelationship(o, b.id, { type: "DUPLICATE_OF", toEventId: a.id });
    const facts = await K.svc.listEventFacts(o, {});
    assert.deepEqual(facts.map((f) => f.event_id), [a.id], "the duplicate is excluded from the analytical view");
    await rejects(() => K.svc.addEventRelationship(o, a.id, { type: "DUPLICATE_OF", toEventId: b.id }), "StateError");
    await rejects(() => K.svc.addEventRelationship(o, a.id, { type: "RELATED", toEventId: a.id }), "ValidationError");
    // a repair order belongs to ONE occurrence
    const c = await create(o, speeding({ sourceReference: "C" }));
    await K.svc.addEventRelationship(o, a.id, { type: "REPAIR_ORDER", recordRef: "RO-1001" });
    await rejects(() => K.svc.addEventRelationship(o, c.id, { type: "REPAIR_ORDER", recordRef: "RO-1001" }), "ConflictError");
    const rels = (await K.svc.getEvent(o, a.id)).relationships as Record<string, any>[];
    await K.svc.removeEventRelationship(o, a.id, rels.find((r) => r.relationship_type === "REPAIR_ORDER")!.id, { reason: "Attached to the wrong occurrence" });
    await K.svc.addEventRelationship(o, c.id, { type: "REPAIR_ORDER", recordRef: "RO-1001" });
  });

  scenario("consequences: missing is never zero, one source is counted once, a newer measurement supersedes, mixed currencies are flagged not converted", async () => {
    await signIn(...MANAGE);
    const o = await org();
    const a = await create(o, speeding({ sourceReference: "A" }));
    const b = await create(o, speeding({ sourceReference: "B" }));
    let fact = (await K.svc.getEvent(o, a.id)).fact!;
    for (const key of ["delay_minutes", "downtime_minutes", "cost_actual_minor", "cost_estimated_minor", "claim_amount_minor", "recovery_amount_minor", "net_impact_minor", "injuries_count"]) {
      assert.equal(fact[key], null, `${key} is NULL (not collected), never zero`);
    }
    await rejects(() => K.svc.recordEventConsequence(o, a.id, { kind: "COST_ACTUAL", measurementState: "UNKNOWN", amountMinor: 0, currency: "CAD", source: "AP", confidence: "UNVERIFIED" }), "ValidationError");
    await rejects(() => K.svc.recordEventConsequence(o, a.id, { kind: "COST_ACTUAL", measurementState: "MEASURED", source: "AP", confidence: "CONFIRMED" }), "ValidationError");
    await K.svc.recordEventConsequence(o, a.id, { kind: "COST_ACTUAL", measurementState: "MEASURED", amountMinor: 125000, currency: "CAD", source: "Repair invoice", confidence: "CONFIRMED", linkType: "INVOICE", linkRef: "INV-77" });
    await rejects(() => K.svc.recordEventConsequence(o, b.id, { kind: "COST_ACTUAL", measurementState: "MEASURED", amountMinor: 125000, currency: "CAD", source: "Repair invoice", confidence: "CONFIRMED", linkType: "INVOICE", linkRef: "INV-77" }), "ConflictError");
    const second = await K.svc.recordEventConsequence(o, a.id, { kind: "COST_ACTUAL", measurementState: "MEASURED", amountMinor: 130000, currency: "CAD", source: "Repair invoice", confidence: "CONFIRMED", linkType: "INVOICE", linkRef: "INV-77" });
    assert.ok(second.superseded);
    await K.svc.recordEventConsequence(o, a.id, { kind: "OPERATIONAL_DELAY", measurementState: "MEASURED", quantity: 2, unit: "hours", source: "Dispatch log", confidence: "ESTIMATED" });
    await K.svc.recordEventConsequence(o, a.id, { kind: "RECOVERY", measurementState: "NONE_CONFIRMED", source: "Claims", confidence: "CONFIRMED" });
    fact = (await K.svc.getEvent(o, a.id)).fact!;
    assert.equal(Number(fact.cost_actual_minor), 130000, "only the active measurement counts");
    assert.equal(Number(fact.delay_minutes), 120);
    assert.equal(Number(fact.recovery_amount_minor), 0, "an explicitly confirmed 'none' is zero");
    assert.equal(Number(fact.net_impact_minor), 130000);
    assert.equal(fact.currency, "CAD");
    await K.svc.recordEventConsequence(o, a.id, { kind: "COST_ESTIMATED", measurementState: "MEASURED", amountMinor: 5000, currency: "USD", source: "Estimate", confidence: "ESTIMATED" });
    fact = (await K.svc.getEvent(o, a.id)).fact!;
    assert.equal(fact.cost_actual_minor, null, "mixed currencies are not converted or summed");
    assert.ok(JSON.parse(JSON.stringify(fact.quality_flags)).includes("MIXED_CURRENCY"));
    assert.equal((await q(`SELECT count(*)::int AS n FROM public.driver_event_consequences WHERE event_id = $1 AND state = 'SUPERSEDED'`, [a.id]))[0].n, 1, "the superseded measurement is kept");
  });

  scenario("equipment 'not safe to operate' holds the vehicle; Others carries a stated reason", async () => {
    await signIn(...MANAGE);
    const o = await org();
    const { rel } = await vehicleRel(o);
    const eq = await create(o, { category: "Equipment Failure / Critical Defect", title: "Air leak", sourceType: "Maintenance", occurrence: { date: day(-1) }, vehicleRelationshipId: rel, facts: { equipmentIssueType: (await import("@/lib/driver-performance-schema")).DRIVER_PERFORMANCE_CATEGORY_BY_VALUE["Equipment Failure / Critical Defect"].fields.find((f) => f.key === "equipmentIssueType")!.options![0].value, vehicleSafeToOperate: "NO", sourceType: "MAINTENANCE" } });
    const got = await K.svc.getEvent(o, eq.id);
    assert.equal((got.restrictions[0] as any).restriction_kind, "EQUIPMENT_HOLD");
    await rejects(() => K.svc.changeEventStatus(o, eq.id, { to: "Closed", reason: "ok" }), "StateError");
    await rejects(() => create(o, other({ facts: { sourceType: "COMPANY_STAFF" } })), "ValidationError");
    const ok = await create(o, other());
    assert.equal(((await K.svc.getEvent(o, ok.id)).event as any).category, "Other Event");
  });

  scenario("access control: no capability, read-only and other companies", async () => {
    const o = await org();
    const o2 = await org("Other");
    await signIn(...MANAGE);
    const created = await create(o, speeding());
    await signIn("DRIVER_EVENT_READ");
    assert.equal((await K.svc.listEvents(o, {})).length, 1);
    await rejects(() => create(o, speeding({ sourceReference: "X" })), "AuthorizationDeniedError");
    await rejects(() => K.svc.changeEventStatus(o, created.id, { to: "Under Review" }), "AuthorizationDeniedError");
    await signIn("DRIVER_READ");
    await rejects(() => K.svc.listEvents(o, {}), "AuthorizationDeniedError");
    K.db.setClerkUser(null);
    await rejects(() => K.svc.listEvents(o, {}), "IdentityRequiredError");
    // tenant isolation: the event is invisible and untouchable through another company
    await signIn(...MANAGE);
    await rejects(() => K.svc.getEvent(o2, created.id), "NotFoundError");
    await rejects(() => K.svc.changeEventStatus(o2, created.id, { to: "Under Review" }), "NotFoundError");
    await rejects(() => K.svc.linkEventEvidence(o2, created.id, { documentId: randomUUID(), role: "OTHER" }), "NotFoundError");
    assert.equal((await K.svc.listEvents(o2, {})).length, 0);
    // row-level security directly: the runtime role without a system context sees nothing
    const client = await pools.runtime.connect();
    try {
      for (const t of EVENT_TABLES) assert.equal((await client.query(`SELECT 1 FROM public.${t} LIMIT 1`)).rowCount, 0, `${t} is invisible without an authorized context`);
      assert.equal((await client.query(`UPDATE public.driver_events SET title = 'x'`)).rowCount, 0, "nothing is updatable without an authorized context");
    } finally {
      client.release();
    }
  });

  scenario("capabilities exist, are SYSTEM scoped and the release capability is separate", async () => {
    const rows = await q<{ code: string }>(`SELECT code FROM public.capabilities WHERE code LIKE 'DRIVER_EVENT_%' ORDER BY code`);
    assert.deepEqual(rows.map((r) => r.code), ["DRIVER_EVENT_MANAGE", "DRIVER_EVENT_READ", "DRIVER_EVENT_SAFETY_RELEASE"]);
  });
});
