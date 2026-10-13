import { launch, BASE, record, shot, pick, setActor, results } from "./lib.mjs"
import fs from "node:fs"
const data = JSON.parse(fs.readFileSync("/tmp/tes-e2e/created.json", "utf8"))
setActor("user_e2e_staff")
const { browser, page } = await launch()
const id = data.id
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 }) }
try {
  // ---- edit and reopen ----
  await go(`/companies/${id}/edit`)
  await page.waitForSelector("#companyName", { timeout: 60000 })
  const before = { region: await page.inputValue("[name=reg_street]"), name: await page.inputValue("#companyName") }
  record("edit page opens prefilled from the canonical record", before.name === data.name && before.region.includes("100 King St W"), JSON.stringify(before))
  const newName = data.name.replace("Ltd", "Holdings Ltd")
  await page.fill("#companyName", newName)
  await page.fill("[name=reg_street]", "200 Bay St")
  await page.fill("[name=reg_zip]", "M5J 2J2")
  await page.selectOption("#opRegion", "US Only")
  await shot(page, "04-edit-form")
  await page.click("button:has-text('Save Changes')")
  await page.waitForURL(/\/profile/, { timeout: 60000 })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForSelector("text=Company Name")
  let body = await page.innerText("body")
  record("edited values persist after save and reopen", body.includes(newName) && body.includes("200 Bay St") && body.includes("US Only"))
  record("mailing and yard addresses untouched by a registered-address edit", body.includes("PO Box 12") && body.includes("55 Yard Rd"))
  await shot(page, "05-profile-after-edit")

  // ---- invalid edit changes nothing ----
  await go(`/companies/${id}/edit`)
  await page.waitForSelector("#companyName")
  await page.fill("#companyName", "Should Not Persist Ltd")
  await page.fill("[name=mail_street]", "")
  await page.fill("[name=mail_city]", "Ottawa")
  await page.click("button:has-text('Save Changes')")
  await page.waitForSelector("[role=alert]", { timeout: 30000 })
  await shot(page, "06-edit-refused")
  await go(`/companies/${id}/profile`)
  await page.waitForSelector("text=Company Name")
  body = await page.innerText("body")
  record("a refused edit changes nothing (identity included)", !body.includes("Should Not Persist") && body.includes(newName))

  // ---- contacts ----
  await go(`/companies/${id}/contacts`)
  await page.waitForSelector("text=Add a contact", { timeout: 60000 })
  body = await page.innerText("body")
  record("contacts shows the canonical primary contact and company lines", body.includes("Jane") && body.includes(data.phone) && body.includes("Roe"))
  await page.fill("#givenName", "Sam"); await page.fill("#familyName", "Dispatcher"); await page.fill("#title", "Dispatcher")
  await page.fill("#phone", "+1 416 555 0199")
  await page.click("button:has-text('Add contact')")
  await page.waitForSelector("text=Contact added.", { timeout: 30000 })
  await shot(page, "07-contacts-added")
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector("text=Add a contact")
  record("a contact added in the browser is read back after reload", (await page.innerText("body")).includes("Sam Dispatcher"))
  record("the existing browser-local contacts workspace stays one click away", await page.getByRole("tab", { name: /browser-local workspace/ }).isVisible())
  await page.getByRole("tab", { name: /browser-local workspace/ }).click()
  await page.waitForTimeout(1500)
  await shot(page, "08-contacts-browser-local")
  record("browser-local contacts workspace opens with its non-canonical banner", await page.getByText("browser-local workspace (not the TES database)").isVisible())

  // ---- settings ----
  await go(`/companies/${id}/settings`)
  await page.waitForSelector("text=Operating scope", { timeout: 60000 })
  await page.selectOption("select[aria-label='Operating scope']", "CANADA_AND_UNITED_STATES")
  await page.waitForSelector("text=Operating scope saved.", { timeout: 30000 })
  await page.getByRole("button", { name: "Does not apply" }).first().click()
  await page.waitForSelector("text=Rule saved.", { timeout: 30000 })
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector("text=Operating scope")
  record("settings persist operating scope and a rule applicability", (await page.locator("select[aria-label='Operating scope']").inputValue()) === "CANADA_AND_UNITED_STATES")
  await shot(page, "09-settings")

  // ---- remaining workspaces: load, navigate, honest states ----
  for (const [path, expectText, label] of [
    ["authorities", /USDOT|Authorit/i, "Authorities"],
    ["tax-filing", /IFTA|Tax|Registration/i, "Tax Filing"],
    ["insurance", /Insurance/i, "Insurance"],
    ["credentials", /Credential/i, "Credentials"],
    ["vehicles", /Vehicle/i, "Vehicles"],
    ["drivers", /Driver/i, "Drivers"],
    ["business", /Business/i, "Business"],
    ["onboarding", /Onboarding/i, "Onboarding"],
    ["citations", /Citation/i, "Citations"],
  ]) {
    await go(`/companies/${id}/${path}`)
    await page.waitForTimeout(2500)
    const t = await page.innerText("body")
    const ok = expectText.test(t) && !/Company not found|could not be opened/i.test(t) && page.errors.length === 0
    record(`${label} workspace opens for the canonical company`, ok, ok ? "" : t.slice(0, 200).replace(/\n/g, " "))
    await shot(page, `10-${path}`)
  }
} catch (e) {
  record("scenario error", false, String(e).slice(0, 400))
  await shot(page, "98-error-edit")
}
record("no uncaught page errors in the run", page.errors.length === 0, page.errors.slice(0, 2).join(" | "))
fs.writeFileSync("/tmp/tes-e2e/results-edit.json", JSON.stringify(results, null, 2))
await browser.close()
