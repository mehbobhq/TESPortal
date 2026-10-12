import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const files = [
  "app/companies/[id]/onboarding/page.tsx",
  "app/api/companies/[id]/onboarding/route.ts",
  "lib/customer-onboarding/service.ts",
]

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("customer onboarding has no browser authority or tes_* persistence", () => {
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(source, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|tes_[a-z0-9_]+/i, file)
  }
})

test("onboarding orchestrates existing canonical services instead of adding parallel state", () => {
  const service = read("lib/customer-onboarding/service.ts")
  for (const required of [
    "customer-relationship/service",
    "company-profile/service",
    "operating-authorities/service",
    "company-credentials/service",
    "insurance/service",
    "tax-registrations/service",
    "operational-identity/reads",
  ]) {
    assert.match(service, new RegExp(required.replaceAll("/", "\\/")), required)
  }
  assert.doesNotMatch(service, /INSERT INTO|UPDATE public|DELETE FROM|CREATE TABLE|ALTER TABLE/i)
})

test("documents and evidence stay blocked until the GCS evidence domain exists", () => {
  const service = read("lib/customer-onboarding/service.ts")
  assert.match(service, /Documents\/evidence/)
  assert.match(service, /Canonical GCS evidence storage is not built yet/)
  assert.doesNotMatch(service, /evidence-payload-store|evidence-file-store|CorporateDocumentsSection|browser state/i)
})
