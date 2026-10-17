// Evidence Phase 2: Insurance policy attachments in the browser (canonical evidence associations).
// Documents are seeded stored rows (same lifecycle transitions as the test fixtures); no bytes are involved, so "Open document" is
// verified as a link to the existing secure-view route, not by rendering bytes (no storage exists in this harness).
import { randomUUID } from "node:crypto"
import { start, makeCompany, record, shot, psql, digits, browserStorage, tesKeys, setActor } from "./b2-common.mjs"
import fs from "node:fs"

const h = await start()
const { page, go, settle, api, step, body, submit } = h
const t = digits(5)
const A = await makeCompany(h, "EvAlpha"); const B = await makeCompany(h, "EvBravo")
const actor = psql(`select actor_id from public.authentication_identities where provider_subject = 'user_e2e_staff'`)
fs.writeFileSync("/tmp/tes-e2e/ev2-ids.json", JSON.stringify({ A, B }))

function seedDocument(org, title, status = "received") {
  const id = randomUUID(), batch = randomUUID(), file = randomUUID()
  const sha = digits(64).replace(/\d/g, (d) => "abcdef0123"[Number(d)])
  const q = `quarantine/${org}/${batch}/${file}/source`, ev = `evidence/${org}/${id}/source`
  psql(`INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel)
        VALUES ('${id}','${org}','OTHER_EVIDENCE','${title}','tes-test-quarantine','${q}','${sha}','application/pdf',100,'staff_upload');
        INSERT INTO public.evidence_payloads (evidence_document_id, organization_id, batch_id, source_file_id, quarantine_bucket, quarantine_object_name, declared_sha256, mime_type, byte_size, original_filename, uploaded_by_actor_id)
        VALUES ('${id}','${org}','${batch}','${file}','tes-test-quarantine','${q}','${sha}','application/pdf',100,'fixture.pdf','${actor}');
        UPDATE public.evidence_payloads SET lifecycle_state='cleared', intake_object_name='${q.replace("quarantine/", "intake/")}', intake_generation='1', cleared_at=now() WHERE evidence_document_id='${id}';
        UPDATE public.evidence_payloads SET lifecycle_state='stored', evidence_bucket='tes-test-evidence', evidence_object_name='${ev}', evidence_generation='2', verified_sha256=declared_sha256, stored_at=now() WHERE evidence_document_id='${id}';
        UPDATE public.evidence_documents SET gcs_bucket='tes-test-evidence', gcs_object_name='${ev}', gcs_generation='2' WHERE id='${id}';
        ${status !== "received" ? `UPDATE public.evidence_documents SET document_status='${status}' WHERE id='${id}';` : ""}`)
  return id
}
const seedQuarantined = (org, title) => {
  const id = randomUUID(), batch = randomUUID(), file = randomUUID(), sha = "a".repeat(64), q = `quarantine/${org}/${batch}/${file}/source`
  psql(`INSERT INTO public.evidence_documents (id, organization_id, document_type, document_title, gcs_bucket, gcs_object_name, sha256, mime_type, byte_size, source_channel) VALUES ('${id}','${org}','OTHER_EVIDENCE','${title}','tes-test-quarantine','${q}','${sha}','application/pdf',100,'staff_upload');
        INSERT INTO public.evidence_payloads (evidence_document_id, organization_id, batch_id, source_file_id, quarantine_bucket, quarantine_object_name, declared_sha256, mime_type, byte_size, original_filename, uploaded_by_actor_id) VALUES ('${id}','${org}','${batch}','${file}','tes-test-quarantine','${q}','${sha}','application/pdf',100,'fixture.pdf','${actor}');`)
  return id
}
const links = (org, status) => Number(psql(`select count(*) from public.evidence_links where organization_id='${org}' ${status ? `and link_status='${status}'` : ""}`))
const ev = (type) => Number(psql(`select count(*) from public.master_register_events where event_type='${type}'`))
const patch = (org, doc, payload) => api(`/api/companies/${org}/evidence/${doc}`, payload, "PATCH")

