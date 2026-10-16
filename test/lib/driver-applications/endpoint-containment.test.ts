// Regression tests for the two driver-application endpoint containments. No database is needed: the authorization
// kernel is exercised through the real wrappers against a scripted pool (the decision queries are answered, not
// bypassed), and the invitation orchestration is exercised with injected ports. The kernel itself is covered by the DB
// suites under test/lib/auth.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";


const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const ACTOR = randomUUID();
const SENTINEL = "SENTINEL-APPLICANT-PII-4f1c";
const ORIGINAL_CWD = process.cwd();

type Invitation = typeof import("../../../lib/driver-applications/invitation.ts");
type Access = typeof import("../../../lib/driver-applications/access.ts");
let I: Invitation;
let A: Access;
let sandbox: string;
let storeFile: string;
let storeHashBefore: string;
let DeniedError: new () => Error;
let InMemoryMasterRegisterRepository: typeof import("../master-register/in-memory-repository.ts").InMemoryMasterRegisterRepository;

const g = globalThis as Record<string, unknown>;
const signIn = (subject: string | null) => { g.__tesTestClerkUserId = subject; };

/** Answers the authorization kernel's queries from a script. Records every statement so tests can prove what did not run. */
function scriptedPool(options: { identity: boolean; allowed: boolean }) {
  const log: string[] = [];
  const query = async (text: string) => {
    const sql = String(text);
    log.push(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (sql.includes("current_setting('tes.customer_id', true)")) return { rows: [{ raw: null, resolved: null }] };
    if (sql.includes("UPDATE public.authentication_identities")) return { rows: [] };
    if (sql.includes("FROM public.authentication_identities")) {
      return { rows: options.identity ? [{ actor_id: ACTOR, actor_type: "HUMAN", actor_status: "active", identity_status: "active" }] : [] };
    }
    if (sql.includes("capability_known")) return { rows: [{ capability_known: true, capability_active: true, customer_exists: true, allowed: options.allowed }] };
    if (sql.includes("is_master_account")) return { rows: [{ is_master_account: false }] };
    if (sql.includes("set_config")) return { rows: [] };
    if (sql.includes("system_context_authorized")) return { rows: [{ allowed: options.allowed }] };
    return { rows: [] };
  };
  const pool = { connect: async () => ({ query, release() {} }), query };
  g.__tesTestRuntimePool = pool;
  return { log };
}

before(async () => {
  // The submission store resolves its directory from process.cwd() when first imported: point it at a sandbox so no
  // real .tes-data file can be read or written by these tests.
  sandbox = mkdtempSync(path.join(tmpdir(), "tes-containment-"));
  mkdirSync(path.join(sandbox, ".tes-data"));
  storeFile = path.join(sandbox, ".tes-data", "driver-application-submissions.json");
  writeFileSync(storeFile, JSON.stringify({
    version: 1,
    submissions: { "APP-000102": { applicationId: "APP-000102", submittedAt: "2026-10-01T00:00:00.000Z", receiptId: "R-1", completedSteps: ["personal"], draft: { legalName: SENTINEL } } },
  }));
  storeHashBefore = createHash("sha256").update(readFileSync(storeFile)).digest("hex");
  process.chdir(sandbox);
  process.env.TES_INVITATION_SECRET = "test-only-invitation-secret";
  await import("../../helpers/register-auth-test-loader.mjs");
  I = await import("@/lib/driver-applications/invitation");
  A = await import("@/lib/driver-applications/access");
  InMemoryMasterRegisterRepository = (await import("@/test/lib/master-register/in-memory-repository")).InMemoryMasterRegisterRepository;
  DeniedError = (await import("@/lib/auth/tes-authorization-core")).TesAuthorizationDeniedError;
});

after(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(sandbox, { recursive: true, force: true });
});

afterEach(() => {
  signIn(null);
  delete g.__tesTestRuntimePool;
});

// --------------------------------------------------------------------------------------------------------------------
// Priority 1: applicant submission reads
// --------------------------------------------------------------------------------------------------------------------

