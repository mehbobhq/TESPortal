import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const migration = () => readFileSync(path.join(ROOT, "database/migrations/0030_onboarding_evidence_contracts_foundation.sql"), "utf8")
const service = () => readFileSync(path.join(ROOT, "lib/onboarding-foundation/service.ts"), "utf8")
const codeOnly = (value: string) => value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")

describe("onboarding evidence and contracts foundation", () => {
  it("stores GCS evidence metadata only, never payloads or browser storage", () => {
    const sql = codeOnly(migration())

    assert.match(sql, /CREATE TABLE public\.evidence_documents/)
    assert.match(sql, /gcs_bucket text NOT NULL/)
    assert.match(sql, /gcs_object_name text NOT NULL/)
    assert.match(sql, /sha256 text NOT NULL/)
    assert.doesNotMatch(sql, /\b(bytea|payload|file_contents|base64|localStorage|sessionStorage|indexedDB)\b/i)
    assert.doesNotMatch(service(), /localStorage|sessionStorage|indexedDB|evidence-payload-store|evidence-file-store/i)
  })

  it("links evidence to canonical records without deleting or moving source records", () => {
    const sql = codeOnly(migration())

    assert.match(sql, /CREATE TABLE public\.evidence_links/)
    for (const target of ["organizations", "customer_engagements", "engagement_service_scopes", "vehicles", "driver_profiles", "customer_contracts"]) {
      assert.match(sql, new RegExp(`'${target}'`), target)
    }
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b|\bDROP\s+TABLE\b/i)
  })

  it("models requirement rules, readiness snapshots, authority roles and contract foundation separately", () => {
    const sql = codeOnly(migration())

    for (const table of [
      "onboarding_evidence_requirements",
      "onboarding_readiness_snapshots",
      "customer_authority_assignments",
      "customer_contracts",
      "customer_contract_line_items",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}\\b`), table)
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table)
    }

    assert.match(sql, /customer_authority_assignments_one_active_uq/)
    assert.match(sql, /SERVICE_DECISION_AUTHORITY/)
    assert.match(sql, /CONTRACT_SIGNATORY/)
    assert.match(sql, /from_effective_responsibility_date_only/)
  })

  it("uses SYSTEM-only capabilities and keeps contracts out of pricing/invoice territory", () => {
    const sql = codeOnly(migration())

    for (const capability of ["EVIDENCE_READ", "EVIDENCE_MANAGE", "CONTRACT_READ", "CONTRACT_MANAGE"]) {
      assert.match(sql, new RegExp(`'${capability}'[\\s\\S]*Intended scope: SYSTEM only\\.`), capability)
    }
    assert.doesNotMatch(sql, /\b(invoice|payment|card|bank|stripe|interac|amount_due|subtotal|tax_amount|total_amount)\b/i)
    assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i)
  })

  it("application service goes through authorization wrappers and does not expose secret document URLs", () => {
    const source = codeOnly(service())

    assert.match(source, /^import "server-only"/)
    assert.match(source, /withAuthorizedSystem\("EVIDENCE_READ"/)
    assert.match(source, /withAuthorizedSystem\("CONTRACT_READ"/)
    assert.match(source, /withAuthorizedSystem\("EVIDENCE_MANAGE"/)
    assert.doesNotMatch(source, /signedUrl|downloadUrl|storage\.googleapis|makePublic|createReadStream/i)
  })
})
