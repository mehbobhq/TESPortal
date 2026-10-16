import { launch, BASE, record, shot, setActor, results, browserStorage, tesKeys } from "./lib.mjs"
import fs from "node:fs"
const A = JSON.parse(fs.readFileSync("/tmp/tes-e2e/created.json", "utf8"))
setActor("user_e2e_staff")
const { browser, page } = await launch()
try {
  // A browser that already holds prototype data from before (this run only seeds it; the app must neither read it into a workspace nor change it).
  await page.goto(`${BASE}/companies`, { waitUntil: "domcontentloaded", timeout: 120000 })
  const legacy = [{ id: "CMP-LEG-1", name: "Legacy Prototype Co", companyName: "Legacy Prototype Co", kind: "Customer", status: "Active" }]
  const contactsBlob = JSON.stringify([{ id: "c1", companyId: "CMP-LEG-1", name: "Legacy Person" }])
  await page.evaluate(([l, c]) => { localStorage.setItem("tes_companies", l); localStorage.setItem("tes_contacts_v5", c) }, [JSON.stringify(legacy), contactsBlob])

  // 1. A non-canonical (legacy prototype) id no longer opens a browser-local workspace.
  await page.goto(`${BASE}/companies/CMP-LEG-1/citations`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(1200)
  let t = await page.innerText("body")
  record("containment: a legacy (non-canonical) id shows 'not a TES record', not a browser-local workspace", /This company is not a TES record/.test(t) && !/Citations on File|Inspect.*Citation Register/.test(t))
  await shot(page, "18-legacy-id-contained")
  // The shell's global search box is app chrome, not workspace data entry.
  record("containment: no data-entry control is offered on the legacy id's workspace", (await page.locator("input, textarea, select").evaluateAll((els) => els.filter((e) => e.offsetParent !== null && !(e.getAttribute("placeholder") || "").startsWith("Search fleet")).length)) === 0)

  // 2. A canonical company: no browser-local tab, no projection, and the seeded data is byte-for-byte untouched.
  for (const path of ["contacts", "settings", "citations", "credentials", "authorities", "drivers"]) {
    await page.goto(`${BASE}/companies/${A.id}/${path}`, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {})
    await page.waitForTimeout(1200)
    t = await page.innerText("body")
    const tabs = await page.getByRole("tab", { name: /browser-local/ }).count()
    record(`containment: ${path} offers no browser-local tab or banner for a canonical company`, tabs === 0 && !/not the TES database/.test(t))
  }
  await page.goto(`${BASE}/companies/${A.id}/citations`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(1000)
  t = await page.innerText("body")
  record("Citations (no canonical workspace yet) explains it is not connected, with a way back to the profile", /not connected to the canonical records yet/.test(t) && (await page.getByRole("link", { name: /Back to the company profile/ }).count()) === 1)
  await shot(page, "19-canonical-citations-deferred")
  const stored = await page.evaluate(() => ({ companies: localStorage.getItem("tes_companies"), contacts: localStorage.getItem("tes_contacts_v5"), keys: Object.keys(localStorage).sort() }))
  record("containment: the seeded browser data is untouched and no projection or other key was added", stored.companies === JSON.stringify(legacy) && stored.contacts === contactsBlob && JSON.stringify(stored.keys) === JSON.stringify(["tes_companies", "tes_contacts_v5"]), JSON.stringify(stored.keys))
  const all = await browserStorage(page)
  record("containment: nothing in sessionStorage or IndexedDB", all.session.filter((k) => /tes/i.test(k)).length === 0 && all.idb.filter((k) => /tes/i.test(String(k))).length === 0)
} catch (e) { record("scenario error", false, String(e).slice(0, 400)) }
fs.writeFileSync("/tmp/tes-e2e/results-legacy.json", JSON.stringify(results, null, 2))
await browser.close()
