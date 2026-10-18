import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8")

describe("service labels never grant access and are never invented", () => {
  it("no migration seeds a contract package or a service catalogue entry", () => {
    const dir = path.join(ROOT, "database/migrations")
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, file), "utf8")
      assert.doesNotMatch(sql, /INSERT INTO public\.contract_package_definitions/i, `${file} must not seed packages`)
      assert.doesNotMatch(sql, /INSERT INTO public\.service_catalogue/i, `${file} must not seed the service catalogue`)
    }
  })

  it("the profile derives Service Type only from SIGNED contract lines and names no commercial label", () => {
    const profile = read("lib/company-directory/read-profile.ts")
    assert.match(profile, /contract\.contractStatus === "signed"/)
    assert.match(profile, /readContractsView/)
    for (const label of ["Basic", "Standard", "Premium"]) assert.doesNotMatch(profile, new RegExp(`["'\`]${label}["'\`]`), `${label} must not be hard-coded as an entitlement`)
  })

  it("the create and edit forms offer no Service Type selector", () => {
    for (const file of ["app/companies/new/page.tsx", "app/companies/[id]/edit/page.tsx"]) {
      const source = read(file)
      assert.doesNotMatch(source, /<option[^>]*>\s*(Basic|Standard|Premium)\s*<\/option>/i, `${file} must not offer a service-level choice`)
      assert.doesNotMatch(source, /SelectItem[^>]*value="(Basic|Standard|Premium)"/i, `${file} must not offer a service-level choice`)
    }
  })
})
