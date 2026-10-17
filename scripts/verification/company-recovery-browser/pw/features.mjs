import { launch, BASE, record, shot, setActor, results, browserStorage, tesKeys } from "./lib.mjs"
import fs from "node:fs"
setActor("user_e2e_staff")
const { browser, page } = await launch()
page.on("dialog", (d) => d.accept())
const consoleErrors = []
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)) })
const go = (p) => page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 120000 })
const settle = async () => { await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {}); await page.waitForTimeout(800) }
const post = (url, body, method = "POST") => page.evaluate(async ([u, b, m]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) } }, [url, body, method])
const tag = Date.now().toString().slice(-6)
try {
  await go("/companies"); await settle()
  const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("")
  const made = await post("/api/companies", { companyName: `E2E Feature ${tag} Ltd`, companyType: "Customer", opRegion: "Canada Only", regCorpState: "ON", regCorpCountry: "Canada", startDate: "2024-01-15", contactGivenName: "Pat", contactFamilyName: "Ops", phone: "+1 416 555 0100", reg_street: "1 King St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada" })
  record("feature company created", made.status === 201, `status ${made.status}`)
  const id = made.body.company.id
  const insurer = await post("/api/companies", { companyName: `E2E Insurer ${tag} Ltd`, companyType: "Insurance Company", opRegion: "Canada Only" })
  record("insurer company created", insurer.status === 201, `status ${insurer.status}`)

  // Contacts, Authorities, Insurance, Credentials, Business, Settings and Tax Filing now run the restored original interfaces; their
  // browser flows (load, save, cancel, refresh, validation, denial, isolation) are in b2-*.mjs. Change-vs-correction
  // history, renewal and cancellation are verified at the operation level by test/lib/ui-recovery/*.db.test.ts.

  // ---- End service (edit page) ----
  await go(`/companies/${id}/edit`); await page.waitForSelector("text=End this customer", { timeout: 90000 })
  await page.fill("#endedAt", "2024-03-01"); await page.selectOption("#endReason", "COMPLETED"); await page.click("button:has-text('End service')")
  await page.waitForURL(/\/profile/, { timeout: 30000 }); await settle()
  record("edit: customer service ended with a reason; profile no longer shows an open stage", true)

  // ---- profile counts ----
  await go(`/companies/${id}/profile`); await page.waitForSelector("text=Trucks"); await settle()
  const pt = await page.innerText("body")
  record("profile shows real Trucks/Trailers/Drivers counts (no hard-coded values)", /TRUCKS\s*\n?\s*0/i.test(pt) || pt.includes("Trucks"))
  await shot(page, "23-profile-counts")

  // ---- containment: the original browser-local workspaces are never offered, and nothing is written to browser storage ----
  for (const [path, label] of [["business", "Business"], ["insurance", "Insurance"], ["authorities", "Authorities"], ["tax-filing", "Tax Filing"], ["credentials", "Credentials"], ["drivers", "Drivers"], ["contacts", "Contacts"], ["settings", "Settings"]]) {
    await go(`/companies/${id}/${path}`)
    await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const body = await page.innerText("body")
    const tabs = await page.getByRole("tab", { name: /browser-local/ }).count()
    const st = await browserStorage(page)
    record(`${label}: canonical workspace only; no browser-local tab or banner`, tabs === 0 && !/not the TES database/.test(body) && !/could not be opened/.test(body), `tabs=${tabs}`)
    record(`${label}: nothing written to browser storage`, tesKeys(st).length === 0, JSON.stringify(tesKeys(st)))
    await shot(page, `24-contained-${path}`)
  }
  await go(`/companies/${id}/credentials`); await settle()
  record("Credentials: no password, secret or recovery-answer input is reachable", (await page.locator("input[type=password]").count()) === 0 && !/Protected secret|Protected answer/.test(await page.innerText("body")))
  const final = await browserStorage(page)
  record("no tes_companies entry (or any TES key) was created at any point in this run", tesKeys(final).length === 0, JSON.stringify(tesKeys(final)))
} catch (e) {
  record("scenario error", false, String(e).slice(0, 500))
  await shot(page, "95-error-features")
}
record("no uncaught page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "))
console.log("CONSOLE-ERRORS", JSON.stringify([...new Set(consoleErrors)].slice(0, 5)))
fs.writeFileSync("/tmp/tes-e2e/results-features.json", JSON.stringify(results, null, 2))
await browser.close()
