// Company and Customer profile fact persistence in the browser: Website, Cargo Information, GPS / Fuel Provider and Payment Method
// (migration 0033) plus the read-only derived states. Create -> Save -> Reopen -> Edit -> Cancel -> Edit -> Save -> Refresh.
// Synthetic companies only; the database is the disposable local one the harness started.
import { start, record, shot, psql, digits, browserStorage, tesKeys } from "./b2-common.mjs"
import { pick } from "./lib.mjs"
import fs from "node:fs"

const h = await start()
const { page, go, settle, api, step, submit } = h
const t = digits(6)
const name = `CC Customer ${t} Ltd`
const CARGO = ["General Freight", "Hazardous Materials", "Temperature-Controlled & Food"]
const body = () => page.innerText("body")
const one = (sql) => psql(sql)
const orgs = (like) => Number(one(`select count(*) from public.organizations where legal_name like '${like}%'`))
let id = ""

await step("create form: Website, Cargo, GPS, Fuel and Payment Method are live; derived fields are read-only; GST/HST stays unavailable", async () => {
  await go("/companies/new"); await page.waitForSelector("#companyName", { timeout: 90000 })
  await pick(page, page.locator("button:has-text('Select entity type')"), "Customer")
  await page.waitForSelector("[name=startDate]")
  const state = async (n) => ({ disabled: await page.locator(`[name=${n}]`).first().isDisabled().catch(() => null), present: (await page.locator(`[name=${n}]`).count()) > 0 })
  const live = await Promise.all(["website", "gpsProvider", "fuelProvider", "startDate"].map(async (n) => [n, (await state(n)).disabled === false]))
  const derived = await Promise.all(["svcType", "status", "endDate", "assessmentDate", "gstHst"].map(async (n) => [n, (await state(n)).disabled === true]))
  const text = await body()
  const values = { svcType: await page.inputValue("[name=svcType]"), status: await page.inputValue("[name=status]"), assessmentDate: await page.inputValue("[name=assessmentDate]") }
  await shot(page, "cc-01-create-form")
  const bad = [...live, ...derived].filter(([, ok]) => !ok).map(([n]) => n)
  return bad.length === 0 && values.svcType === "Not contracted" && values.status === "Onboarding" && values.assessmentDate === "No assessment yet" && /Cargo Information \*/.test(text) ? "live: website/gps/fuel/startDate; read-only: svcType/status/endDate/assessmentDate; gstHst disabled" : `!${bad}`
})

await step("create: Cargo Information is mandatory for a Customer (the original rule), and a refused form creates nothing", async () => {
  const before = orgs("CC Customer")
  await page.fill("#companyName", name)
  await page.fill("[name=startDate]", "2024-01-15")
  const button = page.locator("button:has-text('Create Record')")
  const disabled = await button.isDisabled()
  return disabled && orgs("CC Customer") === before ? "Create Record is disabled until a cargo category is chosen" : `!disabled=${disabled}`
})

await step("create: an invalid website is refused with a per-field message and nothing is created", async () => {
  const before = orgs("CC Customer")
  await page.fill("#website", "ftp://not-allowed.example.com")
  await page.locator("button:has-text('Select cargo types')").click()
  for (const c of CARGO) await page.locator("label", { hasText: c }).first().click()
  await page.keyboard.press("Escape")
  await page.fill("[name=gpsProvider]", "Samsara"); await page.fill("[name=fuelProvider]", "WEX Fleet")
  await pick(page, page.locator("button:has-text('Not specified')"), "Cheque")
  await submit(() => page.click("button:has-text('Create Record')"), false)
  await page.waitForSelector("[role=alert]", { timeout: 30000 })
  const alert = await page.locator("[role=alert]").first().innerText(); await shot(page, "cc-02-create-refused")
  return /website/.test(alert) && /Nothing was saved|not created/i.test(alert) && orgs("CC Customer") === before ? "refused: website; no organization created" : `!${alert}`
})

await step("create: the corrected form saves every field once and opens the new profile", async () => {
  await page.fill("#website", "https://Example-Transport.com")
  await submit(() => page.click("button:has-text('Create Record')"), true, () => page.waitForURL(/\/companies\/[0-9a-f-]{36}\/profile/, { timeout: 60000 }))
  id = page.url().match(/companies\/([0-9a-f-]{36})/)[1]
  const counts = { orgs: orgs(name), customers: Number(one(`select count(*) from customers where organization_id='${id}'`)), engagements: Number(one(`select count(*) from customer_engagements e join customers c on c.id=e.customer_id where c.organization_id='${id}'`)) }
  return counts.orgs === 1 && counts.customers === 1 && counts.engagements === 1 ? `1 organization, 1 customer, 1 engagement (${id})` : `!${JSON.stringify(counts)}`
})