// ---- a company with two policies, created through the existing Insurance UI (proves create still works) ----
await go("/companies"); await settle()
const insurerName = `Northbridge Ev ${t} Insurance Ltd`
await api("/api/companies", { companyName: insurerName, companyType: "Insurance Company", opRegion: "Canada Only" })
const createPolicy = async (number) => {
  await go(`/companies/${A.id}/insurance`); await settle()
  await page.getByRole("button", { name: "Add Transportation Policy" }).first().click()
  await page.locator("select[name=insuranceType]").selectOption("Auto Liability")
  await page.locator("input[name=policyNumber]").fill(number); await page.locator("input[name=insurerName]").fill(insurerName)
  await page.locator("input[name=coverageAmount]").fill("2000000"); await page.locator("input[name=effectiveDate]").fill("2026-01-01"); await page.locator("input[name=expiryDate]").fill("2027-01-01")
  await submit(() => page.getByRole("button", { name: "Save Policy" }).click(), true, () => page.getByRole("button", { name: "Save Policy" }).waitFor({ state: "hidden", timeout: 60000 }))
}
await step("insurance: two policies are created through the existing UI", async () => { await createPolicy(`EV-${t}-1`); await createPolicy(`EV-${t}-2`); return Number(psql(`select count(*) from public.insurance_policies where organization_id='${A.id}'`)) === 2 })
const policyId = (n) => psql(`select p.id from public.insurance_policies p join public.insurance_policy_terms t on t.policy_id = p.id where p.organization_id='${A.id}' and t.number_display='EV-${t}-${n}' limit 1`)
const P1 = policyId(1), P2 = policyId(2)
const docR = seedDocument(A.id, `COI received ${t}`), docV = seedDocument(A.id, `COI verified ${t}`, "verified"), docC = seedDocument(A.id, `COI conflict ${t}`)
const docRej = seedDocument(A.id, `COI rejected ${t}`), docArch = seedDocument(A.id, `COI archived ${t}`), docQ = seedQuarantined(A.id, `COI quarantined ${t}`)
const docB = seedDocument(B.id, `B secret ${t}`)
await patch(A.id, docRej, { action: "review", decision: "rejected" }); await patch(A.id, docArch, { action: "archive" })
const card = (n) => page.locator("div").filter({ has: page.getByText(`EV-${t}-${n}`).first() }).filter({ has: page.locator("[data-testid=evidence-attachments]") }).last()
const evidenceOf = (n) => card(n).locator("[data-testid=evidence-attachments]")
const openInsurance = async () => { await go(`/companies/${A.id}/insurance`); await settle(); await page.locator("[data-testid=evidence-attachments]").first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800) }
await openInsurance()

