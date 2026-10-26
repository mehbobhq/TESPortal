# Driver Events — canonical architecture and implementation status

Companion documents: [field reconciliation matrix](field-reconciliation.md) (+ machine-readable [catalogue](field-reconciliation.json)) and the [analytical contract](bi-contract-v1.md).

## What changed and what did not

Before this work every Driver Event lived in the browser (localStorage / IndexedDB): no server validation, no tenant isolation, no durable history, and a Record of Events page that was deliberately empty.
Now every recordable category is a PostgreSQL record behind row-level security. The six detailed workflows, the category registry, the workflow engines and the validators are **reused**; the
registry was extended only where the baseline needed a field the existing schema lacked (59 fields, all optional unless the baseline made them essential). No existing field was removed, renamed or
retyped, and no browser-local test record is migrated (migration 0042 loads no data).

## Pieces

| Concern | Implementation |
|---|---|
| Store | Migration `0042_driver_events_canonical_store.sql`: `driver_events` (+ typed columns for canonical links, time, severity, status) with the schema-validated `record` jsonb; `driver_event_history` (append-only, one snapshot per version); `driver_event_evidence`; `driver_event_relationships`; `driver_event_consequences`; `driver_event_actions`; `driver_event_restrictions`; `driver_event_bi_facts` + view `driver_event_facts_v1`. |
| Access | SYSTEM scope only. `DRIVER_EVENT_READ`, `DRIVER_EVENT_MANAGE`, and a separate `DRIVER_EVENT_SAFETY_RELEASE`. TypeScript and database capability lists are identical (existing test K2). Company comes from the URL path and every statement filters it; composite foreign keys tie events to the company's own driver / vehicle / trailer relationships. |
| Validation | `lib/driver-events/validation.ts` is driven by the same registry the browser uses: unknown keys, out-of-list values, wrong types, hidden legacy fields, inapplicable conditional facts, missing required facts, explicit units, zone-correct instants (a date-only occurrence never gets an instant; a non-existent local time is refused). Drafts may be incomplete; recording is not. The browser is never trusted. |
| Versions and corrections | A changed record is exactly one new version (database trigger). Corrections need a reason, are checked against the version the person saw (stale writes are refused), and keep every earlier version readable. History rows cannot be updated or deleted; no event row is ever deleted. |
| Master Register | Each mutation records `RECORD_CREATED / RECORD_UPDATED / RECORD_CORRECTED / RECORD_STATUS_CHANGED / RECORD_LINK_ESTABLISHED / EVIDENCE_ASSOCIATED` attributed to the actor. |
| Evidence | Files use the existing GCS lifecycle (upload → quarantine → scanner → intake → evidence, `DRIVER_EVENT_EVIDENCE` document type). An event links only a document whose payload is **stored** and belongs to the **same company** (checked by trigger). Linking is not verification: a person verifies each link, and only verified evidence raises `source_reliability`. OCR or document matching alone never verifies. |
| Relationships and de-duplication | Possible duplicates are offered (same category, driver or vehicle, same day, within two hours); `DUPLICATE_OF` removes the later event from analytics. A citation, repair order, claim or maintenance record attaches to one event only, and one source reference carries one active consequence per kind, so the same occurrence is never counted twice. Source references make ingestion idempotent. |
| Consequences | Delay, downtime, missed service, estimated / actual cost, claim, recovery, injury, damage, enforcement, environmental, customer impact, investigation time and corrective-action cost, each with source, confidence, measurement date and canonical link. Measurement state is explicit (`MEASURED / NONE_CONFIRMED / NOT_COLLECTED / UNKNOWN`); missing is never zero; a newer measurement supersedes and the old one is kept. |
| Safety restrictions | Facts that oblige a restriction create it automatically: roadside driver / vehicle out-of-service = YES → mandatory enforcement restriction plus required follow-up; equipment "not safe to operate" = NO → mandatory equipment hold. An active mandatory restriction **blocks closing** (database trigger), **cannot be dissolved by correcting the answer** (service) and is **released only through the dedicated capability**, with the documented correction; an enforcement or regulator restriction additionally needs a stored, scanned, **person-verified** release document linked to that event (company clearance is refused for it). A released restriction is final. |
| Detail records (child collections) | Parties, injured persons, violations, inspected equipment, items, materials ... are validated for structure on the server (and, for Roadside Inspection, by the existing collection validators) and corrected like any other fact: a correction is a new version with its reason, the history lists each item **added, changed or removed** (item id, before, after), the earlier version stays readable in full, and nothing is silently overwritten. The correction screen edits the items' recorded values and can add or remove items. |
| Follow-up | Corrective actions with owner / due / status; a *required* action blocks closure until completed with a note. |
| Analytical fact | Contract `driver-event-fact/1` ([contract](bi-contract-v1.md)). |

## API (`/api/companies/{id}/driver-events…`)

