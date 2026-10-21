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
    assert.match(code, /createCompanyRecord/)
    assert.match(code, /readCompanyProfile/)
    assert.match(code, /public\.organizations/)
    assert.match(code, /public\.customers/)
    assert.doesNotMatch(code, /INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|localStorage|sessionStorage|indexedDB/i)
  })

  it("creates companies only through the existing canonical domain operations in one transaction", () => {
    const code = source("lib/company-directory/create-company.ts")
    for (const op of ["createOrganization", "establishCustomerRelationship", "setOperatingScope", "createLocation", "createContact", "addOrganizationChannel", "createAuthority", "createRegistration"]) {
      assert.match(code, new RegExp(op), op)
    }
    assert.equal((code.match(/withAuthorizedSystem\(/g) ?? []).length, 1, "exactly one transaction")
    assert.doesNotMatch(code, /INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|localStorage|sessionStorage|indexedDB/i)
  })

  it("keeps workspace pages from reporting a failed lookup as a missing company", () => {
    for (const file of [...["business", "credentials", "drivers", "insurance", "edit"].map((page) => `app/companies/[id]/${page}/page.tsx`), "app/companies/[id]/vehicles/canonical-vehicles.tsx", "src/components/canonical/CanonicalRegistryPanel.tsx"]) {
      const page = file
      const code = source(file)
      assert.match(code, /CompanyMissing/, page)
      assert.doesNotMatch(code, /<div className="p-10 text-center">Company not found\.<\/div>/, page)
    }
  })

  it("keeps the canonical Contacts and Settings workspaces off browser persistence and behind company-scoped routes", () => {
    for (const file of ["app/companies/[id]/contacts/page.tsx", "app/companies/[id]/settings/canonical-settings.tsx"]) {
      const code = source(file)
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/i, file)
      assert.match(code, /\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}\/(contacts|settings)/, file)
    }
    for (const file of ["app/api/companies/[id]/contacts/route.ts", "app/api/companies/[id]/settings/route.ts"]) {
      const code = source(file)
      assert.match(code, /organizationId: id/, file)
      assert.doesNotMatch(code, /body\.organizationId/, file)
      assert.doesNotMatch(code, /INSERT\s+INTO|DELETE\s+FROM|localStorage/i, file)
    }
  })
})
