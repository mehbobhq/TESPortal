// Run with `TES_TEST_FILES="test/lib/ui-recovery/credentials-business.db.test.ts" bash scripts/test/run-auth-tests.sh`.
//
// UI recovery: Credentials and Business. The company-scoped entry points and routes added for the restored interfaces, through the
// REAL authorization wrappers and the RUNTIME role: isolation (a company-scoped id is only reachable through its own company),
// Master Register events, "no secret value anywhere", authorization, and rollback.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  const { NextRequest } = await import("next/server");
  return {
    db: await import("@/test/helpers/auth-db"),
    credentials: await import("@/lib/company-credentials/service"),
    scope: await import("@/lib/company-credential-scope/service"),
    corporate: await import("@/lib/corporate-identity/service"),
    credentialRoute: await import("@/app/api/companies/[id]/credentials/[credentialId]/route"),
    credentialsRoute: await import("@/app/api/companies/[id]/credentials/route"),
    businessRoute: await import("@/app/api/companies/[id]/business/route"),
    NextRequest,
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

const MANAGE = ["CREDENTIAL_READ", "CREDENTIAL_MANAGE", "ORGANIZATION_REGISTRY_READ", "ORGANIZATION_UPDATE", "ORGANIZATION_CREATE"];

describe("UI recovery: credentials and business", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 8).toUpperCase();

  before(async () => {
    Object.assign(K, await loadKit());
    pools = K.db.openPools();
  });
  after(async () => {
    K.db.setClerkUser(null);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`DROP FUNCTION IF EXISTS public.tes_test_fail_master_register()`);
    for (const fx of fixtures) await fx.cleanup();
    await K.db.closePools();
  });

  async function signInWith(...capabilities: string[]): Promise<string> {
    const fx = new K.db.AuthFixtures(pools.admin);
    fixtures.push(fx);
    const actor = await fx.actor();
    const relationshipId = await fx.relationship(actor.actorId, "TES_STAFF");
    const assignmentId = await fx.assignment(relationshipId, { type: "SYSTEM" });
    for (const capability of capabilities) await fx.grant(relationshipId, capability, { assignmentId });
    K.db.setClerkUser(actor.clerkSubject);
    return actor.actorId;
  }
  async function organization(label: string): Promise<string> {
    const id = randomUUID();
    await pools.admin.query(`INSERT INTO public.organizations (id, legal_name, normalized_legal_name) VALUES ($1, $2, lower($2))`, [id, `UIR ${label} ${run} ${id.slice(0, 6)}`]);
    return id;
  }
  const count = async (sql: string, params: unknown[] = []) => Number((await pools.admin.query(sql, params)).rows[0].count);
  const named = (name: string) => (error: unknown) => error instanceof Error && error.constructor.name === name;
  const notFound = (promise: Promise<unknown>) => assert.rejects(promise, (error: unknown) => error instanceof Error && error.constructor.name.endsWith("NotFoundError"));
  const denied = (promise: Promise<unknown>) => assert.rejects(promise, named("TesAuthorizationDeniedError"));
  const operations = async (actorId: string) =>
    (await pools.admin.query<{ event_type: string; operation: string }>(`SELECT event_type, action->>'operation' AS operation FROM public.master_register_events WHERE actor_id = $1::uuid ORDER BY recorded_at, event_type`, [actorId])).rows;
  const has = (rows: { event_type: string; operation: string }[], operation: string, eventType: string) => rows.some((row) => row.operation === operation && row.event_type === eventType);
  const everythingFor = async (actorId: string) => JSON.stringify((await pools.admin.query(`SELECT * FROM public.master_register_events WHERE actor_id = $1::uuid`, [actorId])).rows);

  async function credentialFixture(label: string) {
    const owner = await organization(`${label}Owner`);
    const other = await organization(`${label}Other`);
    const system = await K.credentials.createSystem({ name: `UIR ${run} ${label} Portal ${randomInt(1000, 9999)}` });
    const view = await K.credentials.createCredential({ organizationId: owner, systemId: system.id, category: "FLEET", username: `user-${label}-${run}@example.test` });
    return { owner, other, system, view, id: view.credential.id };
  }
  const request = (method: string, body?: unknown) => new K.NextRequest("http://localhost/test", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("credential operations are reachable only through the credential's own company and leave other companies untouched", async () => {
    const actorId = await signInWith(...MANAGE);
    const { owner, other, system, view, id } = await credentialFixture("Iso");
    const periodId = view.currentStatus!.id;

    // wrong company: every scoped entry point looks like "not found" and changes nothing
    await notFound(K.scope.updateCompanyCredentialMetadata(other, { credentialId: id, category: "FUEL" }));
    await notFound(K.scope.replaceCompanyCredential(other, { credentialId: id, username: `new-${run}`, reason: "CORRECTION" }));
    await notFound(K.scope.correctCompanyCredentialStatus(other, { periodId, status: "LOCKED" }));
    await notFound(K.scope.declareCompanySecretSlot(other, { credentialId: id, slotKind: "RECOVERY_EMAIL" }));
    await notFound(K.scope.retireCompanySecretSlot(other, { slotId: view.slots[0].id }));
    await notFound(K.scope.linkCompanySlotToSecretManager(other, { slotId: view.slots[0].id, secretReference: `projects/tes-test-proj/secrets/iso-${run}` }));
    const after = (await K.credentials.getOrganizationCredentials(owner)).credentials[0];
    assert.equal(after.credential.category, "FLEET");
    assert.equal(after.credential.recordStatus, "active");
    assert.equal(after.slots.length, 1);
    assert.equal(after.currentStatus?.status, "ACTIVE");
    assert.equal((await K.credentials.getOrganizationCredentials(other)).credentials.length, 0);

    // the right company works: metadata, status correction, verification void, slots
    const meta = await K.scope.updateCompanyCredentialMetadata(owner, { credentialId: id, category: "FUEL", mfaMethod: "SMS" });
    assert.equal(meta.credential.category, "FUEL");
    const corrected = await K.scope.correctCompanyCredentialStatus(owner, { periodId, status: "NEEDS_VERIFICATION" });
    assert.equal(corrected.currentStatus?.status, "NEEDS_VERIFICATION");
    assert.ok(corrected.statusHistory.some((period) => period.recordStatus === "corrected"), "the mistaken status is kept and flagged");

    const verified = await K.credentials.recordVerification({ credentialId: id, organizationId: owner, outcome: "VERIFIED", method: "MANUAL_LOGIN" });
    const verificationId = verified.verifications[0].id;
    await notFound(K.scope.voidCompanyVerification(other, { verificationId }));
    const voided = await K.scope.voidCompanyVerification(owner, { verificationId });
    assert.equal(voided.verifications[0].recordStatus, "voided");
    assert.equal(voided.lastVerification, null);

    const declared = await K.scope.declareCompanySecretSlot(owner, { credentialId: id, slotKind: "RECOVERY_EMAIL" });
    const slot = declared.slots.find((item) => item.slotKind === "RECOVERY_EMAIL")!;
    assert.equal(slot.secretState, "UNRESOLVED");
    const retired = await K.scope.retireCompanySecretSlot(owner, { slotId: slot.id });
    assert.equal(retired.slots.find((item) => item.id === slot.id)?.secretState, "RETIRED");
    assert.equal(await count(`SELECT count(*) FROM public.credential_secret_slots WHERE id = $1`, [slot.id]), 1, "a retired slot is kept");

    // replacing a login: the new credential points at the old, which is archived with its history
    await notFound(K.scope.replaceCompanyCredential(other, { credentialId: id, username: `new-${run}`, reason: "USERNAME_CHANGED" }));
    const replacement = await K.scope.replaceCompanyCredential(owner, { credentialId: id, username: `renamed-${run}@example.test`, reason: "USERNAME_CHANGED" });
    assert.equal(replacement.credential.replacesCredentialId, id);
    assert.equal(replacement.currentStatus?.status, "NEEDS_VERIFICATION", "a new login has not been verified");
    const list = (await K.credentials.getOrganizationCredentials(owner)).credentials;
    assert.equal(list.length, 2);
    assert.equal(list.find((item) => item.credential.id === id)?.credential.recordStatus, "archived");

    // Master Register: one event family per operation, written by the authenticated actor
    const rows = await operations(actorId);
    assert.ok(has(rows, "updateCredentialMetadata", "RECORD_UPDATED"));
    assert.ok(has(rows, "correctCredentialStatus", "RECORD_CORRECTED"));
    assert.ok(has(rows, "voidVerification", "RECORD_STATUS_CHANGED"));
    assert.ok(has(rows, "addSecretSlot", "RECORD_CREATED"));
    assert.ok(has(rows, "retireSecretSlot", "RECORD_STATUS_CHANGED"));
    assert.ok(has(rows, "replaceCredential", "RECORD_CREATED"));
    assert.ok(has(rows, "replaceCredential", "RECORD_ARCHIVED"));

    // system maintenance: an alias can only be retired through its own system
    const otherSystem = await K.credentials.createSystem({ name: `UIR ${run} Iso Portal B ${randomInt(1000, 9999)}` });
    const withAlias = await K.credentials.addAlias({ systemId: system.id, alias: `Alias ${run} ${randomInt(1000, 9999)}` });
    await notFound(K.scope.retireAliasOfCredentialSystem(otherSystem.id, { aliasId: withAlias.aliases[0].id }));
    const done = await K.scope.retireAliasOfCredentialSystem(system.id, { aliasId: withAlias.aliases[0].id });
    assert.equal(done.aliases[0].recordStatus, "retired");
    const updated = await K.credentials.updateSystem({ systemId: system.id, loginUrl: "https://portal.example.test/login" });
    assert.equal(updated.loginUrl, "https://portal.example.test/login");
    assert.ok(has(await operations(actorId), "updateSystem", "RECORD_UPDATED"));
  });

  it("no secret value exists anywhere: strict inputs, value-free responses, events and columns", async () => {
    const actorId = await signInWith(...MANAGE);
    const { owner, id, view } = await credentialFixture("Sec");
    const secret = `S3cr3t-Value-${run}-${randomInt(100000, 999999)}`;
    const resource = `projects/tes-test-proj/secrets/sec-${run.toLowerCase()}`;

    // a value (or any unknown key) is refused by the canonical input, through the service and through the route
    for (const key of ["password", "secret", "value", "answer", "pin", "backupCodes", "question"]) {
      await assert.rejects(K.scope.declareCompanySecretSlot(owner, { credentialId: id, slotKind: "RECOVERY_PIN", [key]: secret }), named("CompanyCredentialValidationError"), key);
      await assert.rejects(K.scope.createCredentialWithRecoverySlots(owner, { systemId: view.system.id, category: "FLEET", username: `x-${key}-${run}`, [key]: secret }), named("CompanyCredentialValidationError"), key);
    }
    const viaRoute = await K.credentialRoute.PATCH(request("PATCH", { action: "declareSlot", slotKind: "RECOVERY_PIN", password: secret }), { params: Promise.resolve({ id: owner, credentialId: id }) });
    assert.equal(viaRoute.status, 400);
    assert.doesNotMatch(JSON.stringify(await viaRoute.json()), new RegExp(secret));
    assert.equal(await count(`SELECT count(*) FROM public.credential_secret_slots WHERE credential_id = $1`, [id]), 1, "nothing was declared by a refused request");

    // a secret value is not a Secret Manager resource name, and the refusal never echoes it
    const slotId = view.slots[0].id;
    await assert.rejects(K.scope.linkCompanySlotToSecretManager(owner, { slotId, secretReference: secret }), (error: unknown) => {
      assert.ok(error instanceof Error && error.constructor.name === "CompanyCredentialValidationError");
      assert.ok(!(error as Error).message.includes(secret));
      return true;
    });
    const linked = await K.scope.linkCompanySlotToSecretManager(owner, { slotId, secretReference: resource });
    assert.equal(linked.slots.find((slot) => slot.id === slotId)?.secretState, "STORED");

    // every response a route returns, and every Master Register row, is free of the value AND of the resource name
    const get = await K.credentialsRoute.GET(request("GET"), { params: Promise.resolve({ id: owner }) });
    const bodies = [JSON.stringify(await get.json()), JSON.stringify(linked), JSON.stringify(view), await everythingFor(actorId)];
    for (const body of bodies) {
      assert.ok(!body.includes(secret));
      assert.ok(!body.includes(resource), "the stored reference is never returned or logged");
      assert.doesNotMatch(body, /secretReference|secret_reference|secretStore|secret_store/);
    }

    // no column in the credential tables can hold a value (the reference column holds a resource name only)
    const columns = (await pools.admin.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'credential%' OR table_name = 'company_credentials'`,
    )).rows;
    const suspicious = columns.filter((column) => /password|passwd|pin\b|answer|question|plaintext|secret_value|token|backup_code/i.test(column.column_name));
    assert.deepEqual(suspicious, []);
    const referenceShape = await pools.admin.query(`SELECT 1 FROM public.credential_secret_slots WHERE secret_reference IS NOT NULL AND secret_reference !~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}(/versions/([0-9]+|latest))?$'`);
    assert.equal(referenceShape.rowCount, 0);
  });

  it("a credential and its recovery slots are created in one transaction, always under the URL company", async () => {
    await signInWith(...MANAGE);
    const owner = await organization("AtomOwner");
    const other = await organization("AtomOther");
    const system = await K.credentials.createSystem({ name: `UIR ${run} Atom Portal ${randomInt(1000, 9999)}` });
    const username = `atom-${run}@example.test`;

    const created = await K.scope.createCredentialWithRecoverySlots(owner, {
      systemId: system.id, category: "REGISTRATION", username, mfaMethod: "AUTHENTICATOR_APP", status: "NEEDS_VERIFICATION",
      organizationId: other, // a body organizationId is never trusted
      recoverySlots: ["SECURITY_ANSWER", "SECURITY_ANSWER", "RECOVERY_EMAIL", "BACKUP_CODES"],
    });
    assert.equal(created.credential.organizationId, owner);
    assert.equal(created.currentStatus?.status, "NEEDS_VERIFICATION");
    const kinds = created.slots.map((slot) => slot.slotKind).sort();
    assert.deepEqual(kinds, ["BACKUP_CODES", "PASSWORD", "RECOVERY_EMAIL", "SECURITY_ANSWER", "SECURITY_ANSWER"]);
    assert.ok(created.slots.every((slot) => slot.secretState === "UNRESOLVED"), "declared, never stored");
    assert.equal((await K.credentials.getOrganizationCredentials(other)).credentials.length, 0);

    // a refused slot rolls the credential back too (MFA_SECRET may exist once, a bad kind never)
    for (const recoverySlots of [["RECOVERY_PHONE", "NOT_A_KIND"], ["MFA_SECRET", "MFA_SECRET"]]) {
      await assert.rejects(K.scope.createCredentialWithRecoverySlots(owner, { systemId: system.id, category: "FLEET", username: `rollback-${recoverySlots[0]}-${run}`, recoverySlots }));
      assert.equal(await count(`SELECT count(*) FROM public.company_credentials WHERE organization_id = $1 AND username_normalized LIKE 'rollback-%'`, [owner]), 0, "no orphan credential");
    }
    await assert.rejects(K.scope.createCredentialWithRecoverySlots(owner, { systemId: system.id, category: "FLEET", username: `rollback-types-${run}`, recoverySlots: "RECOVERY_EMAIL" }), named("CompanyCredentialValidationError"));

    // the same through the route
    const response = await K.credentialsRoute.POST(request("POST", { systemId: system.id, category: "FLEET", username: `route-${run}@example.test`, recoverySlots: ["RECOVERY_PHONE"] }), { params: Promise.resolve({ id: owner }) });
    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as { credential: { slots: unknown[] } }).credential.slots.length, 2);
  });

  it("a Master Register failure rolls the whole change back", async () => {
    await signInWith(...MANAGE);
    const { owner, system, id } = await credentialFixture("Rb");
    await pools.admin.query(`
      CREATE OR REPLACE FUNCTION public.tes_test_fail_master_register() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'RECORD_ARCHIVED' THEN RAISE EXCEPTION 'test: master register write refused'; END IF;
        RETURN NEW;
      END $$`);
    await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    await pools.admin.query(`CREATE TRIGGER tes_test_fail_master_register BEFORE INSERT ON public.master_register_events FOR EACH ROW EXECUTE FUNCTION public.tes_test_fail_master_register()`);
    try {
      await assert.rejects(K.scope.replaceCompanyCredential(owner, { credentialId: id, username: `rolled-${run}@example.test`, reason: "CORRECTION" }));
    } finally {
      await pools.admin.query(`DROP TRIGGER IF EXISTS tes_test_fail_master_register ON public.master_register_events`);
    }
    const list = (await K.credentials.getOrganizationCredentials(owner)).credentials;
    assert.equal(list.length, 1, "the replacement credential was rolled back");
    assert.equal(list[0].credential.recordStatus, "active", "the old credential was not archived");
    assert.equal(system.recordStatus, "active");
  });

  it("authorization: reading and managing are separate, and a signed-out caller can do neither", async () => {
    const { owner, id, view } = await (async () => {
      await signInWith(...MANAGE);
      return credentialFixture("Authz");
    })();
    await signInWith("CREDENTIAL_READ");
    assert.equal((await K.credentials.getOrganizationCredentials(owner)).credentials.length, 1);
    await denied(K.scope.updateCompanyCredentialMetadata(owner, { credentialId: id, category: "FUEL" }));
    await denied(K.scope.declareCompanySecretSlot(owner, { credentialId: id, slotKind: "RECOVERY_EMAIL" }));
    await denied(K.scope.linkCompanySlotToSecretManager(owner, { slotId: view.slots[0].id, secretReference: `projects/tes-test-proj/secrets/a-${run}` }));
    await denied(K.scope.createCredentialWithRecoverySlots(owner, { systemId: view.system.id, category: "FLEET", username: `denied-${run}` }));
    const forbidden = await K.credentialRoute.PATCH(request("PATCH", { action: "metadata", category: "FUEL" }), { params: Promise.resolve({ id: owner, credentialId: id }) });
    assert.equal(forbidden.status, 403);

    await signInWith("ORGANIZATION_REGISTRY_READ");
    await denied(K.credentials.getOrganizationCredentials(owner));
    await denied(K.corporate.registerBusinessIdentifier(owner, { kind: "CRA_BN", value: String(randomInt(100000000, 999999999)) }));

    K.db.setClerkUser(null);
    await assert.rejects(K.credentials.getOrganizationCredentials(owner));
    await assert.rejects(K.corporate.registerBusinessIdentifier(owner, { kind: "CRA_BN", value: String(randomInt(100000000, 999999999)) }));
  });

  it("business: a CRA BN or EIN is registered, changed (history kept), corrected and retired inside its own company", async () => {
    const actorId = await signInWith(...MANAGE);
    const a = await organization("BizA");
    const b = await organization("BizB");
    const bn = () => String(randomInt(100000000, 999999999));
    const identifiers = async (organizationId: string, kind: string) =>
      (await pools.admin.query<{ id: string; status: string }>(`SELECT id, status FROM public.organization_identifiers WHERE organization_id = $1 AND identifier_type = $2 ORDER BY created_at, id`, [organizationId, kind === "CRA_BN" ? "business_number" : "employer_identification_number"])).rows;

    const first = bn();
    const registered = await K.corporate.registerBusinessIdentifier(a, { kind: "CRA_BN", value: first });
    const active = registered.organization.identifiers.find((item) => item.kind === "CRA_BN" && item.status === "active")!;
    assert.equal(active.value, first);

    // a second number needs an explicit relation: change (history kept) or correction (flagged, kept)
    const second = bn();
    await assert.rejects(K.corporate.registerBusinessIdentifier(a, { kind: "CRA_BN", value: second }), named("CorporateIdentityValidationError"));
    await assert.rejects(K.corporate.registerBusinessIdentifier(a, { kind: "CRA_BN", value: first, relation: "change" }), named("CorporateIdentityValidationError"), "the active number cannot be re-registered");
    await assert.rejects(K.corporate.registerBusinessIdentifier(a, { kind: "INCORPORATION", value: "123456" }), named("CorporateIdentityValidationError"));
    await assert.rejects(K.corporate.registerBusinessIdentifier(a, { kind: "CRA_BN", value: second, relation: "change", organizationId: b }), named("CorporateIdentityValidationError"));

    const changed = await K.corporate.registerBusinessIdentifier(a, { kind: "CRA_BN", value: second, relation: "change" });
    const afterChange = changed.organization.identifiers.filter((item) => item.kind === "CRA_BN");
    assert.equal(afterChange.length, 2, "the earlier number is kept as history");
    assert.equal(afterChange.find((item) => item.value === first)?.status, "superseded");
    assert.equal(afterChange.find((item) => item.value === second)?.status, "active");

    const third = bn();
    const corrected = await K.corporate.registerBusinessIdentifier(a, { kind: "CRA_BN", value: third, relation: "correction" });
    assert.equal(corrected.organization.identifiers.find((item) => item.value === third)?.status, "active");
    assert.equal(corrected.organization.identifiers.find((item) => item.value === second)?.status, "superseded");
    assert.equal((await identifiers(a, "CRA_BN")).length, 3, "nothing was deleted");

    // a number another company already holds is refused as a collision, and the real change is not half-applied
    await assert.rejects(K.corporate.registerBusinessIdentifier(b, { kind: "CRA_BN", value: third }), (error: unknown) => error instanceof Error && /Collision|Conflict/.test(error.constructor.name));
    const holder = await K.corporate.registerBusinessIdentifier(b, { kind: "CRA_BN", value: bn() });
    await assert.rejects(K.corporate.registerBusinessIdentifier(b, { kind: "CRA_BN", value: third, relation: "change" }), (error: unknown) => error instanceof Error && /Collision|Conflict/.test(error.constructor.name));
    assert.equal((await K.corporate.getOrganization(b)).identifiers.filter((item) => item.kind === "CRA_BN" && item.status === "active").length, 1, "the real change rolled back as a whole");
    assert.equal(holder.organization.identifiers.length, 1);

    // retire is scoped to the URL company and to the business-number kinds
    const activeId = corrected.organization.identifiers.find((item) => item.value === third)!.id;
    await notFound(K.corporate.retireBusinessIdentifier(b, activeId));
    const retired = await K.corporate.retireBusinessIdentifier(a, activeId);
    assert.equal(retired.organization.identifiers.find((item) => item.id === activeId)?.status, "superseded");
    await assert.rejects(K.corporate.retireBusinessIdentifier(a, activeId), named("CorporateIdentityStateError"), "already retired");

    // EIN uses the same path
    const ein = `${randomInt(10, 99)}-${randomInt(1000000, 9999999)}`;
    const einResult = await K.corporate.registerBusinessIdentifier(a, { kind: "IRS_EIN", value: ein });
    assert.equal(einResult.organization.identifiers.find((item) => item.kind === "IRS_EIN")?.status, "active");

    const rows = await operations(actorId);
    assert.ok(has(rows, "addIdentifier", "RECORD_CREATED"));
    assert.ok(has(rows, "correctIdentifier", "RECORD_CORRECTED"));
    assert.ok(has(rows, "supersedeIdentifier", "RECORD_STATUS_CHANGED"));
  });

  it("business routes: the company comes from the URL, the view includes history, and bad actions are refused", async () => {
    await signInWith(...MANAGE);
    const a = await organization("BizRouteA");
    const b = await organization("BizRouteB");
    const value = String(randomInt(100000000, 999999999));
    const post = await K.businessRoute.POST(request("POST", { kind: "CRA_BN", value }), { params: Promise.resolve({ id: a }) });
    assert.equal(post.status, 201);
    const created = (await post.json()) as { business: { identifiers: { id: string; kind: string; value: string; status: string }[] } };
    assert.equal(created.business.identifiers.length, 1);
    const identifierId = created.business.identifiers[0].id;

    const other = await K.businessRoute.GET(request("GET"), { params: Promise.resolve({ id: b }) });
    assert.deepEqual(((await other.json()) as { business: { identifiers: unknown[] } }).business.identifiers, [], "another company sees nothing of it");

    const wrongCompany = await K.businessRoute.PATCH(request("PATCH", { action: "retire", identifierId }), { params: Promise.resolve({ id: b }) });
    assert.equal(wrongCompany.status, 404);
    const unsupported = await K.businessRoute.PATCH(request("PATCH", { action: "delete", identifierId }), { params: Promise.resolve({ id: a }) });
    assert.equal(unsupported.status, 400);
    const retired = await K.businessRoute.PATCH(request("PATCH", { action: "retire", identifierId }), { params: Promise.resolve({ id: a }) });
    assert.equal(retired.status, 200);
    const history = await K.businessRoute.GET(request("GET"), { params: Promise.resolve({ id: a }) });
    const view = ((await history.json()) as { business: { identifiers: { status: string; supersededAt: string | null }[] } }).business;
    assert.equal(view.identifiers[0].status, "superseded");
    assert.ok(view.identifiers[0].supersededAt, "retiring keeps the number as dated history");
  });
});
