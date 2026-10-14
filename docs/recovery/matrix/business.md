# UI recovery matrix: Business

Original: `git show '971e15e^:app/companies/[id]/business/page.tsx'` (996 lines, browser-local; kept unchanged as `app/companies/[id]/business/legacy-business.tsx`, the second tab of `LegacyWorkspaceGate`) with `src/components/business/*`.
Restored: `src/restored/business/` mounted by `app/companies/[id]/business/page.tsx` as the canonical (first) tab. Sections whose original component has no legacy import and no misleading text are reused unchanged from `src/components/business/` (ShareholdersSection, AnnualReturnsSection); the rest are copies adapted under `src/restored/business/`.

Each section was checked against the approved schema (migrations 0003-0032), `lib/*` domains and `docs/recovery/canonical-field-ownership.md` before being declared unsupported. Findings are in the "Why" column.

## Component map

| Original component | Current (before) | Recovered | Canonical connection | Missing, and why |
|---|---|---|---|---|
| `BusinessHeader` (registered origin, operating region, ownership %) | corporate identity card | `restored/BusinessHeader` (copy: storage label now "TES database"; ownership shows "Not recorded" instead of 0.0%) | formation jurisdiction and operating scope from `GET /api/companies/[id]/profile` | ownership: see Shareholders |
| `IncorporationSection` (record id, number, **date**, jurisdiction) | identity card | `restored/IncorporationSection` (copy; "writes to tes_companies" text replaced) | id, incorporation NUMBER and jurisdiction read from the canonical profile (number is edited on the Edit page, as in the original it was "Locked here") | **Incorporation date: missing domain.** `organizations` and `organization_identifiers` have no date column (checked 0003, 0010, corporate-identity types). Edit shows the original date input; Save refuses with an unavailable note. Needs a decision on where the date lives. |
| `CorporateDocumentsSection` (papers, registry requests, OCR, source-fact review) | "deferred" | `restored/CorporateDocumentsSection` (rewritten over the evidence lifecycle) | `GET/POST /api/companies/[id]/evidence`, `PATCH .../[documentId]` (finalize), secure inline view `GET .../[documentId]` (quarantine, scan, hash-verified, view audited by the server). Uploads are filed as `OTHER_EVIDENCE` | Evidence-link decision resolved as: upload, scan-check, secure view and supersede-on-attach are real. **Not real, kept with refusals:** document-type/source/registry/reference/notes (no fields on the evidence record), "Request from Registry" (no registry-request record), "Run OCR" (legacy OCR closed), "Confirm reviewed facts" (no record for reviewed facts), per-document activity (no read). The evidence catalogue has no corporate-paper types (decision) so the list shows `OTHER_EVIDENCE`. The restored copy does not import any evidence-store module (the two ratchet-allowed importers `src/components/business/{AuditCasesSection,CorporateDocumentsSection}.tsx` remain only in the legacy tab). |
| `ShareholdersSection` | not available | original component, empty canonical list | none | **Missing domain.** Closest structures: `organization_person_relationships` + `organization_person_titles` (0014, Contacts) hold people and job titles (Director/Officer could be titles), but nothing holds an ownership percentage or a shareholder relationship. Add/edit/archive refuse with a note; header shows "Not recorded". Needs a decision (model ownership, or leave to Contacts titles only). |
| `AnnualReturnsSection` | not available | original component, empty list; attach evidence = in-memory preview only | none | **Missing domain.** No table for corporate annual returns (Tax Filing's IFTA returns are a different thing). Save/archive refuse; the preview banner says the file is not saved. |
| `CraTaxCard` (BN9) | active BN in identity card | `restored/CraTaxCard` | `organization_identifiers` CRA_BN. New `registerBusinessIdentifier`: nothing active = `addIdentifier`; active + "a real change" = old superseded (kept as history) then new added, one transaction; active + "a correction" = `correctIdentifier` (old kept, flagged). "Archive" = `supersedeIdentifier`. History (superseded numbers) shown under "Show archived". | "Obtained date / by": no column; inputs disabled, the date TES recorded the number is shown. "Restore" a retired number: no operation (a superseded identifier cannot be reactivated); refuses, register it again. The original rule that the active master BN cannot be archived without a replacement is kept. |
| `EinTaxCard` | active EIN in identity card | `restored/EinTaxCard` | same as CRA, kind IRS_EIN | same as CRA |
| `GstTaxCard` (RT program accounts) | not available | `restored/GstTaxCard`, empty | none | **Missing domain / decision.** `registration_programs` (0016) has no GST/HST program and a CRA program account is not a BN root (`identifier-definitions.ts`). Save refuses; nothing is stored. Never mapped into CRA_BN. |
| `SalesTaxCard` (US state sales tax) | not available | `restored/SalesTaxCard`, empty | none | **Missing domain.** No program or family for state sales tax (canonical-field-ownership: "no owner at all"). Save refuses. |
| `BusinessHistory` (change ledger) | not available | `restored/BusinessHistory` (honest placeholder) | every canonical change on this page already writes a Master Register event in the same transaction | **Missing operation + decision.** There is no organization-scoped read of `master_register_events` (RLS requires MASTER_REGISTER_READ and the repository has no by-organization query); what a company-facing ledger may show is a decision. The section says events cannot be listed here yet instead of showing an empty list. |
| `AuditCasesSection` (carrier audits) | not available | `restored/AuditCasesSection` (header, "New audit case" form, empty list) | none | **Missing domain.** No audit-case table or operation. "Create case" refuses; nothing is kept in the browser. The two regime names offered are the labels the original offered. |
| `BusinessDocumentModals` (source picker, camera, preview) | n/a | `restored/BusinessDocumentModals` (copy; preview via in-memory object URL instead of `SecureDocumentViewer`, which imports the legacy audit-log) | `DocumentSourcePicker`, `CameraCapture` unchanged | the preview is ephemeral and labelled not saved |

## Operations and routes implemented

* `lib/corporate-identity/business-identifiers.ts` (pure): `registerBusinessIdentifier`, `retireBusinessIdentifier`, composed from the existing `addIdentifier` / `correctIdentifier` / `supersedeIdentifier` inside one transaction (a real change cannot end the old number without recording the new). Validation, normalization, collisions, the Organization lock and the Master Register events are the existing operations'. Kinds are limited to CRA_BN and IRS_EIN; INCORPORATION stays on the Edit page.
* `lib/corporate-identity/service.ts` (append-only): `registerBusinessIdentifier`, `retireBusinessIdentifier` under ORGANIZATION_UPDATE.
* `app/api/companies/[id]/business/route.ts`: `GET` (identity view including superseded numbers as history), `POST` (register), `PATCH {action:"retire"}`. The company is always the URL's; a body organization id is refused by the strict input.

## Verification

`test/lib/ui-recovery/credentials-business.db.test.ts`:
* "business: a CRA BN or EIN is registered, changed (history kept), corrected and retired inside its own company" (explicit change-vs-correction, history kept, collision refused and a real change rolled back as a whole, retire scoped to the URL company and to the business-number kinds, Master Register events)
* "business routes: the company comes from the URL, the view includes history, and bad actions are refused"
* "authorization" test above (ORGANIZATION_UPDATE required; signed-out refused)

Static: `restored-ui-boundaries.test.ts` (no storage, no legacy store, no evidence-store import under `src/restored`), `phase-de-cutover-boundaries.test.ts` (page has `fetch(` and "intentionally deferred"), `evidence-payload-boundaries.test.ts` (importer ratchet unchanged).

## Not verified here

No browser run. The coordinator should check: the evidence iframe renders a stored PDF/image (route sends a sandbox CSP), the in-memory preview of a local PDF in the annual-returns "attach" flow, and the layout of the copied cards with the disabled "obtained" inputs.
