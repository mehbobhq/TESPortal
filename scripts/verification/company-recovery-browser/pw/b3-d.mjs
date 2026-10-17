// Vehicles and Drivers: edit flows (unit number correction, archive/restore, driver profile edit, registration/licence relationships, hiring refusal).
import { start, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b3-ids.json", "utf8"))
const h = await start(); const { page, go, settle, api, step, body } = h
const q = (s) => Number(psql(s)); const ev = () => q(`select count(*) from public.master_register_events`)
const t = digits(5)
const saved = (fn, re) => Promise.all([page.waitForResponse((r) => re.test(r.url()) && r.request().method() !== "GET", { timeout: 30000 }), fn()]).then(([r]) => r.status())
// ---------- vehicle edit ----------
const rel = psql(`select id from public.organization_vehicle_relationships where organization_id='${A.id}' and effective_to is null and record_status='active' order by created_at limit 1`)
const unit0 = psql(`select unit_number_display from public.organization_vehicle_relationships where id='${rel}'`)
const vehicleId = psql(`select vehicle_id from public.organization_vehicle_relationships where id='${rel}'`)
const openVehicle = async () => { await go(`/companies/${A.id}/vehicles`); await settle(); await page.locator("tr", { hasText: unit0 }).first().click(); await page.waitForTimeout(1500) }
await step("vehicle edit: Cancel keeps the unit number", async () => {
  await openVehicle(); await page.getByRole("button", { name: "Edit" }).first().click(); await page.waitForTimeout(600)
  await page.locator("main input").nth(2).fill(`X${t}`); await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600)
  return psql(`select unit_number_display from public.organization_vehicle_relationships where id='${rel}'`) === unit0 && !(await body()).includes(`X${t}`)
})
const unit1 = `E${t}`
await step("vehicle edit: a changed unit number is saved as a correction (old row kept and flagged, new row current, Master Register events)", async () => {
  const e0 = ev(); await page.getByRole("button", { name: "Edit" }).first().click(); await page.waitForTimeout(600)
  await page.locator("main input").nth(2).fill(unit1); const code = await saved(() => page.getByRole("button", { name: "Save Vehicle" }).click(), /vehicles\/relationships/); await page.waitForTimeout(1200); await shot(page, "b3-vehicle-unit-corrected")
  const cur = psql(`select unit_number_display from public.organization_vehicle_relationships where organization_id='${A.id}' and vehicle_id='${vehicleId}' and record_status='active' and effective_to is null`)
  const old = psql(`select record_status from public.organization_vehicle_relationships where id='${rel}'`)
  return cur === unit1 && old === "corrected" && ev() >= e0 + 2 ? `current=${unit1}; previous row status=corrected; events +${ev() - e0}` : `!cur=${cur} old=${old}`
})
await step("vehicle edit: the new unit number survives a refresh", async () => { await go(`/companies/${A.id}/vehicles`); await settle(); return (await body()).includes(unit1) && !(await body()).includes(unit0) })
await step("vehicle edit: a unit number already used by another current vehicle is refused with a message; nothing changes", async () => {
  const other = await api(`/api/companies/${A.id}/vehicles`, { vehicleTypeCode: "TRAILER", relationshipType: "OPERATES", unitNumber: `O${t}`, effectiveFrom: "2024-01-01T00:00:00Z" })
  const before = psql(`select count(*) || ':' || max(unit_number_display) from public.organization_vehicle_relationships where organization_id='${A.id}' and record_status='active'`)
  const r = await api(`/api/companies/${A.id}/vehicles/relationships/${psql(`select id from public.organization_vehicle_relationships where organization_id='${A.id}' and unit_number_display='O${t}'`)}`, { action: "correct-unit", unitNumber: unit1 }, "PATCH")
  const after = psql(`select count(*) || ':' || max(unit_number_display) from public.organization_vehicle_relationships where organization_id='${A.id}' and record_status='active'`)
  return other.status === 201 && r.status === 409 && before === after ? `409 ${JSON.stringify(r.body).slice(0, 100)}; unchanged` : `!other ${other.status} correct ${r.status} ${JSON.stringify(r.body).slice(0, 140)} ${before} -> ${after}`
})
await step("vehicle: a vehicle that another company also has on its current record cannot be archived (409, message), and stays active", async () => {
  const shared = psql(`select vehicle_id from public.organization_vehicle_relationships where vehicle_id in (select vehicle_id from public.organization_vehicle_relationships where organization_id='${B.id}' and effective_to is null) and organization_id='${A.id}' and effective_to is null limit 1`)
  if (!shared) return "!no shared vehicle in this database"
  const r = await api(`/api/companies/${A.id}/vehicles/${shared}`, { action: "archive" }, "PATCH"); const st = psql(`select record_status from public.vehicles where id='${shared}'`)
  return r.status === 409 && st === "active" ? `409 ${JSON.stringify(r.body).slice(0, 110)}; still active` : `!status ${r.status} ${st}`
})
const solo = `AR${t}`
const soloVehicle = async () => psql(`select vehicle_id from public.organization_vehicle_relationships where organization_id='${A.id}' and unit_number_display='${solo}' limit 1`)
await step("vehicle: Archive through the UI keeps the record (status archived) and writes a Master Register event", async () => {
  const made = await api(`/api/companies/${A.id}/vehicles`, { vehicleTypeCode: "TRAILER", vin: `1HG${t}ARCHIVE00`.slice(0, 17), relationshipType: "OPERATES", unitNumber: solo, effectiveFrom: "2024-01-01T00:00:00Z" })
  if (made.status !== 201) return `!create ${made.status}`
  await go(`/companies/${A.id}/vehicles`); await settle(); await page.locator("tr", { hasText: solo }).first().click(); await page.waitForTimeout(1500)
  const e0 = ev(); const code = await saved(() => page.getByRole("button", { name: "Archive", exact: true }).first().click(), /vehicles\/[0-9a-f-]+$/); await page.waitForTimeout(800)
  const s2 = psql(`select record_status from public.vehicles where id='${await soloVehicle()}'`); await shot(page, "b3-vehicle-archived")
  return code === 200 && s2 === "archived" && ev() > e0 ? `status=archived; events +${ev() - e0}` : `!code ${code} status=${s2}`
})
await step("vehicle: the archived vehicle is reachable under the Archived filter", async () => {
  await go(`/companies/${A.id}/vehicles`); await settle(); await page.getByRole("button", { name: "Filters" }).click(); await page.waitForTimeout(500)
  const sel = page.locator("main select").first(); await sel.selectOption({ label: "Archived" }); await page.waitForTimeout(800); return (await body()).includes(solo) ? "listed under Archived" : "!not listed"
})
await step("vehicle: the archived vehicle is restored and is active again with its history intact", async () => {
  const vid = await soloVehicle(); const r = await api(`/api/companies/${A.id}/vehicles/${vid}`, { action: "restore" }, "PATCH"); const s2 = psql(`select record_status from public.vehicles where id='${vid}'`)
  const n = q(`select count(*) from public.organization_vehicle_relationships where vehicle_id='${vid}' and organization_id='${A.id}'`)
  return r.status === 200 && s2 === "active" && n === 1 ? "restored; relationship row kept" : `!status ${r.status} ${s2} rows ${n}`
})
// ---------- driver edit ----------
const lic = psql(`select licence_number_display from public.driver_licences where person_id in (select person_id from public.organization_driver_relationships where organization_id='${A.id}') order by created_at limit 1`)
const pid = psql(`select person_id from public.driver_licences where licence_number_display='${lic}' limit 1`)
const nm = () => psql(`select given_name || ' ' || family_name from public.person_name_versions where person_id='${pid}' and record_status='active' and effective_to is null limit 1`)
const openDriver = async () => { await go(`/companies/${A.id}/drivers/${pid}`); await settle() }
const name0 = nm()
await step("driver: the register row opens the driver detail page for the canonical person", async () => {
  await go(`/companies/${A.id}/drivers`); await settle(); await page.locator("td", { hasText: name0.split(" ")[0] }).first().click(); await page.waitForTimeout(2500); await settle()
  return page.url().includes(`/drivers/${pid}`) ? "navigated to the person's page" : `!url ${page.url()}`
})
await step("driver edit: Cancel keeps the name", async () => {
  await openDriver(); await page.getByRole("button", { name: "Edit Profile" }).click(); await page.waitForTimeout(600)
  await page.locator("main label").filter({ hasText: /^Legal Last Name/ }).first().locator("xpath=..").locator("input").fill(`Cx${t}`); await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600)
  return nm() === name0
})
await step("driver edit: a name correction is saved (wrong version kept and flagged, new version current, Master Register event)", async () => {
  const e0 = ev(); await page.getByRole("button", { name: "Edit Profile" }).click(); await page.waitForTimeout(600)
  const last = `Fixed${t}`; await page.locator("main label").filter({ hasText: /^Legal Last Name/ }).first().locator("xpath=..").locator("input").fill(last)
  const code = await saved(() => page.getByRole("button", { name: "Save Profile Changes" }).click(), /drivers\/[0-9a-f-]+$/).catch(() => "no-request"); await page.waitForTimeout(1500); await shot(page, "b3-driver-name-corrected")
  const rows = q(`select count(*) from public.person_name_versions where person_id='${pid}' and record_status='corrected'`)
  return nm().endsWith(last) && rows >= 1 && ev() > e0 ? `current=${nm()}; corrected rows=${rows}; events +${ev() - e0}` : `!name=${nm()} corrected=${rows}`
})
await step("driver edit: the corrected name survives a refresh", async () => { await openDriver(); return (await body()).includes(`Fixed${t}`) })
await step("driver edit: an unsupported field (date of birth) is refused and nothing changes", async () => {
  const before = nm(); const e0 = ev(); await page.getByRole("button", { name: "Edit Profile" }).click(); await page.waitForTimeout(600)
  await page.locator("main label").filter({ hasText: /^Date of Birth/ }).first().locator("xpath=..").locator("input").fill("1980-01-01")
  await page.getByRole("button", { name: "Save Profile Changes" }).click(); await page.waitForTimeout(2500); await shot(page, "b3-driver-dob-refused")
  return nm() === before && ev() === e0 && /not available|refus|no canonical/i.test(await body()) ? "refused; no change, no event" : `!${nm()} events ${ev() - e0}`
})
await step("driver licence relationship: a second licence in another jurisdiction coexists; same jurisdiction replaces with history (API)", async () => {
  const r1 = await api(`/api/companies/${A.id}/drivers/${pid}/licences`, { licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "AB", licenceNumber: `AB${digits(7)}`, effectiveFrom: "2024-03-01" } })
  const current = q(`select count(*) from public.driver_licences where person_id='${pid}' and record_status='active' and effective_to is null`)
  const r2 = await api(`/api/companies/${A.id}/drivers/${pid}/licences`, { licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "AB", licenceNumber: `AB${digits(7)}`, effectiveFrom: "2024-06-01" } })
  const cur2 = q(`select count(*) from public.driver_licences where person_id='${pid}' and record_status='active' and effective_to is null`); const ended = q(`select count(*) from public.driver_licences where person_id='${pid}' and jurisdiction_region='AB' and effective_to is not null`)
  return r1.status === 201 && r2.status === 201 && current === 2 && cur2 === 2 && ended === 1 ? `coexists (2 current), AB replaced with history (1 ended)` : `!${r1.status} ${r2.status} current=${current}/${cur2} ended=${ended} ${JSON.stringify(r2.body).slice(0, 100)}`
})
await step("driver licence relationship: a licence held by another driver is refused (409) and not attached to this person", async () => {
  const other = `OTH${digits(4)}-${digits(5)}-${digits(5)}`
  const seed = await api(`/api/companies/${B.id}/drivers`, { mode: "create", givenName: `Other${t}`, familyName: "Driver", email: `other${t}@example.test`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01", licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: other, effectiveFrom: "2024-02-01" } })
  if (seed.status !== 201) return `!seed ${seed.status}`
  const before = q(`select count(*) from public.driver_licences where person_id='${pid}'`)
  const r = await api(`/api/companies/${A.id}/drivers/${pid}/licences`, { licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: other, effectiveFrom: "2024-07-01" } })
  return r.status === 409 && q(`select count(*) from public.driver_licences where person_id='${pid}'`) === before ? "409; unchanged" : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`
})
await step("driver detail: the Qualifications tab shows the canonical licence", async () => {
  await openDriver(); await page.getByText("Qualifications & Licensing").first().click(); await page.waitForTimeout(1200); await shot(page, "b3-driver-qualifications")
  return /AB\d{7}|\(AB\)|ON/.test(await body()) ? "licence shown" : "!licence not shown"
})
await step("driver hiring: Send Application is refused (no canonical domain); no request reaches the driver-application endpoints", async () => {
  const hits = []; const on = (r) => { if (/driver-applications/.test(r.url())) hits.push(r.url()) }; page.on("request", on)
  await openDriver(); await page.getByRole("button", { name: "Send Application" }).first().click(); await page.waitForTimeout(1000)
  const email = page.locator("input[type=email]").last(); if (await email.isVisible().catch(() => false)) { await email.fill(`applicant${t}@example.test`); await page.getByRole("button", { name: /Create|Send|Save/ }).last().click().catch(() => {}); await page.waitForTimeout(1500) }
  page.off("request", on); await shot(page, "b3-driver-send-application")
  return hits.length === 0 ? `0 requests to /api/driver-applications; refusal text: ${/no canonical|not (yet )?(available|activated)|refus/i.test(await body())}` : `!${hits}`
})
await step("driver: archived/ended relationship keeps the person (end relationship via API keeps the history)", async () => {
  const rid = psql(`select id from public.organization_driver_relationships where organization_id='${A.id}' and person_id='${pid}' and effective_to is null limit 1`)
  const r = await api(`/api/companies/${A.id}/drivers/${pid}`, { action: "end-relationship", effectiveTo: "2024-12-31" }, "PATCH")
  const row = psql(`select status || ':' || (effective_to is not null) from public.organization_driver_relationships where id='${rid}'`); const person = q(`select count(*) from public.driver_profiles where person_id='${pid}'`)
  return r.status === 200 && /ENDED:true/.test(row) && person === 1 ? "relationship ENDED; person and history kept" : `!status ${r.status} ${row} ${JSON.stringify(r.body).slice(0, 120)}`
})
const keys = tesKeys(await browserStorage(page)); record("vehicle/driver edit: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
