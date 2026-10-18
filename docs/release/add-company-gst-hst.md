# Add Company simplification, GST/HST and Primary Contact

Baseline: `main` 17f30d7. Not applied to Production; needs founder authorization.

## Migration 0034 (`0034_gst_hst_registration_program_and_unresolved_jurisdiction.sql`)
Forward-only, additive; 0001-0033 untouched. Requires the Production ledger to be exactly 0001-0033.
1. `registration_programs`: family `SALES_TAX` and program `GST_HST` (national, CA, no region).
2. `operating_authority_versions.jurisdiction_country` loses NOT NULL (an IRP base may be unknown) and gains `region_needs_country`.
3. `guard_authority_version_insert` and `guard_registration_version_insert` (CREATE OR REPLACE, still SECURITY INVOKER, fixed search_path)
   accept an explicitly unresolved jurisdiction on an INITIAL version of MVID, SAFETY_FITNESS, IRP and IFTA only.
No new table, grant, policy or trigger; no data is rewritten. Old application code keeps working on the new schema (it never writes an unresolved version).
Release order: apply 0034 first, then deploy. The older per-migration verification scripts for 0013/0016 assert the original guard bodies and
catalogue size; they describe the schema at their own migration and are not re-run for 0034.

## Behaviour
- Form: titled Add Company; no banner or helper text; short labels; tooltips only on Operating Region and Service Start Date; derived
  read-only fields (service type, status, end date, assessment date) are on the profile, not the form.
- No issuing-province / base-jurisdiction selectors. RIN and CVOR are derived (Ontario). MVID, NSC, IRP and IFTA numbers are recorded with the
  jurisdiction UNRESOLVED (never taken from incorporation or the registered address) and shown as "jurisdiction not set"; it is set later by a
  correction in Authorities / Tax Filing, which keeps the unresolved version as history. An API caller may still state a jurisdiction.
- GST/HST Account: CRA format `#########RT####`, must begin with the Business Number when one is recorded; stored as a GST_HST registration,
  shown on the profile, edited in the company Edit page (correct, replace = archive + new, clear = archive); events in the Master Register.
- Primary Contact: one field. A full name is stored as typed (not split) as a new canonical person with the PRIMARY purpose; people already on
  record with the same name are offered as an explicit choice (`POST /api/people/matches`, PERSON_REGISTRY_READ); a chosen person is linked
  (same person, no duplicate). Nothing is matched or merged by name. The profile links to Contacts.