await step("evidence: an empty policy says no document is attached, offers Attach, and states that attaching verifies nothing", async () => {
  const t1 = await evidenceOf(1).innerText()
  return /No document is attached/.test(t1) && /Attach existing document/.test(t1) && /does not verify it or show that this insurance policy is compliant/.test(t1) ? "empty state, attach control, disclaimer" : `!${t1}`
})
await step("evidence: the picker offers only this company's eligible documents (stored, not archived, not rejected)", async () => {
  await evidenceOf(1).getByRole("button", { name: /Attach existing document/ }).click(); await page.waitForTimeout(1500)
  const options = await evidenceOf(1).locator("select option").allTextContents(); const joined = options.join(" | "); await shot(page, "ev2-picker")
  const has = (s) => joined.includes(s)
  return has(`COI received ${t}`) && has(`COI verified ${t}`) && has(`COI conflict ${t}`) && !has("rejected") && !has("archived") && !has("quarantined") && !has("B secret") ? `${options.length - 1} eligible documents: ${options.slice(1).join(" | ")}` : `!${joined}`
})
await step("evidence: Cancel in the picker attaches nothing", async () => { const b = links(A.id); await evidenceOf(1).getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(500); return links(A.id) === b })
await step("evidence: attaching a document shows 'Attached' next to the document's own status ('Received'), and stores one association (database + Master Register)", async () => {
  const before = [links(A.id), ev("EVIDENCE_ASSOCIATED")]
  await evidenceOf(1).getByRole("button", { name: /Attach existing document/ }).click(); await page.waitForTimeout(1200)
  await evidenceOf(1).locator("select").selectOption({ label: await evidenceOf(1).locator("select option", { hasText: `COI received ${t}` }).first().textContent() })
  await submit(() => evidenceOf(1).getByRole("button", { name: "Attach", exact: true }).click(), true, () => evidenceOf(1).getByText(/Document attached/).waitFor({ timeout: 60000 }))
  await shot(page, "ev2-attached")
  const text = await evidenceOf(1).innerText(); const after = [links(A.id), ev("EVIDENCE_ASSOCIATED")]
  const docStatus = psql(`select document_status from public.evidence_documents where id='${docR}'`)
  return after[0] === before[0] + 1 && after[1] === before[1] + 1 && /Attached/.test(text) && /Received \(not reviewed\)/.test(text) && /\(1 attached\)/.test(text) && docStatus === "received" ? "Attached + Received; document status unchanged; 1 row, 1 event" : `!${text} | ${after} | ${docStatus}`
})
await step("evidence: the association survives a refresh", async () => { await openInsurance(); const text = await evidenceOf(1).innerText(); return text.includes(`COI received ${t}`) && /Attached/.test(text) })
await step("evidence: an attached document is not offered again; a verified document shows 'Verified by review' while the first stays 'Received'", async () => {
  await evidenceOf(1).getByRole("button", { name: /Attach existing document/ }).click(); await page.waitForTimeout(1200)
  const options = (await evidenceOf(1).locator("select option").allTextContents()).join(" | ")
  const notAgain = !options.includes(`COI received ${t}`)
  await evidenceOf(1).locator("select").selectOption({ label: await evidenceOf(1).locator("select option", { hasText: `COI verified ${t}` }).first().textContent() })
  await submit(() => evidenceOf(1).getByRole("button", { name: "Attach", exact: true }).click(), true, () => evidenceOf(1).getByText(/Document attached/).waitFor({ timeout: 60000 }))
  const text = await evidenceOf(1).innerText()
  return notAgain && /Verified by review/.test(text) && /Received \(not reviewed\)/.test(text) && /\(2 attached\)/.test(text) ? "not re-offered; both statuses shown separately" : `!notAgain=${notAgain} ${text}`
})
await step("evidence: a duplicate attachment request is an idempotent no-op (200, same association, no extra row or event)", async () => {
  const rows = links(A.id), events = ev("EVIDENCE_ASSOCIATED")
  const r = await patch(A.id, docR, { action: "link", targetTable: "insurance_policies", targetId: P1 })
  return r.status === 200 && r.body.created === false && links(A.id) === rows && ev("EVIDENCE_ASSOCIATED") === events ? "200 created:false" : `!${r.status} ${JSON.stringify(r.body).slice(0, 120)}`
})
await step("evidence: the other policy of the same company has its own, empty list", async () => { const text = await evidenceOf(2).innerText(); return /No document is attached/.test(text) && !text.includes(`COI received ${t}`) })
await step("evidence: 'Open document' is the existing secure-view route in a new tab; no storage URL appears anywhere on the page", async () => {
  const hrefs = await evidenceOf(1).locator("a").evaluateAll((els) => els.map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]))
  const html = await page.content()
  const ok = hrefs.length === 2 && hrefs.every(([href, target, rel]) => /^\/api\/companies\/[0-9a-f-]{36}\/evidence\/[0-9a-f-]{36}$/.test(href) && target === "_blank" && /noopener/.test(rel))
  return ok && !/storage\.googleapis|gs:\/\/|tes-test-evidence|evidence\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/source/.test(html) ? "2 links to /api/companies/{id}/evidence/{doc}; no bucket/object name in the page" : `!${JSON.stringify(hrefs)}`
})
await step("evidence: the secure-view route authorizes the open (a company without access gets 404, not bytes)", async () => {
  const r = await api(`/api/companies/${B.id}/evidence/${docR}`, undefined, "GET")
  return r.status === 404 || r.status === 403 ? `status ${r.status}` : `!status ${r.status}`
})
await step("evidence: a conflict (the document is archived after the picker was opened) is reported clearly and nothing is stored", async () => {
  const rows = links(A.id)
  await evidenceOf(2).getByRole("button", { name: /Attach existing document/ }).click(); await page.waitForTimeout(1200)
  await evidenceOf(2).locator("select").selectOption({ label: await evidenceOf(2).locator("select option", { hasText: `COI conflict ${t}` }).first().textContent() })
  await patch(A.id, docC, { action: "archive" })
  await submit(() => evidenceOf(2).getByRole("button", { name: "Attach", exact: true }).click(), false)
  await page.waitForTimeout(800); const text = await evidenceOf(2).innerText(); await shot(page, "ev2-conflict")
  await evidenceOf(2).getByRole("button", { name: "Cancel" }).click().catch(() => {})
  return links(A.id) === rows && /Only a stored, scanner-cleared document can be associated/.test(text) ? "conflict message shown; nothing stored" : `!${text}`
})
await step("evidence: archiving an association asks for confirmation, keeps the document, and moves it to the history", async () => {
  await openInsurance()
  const activeBefore = links(A.id, "active")
  const row = evidenceOf(1).locator("[data-testid=evidence-association]").filter({ hasText: `COI received ${t}` })
  await row.getByRole("button", { name: /Archive association/ }).click()
  const askedFirst = await row.getByText(/The document is not archived or deleted/).isVisible()
  await submit(() => row.getByRole("button", { name: "Archive", exact: true }).click(), true, () => evidenceOf(1).getByText(/Association archived/).first().waitFor({ timeout: 60000 }))
  const docs = psql(`select d.document_status || ':' || d.archived_is_null || ':' || p.lifecycle_state from (select id, document_status, (archived_at is null)::text as archived_is_null from public.evidence_documents where id='${docR}') d join public.evidence_payloads p on p.evidence_document_id=d.id`)
  const text = await evidenceOf(1).innerText(); await shot(page, "ev2-archived")
  return askedFirst && links(A.id, "active") === activeBefore - 1 && links(A.id, "archived") === 1 && docs === "received:true:stored" && /\(1 attached\)/.test(text) && /Show archived associations \(1\)/.test(text) ? "confirmed; association archived; document still received/stored and not archived" : `!${askedFirst} ${docs} ${text}`
})
await step("evidence: the history shows the archived association, clearly distinct from active ones, and the event is recorded", async () => {
  await evidenceOf(1).getByText(/Show archived associations/).click()
  const archivedRows = evidenceOf(1).locator("[data-association-status=archived]")
  const text = await archivedRows.first().innerText()
  return (await archivedRows.count()) === 1 && /Association archived/.test(text) && !/Archive association/.test(text) && ev("EVIDENCE_ASSOCIATION_REMOVED") >= 1 ? "archived row labelled 'Association archived', no actions; event recorded" : `!${text}`
})
await step("evidence: re-attaching an archived document creates a new association and keeps the old one (history retained)", async () => {
  await evidenceOf(1).getByRole("button", { name: /Attach existing document/ }).click(); await page.waitForTimeout(1200)
  await evidenceOf(1).locator("select").selectOption({ label: await evidenceOf(1).locator("select option", { hasText: `COI received ${t}` }).first().textContent() })
  await submit(() => evidenceOf(1).getByRole("button", { name: "Attach", exact: true }).click(), true, () => evidenceOf(1).getByText(/Document attached/).waitFor({ timeout: 60000 }))
  return links(A.id, "active") === 2 && links(A.id, "archived") === 1 ? "2 active + 1 archived" : `!${links(A.id, "active")}/${links(A.id, "archived")}`
})
await step("evidence: company B cannot see, attach to or archive company A's associations", async () => {
  const list = await api(`/api/companies/${B.id}/evidence?targetTable=insurance_policies&targetId=${P1}&includeArchived=true`, undefined, "GET")
  const linkA = psql(`select id from public.evidence_links where organization_id='${A.id}' and link_status='active' limit 1`)
  const cross = [await patch(B.id, docR, { action: "link", targetTable: "insurance_policies", targetId: P1 }), await patch(A.id, docB, { action: "link", targetTable: "insurance_policies", targetId: P1 }), await patch(B.id, docR, { action: "archiveLink", linkId: linkA })]
  const bList = await api(`/api/companies/${B.id}/evidence`, undefined, "GET")
  return list.status === 200 && list.body.links.length === 0 && cross.every((r) => r.status === 404) && !JSON.stringify(bList.body).includes(docR) && links(B.id) === 0 ? "B sees no associations or documents of A; every cross attempt is 404" : `!${list.status} ${JSON.stringify(list.body).slice(0, 80)} ${cross.map((r) => r.status)}`
})
await step("evidence: a failed load shows an error with Try again, then recovers", async () => {
  await page.route(/\/evidence\?targetTable=/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }))
  await openInsurance().catch(() => {}); await page.waitForTimeout(1500)
  const errorShown = /Evidence could not be loaded/.test(await evidenceOf(1).innerText().catch(() => ""))
  await page.unroute(/\/evidence\?targetTable=/)
  await evidenceOf(1).getByRole("button", { name: "Try again" }).click(); await page.waitForTimeout(2000)
  return errorShown && /Attached/.test(await evidenceOf(1).innerText()) ? "error + Try again recovered" : `!errorShown=${errorShown}`
})
const keys = tesKeys(await browserStorage(page)); record("evidence: nothing written to browser storage", keys.length === 0, JSON.stringify(keys))
await h.browser.close()

