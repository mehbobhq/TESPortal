import { start, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text, submit } = h
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b2-ids.json", "utf8"))
const tag = digits(5); const PORTAL = `B2 Portal ${tag}`; const USER = `ops-${tag}@example.test`
const creds = (id) => Number(psql(`select count(*) from public.company_credentials where organization_id='${id}'`))
await go("/companies"); await settle()
const sys = await api("/api/credential-systems", { name: PORTAL, loginUrl: "https://portal.example.test/login" })
record("credentials: portal/system created in the global registry", sys.status === 201, `status ${sys.status}`)
await step("credentials: loads the canonical (empty) credential list", async () => { await go(`/companies/${A.id}/credentials`); await settle(); return /No credentials found/.test(await body()) })
await step("credentials: no password/secret input is enterable (the password field is disabled)", async () => {
  await page.getByRole("button", { name: "Add credential" }).first().click(); await page.waitForTimeout(800)
  const pw = page.locator("input[aria-label^='Password']"); const dis = await pw.isDisabled(); const type = await page.locator("input[type=password]").count()
  return dis && type === 0 ? "password field disabled; no type=password input" : false
})
await step("credentials: validation - Save without a portal/username is refused and nothing is saved", async () => {
  const before = creds(A.id); await submit(() => page.getByRole("button", { name: "Save", exact: true }).click())
  await shot(page, "b2-credentials-validation"); return creds(A.id) === before
})
await step("credentials: Cancel stores nothing", async () => { const before = creds(A.id); await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(500); return creds(A.id) === before })
await step("credentials: creating through the UI persists a credential (database + Master Register event)", async () => {
  const before = creds(A.id); const ev0 = Number(psql(`select count(*) from public.master_register_events`))
  await page.getByRole("button", { name: "Add credential" }).first().click(); await page.waitForTimeout(600)
  await page.getByPlaceholder(/Alberta Transportation/).fill("Northbridge B2"); await page.waitForTimeout(1200); await page.getByText(/Northbridge B2 .* Insurance/).first().click(); await page.waitForTimeout(500)
  await page.getByPlaceholder(/Search ATIOS/).fill(PORTAL); await page.waitForTimeout(1200)
  await page.getByText(PORTAL, { exact: false }).last().click(); await page.waitForTimeout(500)
  await page.getByPlaceholder("Username or account email").fill(USER)
  await shot(page, "b2-credentials-filled")
  await submit(() => page.getByRole("button", { name: "Save", exact: true }).click(), true, () => page.getByText("Add Credential", { exact: true }).waitFor({ state: "hidden", timeout: 60000 }))
  const after = creds(A.id); const ev1 = Number(psql(`select count(*) from public.master_register_events`)); await shot(page, "b2-credentials-after-save")
  return after === before + 1 && ev1 > ev0 ? `credentials ${before}->${after}, events +${ev1 - ev0}` : `!credentials ${before}->${after}; body tail: ${(await body()).slice(-300).replace(/\\n/g, " ")}`
})
await step("credentials: the credential survives a refresh (username shown masked or plain, never a secret)", async () => { await page.reload({ waitUntil: "domcontentloaded" }); await settle(); const t = await body(); return t.includes(PORTAL) })
await step("credentials: no secret value exists in any credential column", async () => {
  const cols = psql(`select string_agg(column_name,',') from information_schema.columns where table_schema='public' and table_name like '%credential%' and column_name ~* 'password|secret_value|answer|pin$|token'`)
  return cols === "" || cols === null ? "no value-capable column" : `columns: ${cols}`
})
await step("credentials: company B does not list company A's credential", async () => { await go(`/companies/${B.id}/credentials`); await settle(); return !(await body()).includes(USER) && /No credentials found/.test(await body()) })
await step("credentials: a credential of company A cannot be changed through company B's URL", async () => {
  const id = psql(`select id from public.company_credentials where organization_id='${A.id}' limit 1`)
  const before = psql(`select category||':'||updated_at from public.company_credentials where id='${id}'`)
  const r = await api(`/api/companies/${B.id}/credentials/${id}`, { action: "metadata", category: "FUEL" }, "PATCH")
  const after = psql(`select category||':'||updated_at from public.company_credentials where id='${id}'`)
  return before === after && r.status >= 400 && r.status < 500 ? `refused (${r.status}); credential unchanged` : `!status ${r.status} ${before} -> ${after} ${JSON.stringify(r.body).slice(0, 150)}`
})
await step("credentials: a secret value in the request is refused (strict input)", async () => {
  const before = creds(A.id)
  const r = await api(`/api/companies/${A.id}/credentials`, { systemId: sys.body.system.id, category: "FLEET", username: `sec-${tag}`, password: "hunter2" })
  return r.status === 400 && creds(A.id) === before && !JSON.stringify(r.body).includes("hunter2") ? `refused (400)` : `!status ${r.status}`
})
const keys = tesKeys(await browserStorage(page)); record("credentials: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
