// Run with `pnpm test:auth` (scripts/test/run-auth-tests.sh) or against a disposable database via the TES_TEST_* URLs.
//
// Company Profile and Company Edit completion: every displayed value has a defined source and every editable value a real, persistent save path
// (the field inventory is checked against the server's actual behaviour); read-only / derived / gated fields cannot be written through the edit;
// the viewer's edit permissions are reported truthfully and enforced atomically; the three addresses are independent and keep their history;
// rejected identifiers are reported per field with nothing saved; the activity shows who made a change; and nothing is reachable across tenants.
// Real authorization, transactions, row-level security and Master Register.

import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { AuthFixtures, Pools } from "@/test/helpers/auth-db";

async function loadKit() {
  await import("../../helpers/register-auth-test-loader.mjs");
  return {
    db: await import("@/test/helpers/auth-db"),
    dir: await import("@/lib/company-directory/service"),
    life: await import("@/lib/company-directory/service-lifecycle"),
    inventory: await import("@/lib/company-directory/field-inventory"),
    changes: await import("@/lib/company-changes/service"),
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

const STAFF = [
  "ORGANIZATION_CREATE", "ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "CONTACT_MANAGE", "PERSON_REGISTRY_READ",
  "COMPANY_PROFILE_MANAGE", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_MANAGE", "TAX_REGISTRATION_READ", "CUSTOMER_ESTABLISH",
  "CUSTOMER_RELATIONSHIP_READ", "CUSTOMER_RELATIONSHIP_MANAGE", "CONTRACT_READ", "EVIDENCE_READ",
];
const digits = (n: number) => Array.from({ length: n }, () => randomInt(1, 10)).join("");

describe("Company Profile and Company Edit completion", { skip: !enabled }, () => {
  let pools: Pools;
  const fixtures: AuthFixtures[] = [];
  const run = randomUUID().slice(0, 6);

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
    return { actorId: actor.actorId, fx };
  }
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pools.admin.query(sql, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(sql, params)).n);
  const refused = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as Error & { issues?: Array<{ field: string; message: string }>; missing?: string[] };
    }
    assert.fail("expected the operation to be refused");
  };
  const events = (id: string) => count(`SELECT count(*) AS n FROM public.master_register_events e WHERE e::text LIKE '%' || $1 || '%'`, [id]);

  /** A Customer with a Primary Contact and an account email only (so first phone / website / billing-email values are recorded directly). */
  const customer = async (label: string) => {
    const tag = `${label}${digits(4)}`;
    const created = await K.dir.createCompanyDirectoryRecord({
      companyName: `Complete ${run} ${tag} Transport Ltd`, companyType: "Customer", cargoTypes: ["General Freight"], opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada",
      startDate: "2024-01-15", contactPerson: `Pat Primary${digits(3)}`, email: `acct-${tag.toLowerCase()}@example.test`,
      reg_street: "1 King St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada",
      mail_street: "PO Box 10", mail_city: "Toronto", mail_state: "ON", mail_zip: "M5X 1A1", mail_country: "Canada",
      yard_street: "9 Yard Rd", yard_city: "Mississauga", yard_state: "ON", yard_zip: "L5T 1A1", yard_country: "Canada",
    });
    return created.company.id as string;
  };
  const profile = async (id: string) => (await K.dir.getCompanyProfile(id))!;
  /** The recorded values only: what the viewer may EDIT differs by viewer and is not part of the record. */
  const recorded = async (id: string) => {
    const { editAccess: _editAccess, ...rest } = await profile(id);
    return JSON.stringify(rest);
  };

  describe("field inventory", () => {
    it("every value the profile returns has a defined source and mode, for a Customer and for another record type", async () => {
      await signInWith(...STAFF);
      const id = await customer("INV");
      const other = (await K.dir.createCompanyDirectoryRecord({ companyName: `Plain ${run} ${digits(4)} Ltd`, companyType: "Owner Operator", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada", contactPerson: "Pat Q", email: `p${digits(5)}@example.test` })).company.id as string;
      for (const target of [id, other]) {
        const record = await profile(target);
        const missing = Object.keys(record).filter((key) => !(key in K.inventory.COMPANY_FIELD_INVENTORY));
        assert.deepEqual(missing, [], `profile values without a defined source: ${missing.join(", ")}`);
      }
      for (const [key, field] of Object.entries(K.inventory.COMPANY_FIELD_INVENTORY)) {
        assert.ok(field.source && field.label, `${key} has a source and a label`);
        if (field.mode === "managed_elsewhere") assert.ok(field.workspace, `${key} says where it is managed`);
        if (field.mode !== "editable") assert.ok(field.note || field.workspace, `${key} says why it is not editable here`);
      }
    });

    it("every EDITABLE field has a persistent, validated save path: one edit round-trips through the canonical records, the ledger and the Master Register", async () => {
      await signInWith(...STAFF);
      const id = await customer("RT");
      const bn = digits(9);
      const ein = `${digits(2)}-${digits(7)}`;
      const eventsBefore = await events(id);
      const values = {
        dba: `Round Trip Trading ${run}`, incorpNo: `RT${digits(6)}`, businessNo: bn, ein, gstHst: `${bn} RT 0001`, opRegion: "Cross-Border",
        website: `https://rt-${run.toLowerCase()}.example.test`, phone: "+1 416 555 0188", billingEmail: `bill-${digits(4)}@example.test`,
        eldProvider: "Samsara", gpsProvider: "Geotab", fuelProvider: "Fleetcor", payMethod: "Cheque", cargoTypes: JSON.stringify(["General Freight", "Household Goods"]),
        reg_street: "2 Queen St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5H 2N2", reg_country: "Canada",
        mail_street: "PO Box 22", mail_city: "Ottawa", mail_state: "ON", mail_zip: "K1A 0B1", mail_country: "Canada",
        yard_street: "77 Depot Rd", yard_city: "Hamilton", yard_state: "ON", yard_zip: "L8E 1A1", yard_country: "Canada",
      };
      const result = await K.dir.editCompany(id, values);
      assert.equal(result.details?.website, "created");
      const after = await profile(id);
      assert.deepEqual(
        [after.dba, after.incorpNo, after.businessNo, after.ein, after.gstHst, after.opRegion, after.website, after.phone, after.billingEmail],
        [values.dba, values.incorpNo, values.businessNo, values.ein, values.gstHst, "Cross-Border", values.website, values.phone, values.billingEmail],
      );
      assert.deepEqual([after.eldProvider, after.gpsProvider, after.fuelProvider, after.payMethod], ["Samsara", "Geotab", "Fleetcor", "Cheque"]);
      assert.deepEqual([...after.cargoTypes].sort(), ["General Freight", "Household Goods"]);
      assert.deepEqual([after.reg_street, after.mail_city, after.yard_street], ["2 Queen St", "Ottawa", "77 Depot Rd"]);
      assert.ok((await events(id)) > eventsBefore, "the Master Register recorded the changes");
      const operations = (await rows<{ operation_code: string }>(`SELECT operation_code FROM public.company_change_records WHERE organization_id = $1`, [id])).map((r) => r.operation_code);
      for (const expected of ["DBA_ADDED", "ADDRESS_UPDATED", "PAYMENT_METHOD_UPDATED", "OPERATING_REGION_UPDATED", "WEBSITE_ADDED", "COMPANY_PHONE_ADDED", "BUSINESS_DETAILS_UPDATED"]) assert.ok(operations.includes(expected), `${expected} is in the ledger`);
      // the edit is idempotent: the same values again change nothing and add nothing
      const ledgerSize = operations.length;
      await K.dir.editCompany(id, values);
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1`, [id]), ledgerSize);
    });

    it("read-only, derived, managed-elsewhere and gated fields cannot be written through the edit: they are refused and nothing is saved", async () => {
      await signInWith(...STAFF);
      const id = await customer("RO");
      const before = JSON.stringify(await profile(id));
      const attempts: Array<[string, unknown]> = [
        ["startDate", "2020-01-01"], ["endDate", "2030-01-01"], ["serviceStage", "ACTIVE"], ["serviceType", "Premium"], ["status", "Archived"], ["kind", "Carrier"],
        ["region", "BC, CA"], ["regCorpState", "BC"], ["usdot", "1234567"], ["mc", "654321"], ["scac", "ABCD"], ["accIfta", "IFTA-1"], ["contact", "Someone Else"],
      ];
      for (const [key, value] of attempts) {
        const error = await refused(K.dir.editCompany(id, { [key]: value, dba: "Should Not Save" }));
        assert.equal(error.name, "CompanyCreationValidationError", `${key} is refused as an unknown/non-editable field`);
        assert.ok(error.issues?.some((issue) => issue.field === key), `${key} is named in the refusal`);
      }
      // the registered legal name is gated (its own procedure), not a plain field
      assert.match((await refused(K.dir.editCompany(id, { companyName: "Silent Rename Ltd" }))).message, /legal-name change procedure/i);
      assert.equal(JSON.stringify(await profile(id)), before, "no refused attempt, including the DBA sent alongside it, was partly saved");
    });
  });

  describe("permissions", () => {
    it("the profile reports what the viewer may edit, a read-only viewer cannot save anything, and a partly-authorized save is refused atomically", async () => {
      await signInWith(...STAFF);
      const id = await customer("AC");
      const full = (await profile(id)).editAccess;
      assert.deepEqual(Object.entries(full).filter(([, allowed]) => !allowed).map(([key]) => key), ["legalName"], "staff hold every edit capability except executing a legal-name change");

      await signInWith("ORGANIZATION_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_READ", "COMPANY_PROFILE_READ", "PERSON_REGISTRY_READ", "TAX_REGISTRATION_READ");
      const viewer = await profile(id);
      assert.deepEqual(Object.values(viewer.editAccess), [false, false, false, false, false, false, false]);
      const before = await recorded(id);
      const denied = await refused(K.dir.editCompany(id, { dba: "Viewer Edit" }));
      assert.match(denied.message, /not authorized|denied/i);
      assert.equal(await recorded(id), before);

      // may update company records but not phone / email / website: the whole request is refused, naming the missing capability, and the DBA is NOT applied
      await signInWith("ORGANIZATION_UPDATE", "ORGANIZATION_REGISTRY_READ", "PERSON_REGISTRY_READ", "CUSTOMER_RELATIONSHIP_READ", "COMPANY_PROFILE_READ", "TAX_REGISTRATION_READ");
      const partial = await profile(id);
      assert.deepEqual([partial.editAccess.identity, partial.editAccess.communication, partial.editAccess.operatingProfile, partial.editAccess.billing], [true, false, false, false]);
      const error = await refused(K.dir.editCompany(id, { dba: "Half Saved", phone: "+1 416 555 0123" }));
      assert.equal(error.name, "CompanyCreationCapabilityError");
      assert.deepEqual(error.missing, ["CONTACT_MANAGE"]);
      assert.equal(await recorded(id), before, "nothing, including the permitted DBA, was saved");
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1`, [id]), 0);
    });

    it("a customer-scoped actor can reach nothing of any company through the staff services (cross-tenant isolation), and an unknown company reads as not found", async () => {
      await signInWith(...STAFF);
      const a = await customer("TA");
      const b = await customer("TB");
      const customerA = (await one<{ id: string }>(`SELECT id FROM public.customers WHERE organization_id = $1`, [a])).id;
      const fx = new K.db.AuthFixtures(pools.admin);
      fixtures.push(fx);
      const actor = await fx.actor();
      const relationshipId = await fx.relationship(actor.actorId, "CUSTOMER_USER");
      const assignmentId = await fx.assignment(relationshipId, { type: "CUSTOMER", customerId: customerA });
      for (const capability of STAFF) await fx.grant(relationshipId, capability, { assignmentId });
      K.db.setClerkUser(actor.clerkSubject);
      const before = JSON.stringify([await one(`SELECT legal_name FROM public.organizations WHERE id = $1`, [a]), await one(`SELECT legal_name FROM public.organizations WHERE id = $1`, [b])]);
      for (const target of [a, b]) {
        await refused(K.dir.getCompanyProfile(target));
        await refused(K.dir.editCompany(target, { dba: "Cross Tenant" }));
        await refused(K.changes.getCompanyActivity(target));
        await refused(K.life.endCompanyService(target, { endedAt: "2030-01-01T00:00:00Z", endReason: "OTHER" }));
      }
      assert.equal(JSON.stringify([await one(`SELECT legal_name FROM public.organizations WHERE id = $1`, [a]), await one(`SELECT legal_name FROM public.organizations WHERE id = $1`, [b])]), before);
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = ANY($1::uuid[])`, [[a, b]]), 0);
      await signInWith(...STAFF);
      assert.equal(await K.dir.getCompanyProfile(randomUUID()), null);
    });
  });

  describe("addresses and history", () => {
    it("registered, mailing and yard addresses change independently, each keeping its previous address with dates, and the ledger names which one changed", async () => {
      await signInWith(...STAFF);
      const id = await customer("AD");
      const start = await profile(id);
      const mailing = { mail_street: "PO Box 99", mail_city: "London", mail_state: "ON", mail_zip: "N6A 1A1", mail_country: "Canada" };
      await K.dir.editCompany(id, mailing);
      let after = await profile(id);
      assert.deepEqual([after.reg_street, after.reg_city, after.yard_street], [start.reg_street, start.reg_city, start.yard_street], "registered and yard are untouched");
      assert.deepEqual([after.mail_street, after.mail_city], ["PO Box 99", "London"]);
      assert.equal(after.addressHistory?.length, 1);
      assert.deepEqual([after.addressHistory?.[0].role, after.addressHistory?.[0].address.startsWith("PO Box 10")], ["MAILING", true]);
      assert.equal(after.addressHistory?.[0].to !== null, true);

      await K.dir.editCompany(id, { yard_street: "5 New Yard Rd", yard_city: "Guelph", yard_state: "ON", yard_zip: "N1H 1A1", yard_country: "Canada" });
      after = await profile(id);
      assert.deepEqual([after.mail_street, after.reg_street], ["PO Box 99", start.reg_street]);
      assert.deepEqual((after.addressHistory ?? []).map((entry) => entry.role).sort(), ["HOME_YARD", "MAILING"]);
      const summaries = (await rows<{ summary: string }>(`SELECT summary FROM public.company_change_records WHERE organization_id = $1 AND operation_code = 'ADDRESS_UPDATED' ORDER BY recorded_at`, [id])).map((r) => r.summary);
      assert.deepEqual(summaries.map((s) => s.split(" ")[0]), ["mailing", "home_yard"]);

      // an incomplete address is refused with the field named; nothing changes
      const before = JSON.stringify(await profile(id));
      const error = await refused(K.dir.editCompany(id, { reg_street: "9 Partial St" }));
      assert.equal(error.name, "CompanyCreationValidationError");
      assert.ok(error.issues?.some((issue) => issue.field === "reg_city" || issue.field === "reg_state"));
      assert.equal(JSON.stringify(await profile(id)), before);
      // a blank address block is never treated as "clear it"
      await K.dir.editCompany(id, { reg_street: "", reg_city: "", reg_state: "", reg_zip: "", reg_country: "" });
      assert.equal(JSON.stringify(await profile(id)), before, "an address is never blanked silently");
    });

    it("payment-method changes keep the previous preference with its dates, shown as history on the profile and as a ledger entry", async () => {
      await signInWith(...STAFF);
      const id = await customer("PM");
      await K.dir.editCompany(id, { payMethod: "E-Transfer" });
      assert.deepEqual((await profile(id)).paymentMethodHistory, []);
      await K.dir.editCompany(id, { payMethod: "Wire Transfer" });
      const after = await profile(id);
      assert.equal(after.payMethod, "Wire Transfer");
      assert.deepEqual(after.paymentMethodHistory?.map((entry) => entry.method), ["E-Transfer"]);
      assert.ok(after.paymentMethodHistory?.[0].to);
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1 AND operation_code = 'PAYMENT_METHOD_UPDATED'`, [id]), 2);
      // only a billing preference is stored: nothing resembling payment credentials exists in the profile
      assert.equal(Object.keys(after).some((key) => /card|account_number|routing|cvv|iban/i.test(key)), false);
    });
  });

  describe("validation and accountability", () => {
    it("a rejected identifier is reported against its own field, and the rest of the same request is NOT saved (one transaction)", async () => {
      await signInWith(...STAFF);
      const id = await customer("VL");
      const other = await customer("VM");
      const before = JSON.stringify(await profile(id));
      const malformed = await refused(K.dir.editCompany(id, { dba: "Not Saved", businessNo: "12" }));
      assert.equal(malformed.name, "CompanyCreationValidationError");
      assert.deepEqual(malformed.issues?.map((issue) => issue.field), ["businessNo"]);
      assert.match(malformed.issues?.[0].message ?? "", /9 digits/);

      const ein = `${digits(2)}-${digits(7)}`;
      await K.dir.editCompany(other, { ein });
      const duplicate = await refused(K.dir.editCompany(id, { dba: "Not Saved Either", ein }));
      assert.deepEqual(duplicate.issues?.map((issue) => issue.field), ["ein"]);
      assert.match(duplicate.issues?.[0].message ?? "", /already registered/);
      assert.equal(JSON.stringify(await profile(id)), before, "nothing was saved");
      assert.equal(await count(`SELECT count(*) AS n FROM public.company_change_records WHERE organization_id = $1`, [id]), 0);
    });

    it("the activity records who made each change: the viewer sees 'you', another staff member sees the actor type and a stable reference", async () => {
      const first = await signInWith(...STAFF);
      const id = await customer("AU");
      await K.dir.editCompany(id, { dba: `Actor Trading ${run}` });
      const mine = await K.changes.getCompanyActivity(id);
      const entry = mine.entries.find((e) => e.operation === "DBA_ADDED")!;
      assert.deepEqual([entry.actor?.you, entry.actor?.ref], [true, first.actorId.slice(0, 8)]);
      await signInWith(...STAFF);
      const theirs = (await K.changes.getCompanyActivity(id)).entries.find((e) => e.operation === "DBA_ADDED")!;
      assert.equal(theirs.actor?.you, false);
      assert.equal(theirs.actor?.ref, first.actorId.slice(0, 8));
      assert.ok(theirs.actor?.type, "the actor type is reported");
      assert.ok(Date.parse(theirs.recordedAt) > 0);
    });
  });
});
