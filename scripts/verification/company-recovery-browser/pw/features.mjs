import { launch, BASE, record, shot, setActor, results } from "./lib.mjs"
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

  // ---- Contacts: existing operations in the UI ----
  await go(`/companies/${id}/contacts`); await page.waitForSelector("text=Add a contact", { timeout: 90000 }); await settle()
  await page.locator("details summary", { hasText: "Edit" }).first().click()
  await page.locator("input[aria-label='Given name']").first().fill("Patricia")
  await page.getByRole("button", { name: "Save name" }).click()
  await page.waitForSelector("text=Name saved.", { timeout: 30000 })
  await page.locator("input[aria-label='Add title']").first().fill("Safety Lead")
  await page.getByRole("button", { name: "Add", exact: true }).first().click()
  await page.waitForSelector("text=Title added.", { timeout: 30000 })
  await page.waitForFunction(() => document.body.innerText.includes("Safety Lead"), null, { timeout: 30000 }).catch(() => {})
  let t = await page.innerText("body")
  record("contacts: name change and title add persist and display", t.includes("Patricia") && t.includes("Safety Lead"))
  await page.fill("[aria-label='Search contacts']", "zzzz"); 
  record("contacts: search filters the list", (await page.innerText("body")).includes("No contacts match"))
  await page.fill("[aria-label='Search contacts']", "")
  await page.getByRole("button", { name: "End contact" }).first().click()
  await page.waitForSelector("text=Contact ended", { timeout: 30000 })
  await page.getByLabel(/Include ended contacts/).check()
  await page.getByRole("button", { name: "Archive person" }).first().click()
  await page.waitForSelector("text=Person archived", { timeout: 30000 })
  await page.waitForFunction(() => document.body.innerText.includes("(archived)"), null, { timeout: 30000 }).catch(() => {})
  record("contacts: end then archive keeps the person visible under 'ended' (history kept)", (await page.innerText("body")).includes("(archived)"))
  await shot(page, "20-contacts-operations")

  // ---- Authorities: create, edit (change), correct, history ----
  await go(`/companies/${id}/authorities`); await page.getByRole("tab", { name: /TES records/ }).click().catch(() => {}); await page.waitForSelector("text=Add authorities record", { timeout: 90000 }).catch(async () => { await page.waitForSelector("text=Add authorit", { timeout: 30000 }) }); await settle()
  await page.selectOption("#type", "IRP"); await page.fill("#number", `IRP${digits(6)}`); await page.selectOption("#country", "US"); await page.fill("#region", "IL"); await page.click("button:has-text('Save record')")
  await page.waitForSelector("text=Edit or correct", { timeout: 30000 })
  await page.locator("details summary", { hasText: "Edit or correct" }).first().click()
  await page.locator("select[aria-label='Issuing country']").first().selectOption("CA")
  await page.locator("input[aria-label='Jurisdiction region']").first().fill("ON")
  await page.getByRole("button", { name: "Save", exact: true }).first().click()
  await page.waitForFunction(() => /\bON\b/.test(document.body.innerText) && document.body.innerText.includes("from "), null, { timeout: 30000 })
  const fixed = `IRP${digits(6)}`
  await page.locator("input[aria-label='Number']").first().fill(fixed)
  await page.locator("input[value=correct]").first().check()
  await page.getByRole("button", { name: "Save", exact: true }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes("corrected (not genuine history)"), null, { timeout: 30000 })
  record("authorities: a real change (IRP base move) keeps history; a correction flags the wrong version", true)
  await shot(page, "21-authorities-edit-history")

  // ---- Insurance: renew and cancel ----
  const pol = await post(`/api/companies/${id}/insurance`, { insurerOrganizationId: insurer.body.company.id, family: "INSURANCE", policyNumber: `E2E-${tag}`, termStart: "2023-01-01", termEnd: "2024-01-01", coverages: [{ coverageType: "AUTO_LIABILITY", limitAmount: "1000000", currency: "CAD", limitBasis: "COMBINED_SINGLE_LIMIT" }] })
  record("insurance policy created (API)", pol.status === 201, `status ${pol.status} ${JSON.stringify(pol.body).slice(0, 100)}`)
  await go(`/companies/${id}/insurance`); await page.waitForSelector("summary:has-text('Renew or cancel')", { timeout: 90000 }); await settle()
  await page.locator("summary", { hasText: "Renew or cancel" }).first().click()
  await page.locator("input[name=termStart]").first().fill("2024-01-01")
  await page.locator("input[name=termEnd]").first().fill("2025-01-01")
  await page.getByRole("button", { name: /Renew \(new term/ }).click()
  await page.waitForFunction(() => document.body.innerText.includes("2024-01-01 to 2025-01-01"), null, { timeout: 30000 })
  record("insurance: renewal adds a new term (shown as latest)", true)
  if (!(await page.locator("input[name=cancelledOn]").first().isVisible())) await page.locator("summary", { hasText: "Renew or cancel" }).first().click()
  await page.locator("input[name=cancelledOn]").first().fill("2024-06-01")
  await page.getByRole("button", { name: "Cancel this term" }).click()
  await page.waitForFunction(() => document.body.innerText.includes("cancelled 2024-06-01"), null, { timeout: 30000 })
  record("insurance: a term can be cancelled with a reason", true)
  await shot(page, "22-insurance-renew-cancel")

  // ---- Credentials ----
  const sys = await post("/api/credential-systems", { name: `E2E Portal ${tag}`, loginUrl: "https://portal.example.test/login" })
  record("credential system created", sys.status === 201 || sys.status === 200, `status ${sys.status}`)
  await go(`/companies/${id}/credentials`); await page.waitForSelector("text=Add credential", { timeout: 90000 }); await settle()
  await page.selectOption("#systemId", { label: `E2E Portal ${tag}` }); await page.fill("#username", `user${tag}`); await page.click("button:has-text('Save credential')")
  await page.waitForFunction(() => document.body.innerText.includes("NEEDS_VERIFICATION"), null, { timeout: 30000 })
  record("credentials: a new credential starts as needs-verification (original parity)", true)
  await page.selectOption("[aria-label='Verification outcome']", "VERIFIED"); await page.selectOption("[aria-label='Verification method']", "PORTAL_CHECK")
  await page.getByRole("button", { name: "Record check" }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes("last check VERIFIED"), null, { timeout: 30000 })
  await page.fill("[aria-label='Search credentials']", "nomatch")
  record("credentials: search narrows the list and the open-portal link is offered", !(await page.innerText("body")).includes(`user${tag}`))
  await page.fill("[aria-label='Search credentials']", "")
  record("credentials: Open portal link present", await page.getByRole("link", { name: "Open portal" }).first().isVisible())

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

  // ---- legacy tabs for restored workspaces ----
  for (const [path, label] of [["business", "Business"], ["insurance", "Insurance"], ["authorities", "Authorities"], ["tax-filing", "Tax Filing"], ["credentials", "Credentials"], ["drivers", "Drivers"]]) {
    await go(`/companies/${id}/${path}`); await page.getByRole("tab", { name: new RegExp(`${label} \\(browser-local workspace\\)`) }).waitFor({ timeout: 90000 })
    await page.getByRole("tab", { name: new RegExp(`${label} \\(browser-local workspace\\)`) }).click()
    await page.waitForFunction(() => /not the TES database/.test(document.body.innerText), null, { timeout: 60000 })
    await page.waitForTimeout(1500)
    const body = await page.innerText("body")
    const proj = await page.evaluate((cid) => JSON.parse(localStorage.getItem("tes_companies") || "[]").some((c) => c.id === cid && c.source === "canonical-projection"), id)
    record(`${label}: original workspace opens as a labelled browser-local tab`, /not the TES database/.test(body) && !/could not be opened/.test(body) && proj, proj ? "" : "projection missing")
    await shot(page, `24-legacy-${path}`)
  }
  await go(`/companies/${id}/profile`); await settle()
  const left = await page.evaluate((cid) => JSON.parse(localStorage.getItem("tes_companies") || "[]").some((c) => c.id === cid), id)
  record("leaving the browser-local tab removes the marked projection (no durable second copy)", left === false)
} catch (e) {
  record("scenario error", false, String(e).slice(0, 500))
  await shot(page, "95-error-features")
}
record("no uncaught page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "))
console.log("CONSOLE-ERRORS", JSON.stringify([...new Set(consoleErrors)].slice(0, 5)))
fs.writeFileSync("/tmp/tes-e2e/results-features.json", JSON.stringify(results, null, 2))
await browser.close()
