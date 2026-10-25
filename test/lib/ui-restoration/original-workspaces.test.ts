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

// Sections that show ONE workspace (the original) with the compact browser-data indicator; their canonical workspace lives in canonical-<route>.tsx.
const SINGLE = new Set(["drivers", "tax-filing", "authorities", "insurance", "business", "vehicles", "contacts"])

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
    it(`${title}: the route mounts the original workspace${SINGLE.has(route) ? " as the only visible interface" : " and keeps the canonical records as the second workspace"}`, () => {
      const page = read(`app/companies/[id]/${route}/page.tsx`)
      assert.match(page, /<LegacyWorkspaceGate/)
      assert.match(page, new RegExp(`from "\\./${legacy}"`))
      assert.match(page, new RegExp(`title="${title}"`))
      if (SINGLE.has(route)) {
        assert.match(page, /<LegacyWorkspaceGate\s+single\b/)
        assert.doesNotMatch(page, /canonical=|role="tablist"/)
        assert.doesNotMatch(page, /import[^\n]*canonical-/)
      } else assert.match(page, /canonical=\{/)
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

  it("shows ONE interface: no workspace tabs and no boundary banner, only the compact browser-data indicator", () => {
    assert.match(page, /<LegacyWorkspaceGate\s+single\b/)
    assert.doesNotMatch(page, /canonical=|CanonicalVehicles|role="tablist"/)
    assert.match(gate, /single = false/, "other sections keep their tabs and banner by default")
    assert.match(original, /Prototype workspace · Browser data/)
    assert.match(original, /Records in this workspace are stored in this browser and are not synchronized with the TES production database\./)
    assert.doesNotMatch(original, /saved to PostgreSQL|saved to the TES database/i)
  })

  it("keeps the PostgreSQL vehicle register, unchanged, in its own file that no route renders", () => {
    const canonical = read("app/companies/[id]/vehicles/canonical-vehicles.tsx")
    assert.match(canonical, /export function CanonicalVehicles\(\)/)
    assert.match(canonical, /const base = `\/api\/companies\/\$\{encodeURIComponent\(companyId\)\}`/)
    assert.match(canonical, /deferred/i)
    assert.doesNotMatch(canonical, /export default/, "not a route")
    assert.doesNotMatch(page, /import[^\n]*canonical-vehicles/)
  })

  it("keeps the vehicle deep-link parameters and storage persistence untouched", () => {
    for (const code of [/getQueryParam\("vehicle"\)/, /getQueryParam\("vehicleTab"\)/, /pushHistoryQueryParams\(\{ vehicle: vehicle\.id, vehicleTab: null \}\)/, /loadVehicleStore\(companyId\)/, /saveVehicleStore\(companyId, next\)/]) assert.match(original, code)
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
    const page = read("app/companies/[id]/contacts/canonical-contacts.tsx")
    assert.doesNotMatch(page, /components\/contacts\/legacy\//)
  })
})

describe("Drivers, Authorities, Insurance, Tax Filing, Business: one workspace, canonical code preserved", () => {
  const CANON: Array<[string, string, string]> = [
    ["drivers", "CanonicalDrivers", "deferred"],
    ["authorities", "CanonicalAuthorities", "CanonicalRegistryPanel"],
    ["insurance", "CanonicalInsurance", "deferred"],
    ["tax-filing", "CanonicalTaxFiling", "CanonicalRegistryPanel"],
    ["business", "CanonicalBusiness", "deferred|intentionally"],
    ["contacts", "CanonicalContactsPage", "/api/companies"],
  ]
  for (const [route, name, marker] of CANON) {
    it(`${route}: the canonical workspace is kept, exported, not a route and not mounted`, () => {
      const canonical = read(`app/companies/[id]/${route}/canonical-${route}.tsx`)
      assert.match(canonical, new RegExp(`export function ${name}\\(`))
      assert.match(canonical, new RegExp(marker, "i"))
      assert.doesNotMatch(canonical, /export default/)
      assert.doesNotMatch(read(`app/companies/[id]/${route}/page.tsx`), new RegExp(name))
    })
  }

  it("each original workspace carries the shared compact browser-data indicator in its header", () => {
    const files = ["app/companies/[id]/drivers/legacy-drivers.tsx", "app/companies/[id]/authorities/legacy-authorities.tsx", "app/companies/[id]/insurance/legacy-insurance.tsx", "app/companies/[id]/tax-filing/legacy-tax-filing.tsx", "src/components/business/BusinessHeader.tsx", "app/companies/[id]/drivers/[driverId]/page.tsx", "app/companies/[id]/contacts/legacy-contacts.tsx"]
    for (const file of files) assert.match(read(file), /<PrototypeBrowserDataIndicator \/>/, file)
    const indicator = read("src/components/shared/PrototypeBrowserDataIndicator.tsx")
    assert.match(indicator, /Prototype workspace · Browser data/)
    assert.match(indicator, /Records in this workspace are stored in this browser and are not synchronized with the TES production database\./)
  })

  it("the shared gate keeps `single` opt-in: sections that pass no `single` would still get tabs and the banner", () => {
    const gate = read("src/components/shared/LegacyWorkspaceGate.tsx")
    assert.match(gate, /single = false/)
    assert.match(gate, /role="tablist"/)
  })
})

describe("Credentials, Settings, Citations: one workspace; Record of Events, Customs, Programs: unchanged honest placeholders", () => {
  const SIX_SINGLE: Array<[string, string]> = [["credentials", "Credentials"], ["settings", "Settings"], ["citations", "Citations"]]
  for (const [route, title] of SIX_SINGLE) {
    it(`${title}: the route shows only the original workspace (single gate, no canonical tab) with the compact indicator`, () => {
      const page = read(`app/companies/[id]/${route}/page.tsx`)
      assert.match(page, /<LegacyWorkspaceGate\s[^>]*\bsingle\b/)
      assert.doesNotMatch(page, /canonical=|role="tablist"|import[^\n]*canonical-/)
      const files = route === "credentials" ? [read(`app/companies/[id]/credentials/legacy-credentials.tsx`)] : [page]
      for (const code of files) assert.match(code, /<PrototypeBrowserDataIndicator \/>/)
      assert.doesNotMatch(page, /canonical PostgreSQL|saved to PostgreSQL|TES records/i, "no visible text claims these records are canonical")
    })
  }

  it("the canonical Credentials and Settings implementations are preserved, exported and not mounted", () => {
    const credentials = read("app/companies/[id]/credentials/canonical-credentials.tsx")
    assert.match(credentials, /export function CanonicalCredentials\(/)
    assert.match(credentials, /\/api\/credential-systems/)
    assert.doesNotMatch(credentials, /export default|type="password"/)
    const settings = read("app/companies/[id]/settings/canonical-settings.tsx")
    assert.match(settings, /export function CanonicalSettings\(/)
    assert.doesNotMatch(settings, /export default/)
    assert.doesNotMatch(read("app/companies/[id]/settings/page.tsx"), /CanonicalSettings/)
  })

  it("Record of Events: is the canonical (PostgreSQL) workspace - server API only, no browser storage, no legacy gate", () => {
    const dir = "app/companies/[id]/record-of-events"
    const sources = ["page.tsx", "events-workspace.tsx", "event-detail.tsx", "category-form.tsx", "wizard-host.tsx", "events-api.ts"].map((f) => read(`${dir}/${f}`)).join("\n")
    assert.match(sources, /\/driver-events/)
    assert.doesNotMatch(sources, /localStorage|sessionStorage|indexedDB|PrototypeBrowserDataIndicator|<LegacyWorkspaceGate|<DeferredWorkspace/)
    assert.doesNotMatch(sources, /addPerformanceEvent|loadCompanyDriverStore|saveCompanyDriverStore/, "nothing is written through the browser-local driver store")
  })

  for (const [route, title] of [["customs", "Customs"], ["programs", "Programs"]]) {
    it(`${title}: remains the truthful deferred placeholder: no browser storage, no indicator, no gate`, () => {
      const page = read(`app/companies/[id]/${route}/page.tsx`)
      assert.match(page, /<DeferredWorkspace/)
      assert.match(page, /no canonical \(PostgreSQL\) implementation yet/)
      assert.doesNotMatch(page, /localStorage|PrototypeBrowserDataIndicator|<LegacyWorkspaceGate/)
    })
  }
})
