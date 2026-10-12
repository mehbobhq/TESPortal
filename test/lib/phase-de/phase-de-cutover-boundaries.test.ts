import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()
const source = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")

const CUT_OVER_PAGES = [
  "app/profile/page.tsx",
  "app/companies/[id]/profile/page.tsx",
  "app/companies/[id]/edit/page.tsx",
  "app/companies/[id]/credentials/page.tsx",
  "app/companies/[id]/vehicles/page.tsx",
  "app/companies/[id]/drivers/page.tsx",
  "app/companies/[id]/insurance/page.tsx",
  "app/companies/[id]/tax-filing/page.tsx",
  "app/companies/[id]/authorities/page.tsx",
  "app/companies/[id]/business/page.tsx",
  "src/components/canonical/CanonicalRegistryPanel.tsx",
]

const ROUTES = [
  "app/api/companies/[id]/route.ts",
  "app/api/companies/[id]/authorities/route.ts",
  "app/api/companies/[id]/authorities/[authorityId]/route.ts",
  "app/api/companies/[id]/tax-registrations/route.ts",
  "app/api/companies/[id]/tax-registrations/[registrationId]/route.ts",
  "app/api/companies/[id]/insurance/route.ts",
  "app/api/companies/[id]/insurance/[policyId]/route.ts",
  "app/api/companies/[id]/credentials/route.ts",
  "app/api/companies/[id]/credentials/[credentialId]/route.ts",
  "app/api/credential-systems/route.ts",
  "app/api/companies/[id]/vehicles/route.ts",
  "app/api/companies/[id]/drivers/route.ts",
]

describe("Block 01 Phase D/E cutover boundaries", () => {
  it("keeps every cut-over page and component off browser persistence and tes_* keys", () => {
    for (const file of CUT_OVER_PAGES) {
      const code = source(file)
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/i, file)
      assert.doesNotMatch(code, /["'`]tes_[a-z_]+/i, file)
      assert.doesNotMatch(code, /@\/lib\/(?:activity-log|audit-logger|audit-log|vehicle-data|driver-data|authorities\/model)/, file)
    }
  })

  it("makes every cut-over page talk to the PostgreSQL-backed API", () => {
    for (const file of CUT_OVER_PAGES.filter((file) => file !== "app/companies/[id]/profile/page.tsx")) {
      assert.match(source(file), /fetch\(|CanonicalRegistryPanel/, file)
    }
  })

  it("keeps API routes thin: no browser globals and no SQL", () => {
    for (const file of ROUTES) {
      assert.ok(existsSync(path.join(ROOT, file)), file)
      const code = source(file)
      assert.match(code, /NextResponse\.json/, file)
      assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|window\.|document\./i, file)
      assert.doesNotMatch(code, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b\s/, file)
      assert.match(code, /export const runtime = "nodejs"/, file)
    }
  })

  it("routes call only existing canonical services", () => {
    const expected: Record<string, RegExp> = {
      "app/api/companies/[id]/authorities/route.ts": /@\/lib\/operating-authorities\/service/,
      "app/api/companies/[id]/tax-registrations/route.ts": /@\/lib\/tax-registrations\/service/,
      "app/api/companies/[id]/insurance/route.ts": /@\/lib\/insurance\/service/,
      "app/api/companies/[id]/credentials/route.ts": /@\/lib\/company-credentials\/service/,
      "app/api/companies/[id]/vehicles/route.ts": /@\/lib\/operational-identity\/(?:reads|service)/,
      "app/api/companies/[id]/drivers/route.ts": /@\/lib\/operational-identity\/reads/,
      "app/api/companies/[id]/route.ts": /@\/lib\/company-directory\/service/,
    }
    for (const [file, pattern] of Object.entries(expected)) assert.match(source(file), pattern, file)
  })

  it("never accepts or returns a secret value through the credentials surface", () => {
    for (const file of ["app/companies/[id]/credentials/page.tsx", "app/api/companies/[id]/credentials/route.ts", "app/api/companies/[id]/credentials/[credentialId]/route.ts"]) {
      assert.doesNotMatch(source(file), /type="password"|password\s*[:=]|secretValue|attachSecretReference/i, file)
    }
  })

  it("keeps the additive read services SELECT-only under the existing capabilities", () => {
    const code = source("lib/operational-identity/reads.ts")
    assert.match(code, /withAuthorizedSystem\("VEHICLE_READ"/)
    assert.match(code, /withAuthorizedSystem\("DRIVER_READ"/)
    assert.doesNotMatch(code, /\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE)/i)
    assert.doesNotMatch(code, /public\.organizations/)
  })

  it("adds no migration in this pass", () => {
    const migrations = readdirSync(path.join(ROOT, "database/migrations")).filter((name) => name.endsWith(".sql")).sort()
    assert.ok(migrations[migrations.length - 1].startsWith("0029_"), migrations[migrations.length - 1])
  })

  it("makes deferred modules explicit instead of persisting them in the browser", () => {
    const deferred: Record<string, RegExp> = {
      "app/companies/[id]/business/page.tsx": /intentionally deferred/,
      "app/companies/[id]/drivers/page.tsx": /deferred/i,
      "app/companies/[id]/vehicles/page.tsx": /deferred/i,
      "app/companies/[id]/insurance/page.tsx": /deferred/i,
      "app/companies/[id]/credentials/page.tsx": /deferred/i,
      "app/companies/[id]/edit/page.tsx": /Not yet available/,
    }
    for (const [file, pattern] of Object.entries(deferred)) assert.match(source(file), pattern, file)
  })

  it("edits only canonical corporate-identity fields through existing corporate-identity operations", () => {
    const code = source("lib/company-directory/service.ts")
    assert.match(code, /updateLegalIdentity/)
    assert.match(code, /correctIdentifier/)
    assert.match(code, /deactivateAlias/)
    assert.doesNotMatch(code, /UPDATE public\.organizations/)
  })
})