describe("GET /api/driver-applications/submissions", () => {
  const get = async (ids = "APP-000102") => {
    const route = await import("@/app/api/driver-applications/submissions/route");
    const response = await (route.GET as (request: Request) => Promise<Response>)(new Request(`http://localhost/api/driver-applications/submissions?applicationIds=${ids}`));
    return { status: response.status, text: await response.text() };
  };

  it("denies an unauthenticated caller and releases nothing", async () => {
    signIn(null);
    const { status, text } = await get();
    assert.equal(status, 401);
    assert.ok(!text.includes(SENTINEL));
  });

  it("denies a signed-in user who has no TES identity", async () => {
    signIn("user_without_tes_identity");
    scriptedPool({ identity: false, allowed: false });
    const { status, text } = await get();
    assert.equal(status, 403);
    assert.ok(!text.includes(SENTINEL));
  });

  it("denies a TES actor who lacks DRIVER_READ", async () => {
    signIn("user_tes_actor");
    scriptedPool({ identity: true, allowed: false });
    const { status, text } = await get();
    assert.equal(status, 403);
    assert.ok(!text.includes(SENTINEL));
  });

  it("is closed even for an authorized actor: caller-supplied ids (existing, unknown, bulk) cannot retrieve or probe submissions", async () => {
    signIn("user_tes_actor");
    scriptedPool({ identity: true, allowed: true });
    const existing = await get("APP-000102");
    const unknown = await get("APP-999999");
    const bulk = await get(Array.from({ length: 200 }, (_, index) => `APP-${index}`).join(",") + ",APP-000102");
    for (const result of [existing, unknown, bulk]) {
      assert.equal(result.status, 503);
      assert.ok(!result.text.includes(SENTINEL), "no applicant data in the response");
      assert.ok(!result.text.includes("APP-000102"), "the requested id is not echoed or confirmed");
    }
    assert.equal(existing.text, unknown.text, "existing and nonexistent applications are indistinguishable");
    assert.equal(existing.text, bulk.text);
  });

  it("never touches the stored submissions", async () => {
    signIn("user_tes_actor");
    scriptedPool({ identity: true, allowed: true });
    await get();
    assert.equal(createHash("sha256").update(readFileSync(storeFile)).digest("hex"), storeHashBefore);
  });

  it("the route no longer reads the submission store for GET", () => {
    const code = read("app/api/driver-applications/submissions/route.ts");
    const getHandler = code.slice(code.indexOf("export async function GET"));
    assert.ok(!/getApplicantSubmissions|searchParams|applicationIds/.test(getHandler.replace(/\/\*[\s\S]*?\*\//g, "")));
    assert.ok(getHandler.indexOf("auth()") < getHandler.indexOf("authorizeApplicantSubmissionRead()"));
  });
});

describe("POST /api/driver-applications/submissions (unrelated applicant path stays working)", () => {
  it("still accepts an invitation-authorized submission and keeps replays idempotent", async () => {
    const { createDriverInvitationToken } = await import("@/lib/driver-invitation-token");
    const token = createDriverInvitationToken({
      version: 1, companyId: "c1", companyName: "Carrier", driverMasterId: "d1", applicationId: "APP-000777",
      recipientEmail: "driver@example.test", driverName: "Driver", expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const route = await import("@/app/api/driver-applications/submissions/route");
    const body = { applicationId: "APP-000777", submittedAt: "2026-10-02T00:00:00.000Z", receiptId: "R-777", completedSteps: ["a"], draft: { x: 1 } };
    const post = () => route.POST(new Request("http://localhost/api", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }) as never);
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    const noToken = await route.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) }) as never);
    assert.equal(noToken.status, 401);
    // restore the original store so the "untouched" assertion above stays meaningful if tests are reordered
    writeFileSync(storeFile, JSON.stringify({
      version: 1,
      submissions: { "APP-000102": { applicationId: "APP-000102", submittedAt: "2026-10-01T00:00:00.000Z", receiptId: "R-1", completedSteps: ["personal"], draft: { legalName: SENTINEL } } },
    }));
    storeHashBefore = createHash("sha256").update(readFileSync(storeFile)).digest("hex");
  });
});

// --------------------------------------------------------------------------------------------------------------------
// Priority 2: invitation sending
// --------------------------------------------------------------------------------------------------------------------

const CONTEXT = {
  companyId: "ORG-A", companyName: "Authoritative Carrier Ltd", companyEmail: "ops@authoritative.test",
  driverMasterId: "DRV-1", driverName: "Dana Driver", driverEmail: "dana@driver.test",
  applicationId: "APP-100", applicationType: "Standard Driver Application", operatingRegion: "Canada" as const,
};

