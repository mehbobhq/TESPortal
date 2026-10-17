import { start, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import fs from "node:fs"
const h = await start()
const { page, go, settle, api, step, body, text } = h
const { A, B } = JSON.parse(fs.readFileSync("/tmp/tes-e2e/b2-ids.json", "utf8"))
const tag = digits(5)
const persons = (id) => Number(psql(`select count(*) from public.organization_person_relationships r where r.organization_id='${id}'`))
const dlg = () => page.locator("div").filter({ has: page.getByText("Add Contact Manually") }).filter({ has: page.getByRole("button", { name: "Save Contact" }) }).last()

// ---------------- CONTACTS ----------------
await step("contacts: loads the canonical register (creation contact) from PostgreSQL", async () => { await go(`/companies/${A.id}/contacts`); await settle(); const t = await body(); return /TES database \(PostgreSQL\)/.test(t) && /Pat/.test(t) })
await step("contacts: Cancel in Manual Add stores nothing", async () => {
  const before = persons(A.id); await page.getByRole("button", { name: "Manual Add" }).click()
  await dlg().locator("input[type=text]").nth(0).fill(`Cancel${tag}`); await dlg().getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600)
  return persons(A.id) === before && !(await body()).includes(`Cancel${tag}`)
})
await step("contacts: validation - missing last name is refused and nothing is saved", async () => {
  const before = persons(A.id); await page.getByRole("button", { name: "Manual Add" }).click()
  await dlg().locator("input[type=text]").nth(0).fill(`Solo${tag}`); await dlg().getByRole("button", { name: "Save Contact" }).click(); await page.waitForTimeout(1500)
  const still = await dlg().isVisible().catch(() => false); await shot(page, "b2-contacts-validation"); await page.keyboard.press("Escape").catch(() => {})
  await page.reload({ waitUntil: "domcontentloaded" }); await settle()
  return persons(A.id) === before && still
})
await step("contacts: a driver-licence/DOB entry (no canonical home) is refused, not silently dropped", async () => {
  const before = persons(A.id); await page.getByRole("button", { name: "Manual Add" }).click()
  await dlg().locator("input[type=text]").nth(0).fill(`Dob${tag}`); await dlg().locator("input[type=text]").nth(1).fill("Test"); await dlg().locator("input[type=email]").fill(`dob${tag}@example.test`)
  await dlg().locator("input[aria-label='Date of Birth']").fill("1980-01-01"); await dlg().getByRole("button", { name: "Save Contact" }).click(); await page.waitForTimeout(2000)
  const msg = await body(); const reason = /not available yet|refuse/i.test(msg); await shot(page, "b2-contacts-dob-refused"); await page.reload({ waitUntil: "domcontentloaded" }); await settle()
  return persons(A.id) === before && !(await body()).includes(`Dob${tag}`) && reason ? "refused; nothing stored" : "!persons or reason"
})
await step("contacts: Save Contact persists a canonical person + relationship (database + Master Register event)", async () => {
  const before = persons(A.id); const ev0 = Number(psql(`select count(*) from public.master_register_events`))
  await page.getByRole("button", { name: "Manual Add" }).click()
  await dlg().locator("input[type=text]").nth(0).fill(`Sam${tag}`); await dlg().locator("input[type=text]").nth(1).fill("Rivera")
  await dlg().locator("input[type=email]").fill(`sam${tag}@example.test`); await dlg().getByRole("button", { name: "Save Contact" }).click(); await page.waitForTimeout(3000)
  const after = persons(A.id); const ev1 = Number(psql(`select count(*) from public.master_register_events`)); await shot(page, "b2-contacts-saved")
  return after === before + 1 && ev1 > ev0 ? `relationships ${before}->${after}, events +${ev1 - ev0}` : false
})
await step("contacts: the saved contact survives a refresh", async () => { await page.reload({ waitUntil: "domcontentloaded" }); await settle(); return (await body()).includes(`Sam${tag}`) })
await step("contacts: company B does not list company A's contacts", async () => { await go(`/companies/${B.id}/contacts`); await settle(); return !(await body()).includes(`Sam${tag}`) })
await step("contacts: API createContact on B's URL with a body organizationId lands on B only", async () => {
  const a0 = persons(A.id), b0 = persons(B.id)
  const r = await api(`/api/companies/${B.id}/contacts`, { action: "createContact", organizationId: A.id, name: { givenName: `Leak${tag}`, familyName: "Test" } })
  return r.status < 300 && persons(A.id) === a0 && persons(B.id) === b0 + 1 ? `status ${r.status}; B +1, A unchanged` : `!status ${r.status} ${JSON.stringify(r.body).slice(0, 200)} A ${a0}->${persons(A.id)} B ${b0}->${persons(B.id)}`
})
await step("contacts: a relationship of company A cannot be ended through company B's URL", async () => {
  const relA = psql(`select id from public.organization_person_relationships where organization_id='${A.id}' and effective_to is null limit 1`)
  const before = psql(`select effective_to is null from public.organization_person_relationships where id='${relA}'`)
  const r = await api(`/api/companies/${B.id}/contacts`, { action: "endRelationship", relationshipId: relA })
  const after = psql(`select effective_to is null from public.organization_person_relationships where id='${relA}'`)
  return before === "t" && after === "t" && r.status >= 400 && r.status < 500 ? `refused (${r.status}); A's relationship still active` : `!status ${r.status} before=${before} after=${after} ${JSON.stringify(r.body).slice(0, 200)}`
})
const keys = tesKeys(await browserStorage(page)); record("contacts: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
console.log("page errors", page.errors.slice(0, 3)); await h.browser.close()