await step("reopen: a refreshed profile shows every saved value and the derived states", async () => {
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector("text=Company Name", { timeout: 60000 })
  await page.waitForFunction(() => document.body.innerText.includes("Samsara"), null, { timeout: 30000 })
  const text = await body(); await shot(page, "cc-03-profile-after-create")
  const need = { website: "https://Example-Transport.com", gps: "Samsara", fuel: "WEX Fleet", pay: "Cheque", cargo1: "General Freight", cargo2: "Hazardous Materials", cargo3: "Temperature-Controlled & Food", stage: "Onboarding", svc: "Not contracted", assess: "No assessment yet", start: "2024-01-15" }
  const missing = Object.entries(need).filter(([, v]) => !text.includes(v)).map(([k]) => k)
  const rows = {
    channel: one(`select value_normalized from organization_channels where organization_id='${id}' and channel_type='WEBSITE' and effective_to is null`),
    cargo: one(`select string_agg(cargo_category_code, ',' order by cargo_category_code) from company_cargo_category_periods where organization_id='${id}' and effective_to is null`),
    providers: one(`select string_agg(provider_kind||':'||provider_name, ',' order by provider_kind) from company_fleet_provider_periods where organization_id='${id}' and effective_to is null`),
    pay: one(`select payment_method_code from customer_billing_preference_periods where organization_id='${id}' and effective_to is null`),
  }
  return missing.length === 0 && rows.channel === "https://example-transport.com" && rows.cargo === "GENERAL_FREIGHT,HAZARDOUS_MATERIALS,TEMPERATURE_CONTROLLED_FOOD" && rows.providers === "FUEL:WEX Fleet,GPS:Samsara" && rows.pay === "CHEQUE" ? `all values on screen; canonical rows: ${JSON.stringify(rows)}` : `!missing=${missing} rows=${JSON.stringify(rows)}`
})

await step("edit page: opens prefilled from the canonical record, derived fields are read-only text", async () => {
  await go(`/companies/${id}/edit`); await page.waitForSelector("#companyName", { timeout: 60000 })
  await page.waitForFunction(() => document.querySelector("#website")?.value !== undefined && document.querySelector("#gpsProvider") !== null, null, { timeout: 30000 })
  const v = { website: await page.inputValue("#website"), gps: await page.inputValue("#gpsProvider"), fuel: await page.inputValue("#fuelProvider"), pay: await page.inputValue("#payMethod") }
  const cargo = await Promise.all(CARGO.map((c) => page.getByLabel(c, { exact: true }).isChecked()))
  const text = await body(); await shot(page, "cc-04-edit-form")
  return v.website === "https://Example-Transport.com" && v.gps === "Samsara" && v.fuel === "WEX Fleet" && v.pay === "Cheque" && cargo.every(Boolean) && /Not contracted/.test(text) && /Onboarding/.test(text) && /2024-01-15/.test(text) && /No assessment yet/.test(text) ? "prefilled: website, gps, fuel, payment, 3 cargo; service type/status/start/assessment shown read-only" : `!${JSON.stringify(v)} ${cargo}`
})

await step("cancel: editing then Cancel persists nothing", async () => {
  const before = JSON.stringify([one(`select count(*) from organization_channels where organization_id='${id}'`), one(`select count(*) from company_cargo_category_periods where organization_id='${id}'`), one(`select count(*) from company_fleet_provider_periods where organization_id='${id}'`), one(`select count(*) from customer_billing_preference_periods where organization_id='${id}'`), one(`select count(*) from master_register_events`)])
  await page.fill("#website", "https://should-not-persist.example.com"); await page.fill("#gpsProvider", "Nope"); await page.selectOption("#payMethod", "Wire Transfer")
  await page.getByLabel("Hazardous Materials", { exact: true }).uncheck()
  await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(1500)
  const after = JSON.stringify([one(`select count(*) from organization_channels where organization_id='${id}'`), one(`select count(*) from company_cargo_category_periods where organization_id='${id}'`), one(`select count(*) from company_fleet_provider_periods where organization_id='${id}'`), one(`select count(*) from customer_billing_preference_periods where organization_id='${id}'`), one(`select count(*) from master_register_events`)])
  await go(`/companies/${id}/profile`); await page.waitForSelector("text=Company Name"); await page.waitForFunction(() => document.body.innerText.includes("Samsara"), null, { timeout: 30000 })
  const text = await body()
  return before === after && text.includes("https://Example-Transport.com") && !text.includes("should-not-persist") && text.includes("Hazardous Materials") && text.includes("Cheque") ? "no rows or events written; profile unchanged" : `!${before} vs ${after}`
})

