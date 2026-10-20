// Run with `pnpm test:auth`. Migration 0036 (company change accountability) is applied by the owner, separately from the deployment. The application
// must therefore keep every ordinary company read and edit working on a database that ends at 0035, offer the 0036 features only when the whole
// migration exists, refuse (never silently apply) a sensitive change that needs it, preserve the data across the upgrade, and fail closed on a
// partly applied migration. The test detects which state the disposable database is in (MIGRATIONS_DIR can stop the runner at 0035), asserts
// accordingly, and then APPLIES 0036 to the same database.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

const enabled = Boolean(process.env.TES_TEST_ADMIN_DATABASE_URL && process.env.TES_TEST_RUNTIME_DATABASE_URL);
const STAFF = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ", "COMPANY_PROFILE_MANAGE",
  "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH", "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE",
  "CONTRACT_READ", "EVIDENCE_READ",
];
const digits = (n: number) => Array.from({ length: n }, () => randomInt(1, 10)).join("");
const K: Record<string, any> = {};

describe("Company edit across the 0035 / 0036 schema states", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 6);

  before(async () => {
    await import("../../helpers/register-auth-test-loader.mjs");
    K.db = await import("@/test/helpers/auth-db");
    K.dir = await import("@/lib/company-directory/service");
    K.changes = await import("@/lib/company-changes/service");
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
  const one = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => ((await pools.admin.query(sql, params)).rows as T[])[0];
  const has0036 = async () => (await one<{ p: boolean }>(`SELECT to_regclass('public.company_change_records') IS NOT NULL AS p`)).p;
  const refused = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error & { issues?: Array<{ field: string; message: string }> };
    }
    assert.fail("expected the operation to be refused");
  };
  const recorded = async (id: string) => {
    const { editAccess: _a, changeTracking: _c, ...rest } = await K.dir.getCompanyProfile(id);
    return JSON.stringify(rest);
  };

  it("works whichever state the database is in, refuses sensitive changes that need 0036, preserves data across the upgrade, and fails closed when 0036 is partly applied", async () => {
    await signInWith(...STAFF);
    const atStart = await has0036();
    const tag = digits(5);
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Track ${run} ${tag} Transport Ltd`, companyType: "Customer", cargoTypes: ["General Freight"], opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      startDate: "2024-01-15", contactPerson: `Pat Primary${digits(3)}`, email: `acct-${tag}@example.test`, reg_street: "1 King St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada",
    });
    const id = created.company.id as string;

    // --- the reads work in every state, and say which state they are in
    let profile = await K.dir.getCompanyProfile(id);
    assert.equal(profile.changeTracking, atStart ? "COMPLETE" : "ABSENT");
    assert.equal(profile.editAccess.legalName, false, "STAFF do not hold the legal-name capability (and the capability may not exist yet)");
    const activity = await K.changes.getCompanyActivity(id);
    assert.equal(activity.tracking, atStart ? "COMPLETE" : "ABSENT");
    if (!atStart) {
      assert.deepEqual(activity.entries, []);
      assert.match(activity.message, /migration 0036/);
    }

    // --- ordinary edits work in every state (and are recorded in the Master Register by their own domains)
    const eventsBefore = Number((await one<{ n: string }>(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [id])).n);
    const first = await K.dir.editCompany(id, { dba: `Trading ${run}`, payMethod: "Cheque", phone: "+1 416 555 0177", mail_street: "PO Box 5", mail_city: "Ottawa", mail_state: "ON", mail_zip: "K1A 0B1", mail_country: "Canada" });
    assert.equal(first.details?.channels.find((c: any) => c.field === "phone")?.action, "created", "a first value is recorded directly");
    profile = await K.dir.getCompanyProfile(id);
    assert.deepEqual([profile.dba, profile.payMethod, profile.phone, profile.mail_city], [`Trading ${run}`, "Cheque", "+1 416 555 0177", "Ottawa"]);
    assert.ok(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [id])).n) > eventsBefore);
    const ledgerRows = async () => (atStart ? Number((await one<{ n: string }>(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1`, [id])).n) : -1);
    if (atStart) assert.ok((await ledgerRows()) >= 4, "with 0036 every change is also a ledger row");

    // --- the legal name still cannot be changed by an ordinary edit, in any state
    assert.match((await refused(K.dir.editCompany(id, { companyName: "Silent Rename Ltd" }))).message, /legal-name change procedure/i);

    if (!atStart) {
      // --- a sensitive replacement or removal needs the confirmation workflow: refused with an explanation, the established value stays
      const before = await recorded(id);
      for (const change of [{ email: "other@example.test" }, { phone: "+1 416 555 0199" }, { email: "" }, { phone: "" }]) {
        const error = await refused(K.dir.editCompany(id, { dba: "Not Saved", ...change }));
        assert.equal(error.name, "CompanyCreationValidationError");
        assert.match(error.issues?.[0].message ?? "", /migration 0036/);
      }
      assert.equal(await recorded(id), before, "nothing was saved, including the DBA sent alongside");
      // --- the legal-name procedure explains itself instead of failing anonymously
      for (const call of [
        () => K.changes.requestLegalNameChange({ organizationId: id, requestedLegalName: "New Name Ltd", requestedByPersonId: randomUUID(), requesterRelationshipId: randomUUID(), requesterBasis: "CUSTOMER_AUTHORITY", requestSource: "EMAIL", requestReference: "email", requestReceivedAt: new Date(Date.now() - 1000).toISOString() }),
        () => K.changes.applyLegalNameChange({ organizationId: id, requestId: randomUUID(), effectiveDate: "2026-10-01" }),
        () => K.changes.confirmChannelChange({ organizationId: id, requestId: randomUUID(), confirmationChannelKind: "COMPANY_CHANNEL", confirmationChannelId: randomUUID(), confirmationMethod: "CALL_BACK", confirmationEvidenceDocumentId: randomUUID() }),
      ]) {
        const error = await refused(call());
        assert.equal(error.name, "CompanyChangeStateError");
        assert.match(error.message, /migration 0036/);
      }
      // --- apply 0036 to the SAME database and prove nothing recorded changed
      // the migrations are forward-only and ordered: a database still at 0034 receives 0035 first, exactly as the runner would apply them
      if (!(await one<{ p: boolean }>(`SELECT to_regclass('public.organization_person_operational_email_exclusions') IS NOT NULL AS p`)).p) {
        await pools.admin.query(readFileSync(path.join(process.cwd(), "database/migrations/0035_person_identity_details_and_operational_email_exclusions.sql"), "utf8"));
      }
      await pools.admin.query(readFileSync(path.join(process.cwd(), "database/migrations/0036_company_change_accountability.sql"), "utf8"));
      assert.equal(await recorded(id), before, "the same record reads back unchanged after the upgrade");
      assert.equal((await K.dir.getCompanyProfile(id)).changeTracking, "COMPLETE");
      assert.equal((await K.changes.getCompanyActivity(id)).tracking, "COMPLETE");
    }

    // --- with 0036 the replacement is a request, and the established value stays
    const replaced = await K.dir.editCompany(id, { email: "replacement@example.test", channelChangeSource: "COMPANY_WRITTEN_REQUEST", channelChangeReference: "email of the Primary Contact" });
    assert.equal(replaced.details?.channels.find((c: any) => c.field === "email")?.action, "pending_confirmation");
    assert.equal((await K.dir.getCompanyProfile(id)).email, `acct-${tag}@example.test`);

    // --- removal is a sensitive change too: it waits for confirmation (nothing is removed), so "remove, then add" has no first step to exploit
    const removal = await K.dir.editCompany(id, { phone: "", channelChangeSource: "STAFF_ENTRY", channelChangeReference: "asked to drop the phone" });
    assert.equal(removal.details?.channels.find((c: any) => c.field === "phone")?.action, "pending_confirmation");
    assert.equal((await K.dir.getCompanyProfile(id)).phone, "+1 416 555 0177", "the established phone is still in use");

    // --- FAIL CLOSED when 0036 is partly applied: reads keep working, writes are refused and nothing is half-saved
    await pools.admin.query(`ALTER TABLE public.company_change_record_evidence DISABLE ROW LEVEL SECURITY`);
    try {
      const before = await recorded(id);
      assert.equal((await K.dir.getCompanyProfile(id)).changeTracking, "INCONSISTENT");
      const error = await refused(K.dir.editCompany(id, { dba: "Half Applied" }));
      assert.equal(error.name, "CompanyChangeStateError");
      assert.match(error.message, /partly applied migration 0036/);
      assert.equal(await recorded(id), before, "the refused edit rolled back entirely");
      const inconsistent = await K.changes.getCompanyActivity(id);
      assert.deepEqual([inconsistent.tracking, inconsistent.entries.length], ["INCONSISTENT", 0]);
    } finally {
      await pools.admin.query(`ALTER TABLE public.company_change_record_evidence ENABLE ROW LEVEL SECURITY`);
    }
    assert.equal((await K.dir.getCompanyProfile(id)).changeTracking, "COMPLETE");
    await K.dir.editCompany(id, { dba: `Healed ${run}` });
    assert.equal((await K.dir.getCompanyProfile(id)).dba, `Healed ${run}`);
  });
});
