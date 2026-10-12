import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const MIGRATION = path.join(ROOT, "database/migrations/0029_canonical_data_cutover_import_infrastructure.sql")

function sql(): string {
  return readFileSync(MIGRATION, "utf8")
}

function codeOnly(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "")
}

describe("legacy import infrastructure migration", () => {
  it("is infrastructure only: no canonical business writes and no browser cleanup assumptions", () => {
    const source = codeOnly(sql())

    assert.doesNotMatch(source, /\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b/i)
    assert.doesNotMatch(source, /\bDROP\s+TABLE\b/i)
    assert.doesNotMatch(source, /\b(ciphertext|password|secret_value|access_token|refresh_token)\b/i)

    for (const table of [
      "organizations",
      "customers",
      "vehicles",
      "persons",
      "operating_authorities",
      "registrations",
      "insurance_policies",
      "company_credentials",
      "master_register_events",
    ]) {
      assert.doesNotMatch(source, new RegExp(`INSERT\\s+INTO\\s+public\\.${table}\\b`, "i"), table)
      assert.doesNotMatch(source, new RegExp(`UPDATE\\s+public\\.${table}\\b`, "i"), table)
    }
  })

  it("does not widen the original company-only legacy_record_map", () => {
    const source = codeOnly(sql())

    assert.doesNotMatch(source, /ALTER\s+TABLE\s+public\.legacy_record_map[\s\S]*DROP\s+CONSTRAINT/i)
    assert.doesNotMatch(source, /ALTER\s+TABLE\s+public\.legacy_record_map[\s\S]*legacy_record_map_entity_type_valid/i)
    assert.match(source, /CREATE\s+TABLE\s+public\.legacy_canonical_record_map\b/i)
  })

  it("keeps import control tables protected by RLS and SYSTEM-only capabilities", () => {
    const source = codeOnly(sql())

    for (const table of [
      "legacy_import_batches",
      "legacy_canonical_record_map",
      "legacy_import_records",
      "legacy_import_checkpoints",
      "legacy_import_review_decisions",
    ]) {
      assert.match(source, new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"), table)
      assert.match(source, new RegExp(`CREATE\\s+POLICY\\s+${table}_[a-z_]+\\s+ON\\s+public\\.${table}`, "i"), table)
    }

    assert.match(source, /'LEGACY_IMPORT_READ'[\s\S]*Intended scope: SYSTEM only\./)
    assert.match(source, /'LEGACY_IMPORT_MANAGE'[\s\S]*Intended scope: SYSTEM only\./)
    assert.match(source, /tes_security\.system_context_authorized\(ARRAY\['LEGACY_IMPORT_MANAGE'\]\)/)
  })

  it("stores immutable provenance and explicit exceptions for every source record", () => {
    const source = codeOnly(sql())

    assert.match(source, /source_sha256\s+text\s+NOT\s+NULL/)
    assert.match(source, /source_snapshot\s+jsonb\s+NOT\s+NULL/)
    assert.match(source, /unsupported_fields\s+jsonb\s+NOT\s+NULL/)
    assert.match(source, /exception_summary\s+text/)
    assert.match(source, /exception_details\s+jsonb\s+NOT\s+NULL/)
    assert.match(source, /UNIQUE\s+\(import_batch_id,\s*source_key\)/)
  })
})
