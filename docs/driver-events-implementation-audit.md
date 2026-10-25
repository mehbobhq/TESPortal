# Driver Events — implementation audit (read-only)

Baseline `a61d68f` (main lineage; `origin/main` = `0327263`). Nothing in this document was implemented or changed by the audit.

## 1. Headline

**No Driver Events category is production-complete, because none of them has a server-side home.** The whole Driver Performance / Events subsystem (`lib/driver-data.ts`, `lib/performance-*.ts`, `src/components/drivers/*`) stores records in the browser:

| Concern | Where it lives today | Evidence |
|---|---|---|
| Event records | `localStorage` (`tes_driver_masters_v1`, per-company driver stores) | `lib/driver-data.ts:103,116,125,493` |
| Evidence files | browser IndexedDB (`indexeddb://tes-evidence-files/…`), not the GCS evidence pipeline | `lib/evidence-file-store.ts:1-5` |
| Citations linked from Roadside | `localStorage` (`tes_company_citations_<id>`) | `lib/driver-data.ts:2396-2442` |
| Company "Record of Events" | deliberately deferred: "no canonical (PostgreSQL) implementation yet" | `app/companies/[id]/record-of-events/page.tsx` |
| Driver page | legacy browser workspace flagged as prototype data | `app/companies/[id]/drivers/[driverId]/page.tsx` (`PrototypeBrowserDataIndicator`) |
| PostgreSQL schema | **no** event/performance/collision/roadside/incident tables in migrations 0001–0041 | `database/migrations/` (only `driver_prospect_events`, `master_register_events` match "event") |
| HTTP API | **no** driver-event routes under `app/api` | `app/api/companies/[id]/drivers` is canonical driver identity only |

Consequently none of the following exists for any event category: tenant isolation / RLS, permissions, Master Register attribution, canonical driver/vehicle links, GCS evidence, server-side history or corrections, notifications.

What *is* substantial and reusable is the pure TypeScript domain layer (category schema, taxonomies, workflow/obligation engine, investigation and relationship engines) and its unit tests (all pass, 324 tests across the 13 files in `test/lib/drivers`).

## 2. Classification

Definitions as requested. Because of the headline above, "Complete" is not awarded to any category; the table separates **workflow depth** (what the code does) from **production readiness** (persistence, RLS, MR, GCS).

