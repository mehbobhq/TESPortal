# Functional regression matrix

> **Superseded in part:** browser-local workspace behavior described here was contained by the Batch 1 corrections; see `docs/recovery/legacy-workspace-containment.md`.

Three points compared per workspace: **A** = original rich interface (root snapshot `2644183`, last pre-cutover version of each file),
**B** = `main` (after the Block 01 D/E cutover), **C** = this PR. Line counts are pages only.

Legend for "Persistence": LS = browser `localStorage`/IndexedDB; PG = PostgreSQL through the canonical domain operations.

| Workspace | A (original) | B (`main`) | C (this PR) | Still missing / decision |
| --- | --- | --- | --- | --- |
| **Company Directory** (`app/companies`) | 141 lines, LS. Stats, table with Contact column, hard-delete button | PG list; Contact column and delete gone | unchanged from B | Contact column (needs a read-only primary-contact join; not done). **Delete must not return**; archive (`archiveOrganization`) needs a product decision |
| **Customers** | LS; Primary Contact column, dev hard-delete | PG list | unchanged | same; "end engagement" is the nearest canonical action (now on Edit) |
| **New Company** | 2531 lines, LS (`tes_companies`/`tes_customers`) | UI almost intact; server saved only name/DBA/type/region/identifiers/start date, **silently dropped the rest**; BN := EIN for US-only (fabricated) | **Restored** every original field; one transaction writes identity, customer + onboarding, scope, 3 addresses, contact + channels, authorities, tax registrations; unavailable fields kept, disabled and labelled before submission | 10 fields without a canonical owner (see canonical-field-ownership.md); cross-record fuzzy duplicate review (needs a read-only API over existing `find*Matches`) |
| **Company Profile** | 504 lines, LS. Fake stats (Staff 0, Trucks 0, Accounts "Good"), cards, Quick Note, activity | PG read of identity only; many cards empty | Real values from every canonical domain with per-section "not permitted"; all original cards kept; **real** truck/trailer/driver counts; fake "Good/Pending" removed on purpose | Activity feed (Master Register has no list-by-organization read), Quick Note, Check Status, New Case (kept as disabled controls) |
| **Company Edit** | 484 lines, LS, all fields | identity only (name, DBA, incorporation, BN, EIN) | + operating region, 3 addresses (change vs correct), **end service with a reason** (customers) | Carrier numbers and tax accounts (their workspaces edit them), primary contact (Contacts workspace), website/GST/etc. (no owner) |
| **Onboarding** | none (first appears canonical, `2acd624`) | canonical | unchanged | nothing to restore |
| **Business** | 996 lines, LS: incorporation, documents, shareholders, annual returns, CRA/EIN/GST/sales-tax cards, history, audit cases | 95 lines: canonical identity card + "not yet available" | canonical card kept; **original workspace reachable as a browser-local tab** | Shareholders, returns, GST/HST and state sales tax, history, audit cases: no canonical home. Corporate documents need an evidence link decision |
| **Contacts** | 933 lines, LS (`tes_contacts_v5`) + IndexedDB evidence | same LS page (canonical id not found) | canonical tab: company lines (add/end), people (add, change/correct name, titles add/end, purposes add/end/make primary, end contact, archive/restore person, duplicate review, search, purpose filter, stats); original workspace as a browser-local tab | Licence/DOB (driver domain), OCR/camera/evidence intake (no evidence link for persons) |
| **Insurance** | 1923 lines, LS, 14 components: transportation / workers comp / bond tabs, broker update, renewal lineage, OCR, evidence | 260 lines: list, add one coverage, archive/restore | + **renew** (new term, history kept), **cancel term**, renewal scoped to the URL company; original restored (10 deleted components recovered from git) as a browser-local tab | Endorsements, scheduled vehicles, broker UI, multi-coverage entry, evidence/OCR (no evidence link), archive reason/notes (no canonical home) |
| **Authorities** | 1576 lines, LS: grouped cards, safety and audit records, history, OCR | 23 lines (`CanonicalRegistryPanel`) | + **edit (real change) / correct / correct status / version history**; original as a browser-local tab | Safety and audit records, evidence/OCR, kinds MCS150/UCR/PHMSA/OTHER (no canonical kind) |
| **Tax Filing** | 1511 lines, LS: profiles, frequency history, calendar, filing records with evidence | 23 lines (panel) | + edit/correct/history; original as a browser-local tab | Calendar, filing records, frequency history, verification fields, Form 2290: no canonical model |
| **Vehicles** | 1061 lines, LS: 7 tabs (profile, ownership, registration, permits, maintenance, activity, settings), OCR, evidence | 183 lines: list + add | atomic create, real counts on Profile | **Original NOT restored: the page imports the browser evidence store and the approved ratchet test (`evidence-payload-boundaries`: importers may shrink, never grow) forbids it.** Needs a decision to amend the ratchet. Registration/plate and archive/status have tables but **no operations** |
| **Drivers** | 109 + 233 lines, LS: register, Add Driver, existing-driver check, filters, detail with qualifications/training/screening/performance | 95 lines: list only | list + **original register and detail reachable as a browser-local tab** | No standalone person-creation service, so no canonical Add Driver; medical table has no operations |
| **Citations** | 1266 lines, LS | same | wrapped: browser-local banner (not canonical) | no canonical enforcement-event model |
| **Record of Events / Customs / Programs** | no company page ever existed; sidebar links 404'd | same | explicit notice pages | product decision on what they hold; Master Register has no list read |
| **Credentials** | 1258 lines, LS (never stored secrets) | 245 lines: list, add, status, verify, archive | + search, category filter, verification outcome/method, open-portal link, **new credentials start "needs verification"** (original parity bug fixed); original as a browser-local tab | Recovery-slot declarations, system management fields (operations exist, no route) |
| **Settings** | 1127 lines, LS | same LS | canonical tab (scope, rule applicability with "not configured", driver minimums); original as a browser-local tab | Section navigation, jurisdiction-based disabling, unsaved-changes guard (client work) |
| **Navigation / chrome** | read `tes_companies` | same (canonical company unresolved) | canonical resolution; read-only fallback | none |

## What "reachable as a browser-local tab" means

The original component is extracted **unchanged** from the pre-cutover revision (only behaviour-neutral type guards so it compiles) and
mounted by `LegacyWorkspaceGate` beside the canonical tab under a banner stating that its records live only in this browser, are not in the
TES database and are not canonical. It does not read or write PostgreSQL. A canonical company is added to `tes_companies` as a marked
projection **only while that tab is open** and removed again (only that marked entry) when it closes. Nothing in the browser is
migrated, overwritten or deleted, and nothing is copied into PostgreSQL. This is a compatibility interface, not production data.
