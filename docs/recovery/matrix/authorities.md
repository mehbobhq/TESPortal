# Authorities: UI recovery matrix

Original: `git show 'a36acf1^:app/companies/[id]/authorities/page.tsx'` (1576 lines, browser-local store `tes_company_authorities_<id>`), extracted unchanged
as `app/companies/[id]/authorities/legacy-authorities.tsx` (second tab, "browser-local, not canonical"; untouched).
Canonical: `lib/operating-authorities` (migration 0013; kinds USDOT, MC, MVID, RIN, CVOR, SAFETY_FITNESS, IRP).
Restored UI: `src/restored/authorities/**`, mounted by `app/companies/[id]/authorities/page.tsx` as the canonical tab of `LegacyWorkspaceGate`.

## Component map

| Original file | Before (cutover page) | Recovered implementation | Notes |
|---|---|---|---|
| `app/companies/[id]/authorities/page.tsx` | 23-line `CanonicalRegistryPanel` | `RestoredAuthorities.tsx` (adapted page): header strip, summary tiles, 3-year banner + toggle, Canadian / US Federal / Operating Registrations cards, Carrier Profile / CVOR and SMS sections, Audits & Interventions, inspector dialog, add/edit modals, archive dialog, scan / camera / OCR review | all `localStorage`, `recordAuditEvent`, cross-store snapshot and global scan code replaced by the adapter |
| `src/components/authorities/forms.tsx` | imports `lib/authorities/model` | `src/restored/authorities/forms.tsx` | + Registry Kind select (MVID/RIN, Safety Fitness/CVOR), fixed jurisdiction for national / Ontario kinds, number check, change-vs-correct choice, inline error, unavailable notes |
| `.../sections.tsx` | imports deadline engine | `sections.tsx` | + unavailable note on the safety sections |
| `.../record-inspector.tsx` | imports model | `record-inspector.tsx` | + canonical Version History / Status History (corrected rows flagged), archive reason "Not recorded", evidence unavailable note |
| `.../shared-fields.tsx` | imports deadline engine | `shared-fields.tsx` | + `fixedLabel` for kinds whose issuer is fixed |
| `.../ocr-workspace.tsx` | `requestOCR` posts to the legacy OCR endpoint; `SecureDocumentViewer` (audit-log + watermark storage) | `ocr-workspace.tsx` | no OCR request; in-memory preview (`iframe` / `img` of the chosen file, never stored); Extract Data refuses |
| `lib/authorities/model.ts` | localStorage company list, deadline settings, snapshots, global duplicate scan | `model.ts` (pure copy of applicability, 3-year window, option lists, drafts, deadline mechanics) + kind/jurisdiction mapping | deadline thresholds are the TES defaults (no canonical per-company store) |
| `lib/authorities/types.ts` | n/a | `types.ts` (adds IRP, Revoked/Canceled, canonical kind, history) | |
| (new) | n/a | `adapter.ts` (`useCanonicalAuthorities`, `mapAuthorityView`) | only module that talks to the API |
| (new) | n/a | `app/api/companies/[id]/authorities/check/route.ts` | advisory registry check (existing `checkAuthorityNumber`, `ORGANIZATION_REGISTRY_READ`) |

## Control classification

Classes: **read**, **create**, **update/correct**, **lifecycle**, **evidence op**, **missing operation** (approved domain, no application operation), **missing domain** (needs a decision).