function harness(overrides: Partial<import("../../../lib/driver-applications/invitation.ts").InvitationDeps> & { denied?: boolean; failAudit?: boolean; providerFails?: boolean } = {}) {
  const calls: string[] = [];
  const sent: Array<{ to: string; subject: string; html: string; idempotencyKey: string }> = [];
  const tokens: Array<Record<string, unknown>> = [];
  const memory = new InMemoryMasterRegisterRepository();
  const register = Object.assign(Object.create(memory), {
    append: async (event: { eventType: string }) => {
      if (overrides.failAudit) throw new Error("register unavailable");
      calls.push(`append:${event.eventType}`);
      return memory.append(event as never);
    },
  }) as typeof memory;
  const resolved: Array<Record<string, string>> = [];
  const deps = {
    getAuthenticatedSubject: async () => "user_1",
    runAuthorized: async (work: (scope: never) => Promise<unknown>) => {
      calls.push("authorize");
      if (overrides.denied) throw new DeniedError();
      return work({ client: {}, actor: { id: ACTOR, actorType: "HUMAN" }, register } as never);
    },
    records: {
      resolve: async (_client: unknown, request: Record<string, string>) => {
        calls.push("resolve");
        resolved.push(request);
        const matches = request.companyId === CONTEXT.companyId && request.driverMasterId === CONTEXT.driverMasterId && request.applicationId === CONTEXT.applicationId;
        return matches ? { status: "VERIFIED" as const, context: CONTEXT } : { status: "NOT_FOUND" as const };
      },
    },
    emailConfigured: () => true,
    createToken: (payload: Record<string, unknown>) => { tokens.push(payload); return "signed-token"; },
    sendEmail: async (message: (typeof sent)[number]) => {
      calls.push("send");
      if (overrides.providerFails) throw new I.InvitationProviderError();
      sent.push(message);
      return { messageId: "msg_1" };
    },
    now: () => new Date("2026-10-16T12:00:00.000Z"),
    origin: "https://tes.example",
    ...overrides,
  };
  delete (deps as Record<string, unknown>).denied;
  delete (deps as Record<string, unknown>).failAudit;
  delete (deps as Record<string, unknown>).providerFails;
  return { deps: deps as never, calls, sent, tokens, memory, resolved };
}

const request = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const VALID = { companyId: "ORG-A", driverMasterId: "DRV-1", applicationId: "APP-100", recipientEmail: "dana@driver.test" };

