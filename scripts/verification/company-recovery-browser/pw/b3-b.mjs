// Drivers workspace (restored over the canonical driver records): create (atomic), licence, relationships, duplicates, isolation.
import { start, makeCompany, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text, submit } = h
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b3-ids.json", "utf8"))
const t = digits(5); const FIRST = `Dana${t}`; const LICENCE = `D${digits(4)}-${digits(5)}-${digits(5)}`
const q = (sql) => Number(psql(sql))
const persons = () => q(`select count(*) from public.driver_profiles`)
const rels = (org) => q(`select count(*) from public.organization_driver_relationships where organization_id='${org}'`)
const lics = () => q(`select count(*) from public.driver_licences`)
const ev = () => q(`select count(*) from public.master_register_events`)
const snap = (org) => [persons(), rels(org), lics()].join("/")
const dlg = () => page.locator("div").filter({ has: page.getByText("Add Driver", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Save Driver" }) }).last()
const open = async () => { if (!page.url().endsWith(`/companies/${A.id}/drivers`)) { await go(`/companies/${A.id}/drivers`); await settle() }; await page.getByRole("button", { name: "Add Driver" }).first().click(); await page.waitForTimeout(800) }
const field = (label) => dlg().locator("label").filter({ hasText: new RegExp("^" + label) }).first().locator("xpath=..").locator("input, select").first()
async function fillForm({ address = false, first = FIRST, last = "Rivera", phone = "+1 416 555 0142", email = `dana${t}@example.test`, licence = LICENCE, start = "2024-02-01", extra = {} } = {}) {
  await field("First Name").fill(first); await field("Last Name").fill(last); await field("Phone").fill(phone); await field("Email").fill(email)
  await field("Record Type").selectOption({ label: "Employee" }); await field("Driver Status").selectOption({ label: "Active" })
  await field("Relationship Start").fill(start)
  if (address) { await field("Address \\*").fill("1 King St"); await field("Country \\*").selectOption({ label: "Canada" }) }
  if (licence) { await field("Issuing Country").selectOption({ label: "Canada" }); await field("Issuing Jurisdiction").selectOption({ label: "ON" }); await field("Licence Number").fill(licence); await field("Licence Effective From").fill(start) }
  for (const [label, value] of Object.entries(extra)) await field(label).fill(value)
}
const check = async () => { await dlg().getByRole("button", { name: "Check for Existing Driver" }).click(); await page.waitForTimeout(2500) }
const save = async (strict = false) => { await check(); await submit(() => dlg().getByRole("button", { name: "Save Driver" }).click({ timeout: 8000 }), strict, strict ? () => page.waitForURL(/\/drivers\/[0-9a-f-]{36}/, { timeout: 60000 }) : null) }

await step("drivers: loads the canonical (empty) register", async () => { await go(`/companies/${A.id}/drivers`); await settle(); return /Driver Records/.test(await body()) })
await step("drivers: Invite Applicant only shows a note: no request to the driver-application endpoints (containment preserved)", async () => {
  const hits = []; const on = (r) => { if (/driver-applications/.test(r.url())) hits.push(r.url()) }; page.on("request", on)
  await page.getByRole("button", { name: "Invite Applicant" }).click(); await page.waitForTimeout(1500); page.off("request", on)
  const note = /deferred|not (yet )?(available|activated)|no canonical/i.test(await body()); await shot(page, "b3-driver-invite-note")
  return hits.length === 0 && note ? "note shown; 0 requests to /api/driver-applications" : `!requests=${hits.length} note=${note}`
})
await step("drivers: Cancel stores nothing", async () => { const b = snap(A.id); await open(); await fillForm({ first: "CancelMe" }); await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600); return snap(A.id) === b && !(await body()).includes("CancelMe") })
await step("drivers: validation - required fields missing keeps Save disabled; nothing stored", async () => {
  const b = snap(A.id); await open(); const s = dlg().getByRole("button", { name: "Save Driver" }); const d = await s.isDisabled(); await page.getByRole("button", { name: "Cancel" }).click(); return d && snap(A.id) === b ? "Save disabled" : `!disabled=${d}`
})
await step("drivers: a field with no canonical home (Middle Name) is refused and nothing is stored (atomic)", async () => {
  const b = snap(A.id); await open(); await fillForm({ first: `Mid${t}`, licence: `M${digits(4)}-${digits(5)}-${digits(5)}`, extra: { "Middle Name": "Quinn" } }); await save(); await shot(page, "b3-driver-middle-refused")
  const ok = snap(A.id) === b; await page.getByRole("button", { name: "Cancel" }).click().catch(() => {}); return ok ? "refused; person/relationship/licence all unchanged" : `!${b} -> ${snap(A.id)}`
})
await step("drivers: the address fields are disabled, labelled 'not available yet' and not marked required", async () => {
  await open(); const labels = await dlg().locator("label").allTextContents()
  const addr = labels.filter((l) => /^(Address|City|Country|State|Postal)/.test(l.trim()) && !/^Issuing/.test(l.trim()))
  const disabledAll = await dlg().locator("label").filter({ hasText: /^(Address|City|Country \(|State|Postal)/ }).evaluateAll((els) => els.map((l) => l.parentElement.querySelector("input,select")).every((c) => c && c.disabled))
  await shot(page, "b3-driver-address-unavailable"); await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return addr.length >= 6 && addr.every((l) => /not available yet/.test(l) && !l.includes("*")) && disabledAll ? `${addr.length} address fields: disabled, "not available yet", no required marker` : `!${JSON.stringify(addr)} disabled=${disabledAll}`
})
await step("drivers: the server still rejects an address in a create request and stores nothing", async () => {
  const b = snap(A.id); const r = await api(`/api/companies/${A.id}/drivers`, { mode: "create", givenName: "Addr", familyName: "Refused", email: `addr${t}@example.test`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01", address: { line1: "1 King St" } })
  return r.status === 400 && /address/.test(JSON.stringify(r.body)) && snap(A.id) === b ? `400 ${JSON.stringify(r.body)}; nothing stored` : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`
})
await step("drivers: Save creates person + driver profile + licence + company relationship atomically, with Master Register events", async () => {
  const b = [persons(), rels(A.id), lics(), ev()]; await open(); await fillForm(); await save(true); await shot(page, "b3-driver-saved")
  const a = [persons(), rels(A.id), lics(), ev()]
  return a[0] === b[0] + 1 && a[1] === b[1] + 1 && a[2] === b[2] + 1 && a[3] >= b[3] + 3 ? `profiles ${b[0]}->${a[0]}, relationships ${b[1]}->${a[1]}, licences ${b[2]}->${a[2]}, events +${a[3] - b[3]}` : `!${b} -> ${a}`
})
await step("drivers: the driver is listed after a refresh", async () => { await go(`/companies/${A.id}/drivers`); await settle(); return (await body()).includes(FIRST) })
await step("drivers: the person, licence and relationship are linked to the same person id", async () => {
  const pid = psql(`select person_id from public.driver_licences where licence_number_normalized = upper(regexp_replace('${LICENCE}','[^A-Za-z0-9]','','g')) limit 1`)
  const r = q(`select count(*) from public.organization_driver_relationships where person_id='${pid}' and organization_id='${A.id}'`); const p = q(`select count(*) from public.driver_profiles where person_id='${pid}'`)
  const name = psql(`select given_name from public.person_name_versions where person_id='${pid}' and effective_to is null limit 1`)
  return pid && r === 1 && p === 1 && name === FIRST ? `person ${pid.slice(0, 8)}: profile=1 relationship=1 licence=1 name=${name}` : `!pid=${pid} rel=${r} prof=${p} name=${name}`
})
await step("drivers: the same licence on a second create is refused (conflict) and no second person is created", async () => {
  const b = snap(A.id); await open(); await fillForm({ first: `Copy${t}`, email: `copy${t}@example.test` }); await save(); await shot(page, "b3-driver-dup-licence")
  const msg = await body(); const ok = snap(A.id) === b; await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return ok && /already|existing|identif/i.test(msg) ? "refused with an existing-driver message" : `!${b} -> ${snap(A.id)}`
})
await step("drivers: the driver detail page opens and shows the canonical licence", async () => {
  await go(`/companies/${A.id}/drivers`); await settle(); await page.getByText(FIRST).first().click(); await page.waitForTimeout(2500); await settle(); await shot(page, "b3-driver-detail")
  const t2 = await body(); return t2.includes(FIRST) && /Licen[cs]e|ON/i.test(t2) ? "opened" : "!detail missing"
})
await step("drivers: company B does not list company A's driver", async () => { await go(`/companies/${B.id}/drivers`); await settle(); return !(await body()).includes(FIRST) })
await step("drivers: the existing-driver check from company B reveals only that the licence is registered (no id, name or detail)", async () => {
  const pid = psql(`select person_id from public.driver_licences where licence_number_normalized = upper(regexp_replace('${LICENCE}','[^A-Za-z0-9]','','g')) limit 1`)
  const r = await api(`/api/companies/${B.id}/drivers/check`, { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: LICENCE })
  const txt = JSON.stringify(r.body)
  return r.status === 200 && txt === JSON.stringify({ match: { found: true, scope: "OTHER_ORGANIZATION" } }) && !txt.includes(pid) && !txt.includes(FIRST) ? txt : `!status ${r.status} ${txt.slice(0, 160)}`
})
await step("drivers: the Add Driver form of company B shows 'registered elsewhere' with no driver detail, and cannot save or link", async () => {
  const bRels = rels(B.id), people = persons(); const pid = psql(`select person_id from public.driver_licences where licence_number_normalized = upper(regexp_replace('${LICENCE}','[^A-Za-z0-9]','','g')) limit 1`)
  await go(`/companies/${B.id}/drivers`); await settle(); await page.getByRole("button", { name: "Add Driver" }).first().click(); await page.waitForTimeout(800)
  await fillForm({ first: `Probe${t}`, email: `probe${t}@example.test`, licence: LICENCE }); await check()
  const panel = await page.locator("[data-testid=licence-registered-elsewhere]").isVisible().catch(() => false); const txt = await body()
  const saveDisabled = await dlg().getByRole("button", { name: "Save Driver" }).isDisabled(); await shot(page, "b3-driver-registered-elsewhere")
  await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return panel && saveDisabled && !txt.includes(FIRST) && !txt.includes(pid) && !/same person/i.test(txt) && rels(B.id) === bRels && persons() === people ? "panel shown; Save disabled; no name/id; no 'same person' link; nothing stored" : `!panel=${panel} saveDisabled=${saveDisabled} leakedName=${txt.includes(FIRST)} leakedId=${txt.includes(pid)}`
})
await step("drivers: the same-company existing-driver check still shows the company's own driver", async () => {
  await open(); await fillForm({ first: `Again${t}`, email: `again${t}@example.test`, licence: LICENCE }); await check()
  const txt = await body(); await page.getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return txt.includes(FIRST) && /already has a Driver with this licence/i.test(txt) ? "own driver shown (name and id), with the already-active note" : `!${txt.slice(-300).replace(/\n/g, " ")}`
})
await step("drivers: company A's driver cannot be read or changed through company B's URL (404)", async () => {
  const pid = psql(`select person_id from public.driver_licences where licence_number_normalized = upper(regexp_replace('${LICENCE}','[^A-Za-z0-9]','','g')) limit 1`)
  const g = await api(`/api/companies/${B.id}/drivers/${pid}`, undefined, "GET"); const p = await api(`/api/companies/${B.id}/drivers/${pid}`, { action: "change-name", givenName: "Hacked", familyName: "Name" }, "PATCH")
  const name = psql(`select given_name from public.person_name_versions where person_id='${pid}' and effective_to is null limit 1`)
  return g.status === 404 && p.status >= 400 && p.status < 500 && name === FIRST ? `GET ${g.status}, PATCH ${p.status}; name unchanged` : `!GET ${g.status} PATCH ${p.status} name=${name}`
})
await step("drivers: a licence conflict through the API (same licence, new person) is a 409 and leaves everything unchanged", async () => {
  const b = snap(A.id); const r = await api(`/api/companies/${A.id}/drivers`, { mode: "create", givenName: "Eve", familyName: "Copy", email: `eve${t}@example.test`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01", licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: LICENCE, effectiveFrom: "2024-02-01" } })
  return r.status === 409 && snap(A.id) === b ? "409; unchanged" : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 120)} ${b} -> ${snap(A.id)}`
})
await step("drivers: a body organizationId cannot redirect the write", async () => {
  const a0 = rels(A.id), b0 = rels(B.id); const r = await api(`/api/companies/${B.id}/drivers`, { mode: "create", organizationId: A.id, givenName: "Leak", familyName: "Test", email: `leak${t}@example.test`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01" })
  return r.status === 201 && rels(A.id) === a0 && rels(B.id) === b0 + 1 ? "201 but the URL company wins: relationship created for B only, A unchanged (body organizationId silently overridden)" : `!status ${r.status} A ${a0}->${rels(A.id)} B ${b0}->${rels(B.id)}`
})
await step("drivers: an invalid licence block (expiry before issue) fails the whole create: no person, profile or relationship remains", async () => {
  const b = snap(A.id); const r = await api(`/api/companies/${A.id}/drivers`, { mode: "create", givenName: "Zed", familyName: "Atomic", email: `zed${t}@example.test`, relationshipType: "EMPLOYEE", status: "ACTIVE", effectiveFrom: "2024-02-01", licence: { jurisdictionCountry: "Canada", jurisdictionRegion: "ON", licenceNumber: `Z${digits(4)}-${digits(5)}-${digits(5)}`, issueDate: "2024-01-01", expiryDate: "2020-01-01", effectiveFrom: "2024-02-01" } })
  return r.status >= 400 && r.status < 500 && snap(A.id) === b ? `${r.status}; unchanged` : `!status ${r.status} ${b} -> ${snap(A.id)}`
})
const keys = tesKeys(await browserStorage(page)); record("drivers: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
