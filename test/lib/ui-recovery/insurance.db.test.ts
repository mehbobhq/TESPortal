// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Insurance workspace recovery: the restored interface's operations, through the REAL authorization wrappers and the RUNTIME role.
//   - every operation that edits or corrects a policy refuses another company's policy (as "not found") and changes nothing;
//   - the composed "edit" is one transaction: a mistake is CORRECTED (wrong rows kept and flagged), a real change is an
//     ENDORSEMENT / broker change (earlier state kept), and a refusal in any step rolls the whole edit back;
//   - every change writes its Master Register events (company referenced); the archive reason lands in the archive event;
//   - nothing is deleted; INSURANCE_MANAGE is required.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    insurance: await import("@/lib/insurance/service"),
    workspace: await import("@/lib/insurance-workspace/service"),
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

const ALL = ["INSURANCE_READ", "INSURANCE_MANAGE", "CONTACT_MANAGE", "PERSON_REGISTRY_READ"];

describe("Insurance workspace recovery (real authorization, runtime role, real Master Register)", { skip: !enabled }, () => {
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
    return actor;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `IR ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const number = (prefix: string) => `${prefix}-${run}-${randomInt(100000, 999999)}`;
  const notFound = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof Error && error.constructor.name.endsWith("NotFoundError"));
  const refused = (promise: Promise<unknown>, kind: "ValidationError" | "StateError" | "NotFoundError") => assert.rejects(promise, (error: unknown) => error instanceof Error && error.constructor.name.endsWith(kind));
  const events = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string; target: { resourceType: string; resourceId: string; subjectReferences: string[] }; outcome: { reason?: string } | null }>(
      `SELECT event_type, target, outcome FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`,
      [actorId],
    )).rows;

  async function newPolicy(insured: string, insurer: string, broker?: { brokerOrganizationId: string; brokerPersonId: string }) {
    return K.insurance.createPolicy({
      organizationId: insured,
      insurerOrganizationId: insurer,
      family: "INSURANCE",
      policyNumber: number("POL"),
      termStart: "2024-01-01",
      termEnd: "2025-01-01",
      coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD" }],
      ...(broker ? { broker } : {}),
    });
  }
  async function brokerage(label: string) {
    const organizationId = await organization(label);
    const made = await K.contacts.createContact({ organizationId, name: { givenName: "Bea", familyName: `Agent${run}` } });
    return { organizationId, personId: made.contact.person.id };
  }
  const snapshot = async (policyId: string) => ({
    terms: await count(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [policyId]),
    coverages: await count(`SELECT count(*) FROM public.insurance_coverages WHERE policy_id = $1`, [policyId]),
    endorsements: await count(`SELECT count(*) FROM public.insurance_endorsements WHERE policy_id = $1`, [policyId]),
    brokers: await count(`SELECT count(*) FROM public.insurance_broker_periods WHERE policy_id = $1`, [policyId]),
  });

  it("isolation: every edit or correction operation refuses another company's policy and changes nothing", async () => {
    const actor = await signInWith(...ALL);
    const insured = await organization("Insured");
    const other = await organization("Other");
    const insurer = await organization("Insurer");
    const broker = await brokerage("Brokerage");
    const view = await newPolicy(insured, insurer, { brokerOrganizationId: broker.organizationId, brokerPersonId: broker.personId });
    const termId = view.current.latestTerm!.id;
    const coverageId = view.asOf.coverages[0]?.id ?? view.terms[0].coverages[0].id;
    const periodId = view.current.broker!.id;
    const before = await snapshot(view.policy.id);
    const eventsBefore = (await events(actor.actorId)).length;

    await notFound(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: other, mode: "CORRECTION", policyNumber: number("X") }));
    await notFound(K.insurance.addEndorsement({ termId, organizationId: other, kind: "COVERAGE_CHANGED", effectiveOn: "2024-06-01", coverage: { coverageType: "AUTO_LIABILITY", limitAmount: "2000000", currency: "CAD" } }));
    await notFound(K.insurance.correctTerm({ termId, organizationId: other, policyNumber: number("X") }));
    await notFound(K.insurance.correctCoverage({ coverageId, organizationId: other, limitAmount: "3000000" }));
    await notFound(K.insurance.changeBroker({ policyId: view.policy.id, organizationId: other, brokerOrganizationId: broker.organizationId, brokerPersonId: null }));
    await notFound(K.insurance.correctBroker({ brokerPeriodId: periodId, organizationId: other, brokerPersonId: null }));
    await notFound(K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: other, reason: "wrong company" }));

    assert.deepEqual(await snapshot(view.policy.id), before, "no row was added, superseded or ended");
    assert.equal((await events(actor.actorId)).length, eventsBefore, "a refused request records nothing");
    assert.equal((await K.insurance.getOrganizationInsurance(insured)).policies[0].policy.recordStatus, "active");
    assert.equal((await K.insurance.getOrganizationInsurance(other)).policies.length, 0, "the other company has an honest empty list");

    // the owning company can do the same through its own scope
    await K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION", policyNumber: number("FIXED") });
    assert.equal(await count(`SELECT count(*) FROM public.insurance_policies WHERE id = $1`, [view.policy.id]), 1);
  });

  it("CORRECTION: the wrong term and coverage are kept and flagged, the right ones become current, events reference the company", async () => {
    const actor = await signInWith(...ALL);
    const insured = await organization("Corrected");
    const insurer = await organization("CorrectedInsurer");
    const view = await newPolicy(insured, insurer);
    const wrongNumber = view.current.latestTerm!.numberDisplay;
    const rightNumber = number("RIGHT");
    const coverageId = view.asOf.coverages.length ? view.asOf.coverages[0].id : view.terms[0].coverages[0].id;

    const after = await K.workspace.editPolicyRecord({
      policyId: view.policy.id,
      organizationId: insured,
      mode: "CORRECTION",
      policyNumber: rightNumber,
      termEnd: "2025-02-01",
      coverageId,
      coverage: { limitAmount: "1500000" },
    });
    assert.equal(after.current.latestTerm?.numberDisplay, rightNumber);
    assert.equal(after.current.latestTerm?.termEnd, "2025-02-01");
    const current = after.terms.find((entry) => entry.term.id === after.current.latestTerm!.id)!;
    assert.equal(current.coverages.find((row) => row.recordStatus === "active")?.limitAmount, "1500000.00");

    const oldTerms = after.terms.filter((entry) => entry.term.recordStatus === "corrected");
    assert.equal(oldTerms.length, 1, "the wrong term is kept, flagged corrected");
    assert.equal(oldTerms[0].term.numberDisplay, wrongNumber);
    assert.equal(oldTerms[0].term.termEnd, "2025-01-01");
    assert.ok(after.terms.flatMap((entry) => entry.coverages).some((row) => row.recordStatus === "corrected" && row.limitAmount === "1000000.00"), "the wrong coverage state is kept");
    assert.equal(await count(`SELECT count(*) FROM public.insurance_policy_terms WHERE policy_id = $1`, [view.policy.id]), 2, "nothing was deleted");

    const recorded = (await events(actor.actorId)).filter((event) => event.event_type === "RECORD_CORRECTED");
    assert.ok(recorded.some((event) => event.target.resourceType === "insurance_policy_term"));
    assert.ok(recorded.some((event) => event.target.resourceType === "insurance_coverage"));
    for (const event of recorded) assert.ok(event.target.subjectReferences.includes(`organization:${insured}`));
  });

  it("ENDORSEMENT: a real change keeps the earlier coverage state as history and refuses what an endorsement cannot change", async () => {
    const actor = await signInWith(...ALL);
    const insured = await organization("Endorsed");
    const insurer = await organization("EndorsedInsurer");
    const view = await newPolicy(insured, insurer);
    const coverageId = view.asOf.coverages.length ? view.asOf.coverages[0].id : view.terms[0].coverages[0].id;
    const eventsBefore = (await events(actor.actorId)).length;

    await refused(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "ENDORSEMENT", effectiveOn: "2024-06-01", policyNumber: number("NO") }), "ValidationError");
    await refused(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "ENDORSEMENT", effectiveOn: "2024-06-01", coverageId, coverage: { coverageType: "MOTOR_TRUCK_CARGO" } }), "ValidationError");
    assert.equal((await events(actor.actorId)).length, eventsBefore, "refusals record nothing");

    const after = await K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "ENDORSEMENT", effectiveOn: "2024-06-01", coverageId, coverage: { limitAmount: "2000000" } });
    const coverages = after.terms[0].coverages;
    assert.equal(coverages.length, 2);
    const ended = coverages.find((row) => row.effectiveTo !== null)!;
    assert.equal(ended.limitAmount, "1000000.00", "the earlier state stays");
    assert.equal(ended.effectiveTo, "2024-06-01");
    assert.equal(coverages.find((row) => row.effectiveTo === null)?.limitAmount, "2000000.00");
    assert.equal(after.terms[0].endorsements.length, 1);
    assert.equal(after.current.latestTerm?.id, view.current.latestTerm?.id, "the term itself did not change");
    const recorded = (await events(actor.actorId)).map((event) => `${event.event_type}:${event.target.resourceType}`);
    assert.ok(recorded.includes("RECORD_CREATED:insurance_endorsement"));
    assert.ok(recorded.includes("RECORD_UPDATED:insurance_coverage"));
  });

  it("broker: a real change keeps the previous period as history; a correction flags the wrong period; a contact must belong to the brokerage", async () => {
    await signInWith(...ALL);
    const insured = await organization("BrokerInsured");
    const insurer = await organization("BrokerInsurer");
    const first = await brokerage("BrokerOne");
    const second = await brokerage("BrokerTwo");
    const view = await newPolicy(insured, insurer);
    assert.equal(view.current.broker, null);

    const started = await K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION", broker: { brokerOrganizationId: first.organizationId, brokerPersonId: first.personId } });
    assert.equal(started.current.broker?.brokerOrganizationId, first.organizationId, "no broker yet: the first period starts");

    await refused(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "ENDORSEMENT", broker: { brokerOrganizationId: second.organizationId, brokerPersonId: first.personId } }), "ValidationError");

    const changed = await K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "ENDORSEMENT", broker: { brokerOrganizationId: second.organizationId, brokerPersonId: second.personId } });
    assert.equal(changed.current.broker?.brokerOrganizationId, second.organizationId);
    assert.equal(changed.brokerPeriods.length, 2);
    assert.ok(changed.brokerPeriods.find((row) => row.brokerOrganizationId === first.organizationId)?.effectiveTo, "the previous broker's period is ended, not removed");

    const corrected = await K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION", broker: { brokerOrganizationId: first.organizationId, brokerPersonId: first.personId } });
    assert.equal(corrected.current.broker?.brokerOrganizationId, first.organizationId);
    assert.ok(corrected.brokerPeriods.some((row) => row.recordStatus === "corrected" && row.brokerOrganizationId === second.organizationId), "the wrong period is kept, flagged corrected");
    assert.equal(await count(`SELECT count(*) FROM public.insurance_broker_periods WHERE policy_id = $1`, [view.policy.id]), 3, "first (ended), second (corrected), replacement");
  });

  it("rollback: a refusal in a later step undoes the earlier steps of the same edit", async () => {
    const actor = await signInWith(...ALL);
    const insured = await organization("Rollback");
    const insurer = await organization("RollbackInsurer");
    const view = await newPolicy(insured, insurer);
    const coverageId = view.asOf.coverages.length ? view.asOf.coverages[0].id : view.terms[0].coverages[0].id;
    const before = await snapshot(view.policy.id);
    const eventsBefore = (await events(actor.actorId)).length;

    // the coverage correction is valid; the term correction (end before start) is refused -> nothing may remain
    await refused(
      K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION", coverageId, coverage: { limitAmount: "5000000" }, termEnd: "2023-06-01" }),
      "ValidationError",
    );
    assert.deepEqual(await snapshot(view.policy.id), before);
    assert.equal(await count(`SELECT count(*) FROM public.insurance_coverages WHERE policy_id = $1 AND record_status = 'corrected'`, [view.policy.id]), 0, "no coverage was flagged corrected");
    assert.equal((await events(actor.actorId)).length, eventsBefore, "and no event remains");
    await refused(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION" }), "ValidationError");
  });

  it("archive: the reason lands in the archive event, a wrong company cannot archive, restore keeps history, nothing is deleted", async () => {
    const actor = await signInWith(...ALL);
    const insured = await organization("Archived");
    const other = await organization("ArchiveOther");
    const insurer = await organization("ArchiveInsurer");
    const view = await newPolicy(insured, insurer);

    await refused(K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: insured, reason: "x".repeat(501) }), "ValidationError");
    await notFound(K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: other, reason: "not mine" }));
    assert.equal((await K.insurance.getOrganizationInsurance(insured)).policies[0].policy.recordStatus, "active");

    const reason = `Superseded by annual renewal ${run}`;
    const archived = await K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: insured, reason });
    assert.equal(archived.policy.recordStatus, "archived");
    const archiveEvents = (await events(actor.actorId)).filter((event) => event.event_type === "RECORD_ARCHIVED");
    assert.equal(archiveEvents.length, 1);
    assert.equal(archiveEvents[0].outcome?.reason, reason);
    assert.ok(archiveEvents[0].target.subjectReferences.includes(`organization:${insured}`));

    await K.insurance.restorePolicy({ policyId: view.policy.id, organizationId: insured });
    assert.equal((await K.insurance.getOrganizationInsurance(insured)).policies[0].policy.recordStatus, "active");
    assert.equal(await count(`SELECT count(*) FROM public.insurance_policies WHERE id = $1`, [view.policy.id]), 1);

    // an archive without a reason is still the existing operation (the reason is optional at the domain)
    const again = await K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: insured });
    assert.equal(again.policy.recordStatus, "archived");
  });

  it("workers compensation and bonds: statutory account without a limit, continuous bond corrected in place of history", async () => {
    await signInWith(...ALL);
    const insured = await organization("WcbBond");
    const board = await organization("Board");
    const surety = await organization("Surety");
    const wcb = await K.insurance.createPolicy({ organizationId: insured, insurerOrganizationId: board, family: "WORKERS_COMPENSATION", policyNumber: number("WCB"), termStart: "2024-01-01", termEnd: "2025-01-01", coverages: [{ coverageType: "WORKERS_COMPENSATION" }] });
    assert.equal(wcb.terms[0].coverages[0].limitAmount, null);
    const bond = await K.insurance.createPolicy({ organizationId: insured, insurerOrganizationId: surety, family: "BOND", policyNumber: number("BND"), termStart: "2024-01-01", termEnd: null, coverages: [{ coverageType: "BOND_FREIGHT_BROKER", limitAmount: "75000", currency: "USD", limitBasis: "PENAL_SUM" }] });
    assert.equal(bond.current.latestTerm?.termEnd, null, "a bond may be continuous");

    const coverageId = bond.asOf.coverages[0].id;
    const fixed = await K.workspace.editPolicyRecord({ policyId: bond.policy.id, organizationId: insured, mode: "CORRECTION", coverageId, coverage: { limitAmount: "100000" } });
    assert.equal(fixed.terms[0].coverages.find((row) => row.recordStatus === "active")?.limitAmount, "100000.00");
    assert.equal(fixed.terms[0].coverages.find((row) => row.recordStatus === "corrected")?.limitAmount, "75000.00");
    const listed = await K.insurance.getOrganizationInsurance(insured);
    assert.deepEqual(listed.policies.map((entry) => entry.policy.family).sort(), ["BOND", "WORKERS_COMPENSATION"]);
  });

  it("authorization: INSURANCE_MANAGE is required to edit; a reader can read but not change", async () => {
    await signInWith(...ALL);
    const insured = await organization("Authz");
    const insurer = await organization("AuthzInsurer");
    const view = await newPolicy(insured, insurer);
    const before = await snapshot(view.policy.id);

    await signInWith("INSURANCE_READ");
    assert.equal((await K.insurance.getOrganizationInsurance(insured)).policies.length, 1);
    const denied = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof Error && /Authorization|Identity/.test(error.constructor.name));
    await denied(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION", policyNumber: number("DENIED") }));
    await denied(K.insurance.archivePolicy({ policyId: view.policy.id, organizationId: insured, reason: "denied" }));

    await signInWith();
    await denied(K.workspace.editPolicyRecord({ policyId: view.policy.id, organizationId: insured, mode: "CORRECTION", policyNumber: number("DENIED") }));
    await denied(K.insurance.getOrganizationInsurance(insured));
    assert.deepEqual(await snapshot(view.policy.id), before);
  });
});
