import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()

const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

describe("company directory PostgreSQL cutover boundaries", () => {
  it("keeps Companies, Customers and Company Profile identity views off browser persistence", () => {
    for (const file of ["app/companies/page.tsx", "app/customers/page.tsx", "app/companies/[id]/profile/page.tsx", "app/companies/new/page.tsx"]) {
      const code = source(file)
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/i, file)
      assert.match(code, /fetch\([`"]\/api\/(?:companies|customers)/, file)
    }
  })

  it("keeps directory API routes as thin server boundaries", () => {
    for (const file of ["app/api/companies/route.ts", "app/api/customers/route.ts", "app/api/companies/[id]/profile/route.ts"]) {
      const code = source(file)
      assert.match(code, /NextResponse\.json/, file)
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|window\.|document\./i, file)
    }
  })

  it("uses authorized system capabilities for the PostgreSQL read model", () => {
    const code = source("lib/company-directory/service.ts")
    assert.match(code, /withAuthorizedSystem\("ORGANIZATION_REGISTRY_READ"/)
    assert.match(code, /withAuthorizedSystem\("CUSTOMER_RELATIONSHIP_READ"/)
    assert.match(code, /createOrganization/)
    assert.match(code, /establishCustomerRelationship/)
    assert.match(code, /getCompanyProfile/)
    assert.match(code, /public\.organizations/)
    assert.match(code, /public\.customers/)
    assert.doesNotMatch(code, /INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|localStorage|sessionStorage|indexedDB/i)
  })
})
