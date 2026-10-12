# Core Operational Identity Graph: additive completion (migrations 0025-0026)

Migrations 0020-0024 (see `core-operational-identity-boundaries.md`) closed the canonical identity graph and the system-wide
RLS foundation. This change adds only what that implementation did not provide, without altering any closed migration.

## What is added

| Migration | Adds | Does not touch |
|---|---|---|
| 0025 | `insurance_coverage_vehicles`: the vehicles a vehicle-scheduled insurance coverage insures, effective-dated with correction history, RLS consistent with 0024 | `insurance_coverages` and `vehicles` (no ALTER); the whole-fleet coverage model |
| 0026 | `vehicle_merges`: the ledger of every vehicle merge and reversal, deferred consistency triggers on the ledger and on `vehicles`, RLS consistent with 0024 | Person and driver identity (0021 has no merge representation); `vehicles` columns |

Server code: `lib/insurance` gains the schedule operations (`scheduleVehicle`, `removeScheduledVehicle`, `changeSchedule`,
`correctSchedule`, `getCoverageSchedule`, `getVehicleInsurance`) and carries a schedule forward atomically through
`correctCoverage`, `correctTerm`, `correctEndorsement` and change endorsements; `lib/vehicle-merges` adds `mergeVehicles`,
`reverseVehicleMerge`, `resolveVehicle` and `listVehicleMerges`. Capabilities are the existing INSURANCE_* and VEHICLE_* ones;
nothing is granted to anyone.

## Rules enforced by the database

* A schedule belongs to an active, vehicle-scheduled coverage of the same Organization, lies inside the coverage, term and
  cancellation window, and its vehicle is active and OPERATED by the insured Organization on the first day. Active windows of
  one vehicle on one coverage never overlap (exclusion constraint). A corrected row is frozen.
* The vehicle check reads VEHICLE-protected tables while the transaction carries an INSURANCE capability, so it is the single
  `SECURITY DEFINER` trigger function this change adds: fixed `search_path`, no input beyond the row, not executable by the
  runtime role, returns nothing.
* A merge is an alias, never a foreign-key rewrite or a delete. Both vehicles are active when merged; a vehicle is `merged`
  exactly while it has one active ledger row pointing at `merged_into_vehicle_id` (checked at commit from both sides); a
  reversal is refused while the survivor is itself merged away, and fails as a VIN collision when the VIN was taken meanwhile.
  Ledger content is immutable; the only change is the one-way `active -> reversed`.

## Classification of every boundary

| Boundary | Classification | Why |
|---|---|---|
| Insurance renewal does not carry the vehicle schedule | Legitimate downstream | A renewal is a new real-world period; vehicles are scheduled again explicitly. Corrections and endorsements do carry it. |
| Person and driver merges | Legitimate downstream | 0021 has no merge representation; adding one redefines identity and needs its own design. |
| `getVehicleInsurance` reads in two transactions | Legitimate downstream | Vehicle rows are invisible under INSURANCE capabilities by design of 0024; the read composes two authorized reads. |
| Merged vehicles that exist before 0026 | Verified, none allowed | 0026 has no backfill; the PRE verification fails if any vehicle is already merged. |
| Granting the capabilities, API routes, UI | Legitimate downstream | Authorization program and application layer. |

## Defects found in the closed implementation (not changed here)

* Master Register writes failed for every SYSTEM capability except MASTER_REGISTER_READ because `append()` used
  `INSERT ... RETURNING`, which needs a SELECT policy that 0024 grants only to that capability. Fixed in
  `lib/master-register/postgres-repository.ts` (no `RETURNING`) with a regression test.
* Under 0024 the `organizations` policy excludes VEHICLE_* and the `organization_person_relationships` policy excludes
  INSURANCE_MANAGE, so `establishOrganizationVehicle` and insurance policies with a broker contact fail. These need a policy
  change in a reviewed migration and are not altered here.

## Migration 0027: organization access policies (policy-only)

0027 resolves the two defects listed above. It creates no table, column, function, trigger, capability or seed row and grants
nothing. It runs exactly two `ALTER POLICY ... USING` statements; `WITH CHECK` and the CUSTOMER policies are untouched, so the
added capabilities can read and lock rows but never insert, update or re-parent them:

* `organizations_system` (`public.organizations`) additionally sees rows for `VEHICLE_READ`, `VEHICLE_MANAGE`, `DRIVER_READ`,
  `DRIVER_MANAGE` and `IDENTITY_RESOLUTION_MANAGE`.
* `organization_person_relationships_system` additionally sees rows for `INSURANCE_MANAGE`.

Production verification (shared script, fragment `0027.sql`, selectable as FROM / THROUGH, default THROUGH 0027): the static
check allows only those two single-statement `USING` alterations; the PRE phase requires the complete policy sets of both
tables to equal the 0024 definitions; the POST phase requires the complete post-0027 policy sets (so an extra, missing or
altered policy fails) and RLS enabled, not forced. The expected definitions are generated from a database migrated through
0026 (pre) and through 0027 (post) with the same catalogue query the verifier runs.

## Migration 0028: SYSTEM policy closure (policy-only)

0028 is also policy-only (seven `ALTER POLICY` statements; no table, function, trigger, capability or seed row; nothing is
granted). It supersedes the `organizations_system` list of 0027 (final list; `VEHICLE_READ` and `DRIVER_READ` are removed
again because no existing operation reads an Organization under them) and closes four policies whose existing operations
failed: `customer_engagement_stages_system`, `organization_identifiers_system`, `organization_aliases_system` and
`organization_classifications_system` (USING and WITH CHECK), and widens the USING of `registrations_system` and
`registration_status_periods_system` by `COMPANY_PROFILE_READ` (WITH CHECK unchanged; `registration_versions_system` is untouched, and the verifier checks its policy set exactly so a stray change fails).
`organizations_system` keeps its WITH CHECK.

Production verification (fragment `0028.sql`): the static check allows exactly those seven single-statement alterations with
`tes_security.system_context_authorized(ARRAY[...])` expressions only. PRE requires the complete policy sets of all seven tables
to equal their state after 0027; POST requires the complete post-0028 sets. A policy that a later migration changes again is
gated: the 0027 post section for `organizations` runs only when THROUGH is 0027 (a THROUGH 0028 run verifies the table through
the 0028 section), and the 0028 pre section for `organizations` runs only when FROM is above 0027 (otherwise the database is
legitimately in the pre-0027 state). The generator derives each state from databases migrated through the previous migration
(`PRE_PGPORT_0026`, `PRE_PGPORT_0027`) and through the migration itself.
