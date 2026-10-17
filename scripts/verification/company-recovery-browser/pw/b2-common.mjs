import { launch, BASE, record, shot, setActor, browserStorage, tesKeys } from "./lib.mjs"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
export { BASE, record, shot, setActor, browserStorage, tesKeys }
export const psql = (sql) => execFileSync("psql", ["--no-psqlrc", "-At", "-U", "tes-database-migrator@tes-production-510007.iam", "-h", "127.0.0.1", "-p", "55432", "-d", "tes_prod", "-c", sql], { encoding: "utf8" }).trim()
export const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("")
export async function start(actor = "user_e2e_staff") {
  setActor(actor)
  const { browser, page, context } = await launch()
  page.on("dialog", (d) => d.accept())
  const go = (p) => page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 120000 })
  const settle = async () => { await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {}); await page.waitForTimeout(1500) }
  const api = (url, body, method = "POST") => page.evaluate(async ([u, b, m]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => null) } }, [url, body, method])
  const step = async (name, fn) => { try { const r = await fn(); const bad = r === false || (typeof r === "string" && r.startsWith("!")); record(name, !bad, typeof r === "string" ? r.replace(/^!/, "") : "") } catch (e) { record(name, false, String(e.message).split("\n")[0].slice(0, 220)); await shot(page, "FAIL-" + name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)).catch(() => {}) } }
  const body = () => page.innerText("body")
  const text = async (re, timeout = 20000) => { await page.waitForFunction((s) => new RegExp(s, "i").test(document.body.innerText), re.source, { timeout }) }
  return { browser, page, context, go, settle, api, step, body, text }
}
export async function makeCompany(h, label) {
  await h.go("/companies"); await h.settle()
  const made = await h.api("/api/companies", { companyName: `B2 ${label} ${Date.now().toString().slice(-6)} Ltd`, companyType: "Customer", opRegion: "Cross-Border", regCorpState: "ON", regCorpCountry: "Canada", startDate: "2024-01-15", contactGivenName: "Pat", contactFamilyName: "Ops", phone: "+1 416 555 0100", email: "ops@example.test", reg_street: "1 King St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada" })
  if (made.status !== 201) throw new Error("company create " + made.status)
  return { id: made.body.company.id, name: made.body.company.name ?? label }
}
