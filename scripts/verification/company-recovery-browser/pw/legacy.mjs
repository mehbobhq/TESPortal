import { launch, BASE, record, shot, setActor, results } from "./lib.mjs"
import fs from "node:fs"
const A = JSON.parse(fs.readFileSync("/tmp/tes-e2e/created.json", "utf8"))
setActor("user_e2e_staff")
const { browser, page } = await launch()
try {
  await page.goto(`${BASE}/companies`, { waitUntil: "domcontentloaded", timeout: 120000 })
  const legacy = [{ id: "CMP-LEG-1", name: "Legacy Prototype Co", companyName: "Legacy Prototype Co", kind: "Customer", status: "Active" }]
  const contactsBlob = JSON.stringify([{ id: "c1", companyId: "CMP-LEG-1", name: "Legacy Person" }])
  await page.evaluate(([l, c]) => { localStorage.setItem("tes_companies", l); localStorage.setItem("tes_contacts_v5", c) }, [JSON.stringify(legacy), contactsBlob])
  await page.goto(`${BASE}/companies/CMP-LEG-1/citations`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const t = await page.innerText("body")
  record("a legacy (non-canonical) company id still opens its existing workspace, with no canonical banner", /Citations on File|Inspection & Citation Register/.test(t) && !/not the TES database/.test(t))
  await shot(page, "18-legacy-id-citations")
  // canonical company, browser-local tab: adds a projection only; legacy data untouched
  await page.goto(`${BASE}/companies/${A.id}/contacts`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("text=Add a contact", { timeout: 90000 })
  await page.getByRole("tab", { name: /browser-local workspace/ }).click()
  await page.waitForTimeout(2000)
  const stored = await page.evaluate(() => ({ companies: JSON.parse(localStorage.getItem("tes_companies") || "[]"), contacts: localStorage.getItem("tes_contacts_v5") }))
  const legacyKept = JSON.stringify(stored.companies.find((c) => c.id === "CMP-LEG-1")) === JSON.stringify(legacy[0])
  const projected = stored.companies.find((c) => c.id === A.id)
  record("existing browser data is untouched; a canonical company is only ADDED as a marked projection", legacyKept && stored.contacts === contactsBlob && projected?.source === "canonical-projection" && stored.companies.length === 2)
  await shot(page, "19-canonical-browser-local-tab")
} catch (e) { record("scenario error", false, String(e).slice(0, 400)) }
fs.writeFileSync("/tmp/tes-e2e/results-legacy.json", JSON.stringify(results, null, 2))
await browser.close()
