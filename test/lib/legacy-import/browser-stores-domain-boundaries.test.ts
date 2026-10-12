import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const BROWSER_STORES_DOMAIN = path.join(ROOT, "lib/legacy-import/domains/browser-stores.ts")

function source(): string {
  return readFileSync(BROWSER_STORES_DOMAIN, "utf8")
}

describe("legacy import supported browser store domain boundaries", () => {
  it("covers every Phase C supported non-company domain with staging configs", () => {
    const code = source()

    for (const domain of [
      "LOCATIONS",
      "CONTACTS",
      "VEHICLES",
      "DRIVERS",
      "AUTHORITIES",
      "TAX_REGISTRATIONS",
      "COMPANY_PROFILE",
      "INSURANCE",
      "CREDENTIAL_METADATA",
    ]) {
      assert.match(code, new RegExp(`domainCode: "${domain}"`), domain)
    }
  })

  it("stages supported browser stores without canonical writes", () => {
    const code = source()

    assert.match(code, /procedure: "buildBrowserStoreStagePlan"/)
    assert.match(code, /commitWritesCanonicalRows: false/)
    assert.match(code, /sourceKey: `\$\{config\.entityType\}:\$\{config\.sourceCollection\}:\$\{id\}`/)
    assert.match(code, /parentLegacyIds: config\.parentCompanyId \? \{ company: config\.parentCompanyId \} : \{\}/)
    assert.doesNotMatch(code, /INSERT\s+INTO\s+public\./i)
    assert.doesNotMatch(code, /UPDATE\s+public\./i)
  })

  it("excludes credential secrets while allowing credential metadata", () => {
    const code = source()

    assert.match(code, /credentialMetadata/)
    assert.match(code, /"systemName", "url", "username", "category", "mfaStatus", "secretSlotId"/)
    assert.doesNotMatch(code, /password|secretValue|accessToken|refreshToken/)
  })
})