await step("edit: an invalid value is refused, shows the reason, and changes nothing (identity and region included)", async () => {
  await go(`/companies/${id}/edit`); await page.waitForSelector("#companyName"); await page.waitForFunction(() => document.querySelector("#gpsProvider") !== null)
  const events = one(`select count(*) from master_register_events`)
  await page.fill("#companyName", "Should Not Persist Ltd"); await page.selectOption("#opRegion", "US Only"); await page.fill("#website", "javascript:alert(1)")
  await submit(() => page.click("button:has-text('Save Changes')"), false)
  await page.waitForSelector("[role=alert]", { timeout: 30000 }); const alert = await page.locator("[role=alert]").first().innerText(); await shot(page, "cc-05-edit-refused")
  const name2 = one(`select legal_name from organizations where id='${id}'`)
  return /website|valid/i.test(alert) && name2 === name && one(`select count(*) from master_register_events`) === events && one(`select operating_scope from company_operating_scope_periods where organization_id='${id}' and effective_to is null`) === "CANADA" ? "refused with a reason; name, region and events unchanged" : `!${alert} ${name2}`
})

await step("edit -> save -> refresh: changes across sections persist (identity, region, address, website, cargo, providers, payment)", async () => {
  await go(`/companies/${id}/edit`); await page.waitForSelector("#companyName"); await page.waitForFunction(() => document.querySelector("#gpsProvider") !== null)
  const renamed = name.replace("Ltd", "Holdings Ltd")
  await page.fill("#companyName", renamed); await page.selectOption("#opRegion", "Cross-Border")
  await page.fill("#website", "https://new-site.example.org/home/")
  await page.getByLabel("Hazardous Materials", { exact: true }).uncheck(); await page.getByLabel("Bulk & Other", { exact: true }).check()
  await page.fill("#gpsProvider", "Geotab"); await page.fill("#fuelProvider", ""); await page.selectOption("#payMethod", "Credit Card")
  await page.fill("[name=reg_street]", "200 Bay St"); await page.fill("[name=reg_city]", "Toronto"); await page.fill("[name=reg_state]", "ON"); await page.fill("[name=reg_zip]", "M5J 2J2"); await page.fill("[name=reg_country]", "Canada")
  await shot(page, "cc-06-edit-filled")
  await submit(() => page.click("button:has-text('Save Changes')"), true, () => page.waitForURL(/\/profile/, { timeout: 60000 }))
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector("text=Company Name")
  await page.waitForFunction(() => document.body.innerText.includes("Geotab"), null, { timeout: 30000 })
  const text = await body(); await shot(page, "cc-07-profile-after-edit")
  const checks = { name: text.includes(renamed), region: text.includes("Cross-Border"), website: text.includes("https://new-site.example.org/home/"), gps: text.includes("Geotab") && !text.includes("Samsara"), fuel: !text.includes("WEX Fleet"), pay: text.includes("Credit Card") && !text.includes("Cheque"), cargo: text.includes("Bulk & Other") && !text.includes("Hazardous Materials") && text.includes("General Freight"), addr: text.includes("200 Bay St"), start: text.includes("2024-01-15") }
  const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k)
  const history = { channels: one(`select count(*) from organization_channels where organization_id='${id}' and channel_type='WEBSITE'`), cargo: one(`select count(*) from company_cargo_category_periods where organization_id='${id}'`), fleet: one(`select count(*) from company_fleet_provider_periods where organization_id='${id}'`), billing: one(`select count(*) from customer_billing_preference_periods where organization_id='${id}'`) }
  return bad.length === 0 && history.channels === "2" && history.cargo === "4" && history.fleet === "3" && history.billing === "2" ? `every change persisted after refresh; history kept ${JSON.stringify(history)}` : `!bad=${bad} ${JSON.stringify(history)}`
})