| # | Category (canonical name) | Status | Workflow depth | Evidence |
|---|---|---|---|---|
| 1 | **Collision** | **Partial** | Dedicated 9-step wizard (facts, parties/equipment, environment, outcomes, injured persons), investigation panel, workflow-engine provider, 36 fields | `lib/performance-collision.ts`, `-taxonomy.ts`, `performance-investigation.ts`; `CollisionWizardPanels.tsx`, `CollisionEventPanel.tsx`, `CollisionInvestigationPanel.tsx`; schema `COLLISION_STEPS` (`driver-performance-schema.ts:753`); tests `performance-collision` (25), `performance-investigation` (26) |
| 2 | **Near Miss** | **Partial** | Wizard + panel, unsafe-condition resolution, potential-severity (reported vs TES-assessed), workflow provider, 25 fields | `lib/performance-near-miss.ts`, `-taxonomy.ts`; `NearMissWizardPanels.tsx`, `NearMissEventPanel.tsx`; test `performance-near-miss` (32) |
| 3 | **Roadside Inspection** | **Partial** | Machine/OCR mapping, violations with OOS state, driver statement, citation linking, auto-save, 19 fields (10 required). Not on the workflow engine (intentionally) | `lib/auto-save-roadside.ts`, `roadside-machine-*.ts`, `driver-performance-child-facts.ts`, `driver-data.ts:2361-2428`; `RoadsideEventPanels.tsx`; test `performance-roadside` (30) |
| 4 | **Cargo Incident** | **Partial** | 11-step wizard (shipment, carrier, items, classification, response, outcomes, custody), damage/theft folded in as outcome modules, workflow provider, 34 fields | `lib/performance-cargo.ts`, `-taxonomy.ts`; `CargoWizardPanels.tsx`, `CargoEventPanel.tsx`; test `performance-cargo` (36) |
| 5 | **Spill or Release** | **Partial** | 11-step wizard, regulatory assessments with notification/report deadlines, cleanup records, workflow provider, 54 fields | `lib/performance-spill.ts`, `-taxonomy.ts`; `SpillWizardPanels.tsx`, `SpillEventPanel.tsx`; test `performance-spill` (58) |
| 6 | **Customer Event** | **Partial** | 10-step wizard with subtypes (complaint/commendation/behaviour are legacy-read-only members), response/resolution/outcome/review forms, 48 fields | `lib/performance-customer-event.ts`, `-taxonomy.ts`; `CustomerEventWizardPanels.tsx`, `CustomerEventPanel.tsx`; test `performance-customer-event` (55) |
| 7 | **Security Incident** | **Partial (generic only)** | Schema (6 fields, 2 required), created through the generic wizard; no category panel, rules, follow-up logic or category tests | schema `SECURITY_INCIDENT`; family `SECURITY_INCIDENT`; no `performance-security*` module; no UI file |
| 8 | **Equipment Failure / Critical Defect** | **Partial (generic only)** | Schema (7 fields); no link to vehicle repair/maintenance, no OOS rule | schema `EQUIPMENT_FAILURE`; no module/UI |
| 9 | **Device / Data Integrity** | **Partial (generic only)** | Schema (12 fields, 1 relationship); ELD/telematics origins declared, no ingestion | schema `DEVICE_DATA_INTEGRITY` |
| 10 | **Fatigue-related emergency event** | **Partial (generic only), two canonical categories** | No single "fatigue-related emergency" category exists. Canonical names are **Fatigue Indicator** (family `HOS_FATIGUE`, 12 fields) and **Emergency Event** (6 fields, 3 required). Both generic. Owner decision needed on whether the request means one, the other, or a linkage between them (no duplicate category should be created) | schema `FATIGUE_INDICATOR`, `EMERGENCY_EVENT`; families `HOS_FATIGUE`, `EMERGENCY_EVENT` |
| 11 | **Speeding** | **Partial (generic only)** + automated feed **Blocked** | Schema 17 fields, 1 relationship; telematics/ELD origins declared, no integration | schema `SPEEDING` |
| 12 | **Harsh Driving** (Harsh Braking / Acceleration / Cornering) | **Partial (generic only)** + feed **Blocked** | Schema 21/16/15 fields; one family with three stored types | schema `HARSH_*`; family `HARSH_DRIVING` |
| 13 | **Following Distance** | **Partial (generic only)** + feed **Blocked** | Schema 16 fields | schema `FOLLOWING_DISTANCE` |
| 14 | **Distracted Driving** | **Partial (generic only)** + feed **Blocked** | Schema 6 fields | schema `DISTRACTED_DRIVING` |
| 15 | **Idle Time** | **Partial (generic only)** + feed **Blocked** | Schema 7 fields | schema `IDLE_TIME` |
| 16 | **Seatbelt** | **Schema only** | Category defined (`SEATBELT`, 6 fields, `RECORDABLE_EVENT`) but **absent from `PERFORMANCE_EVENT_FAMILIES`**, so it cannot be created in the UI; zero tests | `driver-performance-schema.ts:1171`; `driver-performance-families.ts` (no Seatbelt family) |

"Generic only" = creatable and viewable through the schema-driven `DriverPerformanceEventWorkflow.tsx` / `DriverPerformanceTab.tsx`; verified only by the shared tests (`performance-persistence` 4, `performance-enum-persistence` 10, `performance-workflow` 22), none specific to the category.
"Feed Blocked" = `allowedOrigins` include `TELEMATICS_INGESTION`, `ELD_INGESTION`, `API_INTEGRATION`, but nothing in the repository ingests from a provider (`lib/driver-performance-ingestion.ts` only guards document-OCR origin); this needs a provider, credentials and a data contract that are outside the repository.

## 3. Verification matrix (what exists across all categories)

