import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { describeError } from "@/lib/database/safe-error"
import { DatabaseConfigurationError } from "@/lib/database/postgres-config"

describe("describeError (log-safe error summary)", () => {
  it("keeps only the class name and a short code", () => {
    const e = Object.assign(new Error("connect to 10.1.2.3 as user tes-backend password s3cret"), { name: "PgError", code: "28P01" })
    const s = JSON.stringify(describeError(e))
    assert.equal(s, '{"name":"PgError","code":"28P01"}')
    assert.doesNotMatch(s, /10\.1|tes-backend|s3cret/)
  })
  it("never copies a message, token, request body or stack from a connector-style error", () => {
    const e = Object.assign(new Error("The instance is not in an appropriate state"), { code: 409, config: { data: { access_token: "ya29.SECRET" } }, stack: "at x (ya29.SECRET)" })
    assert.doesNotMatch(JSON.stringify(describeError(e)), /ya29|SECRET|appropriate/)
  })
  it("reads a code from the cause, and rejects codes with unsafe characters", () => {
    assert.equal(describeError(Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } })).code, "ECONNREFUSED")
    assert.equal(describeError(Object.assign(new Error("x"), { code: "a b; drop" })).code, undefined)
  })
  it("includes the message only for configuration errors, which never contain values", () => {
    const s = describeError(new DatabaseConfigurationError("Cloud SQL variables are set (TES_CLOUD_SQL_INSTANCE) together with supabase-dev"))
    assert.match(s.detail ?? "", /TES_CLOUD_SQL_INSTANCE/)
  })
  it("handles non-errors", () => {
    assert.deepEqual(describeError(null), { name: "Error" })
    assert.deepEqual(describeError("boom"), { name: "Error" })
  })
})
