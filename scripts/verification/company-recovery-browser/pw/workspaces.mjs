import { launch, BASE, record, shot, pick, setActor, results } from "./lib.mjs"
import fs from "node:fs"
const data = JSON.parse(fs.readFileSync("/tmp/tes-e2e/created.json", "utf8"))
setActor("user_e2e_staff")
const { browser, page } = await launch()
const id = data.id
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 120000 }) }
try {
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
    ["citations", /not connected to the canonical records yet/, "Citations (deferred: browser-local version contained)"],
  ]) {
    await go(`/companies/${id}/${path}`)
    await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {})
    await page.waitForTimeout(800)
    const t = await page.innerText("body")
    const ok = expectText.test(t) && !/Company not found|could not be opened/i.test(t) && page.errors.length === 0
    record(`${label} workspace opens for the canonical company`, ok, ok ? "" : t.slice(0, 200).replace(/\n/g, " "))
    await shot(page, `10-${path}`)
  }
} catch (e) {
  record("scenario error", false, String(e).slice(0, 400))
}
record("no uncaught page errors in the run", page.errors.length === 0, page.errors.slice(0, 2).join(" | "))
fs.writeFileSync("/tmp/tes-e2e/results-workspaces.json", JSON.stringify(results, null, 2))
await browser.close()