`GET /` list · `POST /` create · `GET /{eventId}` full record (history, evidence, relationships, consequences, actions, restrictions, fact) · `PUT /{eventId}` correct (`expectedVersion`, `reason`) ·
`GET /{eventId}/versions?version=N` · `POST /{eventId}/status` · `/evidence` (link / verify / unlink) · `/relationships` · `/consequences` · `/actions` · `/restrictions` (issue / release) ·
`GET /{eventId}/duplicates` · `GET /facts`. Validation failures return every problem as `issues[{field,message}]`.

## Screens

`/companies/{id}/record-of-events`: list with filters, category chooser, event detail (restrictions first, facts, evidence upload → scan → link → verify, consequences, follow-up, relationships, status/closure,
data quality and analytical fact, immutable history) and correction. Collision, Near Miss, Roadside Inspection, Cargo Incident, Spill or Release and Customer Event open their **existing detailed wizards**
(now offering the company's canonical vehicles and resolving inspected equipment against them, and saving through the server). Every other category opens its **own workflow** (`lib/driver-events/workflows.ts`):
its sections, its statement of what it does *not* conclude, its suggested evidence and consequences, all rendered by one shared form. Fields are rendered by what they are, with explicit units, and with
*unknown / not applicable / not collected* as distinct stated answers.

## Implementation status by category

| Category | Workflow | Server-validated create / reload / correct / evidence / close / export / tenant denial |
|---|---|---|
| Collision, Near Miss, Roadside Inspection, Cargo Incident, Spill or Release, Customer Event | existing detailed wizard (canonical) | Yes — database lifecycle test (all categories) + browser run of each wizard |
| Security Incident, Equipment Failure / Critical Defect, Device / Data Integrity, Fatigue Indicator, Emergency Event | own workflow | Yes |
| Speeding, Harsh Braking, Harsh Acceleration, Harsh Cornering, Following Distance, Distracted Driving, Idle Time, Seatbelt | own workflow (telematics observation family) | Yes |
| Others (Other Event) | own workflow with classification review | Yes |
| Route Deviation (existing conditional category) | preserved, own workflow | Yes |

## Safety enforcement beyond the event

See [safety-enforcement.md](safety-enforcement.md): what is enforced where, and which workflows do not exist yet.

## Not verified or not done (stated, not hidden)

1. **Regulatory text could not be verified** in the build environment (network access to eCFR and the other sources was refused). Therefore no reportability, reporting deadline, accident-register
   or out-of-service *compliance* conclusion is computed or hard-coded; those facts are person-entered and labelled so, and the structure (report numbers, authority, required correction, response deadline,
   release evidence) is in place. Applicability of 49 CFR 390.15 / 396.9 and the Canadian provincial rules needs a counsel / safety-lead review before any automatic determination is added.
2. **Telematics / ELD provider feeds** do not exist yet. The observation categories accept manually entered or later-ingested events (`ingestion_origin` TELEMATICS_INGESTION / ELD_INGESTION, idempotent by source reference);
   device events are flagged `DEVICE_SOURCED` and `DEVICE_UNVERIFIED` until a person verifies them.
3. **Exposure (distance, driving hours)** is deliberately not stored on events; rates need the trip / ELD fact layer to be joined.
4. **Trip, shipment and customer** have no canonical records yet: those links are references (text) until they exist, then become ids.
5. **Customer-facing access** to events does not exist (SYSTEM scope only), by design for this phase.
6. The legacy browser-local Driver workspace still exists for drivers that were never moved; its events are **not** copied into PostgreSQL.
7. **Server validation of the detailed workflows** (production gate): the Collision, Near Miss, Cargo Incident, Spill or Release and Customer Event validators now run on the server (`lib/driver-events/workflow-rules.ts`) on create and on every versioned correction, covering controlled values (also inside child-collection items), duplicate item ids, required parties and cross-field consistency. Rules that require a child item to reference evidence *already linked to the event* are not applied at creation, because evidence is stored, scanned and linked to the saved event afterwards; they are covered by the evidence lifecycle instead. Roadside has its own rules (`child-collections.ts`).
8. Production: the migration, deployment and any push require explicit owner approval and have not been performed.

## Evidence requirements through the lifecycle (closure)
Evidence is stored, scanned and linked to the **saved** event, so it cannot exist at creation. Where the approved workflow requires it, the canonical store enforces it at the later stages (`lib/driver-events/operations.ts`):
- **Closing:** a category whose policy requires evidence (19 of the 21 recordable categories) cannot be closed without at least one active link to a stored document (verification is a separate act and is not required to close). The last document of a closed event cannot be unlinked (reopen first). Categories that do not require evidence (e.g. Other Event) are unaffected. The check runs after the database guards, so an active restriction or open follow-up is reported first.
- **Detail items:** an item may reference only documents actively linked to this event (none at creation; the event's active links on a correction); a referenced document cannot be unlinked; reference changes appear in the correction history as `evidenceIds`.
- **Uploaded-document statements:** an obtained Driver Statement whose method is an uploaded document must reference its linked evidence before the event is closed.
- **Release of an enforcement restriction:** unchanged and enforced in the service and by trigger (stored + same company + role `RELEASE_EVIDENCE` + person-verified).
The closure rule is a service rule (this application is the only writer); the release rule is also a database trigger.
