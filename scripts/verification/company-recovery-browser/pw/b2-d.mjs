import { start, makeCompany, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text } = h
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b2-ids.json", "utf8"))
const tag = digits(5); const POL = `POL-${tag}`; const INSURER = `Northbridge B2 ${tag} Insurance Ltd`
const pols = (id) => Number(psql(`select count(*) from public.insurance_policies where organization_id='${id}'`))
const dlg = () => page.locator("div").filter({ has: page.getByRole("button", { name: "Save Policy" }) }).last()
await go("/companies"); await settle()
const ins = await api("/api/companies", { companyName: INSURER, companyType: "Insurance Company", opRegion: "Canada Only" })
record("insurance: insurer company created for the policy", ins.status === 201, `status ${ins.status}`)

// ---------------- INSURANCE ----------------
await step("insurance: loads the canonical (empty) policy register", async () => { await go(`/companies/${A.id}/insurance`); await settle(); return /Transportation Policies \(0\)/.test(await body()) })
await step("insurance: Cancel stores nothing", async () => {
  const before = pols(A.id); await page.getByRole("button", { name: "Add Transportation Policy" }).first().click()
  await page.locator("input[name=policyNumber]").fill(POL); await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600)
  return pols(A.id) === before && !(await body()).includes(POL)
})
await step("insurance: validation - a policy without insurer/dates is refused and nothing is saved", async () => {
  const before = pols(A.id); await page.getByRole("button", { name: "Add Transportation Policy" }).first().click()
  await page.locator("input[name=policyNumber]").fill(`BAD-${tag}`); await page.getByRole("button", { name: "Save Policy" }).click(); await page.waitForTimeout(1500)
  await shot(page, "b2-insurance-validation"); const stillOpen = await page.locator("input[name=policyNumber]").isVisible().catch(() => false)
  await page.getByRole("button", { name: "Cancel" }).click().catch(() => {}); return pols(A.id) === before && stillOpen
})
await step("insurance: Save Policy persists a canonical policy (database + Master Register event)", async () => {
  const before = pols(A.id); const ev0 = Number(psql(`select count(*) from public.master_register_events`))
  await page.getByRole("button", { name: "Add Transportation Policy" }).first().click()
  await page.locator("select[name=insuranceType]").selectOption("Auto Liability")
  await page.locator("input[name=policyNumber]").fill(POL); await page.locator("input[name=insurerName]").fill(INSURER)
  await page.locator("input[name=coverageAmount]").fill("2000000"); await page.locator("input[name=effectiveDate]").fill("2026-01-01"); await page.locator("input[name=expiryDate]").fill("2027-01-01")
  await page.getByRole("button", { name: "Save Policy" }).click(); await page.waitForTimeout(3500)
  await shot(page, "b2-insurance-after-save")
  const after = pols(A.id); const ev1 = Number(psql(`select count(*) from public.master_register_events`))
  return after === before + 1 && ev1 > ev0 ? `policies ${before}->${after}, events +${ev1 - ev0}` : `!policies ${before}->${after}, events +${ev1 - ev0}; body: ${(await body()).slice(-400).replace(/\n/g, " ")}`
})
await step("insurance: the saved policy survives a refresh", async () => { await page.reload({ waitUntil: "domcontentloaded" }); await settle(); return (await body()).includes(POL) })
await step("insurance: company B does not list company A's policy", async () => { await go(`/companies/${B.id}/insurance`); await settle(); return !(await body()).includes(POL) })
await step("insurance: a policy of company A cannot be edited through company B's URL", async () => {
  const id = psql(`select id from public.insurance_policies where organization_id='${A.id}' limit 1`)
  const before = psql(`select record_status || ':' || updated_at from public.insurance_policies where id='${id}'`)
  const r = await api(`/api/companies/${B.id}/insurance/${id}`, { action: "archive", reason: "x" }, "PATCH")
  const after = psql(`select record_status || ':' || updated_at from public.insurance_policies where id='${id}'`)
  return before === after && r.status >= 400 && r.status < 500 ? `refused (${r.status}); policy unchanged` : `!status ${r.status} before=${before} after=${after} ${JSON.stringify(r.body).slice(0, 160)}`
})
const keys = tesKeys(await browserStorage(page)); record("insurance: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
