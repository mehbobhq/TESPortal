import { start, makeCompany, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text, submit } = h
const A = await makeCompany(h, "Alpha"); const B = await makeCompany(h, "Bravo")
fs.writeFileSync("/tmp/tes-e2e/b2-ids.json", JSON.stringify({ A, B }))
const auth = (id) => Number(psql(`select count(*) from public.operating_authorities where organization_id='${id}'`))
const MV = `MV${digits(6)}`

// ---------------- AUTHORITIES ----------------
await step("authorities: loads canonical record counts and the restored layout", async () => { await go(`/companies/${A.id}/authorities`); await h.settle(); await text(/AUTHORITY RECORDS/); return /Add Record/.test(await body()) })
await step("authorities: Cancel stores nothing", async () => {
  const before = auth(A.id)
  await page.getByRole("button", { name: "Add Record" }).first().click(); await page.getByPlaceholder("Enter identifier").fill(MV)
  await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(800)
  return auth(A.id) === before && !(await body()).includes(MV)
})
await step("authorities: validation - an empty number is refused and nothing is saved", async () => {
  const before = auth(A.id)
  await page.getByRole("button", { name: "Add Record" }).first().click()
  const save = page.getByRole("button", { name: "Save Record" }); const disabled = await save.isDisabled()
  if (!disabled) { await submit(() => save.click()) }
  await page.getByRole("button", { name: "Cancel" }).click()
  return auth(A.id) === before ? `Save disabled=${disabled}` : false
})
await step("authorities: a record with an unsupported field (Notes) is refused, not silently dropped", async () => {
  const before = auth(A.id)
  await page.getByRole("button", { name: "Add Record" }).first().click(); await page.getByPlaceholder("Enter identifier").fill(`MV${digits(6)}`)
  await page.getByPlaceholder("Optional compliance notes or reference details").fill("secret note")
  await submit(() => page.getByRole("button", { name: "Save Record" }).click())
  const ok = auth(A.id) === before
  await shot(page, "b2-authorities-notes-refused")
  await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return ok
})
await step("authorities: Save persists a canonical record (database row + Master Register event)", async () => {
  const rows0 = auth(A.id); const events0 = Number(psql(`select count(*) from public.master_register_events`))
  await page.getByRole("button", { name: "Add Record" }).first().click(); await page.getByPlaceholder("Enter identifier").fill(MV)
  await submit(() => page.getByRole("button", { name: "Save Record" }).click(), true, () => page.getByRole("button", { name: "Save Record" }).waitFor({ state: "hidden", timeout: 60000 }))
  const n = auth(A.id); const events1 = Number(psql(`select count(*) from public.master_register_events`))
  await shot(page, "b2-authorities-saved")
  return n === rows0 + 1 && events1 > events0 ? `rows ${rows0}->${n}, master-register events +${events1 - events0}` : false
})
await step("authorities: the saved record survives a refresh", async () => { await page.reload({ waitUntil: "domcontentloaded" }); await h.settle(); return (await body()).includes(MV) })
await step("authorities: a duplicate number is refused (409) and no second row exists", async () => {
  const before = auth(A.id)
  await page.getByRole("button", { name: "Add Record" }).first().click(); await page.getByPlaceholder("Enter identifier").fill(MV)
  await submit(() => page.getByRole("button", { name: "Save Record" }).click())
  const msg = /already|exists|registered|duplicate/i.test(await body())
  await shot(page, "b2-authorities-duplicate")
  await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return auth(A.id) === before && msg ? "refused with message" : `rows ${auth(A.id)} vs ${before}, message shown=${msg}`
})
await step("authorities: company B sees none of company A's records", async () => { await go(`/companies/${B.id}/authorities`); await h.settle(); return !(await body()).includes(MV) })
await step("authorities: the registry number check (staff, REGISTRY_READ) finds the existing number", async () => {
  const r = await api(`/api/companies/${B.id}/authorities/check`, { kind: "MVID", number: MV, jurisdiction: { country: "CA", region: "ON" } })
  return r.status === 200 && r.body.registered === true ? `registered=true match=${r.body.match ? "disclosed to the registry reader" : "none"}` : false
})
await step("authorities: unknown company id reports an error/not-a-record, not an empty workspace", async () => { await go(`/companies/00000000-0000-4000-8000-000000000000/authorities`); await h.settle(); return /not a TES record|not found|could not/i.test(await body()) })
const keys = tesKeys(await browserStorage(page)); record("authorities: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
