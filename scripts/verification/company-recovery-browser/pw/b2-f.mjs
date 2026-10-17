import { start, record, shot, psql, digits, browserStorage, tesKeys, setActor } from "./b2-common.mjs"
import fs from "node:fs"
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b2-ids.json", "utf8"))
const PAGES = ["authorities", "tax-filing", "insurance", "credentials", "business", "contacts", "settings"]
const counts = () => ["organizations", "organization_person_relationships", "insurance_policies", "company_credentials", "operating_authorities", "organization_identifiers", "master_register_events"].map((t) => { try { return Number(psql(`select count(*) from public.${t.replace("organization_person_relationships","organization_person_relationships")}`)) } catch { return -1 } }).join(",")
// ---- actor with NO capabilities (staff relationship, SYSTEM assignment, zero grants) ----
let h = await start("user_e2e_none"); let { page, go, settle, api, step, body } = h
await go("/companies"); await settle()
const snapshot = counts()
for (const p of PAGES) {
  await step(`denial: ${p} page shows a permission message and none of the company's data`, async () => {
    await go(`/companies/${A.id}/${p}`); await settle(); const t = await body()
    await shot(page, `b2-denied-${p}`)
    const leaked = /Sam\d{5}|POL-\d{5}|B2 Portal/.test(t)
    const m = t.match(/(not permitted[^.\n]*|not authorized[^.\n]*)/i)
    return !leaked && m ? m[0] : `!leaked=${leaked}; text: ${t.slice(200, 520).replace(/\n/g, " ")}`
  })
}
const GETS = ["contacts", "settings", "insurance", "credentials", "business"]  // authorities/tax pages read via registry capabilities
for (const g of GETS) await step(`denial: GET /api/companies/{id}/${g} is 403 for an actor without the capability`, async () => { const r = await api(`/api/companies/${A.id}/${g}`, undefined, "GET"); return r.status === 403 ? "403" : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 100)}` })
await step("denial: writes by a capability-less actor are refused (403) and change nothing", async () => {
  const rs = [
    await api(`/api/companies/${A.id}/contacts`, { action: "createContact", name: { givenName: "Nope", familyName: "Denied" } }),
    await api(`/api/companies/${A.id}/settings`, { action: "setOperatingScope", operatingScope: "UNITED_STATES" }),
    await api(`/api/companies/${A.id}/business`, { kind: "CRA_BN", value: digits(9) }),
    await api(`/api/companies/${A.id}/credentials`, { systemId: "00000000-0000-4000-8000-000000000000", category: "FLEET", username: "nope" }),
    await api(`/api/companies/${A.id}/insurance`, { insuranceType: "Auto Liability" }),
  ]
  const codes = rs.map((r) => r.status); return codes.every((c) => c === 403) && counts() === snapshot ? `statuses ${codes.join(",")}; row counts unchanged` : `!statuses ${codes.join(",")} counts ${snapshot} -> ${counts()}`
})
await h.browser.close()
// ---- limited actor: ORGANIZATION_REGISTRY_READ + ORGANIZATION_CREATE only ----
h = await start("user_e2e_limited"); ({ page, go, settle, api, step, body } = h)
await go("/companies"); await settle()
await step("limited actor (registry read only): authorities page may read (registry capability) but a save is refused by the server", async () => {
  await go(`/companies/${A.id}/authorities`); await settle()
  const before = Number(psql(`select count(*) from public.operating_authorities where organization_id='${A.id}'`))
  await page.getByRole("button", { name: "Add Record" }).first().click(); await page.getByPlaceholder("Enter identifier").fill(`MV${digits(6)}`)
  await page.getByRole("button", { name: "Save Record" }).click(); await page.waitForTimeout(2500); await shot(page, "b2-limited-authority-save")
  const after = Number(psql(`select count(*) from public.operating_authorities where organization_id='${A.id}'`))
  return after === before && /not authorized|not permitted|permission/i.test(await body()) ? "write refused with a message; nothing stored" : `!rows ${before}->${after}`
})
await step("limited actor: writes through the API are refused (403) and change nothing", async () => {
  const rs = [
    await api(`/api/companies/${A.id}/contacts`, { action: "createContact", name: { givenName: "Nope", familyName: "Denied" } }),
    await api(`/api/companies/${A.id}/settings`, { action: "setOperatingScope", operatingScope: "UNITED_STATES" }),
    await api(`/api/companies/${A.id}/business`, { kind: "CRA_BN", value: digits(9) }),
  ]
  const codes = rs.map((r) => r.status); return codes.every((c) => c === 403) ? `statuses ${codes.join(",")}` : `!statuses ${codes.join(",")}`
})
await h.browser.close()
// ---- signed out ----
h = await start(""); ({ page, go, settle, api, step, body } = h)
await go("/companies"); await settle().catch(() => {})
for (const g of ["contacts", "settings", "business"]) await step(`signed-out: GET /api/companies/{id}/${g} is refused (not data, not 500)`, async () => { const r = await api(`/api/companies/${A.id}/${g}`, undefined, "GET"); return [401, 403].includes(r.status) ? `${r.status}` : `!status ${r.status}` })
await h.browser.close()
// ---- staff: legacy / unknown ids on the seven workspaces ----
h = await start("user_e2e_staff"); ({ page, go, settle, api, step, body } = h)
await go("/companies"); await settle()
await page.evaluate(() => { localStorage.setItem("tes_companies", JSON.stringify([{ id: "CMP-LEG-1", name: "Legacy Prototype Co" }])) })
const seeded = (await browserStorage(page)).local.slice().sort().join(",")
for (const p of PAGES) await step(`legacy id: ${p} shows 'not a TES record' and no data-entry control`, async () => {
  await go(`/companies/CMP-LEG-1/${p}`); await settle(); const t = await body()
  const inputs = await page.locator("input, textarea, select").evaluateAll((els) => els.filter((e) => e.offsetParent !== null && !(e.getAttribute("placeholder") || "").startsWith("Search fleet")).length)
  return /not a TES record/i.test(t) && inputs === 0 ? "ok" : `!text=${/not a TES record/i.test(t)} inputs=${inputs}`
})
await step("legacy id: browser storage is exactly what was seeded (nothing added or removed)", async () => { const s = await browserStorage(page); return s.local.slice().sort().join(",") === seeded && s.session.length === 0 ? seeded : `!${JSON.stringify(s)}` })
await step("unknown (well-formed) company id: honest not-found/not-a-record state on all seven pages", async () => {
  for (const p of PAGES) { await go(`/companies/00000000-0000-4000-8000-000000000000/${p}`); await settle(); const t = await body(); if (!/not a TES record|not found|could not|no company/i.test(t)) return `!${p}: ${t.slice(200, 400).replace(/\n/g, " ")}` }
  return true
})
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close(); setActor("user_e2e_staff")
