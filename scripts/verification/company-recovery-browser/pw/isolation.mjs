import { launch, BASE, record, shot, setActor, results } from "./lib.mjs"
import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
const A = JSON.parse(fs.readFileSync("/tmp/tes-e2e/created.json", "utf8"))
const psql = (sql) => execFileSync("psql", ["--no-psqlrc", "-At", "-U", "tes-database-migrator@tes-production-510007.iam", "-h", "127.0.0.1", "-p", "55432", "-d", "tes_prod", "-c", sql], { encoding: "utf8" }).trim()
const post = (page, url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) } }, [url, body])
setActor("user_e2e_staff")
const { browser, page } = await launch()
const go = (p) => page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 120000 })
const settle = async () => { await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(800) }
try {
  await go("/companies"); await settle()
  const tag = Date.now().toString().slice(-6)
  const nameB = `E2E Isolation ${tag} Inc`
  const created = await post(page, "/api/companies", { companyName: nameB, companyType: "Owner Operator", opRegion: "US Only", regCorpState: "TX", regCorpCountry: "United States", ein: `${tag.slice(0, 2)}-${tag}1`, reg_street: "1 Main St", reg_city: "Austin", reg_state: "TX", reg_zip: "73301", reg_country: "United States" })
  record("second company created (for isolation checks)", created.status === 201, `status ${created.status}`)
  const B = created.body.company.id

  // vehicles: scoped to the right company
  const vin = `E2E${tag}${"0".repeat(14)}`.slice(0, 17)
  const veh = await post(page, `/api/companies/${A.id}/vehicles`, { vehicleTypeCode: "TRUCK_TRACTOR", vin, make: "Testmake", relationshipType: "OPERATES", unitNumber: "E2E-1", effectiveFrom: "2024-01-01T00:00:00Z" })
  record("vehicle created for company A through the company route", veh.status === 201 || veh.status === 200, `status ${veh.status} ${JSON.stringify(veh.body).slice(0, 120)}`)
  await go(`/companies/${A.id}/vehicles`); await settle(); await shot(page, "11-vehicles-A")
  const a = await page.innerText("body")
  await go(`/companies/${B}/vehicles`); await settle(); await shot(page, "12-vehicles-B-empty")
  const b = await page.innerText("body")
  record("vehicle appears under company A only; company B shows a legitimate empty state", a.includes("E2E-1") && !b.includes("E2E-1") && /no vehicles|no current vehicles|not.*recorded|empty/i.test(b), b.slice(-160).replace(/\n/g, " "))

  // contacts isolation
  await go(`/companies/${B}/contacts`); await page.waitForSelector("text=Add a contact", { timeout: 60000 }); await settle()
  const bc = await page.innerText("body")
  record("company B contacts show none of company A's contacts", !bc.includes("Sam Dispatcher") && bc.includes("No contacts have been recorded"))
  await shot(page, "13-contacts-B-empty")

  // wrong-company mutation through another company's URL
  const pol = await post(page, `/api/companies/${B}/insurance/${randomUUID()}`, {})
  record("a record id from another company is refused, not acted on", [404, 405, 400].includes(pol.status), `status ${pol.status}`)

  // failed submission leaves no partial record
  const before = psql(`SELECT count(*) FROM public.organizations`)
  const dupName = `E2E Duplicate ${tag} Corp`
  const dup = await post(page, "/api/companies", { companyName: dupName, companyType: "Owner Operator", opRegion: "US Only", regCorpState: "TX", regCorpCountry: "United States", ein: A.ein, contactGivenName: "Z", contactFamilyName: "Z", phone: "+1 416 555 0100", reg_street: "1 Main St", reg_city: "Austin", reg_state: "TX", reg_zip: "73301", reg_country: "United States" })
  const orphan = psql(`SELECT count(*) FROM public.organizations WHERE legal_name = '${dupName}'`)
  const persons = psql(`SELECT count(*) FROM public.persons`)
  record("duplicate strong identifier is refused (409) and no partial record remains", dup.status === 409 && orphan === "0" && psql(`SELECT count(*) FROM public.organizations`) === before, `status ${dup.status}`)
  const unsupported = await post(page, "/api/companies", { companyName: `E2E Unsupported ${tag}`, companyType: "Owner Operator", opRegion: "US Only", website: "https://x.test" })
  record("unsupported field is refused with explicit issues and creates nothing", unsupported.status === 400 && Array.isArray(unsupported.body.issues) && psql(`SELECT count(*) FROM public.organizations WHERE legal_name = 'E2E Unsupported ${tag}'`) === "0")

  // unknown company
  await go(`/companies/${randomUUID()}/profile`); await settle()
  record("an unknown company id reports 'not found' (not a crash or empty profile)", /Company Not Found|Company not found/i.test(await page.innerText("body")))

  // authorization: limited staff
  setActor("user_e2e_limited")
  await go(`/companies/${A.id}/profile`); await settle(); await shot(page, "14-profile-limited-actor")
  const lt = await page.innerText("body")
  record("a user without the domain capabilities sees 'Not permitted to view', never blanks", lt.includes("Not permitted to view"))
  const deny = await post(page, "/api/companies", { companyName: `E2E Denied ${tag}`, companyType: "Customer", opRegion: "Canada Only", startDate: "2024-01-01", contactGivenName: "A", contactFamilyName: "B" })
  record("creation with a missing capability is refused (403) naming it, and creates nothing", deny.status === 403 && (deny.body?.missingCapabilities ?? []).includes("COMPANY_PROFILE_MANAGE") && psql(`SELECT count(*) FROM public.organizations WHERE legal_name = 'E2E Denied ${tag}'`) === "0", JSON.stringify(deny.body))
  await go(`/companies/${A.id}/contacts`); await page.waitForTimeout(4000); await shot(page, "15-contacts-limited-actor")
  record("contacts for a user without PERSON_REGISTRY_READ is refused, not shown", /not permitted|could not be loaded/i.test(await page.innerText("body")))
  setActor("user_e2e_staff")
} catch (e) {
  record("scenario error", false, String(e).slice(0, 500))
  await shot(page, "97-error-isolation")
}
fs.writeFileSync("/tmp/tes-e2e/results-isolation.json", JSON.stringify(results, null, 2))
await browser.close()