// ---- read-only user: sees evidence, cannot change it ----
let r = await start("user_e2e_readonly")
await r.go(`/companies/${A.id}/insurance`); await r.settle(); await r.page.locator("[data-testid=evidence-attachments]").first().waitFor({ timeout: 60000 }).catch(() => {}); await r.page.waitForTimeout(1500)
await r.step("read-only user: attached evidence is visible, with no attach and no archive controls, and a read-only note", async () => {
  const text = await r.page.locator("[data-testid=evidence-attachments]").first().innerText(); await shot(r.page, "ev2-readonly")
  return /Attached/.test(text) && !/Attach existing document/.test(text) && !/Archive association/.test(text) && /Read-only/.test(text) ? "visible; write controls absent; read-only note" : `!${text}`
})
await r.step("read-only user: the server refuses a write made anyway (403) and nothing changes", async () => {
  const rows = links(A.id)
  const w = await r.api(`/api/companies/${A.id}/evidence/${docV}`, { action: "link", targetTable: "insurance_policies", targetId: P2 }, "PATCH")
  return w.status === 403 && links(A.id) === rows ? "403; unchanged" : `!${w.status}`
})
await r.browser.close()
// ---- insurance user without any evidence capability ----
r = await start("user_e2e_noevidence")
await r.go(`/companies/${A.id}/insurance`); await r.settle(); await r.page.waitForTimeout(3000)
await r.step("no-evidence user: the policy list still works and the evidence area says it is not permitted (no documents, no titles)", async () => {
  const text = await r.page.innerText("body"); await shot(r.page, "ev2-noevidence")
  return text.includes(`EV-${t}-1`) && /not permitted to view this company's evidence/.test(text) && !text.includes(`COI received ${t}`) && !/Attach existing document/.test(text) ? "policies shown; evidence denied; nothing leaked" : `!${text.slice(0, 300)}`
})
await r.browser.close()
console.log("done")
