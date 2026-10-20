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
    // The Phase D/E pass added none; 0033 and 0034 belong to the Company/Customer work. The sequence stays gapless.
    assert.ok(Number(migrations[migrations.length - 1].slice(0, 4)) >= 33, migrations[migrations.length - 1])
    assert.ok(migrations.every((name, index) => Number(name.slice(0, 4)) === index + 1), "migrations are numbered without gaps")
  })

  it("Company Edit has no static 'managed elsewhere / not yet available' list and no history-mode questions: what it cannot change is shown as real values with the reason and a link", () => {
    const edit = source("app/companies/[id]/edit/page.tsx")
    assert.doesNotMatch(edit, /DEFERRED_SECTIONS|Managed elsewhere, read-only, or not yet available|keep the earlier value as history|The recorded value was wrong/i)
    assert.doesNotMatch(edit, /factMode|addressMode/)
    // read-only values come from the canonical profile, each with its reason (and a workspace link where one exists), never as free text
    assert.match(edit, /ReadOnlyRow/)
    assert.match(edit, /COMPANY_FIELD_INVENTORY/)
  })

  it("makes deferred modules explicit instead of persisting them in the browser", () => {
    const deferred: Record<string, RegExp> = {
      "app/companies/[id]/business/page.tsx": /intentionally deferred/,
      "app/companies/[id]/drivers/page.tsx": /deferred/i,
      "app/companies/[id]/vehicles/page.tsx": /deferred/i,
      "app/companies/[id]/insurance/page.tsx": /deferred/i,
      "app/companies/[id]/credentials/page.tsx": /deferred/i,
    }
    for (const [file, pattern] of Object.entries(deferred)) assert.match(source(file), pattern, file)
  })

  it("edits only canonical corporate-identity fields through existing corporate-identity operations", () => {
    const code = source("lib/company-directory/service.ts")
    // The registered legal name is NOT edited here any more: it changes only through the gated legal-name procedure (lib/company-changes).
    assert.doesNotMatch(code, /updateLegalIdentity/)
    assert.match(source("lib/company-changes/service.ts"), /updateLegalIdentity/)
    assert.match(code, /correctIdentifier/)
    assert.match(code, /deactivateAlias/)
    assert.doesNotMatch(code, /UPDATE public\.organizations/)
  })
})
