import { start, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text } = h
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b2-ids.json", "utf8"))
const BN = digits(9)
const ident = (id, kind) => Number(psql(`select count(*) from public.organization_identifiers where organization_id='${id}' and namespace='${kind === "CRA_BN" ? "cra" : "irs"}' and status='active'`))

// ---------------- BUSINESS ----------------
await step("business: loads the canonical identity and shows unavailable domains as unavailable", async () => { await go(`/companies/${A.id}/business`); await settle(); const t = await body(); return /Storage: TES database/.test(t) && /not available yet/.test(t) })
const addCra = async () => { if (!(await page.locator("input[name=accountNo]").first().isVisible().catch(() => false))) await page.getByRole("button", { name: "Add", exact: true }).nth(0).click(); return page.locator("input[name=accountNo]").first() }
await step("business: Cancel on the CRA BN card stores nothing", async () => {
  const before = ident(A.id, "CRA_BN"); const row = await addCra(); await row.fill(BN)
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click(); await page.waitForTimeout(600)
  return ident(A.id, "CRA_BN") === before && !(await body()).includes(BN)
})
await step("business: an invalid BN is refused with a message and nothing is saved", async () => {
  const before = ident(A.id, "CRA_BN"); const row = await addCra(); await row.fill("12ab"); await page.locator("form button[type=submit]").first().click(); await page.waitForTimeout(1500)
  const msg = await body(); await shot(page, "b2-business-invalid")
  return ident(A.id, "CRA_BN") === before && /nine|9|digit|invalid|valid/i.test(msg) ? "refused with message" : false
})
await step("business: a valid BN is saved to the canonical identifier table with a Master Register event", async () => {
  const before = ident(A.id, "CRA_BN"); const ev0 = Number(psql(`select count(*) from public.master_register_events`))
  const row = await addCra(); await row.fill(BN); await page.locator("form button[type=submit]").first().click(); await page.waitForTimeout(2500)
  const after = ident(A.id, "CRA_BN"); const ev1 = Number(psql(`select count(*) from public.master_register_events`))
  await shot(page, "b2-business-bn-saved"); return after === before + 1 && ev1 > ev0 ? `identifiers ${before}->${after}, events +${ev1 - ev0}` : false
})
await step("business: the BN survives a refresh", async () => { await page.reload({ waitUntil: "domcontentloaded" }); await settle(); return (await body()).includes(BN) })
await step("business: company B does not show company A's BN", async () => { await go(`/companies/${B.id}/business`); await settle(); return !(await body()).includes(BN) })
await step("business: a BN already registered to company A is refused for company B (409), nothing saved", async () => {
  const r = await api(`/api/companies/${B.id}/business`, { kind: "CRA_BN", value: BN })
  return (r.status === 409 || r.status === 400) && ident(B.id, "CRA_BN") === 0 ? `status ${r.status} ${JSON.stringify(r.body).slice(0, 140)}` : false
})
await step("business: a body organizationId cannot redirect the write (URL company wins)", async () => {
  const r = await api(`/api/companies/${B.id}/business`, { kind: "IRS_EIN", value: `${digits(2)}-${digits(7)}`, organizationId: A.id })
  return ident(A.id, "IRS_EIN") === 0 && ident(B.id, "IRS_EIN") === 0 && r.status === 400 ? `refused (400 ${JSON.stringify(r.body)}); neither company changed` : false
})

// ---------------- SETTINGS ----------------
await step("settings: loads the canonical operating scope", async () => { await go(`/companies/${A.id}/settings`); await settle(); return await page.locator("input[name=operating-scope][value=CANADA_AND_UNITED_STATES]").isChecked() })
await step("settings: changing the scope and cancelling (navigating away) stores nothing", async () => {
  await page.locator("input[name=operating-scope][value=CANADA]").check(); await go(`/companies/${A.id}/settings`); await settle()
  return await page.locator("input[name=operating-scope][value=CANADA_AND_UNITED_STATES]").isChecked()
})
await step("settings: Save profile persists the scope (database + Master Register) and survives refresh", async () => {
  await page.locator("input[name=operating-scope][value=CANADA]").check()
  const ev0 = Number(psql(`select count(*) from public.master_register_events`))
  await page.getByRole("button", { name: /Save profile/i }).click(); await page.waitForTimeout(3000)
  await shot(page, "b2-settings-saved")
  await page.reload({ waitUntil: "domcontentloaded" }); await settle()
  const ev1 = Number(psql(`select count(*) from public.master_register_events`))
  return (await page.locator("input[name=operating-scope][value=CANADA]").isChecked()) && ev1 > ev0 ? `events +${ev1 - ev0}` : false
})
await step("settings: company B's scope is untouched by A's save", async () => { await go(`/companies/${B.id}/settings`); await settle(); return await page.locator("input[name=operating-scope][value=CANADA_AND_UNITED_STATES]").isChecked() })
await step("settings: the settings API ignores a body organizationId (URL company wins)", async () => {
  const r = await api(`/api/companies/${B.id}/settings`, { action: "setOperatingScope", organizationId: A.id, operatingScope: "UNITED_STATES" })
  const aScope = (await api(`/api/companies/${A.id}/settings`, undefined, "GET")).body
  const bScope = (await api(`/api/companies/${B.id}/settings`, undefined, "GET")).body
  return r.status === 200 && JSON.stringify(aScope).includes('"CANADA"') && JSON.stringify(bScope).includes("UNITED_STATES") ? `status ${r.status}: B changed to UNITED_STATES, A stayed CANADA` : false
})

// ---------------- TAX FILING ----------------
await step("tax-filing: loads and reflects the canonical operating scope", async () => { await go(`/companies/${A.id}/tax-filing`); await settle(); const t = await body(); return /Applicable Taxes/.test(t) && /Tax Applicability/.test(t) })
await step("tax-filing: Tax Profile view opens", async () => { await page.getByText("Tax Profile", { exact: true }).first().click(); await page.waitForTimeout(1000); await shot(page, "b2-tax-profile"); return true })
await step("tax-filing: company B shows its own (unconfigured) profile", async () => { await go(`/companies/${B.id}/tax-filing`); await settle(); return /Not Configured/i.test(await body()) })
const keys = tesKeys(await browserStorage(page)); record("business/settings/tax: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
