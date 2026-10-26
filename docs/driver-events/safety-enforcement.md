# Safety restrictions — where they are enforced, and where nothing exists to enforce them

A *safety restriction* is created by an event (roadside driver / vehicle out-of-service = Yes, equipment "not safe to operate" = No, or one issued by hand). It is **mandatory** unless a person issued a company-only one as non-mandatory; enforcement and regulator restrictions are always mandatory (database check, migration 0043).

## Enforced today (with the test that proves it)

| Where | Rule | Layer | Test (`test/lib/driver-events/driver-events.db.test.ts`) |
|---|---|---|---|
| Event closure | cannot close while a mandatory restriction is active | DB trigger | "roadside OOS creates a mandatory restriction …" |
| Event "Not Applicable" | cannot be set aside while a mandatory restriction is active | DB trigger (0043) | "safety restrictions cannot be bypassed …" |
| Marking the event a duplicate | refused while a mandatory restriction is active (it would drop out of analytics) | service + DB trigger (0043) | same |
| Correcting the answer | OOS Yes → No / hidden is refused while the restriction is active | service | roadside test |
| Draft events | a draft that says OOS = Yes already creates the restriction | service | bypass test |
| Company clearance of an enforcement order | refused; release needs the dedicated capability **and** a stored, scanned, person-verified `RELEASE_EVIDENCE` document linked to that event | service + DB trigger | roadside test, "evidence lifecycle failure cases" |
| Non-mandatory enforcement order | refused | service + DB check (0043) | bypass test |
| Activating a driver as a company driver (`establishOrganizationDriver`, status ACTIVE) | refused while the person has an active mandatory DRIVER restriction **in that company** (boolean lookup `tes_security.driver_event_person_restricted`, no event detail disclosed) | service | bypass test (refused for the stated reason) |
| Transferring a driver to another company (`transferOrganizationDriver`) | same check in the company that holds the restriction, so a transfer cannot shed it | service | tests: a restricted driver is refused for the stated reason; with the lookup missing, NULL or raising, a transfer is refused and nothing is moved (see fail-closed below). A fully *successful* transfer of a released, verified driver is covered by the existing driver-identity suite; the combination "released, then transferred" was not added. |
| Any workflow, for any driver or vehicle | `driver_event_active_restrictions_v1` and `GET /api/companies/{id}/driver-events/restrictions/active?personId=|driverRelationshipId=|vehicleId=` return the active restrictions by person, relationship or vehicle | view + API | bypass test |

## Not enforced because the workflow does not exist canonically

The repository has **no PostgreSQL dispatch, trip, load assignment, movement, driver–vehicle assignment or hours-of-service workflow** (no table, service or API route; those words appear only in the legacy browser-local stores and labels). There is therefore nothing to block, and **system-wide enforcement is not claimed.** Each of those workflows, when built, must call the active-restriction lookup before putting a driver or a vehicle to use and refuse while a mandatory row exists; the lookup, the view and the API are ready for it.

| Workflow | Status |
|---|---|
| Dispatch / trip / load assignment | does not exist (NOT APPLICABLE) — must consult the lookup |
| Movement / vehicle use / driver–vehicle assignment | does not exist — must consult the lookup |
| Hours of service | does not exist canonically (HOS Violation is a linked-record category) — must consult the lookup |
| Vehicle administration (`establishOrganizationVehicle`) | creating a relationship is not "use"; not blocked |
| Legacy browser-local driver and vehicle workspaces | local prototypes with no link to the canonical store; they cannot see a restriction. Not enforced |

## Known limits

* **Cross-company:** a driver restriction is evaluated inside the company that holds it. A person under an out-of-service order who is later onboarded by a *different* company is not seen by that company (it cannot read another company's events). Surfacing it needs a person-level restriction registry and an owner decision on disclosure. NOT IMPLEMENTED.
* **Vehicle merges:** restrictions follow the vehicle id; the effect of merging two vehicle records on an active restriction was not verified.
* **Unknown is not Yes:** an OOS answer of *Unknown* creates no restriction; it must be resolved by correction.
* The regulatory meaning of an order (who may release it, deadlines) is not computed; see the architecture note on regulatory text.

## Fail-closed behaviour of the lookup (production gate)

Activation and transfer call `tes_security.driver_event_person_restricted`. Where Driver Events exists (the event tables or the function are present) the lookup **must answer**:

| Situation | Result |
|---|---|
| function missing while the Driver Events tables exist | refused: "safety-restriction status could not be confirmed" |
| function answers NULL (the caller was not authorized to ask) | refused, same message |
| function raises a database error | refused; the error propagates and the transaction rolls back; no relationship row is created |
| function answers `true` | refused: active safety restriction |
| function answers `false` | not refused for a safety reason |
| neither the Driver Events tables nor the function exist (Driver Events not installed) | nothing to consult; not refused |

Test: `driver-events.db.test.ts`, "safety lookup fails closed" (activation and transfer; missing, NULL and raising lookup; a clean driver, so the lookup alone decides; relationship counts unchanged). The test fails against the previous fail-open code.

## Denied safety-release audit (closure)
A refused release is recorded **outside** the rolled-back business transaction (`lib/driver-events/service.ts`, `releaseEventRestriction`). No migration: it reuses the Master Register and its registered event type `RESOURCE_ACCESS_ATTEMPTED`.
- A separate transaction appends one event: outcome `FAILURE`, a **fixed reason code** (`CAPABILITY_DENIED`, `RELEASE_DOCUMENT_REQUIRED`, `RELEASE_DOCUMENT_NOT_LINKED`, `RELEASE_DOCUMENT_UNVERIFIED`, `COMPANY_CLEARANCE_REFUSED`, `ALREADY_RELEASED`, `RELEASE_NOT_APPLIED`, `NOT_FOUND`, `INVALID_REQUEST`, `STATE_REFUSED`), the actor, timestamp, and a request identifier (`x-request-id` when supplied, else generated). It is written as the strongest SYSTEM capability the actor holds (release, then manage, then read); an actor holding none cannot write the register and is covered by the structured log line only.
- Identifiers are recorded exactly as submitted and never looked up; the caller sees only the original refusal (a nonexistent event and another company's event give the same message). No evidence document id, free text or secret is recorded or logged.
- The register is append-only (the application role has SELECT and INSERT only) and readable only with `MASTER_REGISTER_READ`; event staff read zero rows.
- A failure to write the audit is logged and swallowed; the original refusal is rethrown, so it can never become a release, and the restriction stays `ACTIVE`.
Tests: `driver-events.db.test.ts`, "a denied safety release is recorded durably…" (capability and evidence denials, forged ids, simulated audit failure, actor with no capability, unreadable/immutable history). It fails when the recording is disabled.