describe("driver invitation: access", () => {
  it("rejects an unauthenticated caller before authorization, records or email", async () => {
    const h = harness({ getAuthenticatedSubject: async () => null });
    const outcome = await I.handleInvitationRequest(request(VALID), h.deps);
    assert.equal(outcome.status, 401);
    assert.deepEqual(h.calls, []);
  });

  it("rejects an authenticated but unauthorized actor before reading the body, resolving records or sending", async () => {
    const h = harness({ denied: true });
    let bodyRead = false;
    const req = request(VALID);
    const original = req.json.bind(req);
    req.json = async () => { bodyRead = true; return original(); };
    await assert.rejects(I.handleInvitationRequest(req, h.deps), DeniedError);
    assert.equal(bodyRead, false);
    assert.deepEqual(h.calls, ["authorize"]);
    assert.equal(h.sent.length, 0);
  });

  it("route: a signed-in user without TES identity or DRIVER_MANAGE gets 403 and nothing is sent", async () => {
    const route = await import("@/app/api/driver-applications/send-invitation/route");
    const realFetch = globalThis.fetch;
    const outbound: string[] = [];
    globalThis.fetch = (async (input: unknown) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;
    try {
      for (const options of [{ identity: false, allowed: false }, { identity: true, allowed: false }]) {
        signIn("user_x");
        scriptedPool(options);
        const response = await route.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(VALID) }) as never);
        assert.equal(response.status, 403);
      }
      signIn(null);
      assert.equal((await route.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify(VALID) }) as never)).status, 401);
      assert.deepEqual(outbound, []);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("driver invitation: authoritative records", () => {
  it("sends only company identity, driver name, type and region taken from authoritative records, never from the body", async () => {
    const h = harness();
    const forged = { ...VALID, companyName: "Evil Corp", companyEmail: "attacker@evil.test", companyPhone: "000", driverName: "Somebody Else", applicationType: "Forged", operatingRegion: "United States", companyAddress: { street: "1 Evil St" } };
    const outcome = await I.handleInvitationRequest(request(forged), h.deps);
    assert.equal(outcome.status, 200);
    assert.equal(h.sent.length, 1);
    const html = h.sent[0].html;
    assert.ok(html.includes("Authoritative Carrier Ltd") && html.includes("Dana Driver") && html.includes("Standard Driver Application"));
    for (const forgedValue of ["Evil Corp", "attacker@evil.test", "Somebody Else", "Forged", "1 Evil St"]) assert.ok(!html.includes(forgedValue) && !JSON.stringify(h.tokens).includes(forgedValue), forgedValue);
    assert.equal(h.tokens[0].companyName, "Authoritative Carrier Ltd");
    assert.equal(h.tokens[0].operatingRegion, "Canada");
  });

  it("a forged company identity or another customer's company id cannot send an invitation", async () => {
    const h = harness();
    const outcome = await I.handleInvitationRequest(request({ ...VALID, companyId: "ORG-OTHER-TENANT", companyName: "Authoritative Carrier Ltd" }), h.deps);
    assert.equal(outcome.status, 404);
    assert.equal(h.sent.length, 0);
    assert.ok(!h.calls.includes("send"));
  });

  it("a caller-controlled application id cannot bypass ownership", async () => {
    const h = harness();
    for (const applicationId of ["APP-999", "app-100", "APP-100,APP-200"]) {
      const outcome = await I.handleInvitationRequest(request({ ...VALID, applicationId }), h.deps);
      assert.equal(outcome.status, 404, applicationId);
    }
    assert.equal(h.sent.length, 0);
  });

  it("an arbitrary recipient cannot receive a TES-branded invitation", async () => {
    const h = harness();
    const outcome = await I.handleInvitationRequest(request({ ...VALID, recipientEmail: "attacker@evil.test" }), h.deps);
    assert.equal(outcome.status, 422);
    assert.equal(h.sent.length, 0);
    assert.ok(!h.calls.some((call) => call.startsWith("append:")), "no audit intent for a refused send");
    assert.ok(!JSON.stringify(outcome).includes("dana@driver.test"), "the address on file is not disclosed");
  });

  it("rejects an incomplete or malformed request", async () => {
    const h = harness();
    for (const body of [{}, { ...VALID, recipientEmail: "not-an-email" }, { ...VALID, applicationId: "" }, { ...VALID, companyId: 7 }, { ...VALID, recipientEmail: `${"a".repeat(260)}@x.test` }]) {
      assert.equal((await I.handleInvitationRequest(request(body), h.deps)).status, 400);
    }
    assert.equal(h.sent.length, 0);
  });

  it("fails closed when canonical records are unavailable (the production port)", async () => {
    const h = harness({ records: I.unavailableInvitationRecords });
    const outcome = await I.handleInvitationRequest(request(VALID), h.deps);
    assert.equal(outcome.status, 503);
    assert.equal(h.sent.length, 0);
    assert.ok(!h.calls.some((call) => call.startsWith("append:")));
  });

  it("fails closed when the port returns a record for different references", async () => {
    const h = harness({ records: { resolve: async () => ({ status: "VERIFIED" as const, context: { ...CONTEXT, applicationId: "APP-OTHER" } }) } });
    assert.equal((await I.handleInvitationRequest(request(VALID), h.deps)).status, 404);
    assert.equal(h.sent.length, 0);
  });

  it("production wiring uses the unavailable port, so the real route sends nothing even for an authorized actor", async () => {
    assert.equal(A.productionInvitationDeps("https://tes.example").records, I.unavailableInvitationRecords);
    const route = await import("@/app/api/driver-applications/send-invitation/route");
    const realFetch = globalThis.fetch;
    const outbound: string[] = [];
    globalThis.fetch = (async (input: unknown) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;
    process.env.RESEND_API_KEY = "re_test_key";
    try {
      signIn("user_tes_actor");
      const pool = scriptedPool({ identity: true, allowed: true });
      const response = await route.POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ ...VALID, companyName: "Evil Corp" }) }) as never);
      assert.equal(response.status, 503);
      assert.deepEqual(outbound, []);
      assert.ok(!pool.log.some((sql) => /INSERT INTO public\.master_register_events/i.test(sql)));
    } finally {
      delete process.env.RESEND_API_KEY;
      globalThis.fetch = realFetch;
    }
  });
});

