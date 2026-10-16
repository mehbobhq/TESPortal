import { launch, BASE, record, shot, pick, setActor, results } from "./lib.mjs"
import fs from "node:fs"
setActor("user_e2e_staff")
const { browser, page } = await launch()
const tag = Date.now().toString().slice(-6)
const name = `E2E Customer ${tag} Ltd`
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("")
const data = { name, ein: `${digits(2)}-${digits(7)}`, bn: digits(9), incorp: digits(7), usdot: digits(7), mc: digits(6), mvid: `MV${digits(5)}`, nsc: `NS${digits(5)}`, irp: `IRP${digits(6)}`, ifta: `IFTA${digits(6)}`, phone: "+1 416 555 0142", email: `ops-${tag}@example.test`, billing: `bill-${tag}@example.test` }
fs.writeFileSync("/tmp/tes-e2e/created.json", JSON.stringify(data))
try {
  await page.goto(`${BASE}/companies/new`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("#companyName")
  record("creation form shows the unavailable-fields notice up front", await page.getByText("Some fields on this form cannot be saved yet").isVisible())
  const disabled = []
  for (const n of ["website", "gstHst", "endDate", "gpsProvider", "fuelProvider", "assessmentDate"]) disabled.push(await page.locator(`[name=${n}]`).first().isDisabled().catch(() => false))
  await shot(page, "01-new-form-initial")
  await pick(page, page.locator("button:has-text('Select entity type')"), "Customer")
  record("original fields stay on the form, disabled and labelled", (await Promise.all(["website", "gstHst", "endDate", "gpsProvider", "fuelProvider", "assessmentDate", "svcType", "status", "payMethod", "cargoTypes"].map((n) => page.locator(`[name=${n}]`).first().isDisabled()))).every(Boolean) && (await page.locator("[data-unavailable-note]").count()) >= 8)
  await page.fill("#companyName", name)
  await page.fill("#dba", `E2E Trade ${tag}`)
  await page.fill("#contactPerson", "Jane Roe")
  await page.locator("#contactPerson").blur()
  record("full name suggests confirmable given/family names", (await page.inputValue("#contactGivenName")) === "Jane" && (await page.inputValue("#contactFamilyName")) === "Roe")
  await page.fill("#phone", data.phone)
  await page.fill("#email", data.email)
  await page.fill("#billingEmail", data.billing)
  await pick(page, page.locator("button:has-text('Canada Only')"), "Cross-Border")
  await pick(page, page.locator("button:has-text('Select jurisdiction')").first(), "Ontario")
  await page.fill("[name=incorpNo]", data.incorp)
  await page.fill("input[placeholder='123456789']", data.bn)
  await page.fill("input[placeholder='12-3456789']", data.ein)
  const addr = async (prefix, street, city, region, zip) => {
    await page.fill(`[name=${prefix}_street]`, street)
    await page.fill(`[name=${prefix}_city]`, city)
    await pick(page, page.locator("button:has-text('Select jurisdiction')").first(), region)
    await page.fill(`[name=${prefix}_zip]`, zip)
  }
  await addr("reg", "100 King St W", "Toronto", "Ontario", "M5X 1A9")
  await addr("mail", "PO Box 12", "Ottawa", "Ontario", "K1P 5G3")
  await addr("yard", "55 Yard Rd", "Chicago", "Illinois", "60601")
  await page.fill("[name=startDate]", "2024-01-15")
  await page.fill("[name=mvid]", data.mvid); await page.selectOption("[name=mvidKind]", "MVID"); await page.selectOption("[name=mvidRegion]", "ON")
  await page.fill("[name=nsc]", data.nsc); await page.selectOption("[name=nscKind]", "NSC"); await page.selectOption("[name=nscRegion]", "AB")
  await page.fill("[name=usdot]", data.usdot); await page.fill("[name=mc]", data.mc)
  await page.fill("[name=accIrp]", data.irp); await page.selectOption("[name=irpBase]", "IL")
  await page.fill("[name=accIfta]", data.ifta); await page.selectOption("[name=iftaBase]", "ON")
  await shot(page, "02-new-form-filled")
  await page.click("button:has-text('Create Record')")
  await page.waitForURL(/\/companies\/[0-9a-f-]{36}\/profile/, { timeout: 60000 })
  const id = page.url().match(/companies\/([0-9a-f-]{36})/)[1]
  data.id = id
  fs.writeFileSync("/tmp/tes-e2e/created.json", JSON.stringify(data))
  record("creation redirects to the new company's profile (canonical id)", true, id)
  await page.waitForSelector("text=Company Name", { timeout: 30000 })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector("text=Company Name", { timeout: 30000 })
  await shot(page, "03-profile-after-create-reopened")
  const body = await page.innerText("body")
  const expect = { name, dba: `E2E Trade ${tag}`, phone: data.phone, email: data.email, billing: data.billing, ein: data.ein, bn: data.bn, incorp: data.incorp, usdot: data.usdot, mc: data.mc, mvid: data.mvid, nsc: data.nsc, irp: data.irp, ifta: data.ifta, reg: "100 King St W", mail: "PO Box 12", yard: "55 Yard Rd", contact: "Jane Roe", start: "2024-01-15", scope: "Cross-Border" }
  const missing = Object.entries(expect).filter(([, v]) => !body.includes(v)).map(([k]) => k)
  record("reopened profile shows every persisted value", missing.length === 0, missing.length ? "missing: " + missing.join(",") : "")
  record("profile keeps the original unavailable fields as 'Not recorded (no canonical storage yet)'", (body.match(/Not recorded \(no canonical storage yet\)/g) || []).length >= 6)
} catch (e) {
  record("scenario error", false, String(e).slice(0, 300))
  await shot(page, "99-error")
}
fs.writeFileSync("/tmp/tes-e2e/results-create.json", JSON.stringify(results, null, 2))
await browser.close()