| Restored control | Class | Canonical operation / behaviour |
|---|---|---|
| Authority cards grouped Canadian / US Federal / Operating Registrations | read | `GET /authorities` -> `getOrganizationAuthorities`; `mapAuthorityView` |
| Company profile strip (origin, region, hazmat trigger) and `deriveAuthorityProfile` | read | `GET /profile` (regCorpState/Country, `opRegion`); hazmat only from an explicit `DG_US` / `DG_CANADA` APPLIES assertion in `GET /settings` (never the catalogue default). Sections with existing canonical records are never hidden by the heuristic |
| Add Record (manual) | create | `POST /authorities` -> `createAuthority` (kind, number, jurisdiction, issuedOn, expiresOn, status, effectiveFrom from Effective Date) |
| Registry Kind select | create | MVID vs RIN, Safety Fitness vs CVOR: the original single type maps to two canonical kinds |
| Number check ("Check number in the TES registry") | read | `POST /authorities/check` -> `checkAuthorityNumber`; duplicate creation also blocked in the transaction (`AuthorityNumberCollisionError`) |
| Edit: real-world change | update | `PATCH {action: "version"}` -> `changeAuthorityVersion` (USDOT/MC number never changes; IRP base move allowed; Effective Date -> `effectiveFrom`); status -> `{action: "status"}` |
| Edit: recorded value was wrong | correct | `PATCH {action: "correctVersion"}` / `{action: "correctStatus"}`; wrong value kept and flagged; effective date cannot be corrected (refused with an explanation) |
| Record Status | lifecycle | PENDING/ACTIVE/INACTIVE/SUSPENDED/REVOKED/CANCELED (the original "Expired" has no canonical status: expiry is derived from the expiry date) |
| Archive dialog | lifecycle | `PATCH {action: "archive"}` -> `archiveAuthority` |
| Archive reason | missing domain | no canonical home: typing a reason is refused (leave empty to archive); never silently dropped |
| Restore | lifecycle | `PATCH {action: "restore"}` -> `restoreAuthority` |
| 3-year history toggle, summary tiles, deadline badges | read (derived) | computed from canonical dates; expiry only |
| Version History / Status History in the inspector | read | `versions` + `statusPeriods` of the view; corrected rows flagged "recorded wrongly, not genuine history" |
| IRP accounts (Operating Registrations) | create/update | canonical kind with no original card: added as the "IRP" type in Operating Registrations (section always shown) |
| MCS-150, UCR, PHMSA, Other record types | missing domain | no canonical kind (verified against `authority_kinds`, migration 0013): options stay, Save refuses with `CanonicalOperationUnavailableError` and an inline note |
| Display Name, Issuing Authority, Filed / Update Date, Next Action Date, Notes | missing domain | no canonical home: shown, refused if filled differently from the derived value (issuer text on cards is derived from the kind per `docs/operating-authorities-regulatory-semantics.md`) |
| Safety snapshots (Carrier Profile / CVOR, SMS) add / edit / list | missing domain | no storage: sections and modals visible, Save refuses; lists honestly empty |
| Audits & Interventions add / edit / list | missing domain | same |
| Scan Document / Scan Notice, camera, source picker, OCR review layout | evidence op (not approved for this link) | UI kept; file shown in memory for review; Extract Data refuses (legacy OCR endpoints quarantined); document is NOT stored; fields saved manually where the kind is canonical |
| Attached documents / secure viewer / "Preview" | missing domain | the evidence lifecycle is organization-level and has no link to an authority record: evidence panel kept with an unavailable note, nothing stored in the browser |
| Refresh Deadline Settings | missing domain | no canonical per-company threshold store: refuses with a note |
| Company master sync (`tes_companies` usdot/mc/mvid/nsc) | removed | the canonical authority is the source of the profile identifier fields (read by `/profile`) |

## Semantics honoured

- A USDOT (and MC) number does not change: only a correction can change it (client pre-check plus server rule).
- IRP base-jurisdiction move = real change; a wrong base = correction. Country is always explicit (national kinds fixed; RIN/CVOR fixed to ON).
- Create / change / correct / status / archive / restore are separate canonical operations; nothing is overwritten or deleted.
- A status change after a number change is two calls; if the second fails the user is told the first was saved.

## Verification

- `test/lib/ui-recovery/authorities-tax.db.test.ts` (DB, runtime role): "authorities: every action stays inside the URL company...", "...a real change keeps history, a correction flags the wrong value, a national number only corrects, and the restored mapping shows it", "...registry number check names the holder only with registry access, and a collision blocks creation", "...authorization is enforced...", "...a refused Master Register event rolls the whole operation back".
- Static: `restored-ui-boundaries.test.ts` (no browser storage anywhere reached from `src/restored/**`), `phase-de-cutover-boundaries.test.ts`, `evidence-payload-boundaries.test.ts`.
- Not verified here (no browser run): visual layout, modal stacking, camera capture.
