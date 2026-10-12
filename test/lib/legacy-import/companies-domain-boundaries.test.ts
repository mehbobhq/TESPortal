import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const COMPANIES_DOMAIN = path.join(ROOT, "lib/legacy-import/domains/companies.ts")

function source(): string {
  return readFileSync(COMPANIES_DOMAIN, "utf8")
}

describe("legacy import companies/customers domain boundaries", () => {
  it("stages browser companies and customer/prospect child records without canonical writes", () => {
    const code = source()

    assert.match(code, /sourceCollection: "tes_companies"/)
    assert.match(code, /legacyEntityType: "COMPANY"/)
    assert.match(code, /legacyEntityType: "CUSTOMER"/)
    assert.match(code, /const CUSTOMER_TYPES = new Set\(\["customer", "prospect"\]\)/)
    assert.match(code, /commitWritesCanonicalRows: false/)
    assert.doesNotMatch(code, /INSERT\s+INTO\s+public\.(organizations|customers)\b/i)
    assert.doesNotMatch(code, /UPDATE\s+public\.(organizations|customers)\b/i)
  })

  it("preserves source snapshots and reports unmapped browser fields", () => {
    const code = source()

    assert.match(code, /prepareLegacySourceRecord/)
    assert.match(code, /supportedFields: COMPANY_SUPPORTED_FIELDS/)
    assert.match(code, /sourceSnapshot: sourceSnapshot\(company\)/)
    assert.match(code, /_legacyImport/)
    assert.match(code, /canonicalIntent/)
  })

  it("keeps restart keys deterministic for records with and without browser ids", () => {
    const code = source()

    assert.match(code, /cleanString\(record\.id\)[\s\S]*cleanString\(record\.companyId\)[\s\S]*`browser-company-index-\$\{index\}`/)
    assert.match(code, /sourceKey: `COMPANY:\$\{id\}`/)
    assert.match(code, /sourceKey: `CUSTOMER:\$\{id\}`/)
    assert.match(code, /parentLegacyIds: \{ company: id \}/)
  })
})