| Layer | State |
|---|---|
| PostgreSQL schema, migrations | None for events |
| Tenant isolation / RLS | None (browser keys by company id only) |
| Driver / vehicle relationship | Legacy local ids (`driverMasterId`, local vehicle ids). Canonical driver identity (migrations 0021, 0037) and canonical vehicle identity (0020) are not referenced |
| Lifecycle and history | In-browser (`updatePerformanceEventWorkflow`, corrections `correctPerformanceEventFacts`, archive); no server history |
| Corrections / status changes | Implemented client-side for the six rich categories and generically for the rest |
| Evidence attachments | IndexedDB files linked by id (`linkPerformanceEventEvidence`); the canonical evidence/GCS lifecycle (0032) is not used |
| Search / filtering | Client-side in `DriverPerformanceTab` |
| Permissions | None specific; the legacy workspace is gated only by the legacy-workspace gate |
| Category fields, severity | Defined in `driver-performance-schema.ts` (severity bands Low/Moderate/High/Critical; near-miss potential severity) |
| Required follow-up | Generic `followUpActionRequired` obligation; category obligations for the five engine families; no notifications |
| Repair / citation linking | Roadside → citation (localStorage); no event → repair/work-order link in the event domain (`tests/repair-ingestion.test.ts` is the legacy repair ingestion test) |
| Out-of-Service restrictions | Roadside captures OOS state per violation; nothing enforces a driver or vehicle restriction |
| Master Register accountability | None in the event domain |
| Tests | Pure-library unit tests only (13 files, 324 tests, all pass). No database, RLS, security or browser tests for any event category |

## 4. Shared architecture assessment

Reusable as-is (pure TypeScript, no storage): category registry and field schema (`driver-performance-schema.ts`), taxonomies, `performance-workflow.ts` obligation engine and family providers (`performance-workflow-registry.ts`: Near Miss, Collision, Cargo Incident, Spill or Release, Customer Event), `performance-investigation.ts`, `performance-event-relationships.ts`, `driver-performance-relationship-resolution.ts`, `driver-performance-families.ts` (presentation families over stored `eventType`).

Critical blockers (none requires replacing the architecture):

1. **No canonical persistence** — no tables, RLS, API, permissions (section 1).
2. **Legacy identities** — events point at browser-local driver/vehicle ids, not canonical persons/relationships/vehicles.
3. **No Master Register attribution**; actors are optional strings.
4. **Evidence outside the controlled pipeline** (IndexedDB vs quarantine → scan → evidence/GCS).
5. **Time semantics** — events carry `eventDate` and optional `eventTime` strings with no time zone and no instant. The new `TESDateTimeField` can capture an instant plus IANA zone, but the stored model needs `occurred_at timestamptz` + `time_zone`, kept apart from calendar dates.
6. **No notifications** for deadlines the engines already compute (spill regulatory deadlines, follow-ups).
7. **No automated source ingestion** (telematics / ELD / API).
8. **Seatbelt** is not creatable (missing family); Fatigue/Emergency naming needs an owner decision.
9. **Verification gap**: no DB, security or browser tests.

## 5. Recommended order

0. **Foundation batch (prerequisite for everything): canonical PostgreSQL Driver Events store.** One migration for the event record, child facts (keyed by the existing category schema and `PERFORMANCE_EVENT_SCHEMA_VERSION`), history/corrections, evidence links (to the existing evidence lifecycle) and relationships; RLS and tenant isolation; DRIVER_* capability checks; Master Register entries; `occurred_at` + `time_zone` and calendar-date fields kept distinct; canonical driver/vehicle foreign keys; service + API; a storage adapter so the existing panels read/write the server. Reuse the pure engines unchanged.
1. **Roadside Inspection** on that foundation as the reference implementation (OCR/machine mapping, citation link, OOS facts, driver statement) — highest compliance value and already the most server-shaped.
2. **Collision + Near Miss** together (shared investigation and relationship engines).
3. **Cargo Incident, Spill or Release, Customer Event** together (same engine-provider pattern, obligations/deadlines → add notifications here).
4. **Security Incident, Equipment Failure / Critical Defect, Emergency Event (+ Fatigue Indicator)** — small schemas, one shared "incident" workflow; Equipment Failure also needs the vehicle repair/maintenance link and the OOS restriction rule.
5. **Telematics-class behaviours (Speeding, Harsh Driving, Following Distance, Distracted Driving, Idle Time, Seatbelt, Device / Data Integrity)** as one batch around a single "source observation" model: manual entry first (add the Seatbelt family), then ingestion once a provider/feed is chosen (external prerequisite).

**Next implementation batch: step 0 plus step 1.**
