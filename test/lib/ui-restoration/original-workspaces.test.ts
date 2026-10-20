import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"

const ROOT = process.cwd()
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8")
const gate = read("src/components/shared/LegacyWorkspaceGate.tsx")

const SECTIONS: Array<[string, string, string]> = [
  ["drivers", "Drivers", "legacy-drivers"],
  ["tax-filing", "Tax Filing", "legacy-tax-filing"],
  ["authorities", "Authorities", "legacy-authorities"],
  ["insurance", "Insurance", "legacy-insurance"],
  ["business", "Business", "legacy-business"],
  ["contacts", "Contacts", "legacy-contacts"],
  ["vehicles", "Vehicles", "legacy-vehicles"],
]

describe("original company workspaces are restored as the first workspace", () => {
  it("the shared gate opens the original (browser-local) workspace first and lists it first; TES records are the second tab", () => {
    assert.match(gate, /useState<"canonical" \| "local">\("local"\)/)
    assert.ok(gate.indexOf("original workspace · browser-local") < gate.indexOf("(TES records)"), "original tab precedes the TES records tab")
    assert.match(gate, /browser-local workspace \(not the TES database\)/)
    assert.match(gate, /role="tabpanel"/)
  })

  it("never writes between the two stores: only a marked company projection is added to and removed from the browser", () => {
    assert.match(gate, /source: "canonical-projection"/)
    assert.match(gate, /list\.some\(\(entry: \{ id\?: string \}\) => entry\?\.id === company\.id\)\) return false/)
    assert.doesNotMatch(gate, /localStorage\.(removeItem|clear)\(/)
    assert.doesNotMatch(gate, /method:\s*"(POST|PUT|PATCH|DELETE)"/)
  })

  it("keeps an unrelated or unknown company on its own records: a failed lookup is an error, never another company's data", () => {
    assert.match(gate, /response\.status === 404 \? "legacy" : "error"/)
  })

  for (const [route, title, legacy] of SECTIONS) {
    it(`${title}: the route mounts the original workspace and keeps the canonical records as the second workspace`, () => {
      const page = read(`app/companies/[id]/${route}/page.tsx`)
      assert.match(page, /<LegacyWorkspaceGate/)
      assert.match(page, new RegExp(`from "\\./${legacy}"`))
      assert.match(page, new RegExp(`title="${title}"`))
      assert.match(page, /canonical=\{/)
      const original = read(`app/companies/[id]/${route}/${legacy}.tsx`)
      assert.doesNotMatch(original, /\bfetch\(/, "the original workspace never calls a canonical API")
      assert.match(original, /localStorage|loadVehicleStore|loadCompanyDriverStore|loadCompanyStore|from "@\/lib\//, "the original workspace keeps its browser-local store")
    })
  }
})

describe("Vehicles: the original module is recovered, not replaced", () => {
  const original = read("app/companies/[id]/vehicles/legacy-vehicles.tsx")
  const page = read("app/companies/[id]/vehicles/page.tsx")

  it("is the pre-cutover module (commit 0e8e8c3^): register, detail workspace and every original tab", () => {
    for (const name of ["ProfileTab", "OwnershipTab", "RegistrationTab", "PermitTab", "MaintenanceTab", "SettingsTab", "VehicleActivitySection", "SecureDocumentViewer", "OCRReview"]) assert.match(original, new RegExp(name), name)
    assert.match(original, /loadVehicleStore/)
    assert.match(original, /saveVehicleStore/)
    assert.match(original, /Create Vehicle/)
    assert.ok(original.split("\n").length > 1000, "the full original page, not a simplified one")
  })

  it("keeps the PostgreSQL vehicle register, unchanged, as the TES records workspace", () => {
    assert.match(page, /function CanonicalVehicles\(\)/)
    assert.match(page, /\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}/)
    assert.match(page, /deferred/i)
    assert.match(page, /canonical=\{<CanonicalVehicles \/>\}/)
  })

  it("the Maintenance tab declares the two names the original used without declaring (which threw once a finding or an item was added)", () => {
    const maintenance = read("src/components/vehicles/maintenance/MaintenanceTab.tsx")
    assert.match(maintenance, /^const inputClass = /m)
    assert.match(maintenance, /^function FindingRow\(/m)
  })
})

describe("Contacts: the original workspace uses its original components; the canonical page keeps the canonical ones", () => {
  it("the restored page imports only the preserved original components", () => {
    const original = read("app/companies/[id]/contacts/legacy-contacts.tsx")
    for (const name of ["ContactStats", "ContactDirectory", "ContactInspector", "ManualContactDialog", "contact-helpers"]) assert.match(original, new RegExp(`@/src/components/contacts/legacy/${name}`), name)
    assert.doesNotMatch(original, /canonical-adapter|\bfetch\(/)
  })

  it("the canonical page does not import the original components", () => {
    const page = read("app/companies/[id]/contacts/page.tsx")
    assert.doesNotMatch(page, /components\/contacts\/legacy\//)
  })
})
