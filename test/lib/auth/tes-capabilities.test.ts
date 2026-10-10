// Pure unit tests (no database, no loader needed). Included in any `node --test` run and in `npm run test:auth`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TES_CAPABILITY_CODES,
  TES_CAPABILITY_SCOPES,
  isTesCapability,
  tesCapabilityScope,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/auth/tes-capabilities.ts";
import {
  DEFAULT_AS_OF_SQL,
  accessibleCustomersSql,
  authorizationDecisionSql,
  authorizationPathsSql,
  masterAccountSql,
  // @ts-expect-error TS5097: .ts extension is required for Node's native runtime module resolution; tsconfig is intentionally left unchanged.
} from "../../../lib/auth/tes-authorization-sql.ts";

describe("TES capability references", () => {
  it("lists exactly the six approved Companies capabilities with their approved scopes", () => {
    assert.deepEqual(
      { ...TES_CAPABILITY_SCOPES },
      {
        ORGANIZATION_READ: "CUSTOMER",
        ORGANIZATION_REGISTRY_READ: "SYSTEM",
        ORGANIZATION_CREATE: "SYSTEM",
        ORGANIZATION_UPDATE: "SYSTEM",
        ORGANIZATION_ARCHIVE: "SYSTEM",
        CUSTOMER_ESTABLISH: "SYSTEM",
      },
    );
    assert.equal(TES_CAPABILITY_CODES.length, 6);
  });

  it("has no delete capability and no CUSTOMER_CREATE", () => {
    for (const code of TES_CAPABILITY_CODES) assert.doesNotMatch(code, /DELETE/);
    assert.equal(isTesCapability("CUSTOMER_CREATE"), false);
    assert.equal(isTesCapability("ORGANIZATION_DELETE"), false);
  });

  it("every code is canonical (upper snake case), matching the database check", () => {
    for (const code of TES_CAPABILITY_CODES) {
      assert.equal(code, code.trim().toUpperCase());
      assert.match(code, /^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("K4 isTesCapability is strict: no trimming, no case folding, no near misses, no prototype keys", () => {
    for (const code of TES_CAPABILITY_CODES) assert.equal(isTesCapability(code), true);
    for (const bad of [
      "organization_read",
      " ORGANIZATION_READ",
      "ORGANIZATION_READ ",
      "ORGANIZTION_UPDATE",
      "ORGANIZATION_READ\n",
      "",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      assert.equal(isTesCapability(bad), false, JSON.stringify(bad));
    }
    for (const notAString of [null, undefined, 7, {}, [], Symbol("x")]) {
      assert.equal(isTesCapability(notAString), false);
    }
  });

  it("tesCapabilityScope reports each declared scope", () => {
    assert.equal(tesCapabilityScope("ORGANIZATION_READ"), "CUSTOMER");
    assert.equal(tesCapabilityScope("CUSTOMER_ESTABLISH"), "SYSTEM");
  });
});

describe("TES authorization SQL builders (pure)", () => {
  it("only ever accepts the database clock or an explicit ISO timestamp literal as the evaluation instant", () => {
    assert.doesNotThrow(() => authorizationDecisionSql("SYSTEM", DEFAULT_AS_OF_SQL));
    assert.doesNotThrow(() => authorizationDecisionSql("SYSTEM", "'2031-01-01T00:00:00.000001Z'::timestamptz"));
    assert.doesNotThrow(() => authorizationDecisionSql("CUSTOMER", "'2031-01-01T00:00:00+02:00'::timestamptz"));
    for (const unsafe of [
      "now()",
      "clock_timestamp()",
      "statement_timestamp() OR true",
      "'2031-01-01T00:00:00Z'::timestamptz); DROP TABLE x;--",
      "$1",
      "",
      "'x'::timestamptz",
      "(SELECT max(ends_at) FROM public.actor_relationships)",
    ]) {
      assert.throws(() => authorizationDecisionSql("SYSTEM", unsafe), /Unsafe authorization evaluation instant/, unsafe);
      assert.throws(() => masterAccountSql(unsafe), /Unsafe/);
      assert.throws(() => accessibleCustomersSql(unsafe), /Unsafe/);
    }
  });

  it("applies the effective-time window to relationships, assignments, grants and Master authority", () => {
    const sql = authorizationPathsSql({ scope: "SYSTEM", customerFilter: false });
    for (const [alias, start, end] of [
      ["ar", "starts_at", "ends_at"],
      ["ra", "starts_at", "ends_at"],
      ["rcg", "granted_at", "ended_at"],
    ]) {
      assert.match(sql, new RegExp(`${alias}\\.status = 'active'`));
      assert.match(sql, new RegExp(`${alias}\\.${start} <= statement_timestamp\\(\\)`));
      assert.match(sql, new RegExp(`${alias}\\.${end} IS NULL OR ${alias}\\.${end} > statement_timestamp\\(\\)`));
    }
    const master = masterAccountSql();
    assert.match(master, /maa\.designated_at <= statement_timestamp\(\)/);
    assert.match(master, /maa\.ended_at IS NULL OR maa\.ended_at > statement_timestamp\(\)/);
  });

  it("SYSTEM requires TES_STAFF and a NULL customer; CUSTOMER requires a customer and never TES_STAFF specifically", () => {
    const system = authorizationPathsSql({ scope: "SYSTEM", customerFilter: false });
    assert.match(system, /ra\.scope_type = 'SYSTEM'/);
    assert.match(system, /ra\.customer_id IS NULL/);
    assert.match(system, /ar\.relationship_type = 'TES_STAFF'/);

    const customer = authorizationPathsSql({ scope: "CUSTOMER", customerFilter: true });
    assert.match(customer, /ra\.scope_type = 'CUSTOMER'/);
    assert.match(customer, /ra\.customer_id = \$3::uuid/);
    assert.doesNotMatch(customer, /relationship_type/);
  });

  it("the decision query validates the capability and, for CUSTOMER scope, the customer", () => {
    const customer = authorizationDecisionSql("CUSTOMER");
    assert.match(customer, /AS capability_known/);
    assert.match(customer, /AS capability_active/);
    assert.match(customer, /FROM public\.customers WHERE id = \$3::uuid\) AS customer_exists/);
    assert.doesNotMatch(authorizationDecisionSql("SYSTEM"), /\$3/);
  });

  it("discovery shares the evaluator's path predicate, is DISTINCT, and is bounded", () => {
    const sql = accessibleCustomersSql();
    assert.match(sql, /SELECT DISTINCT ra\.customer_id/);
    assert.match(sql, /LIMIT \$3/);
    const paths = authorizationPathsSql({ scope: "CUSTOMER", customerFilter: false });
    assert.ok(sql.includes(paths), "discovery must embed exactly the shared authorization-path predicate");
  });
});
