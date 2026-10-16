import { chromium } from "playwright-core"
import fs from "node:fs"
export const BASE = "http://localhost:3100"
export const EV = "/tmp/tes-e2e/evidence"
fs.mkdirSync(EV, { recursive: true })
export const results = []
export function record(step, ok, detail = "") {
  results.push({ step, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? "  — " + detail : ""}`)
}
export async function launch() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] })
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await context.newPage()
  page.errors = []
  page.on("pageerror", (e) => page.errors.push(e.message))
  return { browser, context, page }
}
export function setActor(subject) { fs.writeFileSync("/tmp/tes-e2e/actor.txt", subject) }
export async function shot(page, name) { await page.screenshot({ path: `${EV}/${name}.png`, fullPage: true }) }
export async function pick(page, triggerLocator, optionText) {
  const option = page.locator("[role=option]:visible", { hasText: optionText }).first()
  for (let attempt = 0; attempt < 3; attempt++) {
    await triggerLocator.scrollIntoViewIfNeeded()
    await triggerLocator.click()
    try { await option.waitFor({ state: "visible", timeout: 4000 }); break } catch { await page.keyboard.press("Escape") }
  }
  await option.click({ force: true })
  await page.waitForTimeout(200)
}

/** Every key the page's origin holds in localStorage, sessionStorage and IndexedDB (names only, never values). */
export async function browserStorage(page) {
  return page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    idb: ((await indexedDB.databases?.()) ?? []).map((d) => d.name),
  }))
}
/** Containment check: no TES key in any browser storage (the app's own UI-preference keys are not TES records). */
export const tesKeys = (s) => [...s.local, ...s.session, ...s.idb].filter((k) => /^tes|^TES|tes_/.test(String(k)))