describe("driver invitation: authorized path, audit and idempotency", () => {
  it("works only when every authoritative relationship verifies, and audits intent before send and outcome after", async () => {
    const h = harness();
    const outcome = await I.handleInvitationRequest(request(VALID), h.deps);
    assert.equal(outcome.status, 200);
    if (outcome.status !== 200) return;
    assert.equal(outcome.messageId, "msg_1");
    assert.equal(outcome.auditRecorded, true);
    assert.deepEqual(h.calls, ["authorize", "authorize", "resolve", "append:NOTIFICATION_CREATED", "send", "authorize", "append:COMMUNICATION_SENT"]);
  });

  it("records the recipient only as a hash and links the outcome to the intent event", async () => {
    const h = harness();
    await I.handleInvitationRequest(request(VALID), h.deps);
    const events = await h.memory.queryByActorId(ACTOR);
    assert.equal(events.length, 2);
    assert.ok(!JSON.stringify(events).includes("dana@driver.test"));
    const [intent, sentEvent] = events;
    assert.equal(sentEvent.relationships?.causationEventId, intent.eventId);
    assert.equal(sentEvent.outcome?.result, "SUCCESS");
    assert.equal(intent.outcome?.result, "UNRESOLVED");
  });

  it("does not send when the audit append fails", async () => {
    const h = harness({ failAudit: true });
    await assert.rejects(I.handleInvitationRequest(request(VALID), h.deps), /register unavailable/);
    assert.equal(h.sent.length, 0);
  });

  it("uses a stable idempotency key derived from the verified application, so a retry cannot double-send at the provider", async () => {
    const h = harness();
    await I.handleInvitationRequest(request(VALID), h.deps);
    await I.handleInvitationRequest(request(VALID), h.deps);
    assert.deepEqual(h.sent.map((message) => message.idempotencyKey), ["driver-application/APP-100", "driver-application/APP-100"]);
  });

  it("reports a provider failure without claiming delivery and records a failure outcome", async () => {
    const h = harness({ providerFails: true });
    const outcome = await I.handleInvitationRequest(request(VALID), h.deps);
    assert.equal(outcome.status, 502);
    const events = await h.memory.queryByActorId(ACTOR);
    assert.deepEqual(events.map((event) => event.outcome?.result), ["UNRESOLVED", "FAILURE"]);
  });

  it("does not record intent or send when email is not configured", async () => {
    const h = harness({ emailConfigured: () => false });
    assert.equal((await I.handleInvitationRequest(request(VALID), h.deps)).status, 503);
    assert.ok(!h.calls.some((call) => call.startsWith("append:") || call === "send"));
  });
});

describe("static guards", () => {
  it("neither route nor handler reads company identity from the request body, and the browser stops sending it", () => {
    const route = read("app/api/driver-applications/send-invitation/route.ts");
    assert.ok(!/companyName|companyAddress|createDriverInvitationToken|RESEND_API_KEY/.test(route));
    const handler = read("lib/driver-applications/invitation.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    const parse = handler.slice(handler.indexOf("function parseRequest"), handler.indexOf("function buildEmail"));
    assert.ok(!/companyName|companyAddress|companyPhone|driverName|operatingRegion/.test(parse));
    const ui = read("src/components/drivers/DriverWorkspace.tsx");
    const body = ui.slice(ui.indexOf('"/api/driver-applications/send-invitation"'), ui.indexOf("const result = await response.json()"));
    assert.ok(!/companyName|companyAddress|companyPhone|driverName/.test(body));
  });

  it("the shared Driver email is updated only after a successful send", () => {
    const ui = read("src/components/drivers/DriverWorkspace.tsx");
    const fetchAt = ui.indexOf('"/api/driver-applications/send-invitation"');
    const updateAt = ui.indexOf("updateDriverMasterIdentity(master.id, { email: recipientEmail })");
    assert.ok(fetchAt > 0 && updateAt > fetchAt);
  });

  it("does not touch migrations or the existing submission store implementation", () => {
    assert.ok(existsSync(path.join(ROOT, "lib/server/driver-application-submission-repository.ts")));
    assert.ok(!/readFile|writeFile|\.tes-data\//.test(read("lib/driver-applications/access.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
  });
});
