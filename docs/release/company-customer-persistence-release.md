# Company/Customer persistence: release and recovery procedure

Branch `release/company-customer-persistence`, based on Production baseline `main` 11e2fcd. Nothing here has been executed against Production.
Approval needed: one explicit founder authorization covering the merge, migration 0033 and the deployment, in the order below.

## 1. What is in the increment
- Migration `0033_company_customer_profile_facts.sql`, byte-identical to the approved file (sha256 `47f3e9e12489a0feecb4aefda209dbbdf7dc22cb45db6109b540a2ec28256eb7`; a test freezes it).
- Company create/edit/profile persistence: Website, Cargo Information, fleet providers (ELD/HOS, GPS/Telematics, Fuel), billing preference, customer lifecycle,
  atomic edit, truthful "Not yet assessed", service type read from authorized contract records only.
- Required prerequisite already inside the branch: the PR #20 company-recovery stack (d6782ee). The Company/Customer files import its create-company, read-profile,
  contacts and operational-identity modules, which are not on `main`; a direct cherry-pick onto `main` fails with modify/delete conflicts.
  Consequence: the release is not isolable below that stack, and it also changes sibling company workspaces (insurance, credentials, tax filing, authorities,
  business, drivers, vehicles) from browser-held data to canonical or "not yet available" states. The founder accepts that behavior change by authorizing this release.
- Not included: the security-containment candidate (driver-application endpoints and related changes), Preview-auth hardening, `src/restored/*`.
  Production behavior in those areas is unchanged. Authorization, RLS and Master Register code are already on `main`; 0033 adds its own RLS and SYSTEM-gated policies.

## 2. Migration dependencies
- The ledger must be exactly 0001-0032 with the repository checksums, because `scripts/database/migrate.sh` is gapless and applies every pending migration.
- 0033's SQL needs objects from 0016, 0019, 0023 (`btree_gist`), 0024 (guard functions) and the seeded capabilities; the application's service-type read also needs the
  contracts tables of 0030/0031. All are checked by the pre phase of `scripts/database/verify-production-company-customer-profile-facts.sh` (read-only).
- 0033 only adds tables, catalogues, indexes, constraints, functions and triggers. It has no column changes to existing tables and no data rewrite.
- Compatibility proof (disposable PostgreSQL): `test/lib/company-directory/legacy-records-compat.db.test.ts` seeds legacy-shaped companies, customers and
  engagements, including a duplicate-looking pair; after 0033, reads return the same rows (profile fields null/empty, "not contracted", "not yet assessed"),
  reads write no facts, and editing one record or creating a similar name leaves every other record untouched. Nothing merges, overwrites or deletes.
  A full-row fingerprint of organizations, customers, customer_engagements and organization_channels was identical before and after applying 0033.
- Skew: `main`'s code against a 0033 database shows no failures beyond `main`'s own baseline, so applying the schema before the code is safe.

## 3. Release order
1. Founder authorization. Choose a short write-quiet window (the fingerprint in step 3 is valid only if no application writes occur between steps 3 and 6).
2. Founder: confirm a restorable backup or a point-in-time-recovery marker exists and note its timestamp.
3. Pre-check as the migrator, read-only: `TES_VERIFY_PHASE=pre bash scripts/database/verify-production-company-customer-profile-facts.sh`. Stop if it fails. Record `FINGERPRINT=`.
4. Merge the release branch to `main` (code does not deploy until step 7 if Vercel auto-deploy is held; otherwise pause the deployment).
5. Apply: `bash scripts/database/migrate.sh` as `tes-database-migrator@tes-production-510007.iam`. 0033 is one transaction; a failure leaves the ledger at 32.
6. Post-check: `TES_VERIFY_PHASE=post TES_VERIFY_FINGERPRINT=<value> bash scripts/database/verify-production-company-customer-profile-facts.sh`.
   Must show ledger 33 with the approved checksum, RLS and policies, no runtime DELETE/TRUNCATE/table-wide UPDATE, constraints, indexes, triggers and an unchanged fingerprint.
7. Deploy the code. The feature is live as soon as it deploys; there is no feature flag.
8. Read-only smoke on Production (no synthetic writes): open an existing company profile and edit page, the Companies and Customers lists, and confirm existing records
   display, the duplicate-looking pair (if any) is still listed separately, and fields not yet recorded read "Not recorded" or "Not yet assessed".

## 4. Failure containment and recovery
- Migration fails in step 5: nothing is applied (transaction); fix forward and retry; no recovery action needed. Hold the deployment.
- Post-check fails in step 6: do not deploy the code. Old code is compatible with the 0033 schema, so Production keeps working; investigate before any further step.
- Code problem after step 7: roll back the application with Vercel "Instant Rollback" to the previous deployment. This is safe because the old code works on the 0033 schema.
  The extra tables stay in place and unused.
- 0033 is additive and has no down migration. Never edit it, never delete or edit ledger rows. Correct forward with a new migration (0034) under a new approval.
  Dropping the new tables, or restoring from the backup in step 2, are last resorts that need separate founder approval; restoring discards later writes.
- Data containment: 0033 touches no existing row; the runtime role cannot delete or truncate any new table, and fact changes are end-old/start-new or corrected/voided, so history is kept.

## 5. Known limitations at release
- At 390px width the profile page header actions overflow horizontally (539px). The same header renders the same way on the candidate branch and is unchanged
  shared code; it is not fixed here to keep the increment minimal.
- The Production ledger was not read (no Production connection); step 3 is the first check against the real ledger.
