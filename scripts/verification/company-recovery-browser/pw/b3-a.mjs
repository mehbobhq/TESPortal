// Vehicles workspace (restored over the canonical vehicle records): create, validation, duplicates, registration, isolation.
import { start, makeCompany, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text, submit } = h
const A = await makeCompany(h, "VehAlpha"); const B = await makeCompany(h, "VehBravo")
fs.writeFileSync("/tmp/tes-e2e/b3-ids.json", JSON.stringify({ A, B }))
const t = digits(6); const vinOf = (s) => `1HG${t}${s}`.padEnd(17, "0").slice(0, 17)
const VIN = vinOf("0001"); const UNIT = `U${t}`
const n = (org) => Number(psql(`select count(*) from public.organization_vehicle_relationships where organization_id='${org}'`))
const nv = () => Number(psql(`select count(*) from public.vehicles`))
const ev = () => Number(psql(`select count(*) from public.master_register_events`))
const dlg = () => page.locator("div").filter({ has: page.getByText("Create Vehicle", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Save Vehicle" }) }).last()
const open = async () => { if (!/\/vehicles$/.test(page.url())) { await go(`/companies/${A.id}/vehicles`); await settle() }; await page.getByRole("button", { name: "Add Vehicle" }).first().click(); await page.waitForTimeout(700) }
const fill = async (equipment, vin) => { const d = dlg(); const ins = d.locator("input:not([disabled])"); await ins.nth(0).fill(equipment); await ins.nth(1).fill(vin) }

await step("vehicles: loads the canonical (empty) register with the unavailable-fields notice", async () => { await go(`/companies/${A.id}/vehicles`); await settle(); return /No vehicles in this company/.test(await body()) })
await step("vehicles: Cancel stores nothing", async () => {
  const b = [n(A.id), nv()]; await open(); await fill("CANCEL-1", vinOf("0009")); await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600)
  return n(A.id) === b[0] && nv() === b[1] && !(await body()).includes("CANCEL-1")
})
await step("vehicles: validation - an empty form cannot be saved and nothing is stored", async () => {
  const b = [n(A.id), nv()]; await open(); const save = page.getByRole("button", { name: "Save Vehicle" })
  const disabled = await save.isDisabled(); if (!disabled) { await submit(() => save.click()) }
  await page.getByRole("button", { name: "Cancel" }).click().catch(() => {}); return n(A.id) === b[0] && nv() === b[1] ? `save disabled=${disabled}` : false
})
await step("vehicles: an invalid VIN is refused with a message (previously a generic 500) and nothing is stored", async () => {
  const b = [n(A.id), nv()]; await open(); await fill(`BAD-${t}`, "1HGIOQ00000000000"); await submit(() => page.getByRole("button", { name: "Save Vehicle" }).click())
  const msg = await body(); await shot(page, "b3-vehicle-invalid-vin"); await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return n(A.id) === b[0] && nv() === b[1] && /vin|not valid|invalid/i.test(msg) && !/Unable to create vehicle/.test(msg) ? "refused with a specific message" : "!rows or message"
})
await step("vehicles: a field with no canonical home (Color) is refused, not silently dropped", async () => {
  const b = [n(A.id), nv()]; await open(); await fill(`COLOR-${t}`, vinOf("0002"))
  await dlg().locator("input:not([disabled])").nth(5).fill("Red"); await submit(() => page.getByRole("button", { name: "Save Vehicle" }).click())
  await shot(page, "b3-vehicle-color-refused"); await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return n(A.id) === b[0] && nv() === b[1]
})
await step("vehicles: Save creates the vehicle and the company relationship (database + Master Register events)", async () => {
  const b = [n(A.id), nv(), ev()]; await open(); await fill(UNIT, VIN); await submit(() => page.getByRole("button", { name: "Save Vehicle" }).click(), true, () => page.getByRole("button", { name: "Save Vehicle" }).waitFor({ state: "hidden", timeout: 60000 }))
  await shot(page, "b3-vehicle-saved"); const a = [n(A.id), nv(), ev()]
  return a[0] === b[0] + 1 && a[1] === b[1] + 1 && a[2] >= b[2] + 2 ? `links ${b[0]}->${a[0]}, vehicles ${b[1]}->${a[1]}, events +${a[2] - b[2]}` : `!${b} -> ${a}`
})
await step("vehicles: the saved vehicle is listed and survives a refresh", async () => { await page.reload({ waitUntil: "domcontentloaded" }); await settle(); return (await body()).includes(UNIT) })
await step("vehicles: the same unit number is refused (409 message, not a 500) and no row is added", async () => {
  const b = [n(A.id), nv()]; await open(); await fill(UNIT, vinOf("0003")); await submit(() => page.getByRole("button", { name: "Save Vehicle" }).click())
  const msg = await body(); await shot(page, "b3-vehicle-dup-unit"); await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return n(A.id) === b[0] && nv() === b[1] && /unit number|already/i.test(msg) && !/Unable to create vehicle/.test(msg) ? "refused with a specific message" : "!rows or message"
})
await step("vehicles: the same VIN for the same company is refused and no row is added", async () => {
  const b = [n(A.id), nv()]; await open(); await fill(`DUP-${t}`, VIN); await submit(() => page.getByRole("button", { name: "Save Vehicle" }).click())
  const msg = await body(); await page.getByRole("button", { name: "Cancel" }).click().catch(() => {}); return n(A.id) === b[0] && nv() === b[1] && /already|current vehicle/i.test(msg) ? "refused" : "!"
})
const vid = () => psql(`select vehicle_id from public.organization_vehicle_relationships where organization_id='${A.id}' limit 1`)
await step("vehicles: a registration period is recorded against the company's vehicle (API) with a Master Register event", async () => {
  const e0 = ev(); const r = await api(`/api/companies/${A.id}/vehicles/${vid()}/registrations`, { registrationKind: "BASE", plate: `PL${t}`, registrationNumber: `RN${t}`, jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01" })
  const rows = Number(psql(`select count(*) from public.vehicle_registration_periods where vehicle_id='${vid()}'`))
  return r.status === 201 && rows === 1 && ev() > e0 ? `201; periods=1; events +${ev() - e0}` : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 120)} rows ${rows}`
})
await step("vehicles: the registration (plate, jurisdiction) appears on the vehicle's Registration tab after a refresh", async () => {
  await go(`/companies/${A.id}/vehicles`); await settle(); await page.getByText(UNIT).first().click(); await page.waitForTimeout(1500)
  await page.getByText("Registration", { exact: true }).nth(1).click().catch(async () => { await page.getByRole("tab", { name: "Registration" }).click() }); await page.waitForTimeout(1500)
  await shot(page, "b3-vehicle-registration-tab"); return (await body()).includes(`PL${t}`) ? "plate shown" : "!plate not shown"
})
await step("vehicles: a duplicate plate period in the same jurisdiction is refused (4xx) and not duplicated", async () => {
  const r = await api(`/api/companies/${A.id}/vehicles/${vid()}/registrations`, { registrationKind: "BASE", plate: `PL${t}`, registrationNumber: `RN${t}`, jurisdictionCountry: "CA", jurisdictionRegion: "ON", effectiveFrom: "2024-01-01" })
  const rows = Number(psql(`select count(*) from public.vehicle_registration_periods where vehicle_id='${vid()}'`))
  return r.status >= 400 && r.status < 500 && rows === 1 ? `refused (${r.status})` : `!status ${r.status} rows ${rows}`
})
await step("vehicles: company B does not see company A's vehicle", async () => { await go(`/companies/${B.id}/vehicles`); await settle(); return !(await body()).includes(UNIT) })
await step("vehicles: company A's registration cannot be read or changed through company B's URL", async () => {
  const rid = psql(`select id from public.vehicle_registration_periods where vehicle_id='${vid()}' limit 1`)
  const r = await api(`/api/companies/${B.id}/vehicles/registrations/${rid}`, { action: "void" }, "PATCH"); const r2 = await api(`/api/companies/${B.id}/vehicles/${vid()}`, { action: "archive" }, "PATCH")
  const still = psql(`select record_status from public.vehicle_registration_periods where id='${rid}'`)
  return [r.status, r2.status].every((s) => s >= 400 && s < 500) && still === "active" ? `refused (${r.status},${r2.status}); registration still active` : `!${r.status},${r2.status} ${still}`
})
await step("vehicles: the same VIN created for company B links B to the SAME vehicle identity (documented behavior)", async () => {
  const before = nv(); const r = await api(`/api/companies/${B.id}/vehicles`, { vehicleTypeCode: "TRUCK_TRACTOR", vin: VIN, relationshipType: "OPERATES", unitNumber: `B${t}`, effectiveFrom: "2024-01-01T00:00:00Z" })
  return r.status === 201 && r.body.vehicle.kind === "EXISTING" && nv() === before ? "kind=EXISTING; no second vehicle; B has its own relationship" : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`
})
await step("vehicles: after that, company B still cannot see company A's registration periods", async () => {
  const r = await api(`/api/companies/${B.id}/vehicles/workspace`, undefined, "GET"); const s = JSON.stringify(r.body)
  return r.status === 200 && !s.includes(`PL${t}`) && !s.includes(`RN${t}`) ? "A's plate/registration absent from B's workspace" : `!status ${r.status} leaked=${s.includes(`PL${t}`)}`
})
const keys = tesKeys(await browserStorage(page)); record("vehicles: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