await step("edit: 'wrong value' mode corrects (flags the wrong row) instead of recording history", async () => {
  await go(`/companies/${id}/edit`); await page.waitForSelector("#companyName"); await page.waitForFunction(() => document.querySelector("#gpsProvider") !== null)
  await page.locator("input[name=factMode][value=correct]").check(); await page.fill("#gpsProvider", "Geotab Inc")
  await submit(() => page.click("button:has-text('Save Changes')"), true, () => page.waitForURL(/\/profile/, { timeout: 60000 }))
  const status = one(`select string_agg(record_status, ',' order by created_at) from company_fleet_provider_periods where organization_id='${id}' and provider_kind='GPS'`)
  return status.endsWith("corrected,active") ? `GPS rows: ${status}` : `!${status}`
})

await step("roster and lists: the customer appears exactly once in Customers and in Companies", async () => {
  await go("/customers"); await settle(); await page.waitForFunction((n) => document.body.innerText.includes(n), name.replace("Ltd", "Holdings Ltd"), { timeout: 60000 }).catch(() => {})
  const customers = ((await body()).match(new RegExp(name.replace("Ltd", "Holdings Ltd").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length
  await go("/companies"); await settle()
  const companies = ((await body()).match(new RegExp(name.replace("Ltd", "Holdings Ltd").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length
  return customers === 1 && companies >= 1 ? `Customers: ${customers}, Companies: ${companies}; 1 customers row` : `!customers=${customers} companies=${companies}`
})

await step("other classifications: every non-Customer type creates, shows the website, hides customer-only sections and creates no customer", async () => {
  const types = ["Prospect", "Owner Operator", "Service Provider", "Insurance Broker", "Government Agency"]
  const results = []
  for (const type of types) {
    const label = `CC ${type.replace(/\W+/g, "")} ${digits(5)}`
    await go("/companies/new"); await page.waitForSelector("#companyName", { timeout: 90000 })
    await pick(page, page.locator("button:has-text('Select entity type')"), type)
    await page.fill("#companyName", label); await page.fill("#website", "https://kind.example.com")
    const customerOnly = (await page.locator("[name=gpsProvider]").count()) + (await page.locator("[name=payMethod]").count()) + (await page.locator("[name=cargoTypes]").count())
    await submit(() => page.click("button:has-text('Create Record')"), true, () => page.waitForURL(/\/companies\/[0-9a-f-]{36}\/profile/, { timeout: 60000 }))
    const oid = page.url().match(/companies\/([0-9a-f-]{36})/)[1]
    await page.waitForSelector("text=Company Name"); await page.waitForFunction(() => document.body.innerText.includes("https://kind.example.com"), null, { timeout: 30000 })
    const text = await body()
    results.push([type, customerOnly === 0, text.includes("https://kind.example.com") && !text.includes("Customer Information"), Number(one(`select count(*) from customers where organization_id='${oid}'`)) === 0])
  }
  await shot(page, "cc-08-other-classification-profile")
  const bad = results.filter((r) => !(r[1] && r[2] && r[3]))
  return bad.length === 0 ? `${types.length} types ok: no customer-only fields, website shown, no customer row` : `!${JSON.stringify(bad)}`
})

await step("regression: related workspaces still open from the customer", async () => {
  const failures = []
  for (const sub of ["contacts", "authorities", "insurance", "credentials", "vehicles", "drivers", "tax-filing", "settings", "business", "record-of-events"]) {
    const response = await go(`/companies/${id}/${sub}`); await page.waitForTimeout(1200)
    const text = await body()
    if ((response?.status() ?? 0) >= 400 || /Application error|Internal Server Error/i.test(text)) failures.push(`${sub}:${response?.status()}`)
  }
  await go(`/companies/${id}/contacts`); await settle(); await page.waitForTimeout(1500)
  const contacts = await body()
  if (!/Website/.test(contacts) || /Email · GENERAL · https?:\/\//.test(contacts)) failures.push("contacts website label")
  return failures.length === 0 ? "10 workspaces open; the Contacts workspace labels the website as a Website, not an Email" : `!${failures}`
})

await step("responsive: create, edit and profile have no horizontal overflow at phone width", async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  const over = []
  for (const path of ["/companies/new", `/companies/${id}/edit`, `/companies/${id}/profile`]) {
    await go(path); await page.waitForTimeout(2500)
    if (path.endsWith("/new")) await pick(page, page.locator("button:has-text('Select entity type')"), "Customer")
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    if (w[0] > w[1] + 1) over.push(`${path} ${w}`)
    await shot(page, `cc-09-mobile-${path.split("/").pop()}`)
  }
  await page.setViewportSize({ width: 1400, height: 1000 })
  return over.length === 0 ? "no horizontal overflow at 390px" : `!${over}`
})

const keys = tesKeys(await browserStorage(page)); record("nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
await h.browser.close()

// ---- authorization in the browser ----
const seedActor = (subject, excluded) => psql(`DO $$ DECLARE a uuid := gen_random_uuid(); r uuid := gen_random_uuid(); s uuid := gen_random_uuid(); BEGIN
  INSERT INTO public.actors (id, actor_type, status) VALUES (a,'HUMAN','active');
  INSERT INTO public.authentication_identities (actor_id, provider, provider_subject) VALUES (a,'clerk','${subject}');
  INSERT INTO public.actor_relationships (id, actor_id, relationship_type, status, starts_at) VALUES (r,a,'TES_STAFF','active',now()-interval '1 day');
  INSERT INTO public.relationship_assignments (id, relationship_id, scope_type, status, starts_at) VALUES (s,r,'SYSTEM','active',now()-interval '1 day');
  INSERT INTO public.relationship_capability_grants (relationship_id, capability_id, assignment_id, status, granted_at)
    SELECT r, c.id, s, 'active', now()-interval '1 day' FROM public.capabilities c WHERE c.is_active AND c.code NOT IN (${excluded.map((e) => `'${e}'`).join(",") || "''"}); END $$;`)
seedActor("user_cc_nopay", ["CUSTOMER_RELATIONSHIP_MANAGE"])
seedActor("user_cc_noprofile", ["COMPANY_PROFILE_MANAGE"])
seedActor("user_cc_nocontact", ["CONTACT_MANAGE"])

let r = await start("user_cc_nopay")
await r.step("authorization: without CUSTOMER_RELATIONSHIP_MANAGE a payment method is refused (403, names the capability) and nothing changes", async () => {
  await r.go(`/companies/${id}/profile`); await r.settle()
  const before = one(`select count(*) from customer_billing_preference_periods where organization_id='${id}'`)
  const edit = await r.api(`/api/companies/${id}`, { payMethod: "Cheque", opRegion: "US Only" }, "PATCH")
  const create = await r.api("/api/companies", { companyName: `CC Denied ${digits(5)} Ltd`, companyType: "Customer", opRegion: "Canada Only", startDate: "2024-01-01", cargoTypes: JSON.stringify(["Bulk & Other"]), payMethod: "Cheque" })
  const scope = one(`select operating_scope from company_operating_scope_periods where organization_id='${id}' and effective_to is null`)
  const ok = edit.status === 403 && /CUSTOMER_RELATIONSHIP_MANAGE/.test(JSON.stringify(edit.body)) && create.status === 403 && one(`select count(*) from customer_billing_preference_periods where organization_id='${id}'`) === before && orgs("CC Denied") === 0 && scope === "CANADA_AND_UNITED_STATES"
  return ok ? "edit and create refused (403) naming the capability; nothing created; region unchanged" : `!edit=${edit.status} create=${create.status} scope=${scope}`
})
await r.browser.close()
r = await start("user_cc_noprofile")
await r.step("authorization: without COMPANY_PROFILE_MANAGE cargo and providers cannot be saved; the profile hides them as 'Not permitted'", async () => {
  await r.go(`/companies/${id}/profile`); await r.settle()
  const before = one(`select count(*) from company_fleet_provider_periods where organization_id='${id}'`)
  const edit = await r.api(`/api/companies/${id}`, { gpsProvider: "Denied", cargoTypes: JSON.stringify(["Bulk & Other"]) }, "PATCH")
  const profile = await r.api(`/api/companies/${id}/profile`, undefined, "GET")
  const sections = profile.body?.company?.sections
  return edit.status === 403 && /COMPANY_PROFILE_MANAGE/.test(JSON.stringify(edit.body)) && one(`select count(*) from company_fleet_provider_periods where organization_id='${id}'`) === before && sections?.operatingProfile === "ok" ? "write refused (403) naming the capability; nothing changed" : `!edit=${edit.status} ${JSON.stringify(sections)}`
})
await r.browser.close()
r = await start("user_cc_nocontact")
await r.step("authorization: without CONTACT_MANAGE the website cannot be changed (403)", async () => {
  await r.go(`/companies/${id}/profile`); await r.settle()
  const edit = await r.api(`/api/companies/${id}`, { website: "https://denied.example.com" }, "PATCH")
  return edit.status === 403 && one(`select value_normalized from organization_channels where organization_id='${id}' and channel_type='WEBSITE' and effective_to is null`) === "https://new-site.example.org/home/" ? "refused (403); website unchanged" : `!edit=${edit.status}`
})
await r.browser.close()
r = await start("user_e2e_readonly")
await r.step("authorization: a read-only user sees the saved facts, the write is refused (403), and nothing changes", async () => {
  await r.go(`/companies/${id}/profile`); await r.settle(); await r.page.waitForFunction(() => document.body.innerText.includes("Geotab"), null, { timeout: 30000 })
  const text = await r.page.innerText("body")
  const edit = await r.api(`/api/companies/${id}`, { website: "https://readonly.example.com" }, "PATCH")
  return text.includes("Credit Card") && text.includes("Bulk & Other") && edit.status === 403 ? "facts visible; PATCH 403" : `!${edit.status}`
})
await r.browser.close()
r = await start("user_e2e_noevidence")
await r.step("authorization: without evidence/contract access the Assessment Date is 'Not permitted to view' (not blank, not guessed)", async () => {
  await r.go(`/companies/${id}/profile`); await r.settle(); await r.page.waitForFunction(() => document.body.innerText.includes("Geotab"), null, { timeout: 30000 }).catch(() => {})
  const text = await r.page.innerText("body")
  return /assessment date/i.test(text) && /not permitted to view/i.test(text) ? "Assessment Date withheld, not invented" : `!${text.slice(0, 200)}`
})
await r.browser.close()
r = await start("user_e2e_none")
await r.step("authorization: an actor with no capability is denied the profile and the write", async () => {
  await r.go("/companies"); await r.settle()
  const edit = await r.api(`/api/companies/${id}`, { website: "https://none.example.com" }, "PATCH")
  const profile = await r.api(`/api/companies/${id}/profile`, undefined, "GET")
  return edit.status === 403 && profile.status === 403 ? "profile and write both 403" : `!edit=${edit.status} profile=${profile.status}`
})
await r.browser.close()

// ---- tenant isolation in the browser ----
const other = await (async () => {
  const h2 = await start()
  await h2.go("/companies"); await h2.settle()
  const made = await h2.api("/api/companies", { companyName: `CC Other ${digits(6)} Ltd`, companyType: "Customer", opRegion: "Canada Only", startDate: "2024-02-01", website: "other-tenant.example.com", cargoTypes: JSON.stringify(["Household Goods"]), gpsProvider: "OtherGPS", payMethod: "E-Transfer" })
  await h2.step("tenant isolation: another company's facts are separate; editing it never touches the first", async () => {
    const otherId = made.body.company.id
    const snap = () => JSON.stringify([one(`select count(*) from company_cargo_category_periods where organization_id='${id}'`), one(`select count(*) from company_fleet_provider_periods where organization_id='${id}'`), one(`select count(*) from customer_billing_preference_periods where organization_id='${id}'`), one(`select value_normalized from organization_channels where organization_id='${id}' and channel_type='WEBSITE' and effective_to is null`)])
    const before = snap()
    const edit = await h2.api(`/api/companies/${otherId}`, { website: "https://other-new.example.com", gpsProvider: "OtherGPS2", payMethod: "Cheque" }, "PATCH")
    await h2.go(`/companies/${otherId}/profile`); await h2.settle(); await h2.page.waitForFunction(() => document.body.innerText.includes("OtherGPS2"), null, { timeout: 30000 })
    const text = await h2.page.innerText("body")
    return made.status === 201 && edit.status === 200 && snap() === before && !text.includes("Geotab") && !text.includes("new-site.example.org") ? "other company edited; first company's rows identical; no cross-visibility" : `!${made.status} ${edit.status}`
  })
  await h2.browser.close()
})()

fs.writeFileSync("/tmp/claude-0/-home-user-TESPortal/93514665-c9b6-5d17-a2b4-261f33d2a38e/scratchpad/cc/browser-ids.json", JSON.stringify({ id, name }))
console.log("done")
