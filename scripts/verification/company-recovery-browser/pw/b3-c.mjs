// Vehicles and Drivers: authorization denial, signed-out, legacy and unknown ids, driver-application containment.
import { start, record, shot, psql, digits, browserStorage, tesKeys, setActor } from "./b2-common.mjs"
import fs from "node:fs"
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b3-ids.json", "utf8"))
const tables = ["vehicles", "organization_vehicle_relationships", "vehicle_registration_periods", "driver_profiles", "organization_driver_relationships", "driver_licences", "master_register_events"]
const counts = () => tables.map((x) => psql(`select count(*) from public.${x}`)).join(",")
// ---- no capabilities ----
let h = await start("user_e2e_none"); let { page, go, settle, api, step, body } = h
await go("/companies"); await settle(); const snapshot = counts()
for (const p of ["vehicles", "drivers"]) await step(`denial: ${p} page shows 'not permitted' and none of the company's records`, async () => {
  await go(`/companies/${A.id}/${p}`); await settle(); const t = await body(); await shot(page, `b3-denied-${p}`)
  return /not permitted/i.test(t) && !/Dana\d{5}|U\d{6}/.test(t) ? "not permitted" : `!${t.slice(200, 420).replace(/\n/g, " ")}`
})
for (const g of ["vehicles", "vehicles/workspace", "drivers"]) await step(`denial: GET /api/companies/{id}/${g} is 403`, async () => { const r = await api(`/api/companies/${A.id}/${g}`, undefined, "GET"); return r.status === 403 ? "403" : `!status ${r.status}` })
await step("denial: vehicle and driver writes by a capability-less actor are 403 and change nothing", async () => {
  const vid = psql(`select vehicle_id from public.organization_vehicle_relationships where organization_id='${A.id}' limit 1`)
  const pid = psql(`select person_id from public.organization_driver_relationships where organization_id='${A.id}' limit 1`)
  const rs = [
    await api(`/api/companies/${A.id}/vehicles`, { vehicleTypeCode: "TRAILER", relationshipType: "OPERATES", effectiveFrom: "2024-01-01T00:00:00Z" }),
    await api(`/api/companies/${A.id}/vehicles/${vid}/registrations`, { registrationKind: "BASE", plate: "NOPE1", jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01" }),
    await api(`/api/companies/${A.id}/vehicles/${vid}`, { action: "archive" }, "PATCH"),
    await api(`/api/companies/${A.id}/drivers`, { mode: "create", givenName: "No", familyName: "Way", email: "no@example.test", relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01" }),
    await api(`/api/companies/${A.id}/drivers/${pid}`, { action: "change-name", givenName: "No", familyName: "Way" }, "PATCH"),
    await api(`/api/companies/${A.id}/drivers/check`, { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: "X1234" }),
  ]
  const codes = rs.map((r) => r.status); return codes.every((c) => c === 403) && counts() === snapshot ? `statuses ${codes.join(",")}; no row changed` : `!statuses ${codes.join(",")} counts ${snapshot} -> ${counts()}`
})
await h.browser.close()
// ---- read-only vehicle actor ----
h = await start("user_e2e_limited"); ({ page, go, settle, api, step, body } = h)
await go("/companies"); await settle()
await step("limited actor (registry read only): vehicle and driver data stay hidden (404/403), writes are 403", async () => {
  const g = [await api(`/api/companies/${A.id}/vehicles`, undefined, "GET"), await api(`/api/companies/${A.id}/drivers`, undefined, "GET")]
  const w = [await api(`/api/companies/${A.id}/vehicles`, { vehicleTypeCode: "TRAILER", relationshipType: "OPERATES", effectiveFrom: "2024-01-01T00:00:00Z" })]
  return g.every((r) => r.status === 403) && w.every((r) => r.status === 403) ? "403 on reads and writes" : `!reads ${g.map((r) => r.status)} writes ${w.map((r) => r.status)}`
})
await h.browser.close()
// ---- signed out ----
h = await start(""); ({ page, go, settle, api, step, body } = h)
await go("/companies"); await settle().catch(() => {})
for (const g of ["vehicles", "drivers"]) await step(`signed-out: GET /api/companies/{id}/${g} is refused`, async () => { const r = await api(`/api/companies/${A.id}/${g}`, undefined, "GET"); return [401, 403].includes(r.status) ? `${r.status}` : `!status ${r.status}` })
await h.browser.close()
// ---- staff: legacy and unknown ids ----
h = await start("user_e2e_staff"); ({ page, go, settle, api, step, body } = h)
await go("/companies"); await settle()
await page.evaluate(() => { localStorage.setItem("tes_companies", JSON.stringify([{ id: "CMP-LEG-1", name: "Legacy Prototype Co" }])); localStorage.setItem("tes_company_drivers_CMP-LEG-1", JSON.stringify({ drivers: [{ id: "legacy-1" }] })) })
const seeded = (await browserStorage(page)).local.slice().sort().join(",")
for (const p of ["vehicles", "drivers", "drivers/legacy-1"]) await step(`legacy id: ${p} shows 'not a TES record' and no data-entry control`, async () => {
  await go(`/companies/CMP-LEG-1/${p}`); await settle(); const t = await body()
  const inputs = await page.locator("input, textarea, select").evaluateAll((els) => els.filter((e) => e.offsetParent !== null && !(e.getAttribute("placeholder") || "").startsWith("Search fleet")).length)
  return /not a TES record/i.test(t) && inputs === 0 ? "ok" : `!text=${/not a TES record/i.test(t)} inputs=${inputs}`
})
await step("legacy id: browser storage is exactly what was seeded (the legacy driver store is not read or written)", async () => { const s = await browserStorage(page); return s.local.slice().sort().join(",") === seeded && s.session.length === 0 ? seeded : `!${JSON.stringify(s)}` })
await step("unknown (well-formed) company id: honest not-found state on Vehicles and Drivers", async () => { for (const p of ["vehicles", "drivers"]) { await go(`/companies/00000000-0000-4000-8000-000000000000/${p}`); await settle(); if (!/not a TES record|not found|could not/i.test(await body())) return `!${p}` } return true })
await step("driver detail for an unknown person id reports not found (no crash, no blank)", async () => { await go(`/companies/${A.id}/drivers/00000000-0000-4000-8000-000000000000`); await settle(); const t = await body(); return /not found|could not|no driver|not a TES/i.test(t) ? "reported" : `!${t.slice(200, 400).replace(/\n/g, " ")}` })
await step("driver-application containment is unchanged: submissions and send-invitation remain closed", async () => {
  const g = await api("/api/driver-applications/submissions", undefined, "GET"); const p = await api("/api/driver-applications/send-invitation", {})
  return [g.status, p.status].every((s) => [401, 403, 503, 400].includes(s)) && !JSON.stringify(g.body).includes("submissions\":[{") ? `GET ${g.status}, POST ${p.status} (as the containment tests expect for this actor)` : `!${g.status},${p.status}`
})
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close(); setActor("user_e2e_staff")
