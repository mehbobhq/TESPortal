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
  // Waits until the writes a click triggers have ALL finished (optionally until `done`, the page's own completion signal, resolves). A save can be several sequential writes (for example a portal is linked
  // to its provider, then the credential is created), so waiting for the first response is not enough, and a fixed sleep is not
  // evidence of completion. After the click: wait for a write request to start (strict: up to 60 s, and it is an error if none does;
  // otherwise up to 8 s and a client-side refusal is accepted), then wait until no write is in flight and none has started for 1.5 s.
  const submit = async (fn, strict = false, done = null) => {
    let inflight = 0, started = 0, last = Date.now(), status = null
    const isWrite = (r) => r.method() !== "GET" && /\/api\//.test(r.url())
    const onRequest = (r) => { if (isWrite(r)) { inflight += 1; started += 1; last = Date.now() } }
    const onDone = (r) => { if (isWrite(r)) { inflight -= 1; last = Date.now() } }
    const onResponse = (r) => { if (isWrite(r.request())) status = r.status() }
    page.on("request", onRequest); page.on("requestfinished", onDone); page.on("requestfailed", onDone); page.on("response", onResponse)
    try {
      await fn()
      const firstDeadline = Date.now() + (strict ? 60000 : 8000)
      while (started === 0 && Date.now() < firstDeadline) await page.waitForTimeout(100)
      if (started === 0) { if (strict) throw new Error("no write request was sent"); return null }
      // `done` is the page's own completion signal (for example the dialog closing): a save is complete when the UI says so, not when a
      // quiet period elapsed. Without one, wait until no write is in flight and none has started for 1.5 s.
      if (done) await done()
      const deadline = Date.now() + 90000
      while ((inflight > 0 || (!done && Date.now() - last < 1500)) && Date.now() < deadline) await page.waitForTimeout(100)
      return status
    } finally {
      page.off("request", onRequest); page.off("requestfinished", onDone); page.off("requestfailed", onDone); page.off("response", onResponse)
    }
  }
  const body = () => page.innerText("body")
  const text = async (re, timeout = 20000) => { await page.waitForFunction((s) => new RegExp(s, "i").test(document.body.innerText), re.source, { timeout }) }
  return { browser, page, context, go, settle, api, step, body, text, submit }
}
export async function makeCompany(h, label) {
  await h.go("/companies"); await h.settle()
  const made = await h.api("/api/companies", { companyName: `B2 ${label} ${Date.now().toString().slice(-6)} Ltd`, companyType: "Customer", opRegion: "Cross-Border", regCorpState: "ON", regCorpCountry: "Canada", startDate: "2024-01-15", contactGivenName: "Pat", contactFamilyName: "Ops", phone: "+1 416 555 0100", email: "ops@example.test", reg_street: "1 King St", reg_city: "Toronto", reg_state: "ON", reg_zip: "M5X 1A9", reg_country: "Canada" })
  if (made.status !== 201) throw new Error("company create " + made.status)
  return { id: made.body.company.id, name: made.body.company.name ?? label }
}
