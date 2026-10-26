# Production cutover — owner checklist (release `1e60eb2` plus the correction and verification commits)

Nothing here has been executed. Every step needs the owner's explicit approval. Release scope: **24 commits on top of `origin/main` `0327263`; migrations 0040, 0041, 0042, 0043** (driver operating scope, driver hiring application with the public applicant API and signed PDF, Driver Events), plus two correction commits (CI pins, documentation). The repository is a fast-forward of `main`; no force, no branch.

## Why the order is what it is
- Production migrations run only from `main` (`production-database-migration.yml`: `workflow_dispatch`, `github.ref == 'refs/heads/main'`, environment `production-database`). The push therefore comes first, and **a push may deploy production** unless held.
- Migration 0041 removes the 0039 function `tes_security.open_driver_application_invitation(text)` and redefines `tes_security.submit_driver_application`. The **old** code (`main`) calls both (`lib/auth/tes-invitation-access.ts`) for the **applicant-facing** invitation link and submission. Staff screens of the old code are unaffected (the changes are additive).
- The **new** code on the **old** schema is not harmless either: its prospect check (`lib/driver-prospects/schema-state.ts`) needs the 0041 functions, so on a 0039 database every prospect operation (including the existing onboarding rows in the drivers register) reports "not available yet". Driver Events pages fail until 0042.
- So both orders have a short degraded flow. The chosen order (**migrate, then promote**) degrades only the applicant invitation link on the old code, for minutes, and nothing staff-facing.

## 1. Confirm a production deployment can be held before pushing
Owner, in the Vercel project (the project name in `lib/google/auth.ts` is `tesportal`; the dashboard could not be inspected from here):
1. Settings → Git: record the Production Branch (expected `main`).
2. Choose and enable ONE hold that you can see in the dashboard, for example: disable automatic assignment of the production domain for new Production deployments, or an Ignored Build Step that skips the build. (The precedent, `docs/release/company-customer-persistence-release.md` step 4: "hold Vercel auto-deploy, otherwise pause the deployment".) Write down which one.
3. Record the SHA of the deployment currently serving production (expected `0327263`); this is the rollback target.
4. Stop if no hold can be set. A push without a hold is a production deployment before the migrations.
After the push: the new deployment must show as built but **not** serving production; the production domain must still serve `0327263`.

## 2. Read the actual production migration ledger and count live invitations (read-only, existing workflow)
Use the existing workflow **Production 0037/0038 Read-only Verification** with the new phase **`baseline-0039`** (manual dispatch from `main`, environment `production-database`, the same GitHub OIDC → Workload Identity → Cloud SQL Auth Proxy path; no new credential or permission). It reports PASS / FAIL / UNVERIFIED for: read-only enforcement (the database refuses a probe write before anything is read), ledger count = 39, latest = `0039` and contiguous, ledger filenames = repository files 0001–0039, every ledger SHA-256 = the repository file's SHA-256, and the number of live invitations (a count only; no applicant data). It also runs the existing backup/PITR evidence step first. It never runs the migration runner. The phase can only be dispatched once the workflow exists on `main`, so it runs **after the push (deployment held) and before the migration**.
Stop if any item is FAIL or UNVERIFIED (for example, 40+ ledger entries means someone applied a migration by hand). Read-only enforcement is per session and per transaction; the identity itself is the migrator, which has write privileges, so this is not identity-level read-only.

## 3. Verify backup / point-in-time recovery readiness
Owner, in the Cloud SQL console for the instance in `TES_CLOUD_SQL_INSTANCE`: automated backups enabled and the latest backup successful (record its time); point-in-time recovery enabled and its retention window; record the timestamp **T0** immediately before step 6. Use the existing automated backup and PITR; an extra on-demand backup is optional and the owner's call (no spending is requested). Stop if neither a recent backup nor PITR exists.

## 4. Approvals and execution order
| # | Action | Approver | Stop condition |
|---|---|---|---|
| 1 | Approve the scope (the 24 release commits, migrations 0040–0043, and the correction and read-only-verification commits on top) | owner | any doubt |
| 2 | Section 1 done (hold enabled, rollback SHA noted) | owner | no hold |
| 4 | Section 3 done: backup/PITR confirmed, T0 recorded | owner | not confirmed |
| 5 | Re-check `git ls-remote origin refs/heads/main` = `0327263a82a1676007385ab1d706ed154924c951` | owner | advanced: **stop**, no force |
| 6 | Approve and run the fast-forward push of the final commit to `main` (deployment held) | owner | deployment starts serving: pause/rollback to the noted SHA at once |
| 6b | Dispatch `Production 0037/0038 Read-only Verification` with phase `baseline-0039` (Section 2); note the live-invitation count | owner | any FAIL or UNVERIFIED |
| 7 | Wait until the held deployment is built and Ready (not serving) | owner | build fails: leave the old deployment serving, fix forward |
| 8 | Approve and dispatch `Production Database Migration` (environment `production-database`) | owner | log must end at ledger 43; a failure leaves the previous version (each migration is its own transaction) |
| 9 | Post-check, read-only: ledger 43 with the repository checksums; RLS tables 116 and policies 198 (the same queries as the CI pin); the three `DRIVER_EVENT_*` capabilities exist and are granted to nobody | owner | any mismatch: **do not promote**; the old code keeps serving with only the applicant invitation flow affected |
| 10 | **Immediately** release the held deployment | owner | — |
| 11 | Read-only smoke, no writes: companies, drivers (with onboarding rows), prospects load; Record of Events denies actors without a capability | owner | regression: Vercel rollback to the noted SHA (only applicant flows of the old code are affected) |
| 12 | Separate approval later: grant `DRIVER_EVENT_*` capabilities to named actors; production smoke P1–P9 for the live scanner path | owner | any failed step: revoke the grants |
Recovery: no down migrations; correct forward with a new migration. Restoring from backup/PITR is a last resort, needs separate approval and discards later writes.

## 5. How the migration-to-deployment window is kept short
- The new deployment is **built and Ready before any migration runs** (step 7), so releasing it is one action, not a build.
- The two migrations that touch the applicant functions (0040, then 0041) run back to back in one workflow run; the window of old code against the new schema is the run time of 0041 plus the post-check plus one promotion. Keep the post-check scripted and ready in advance (queries in step 9) so it takes minutes.
- Pick a low-traffic moment and use the live-invitation count from Section 2: if it is zero, nobody is affected during the window.
- If the post-check fails, do not release the deployment; staff features of the old code keep working.
- The reverse order (deploy before migrating) was rejected: it would put every prospect operation, including existing onboarding rows, into "not available yet" for the whole window, not just the applicant link.

## 6. What this checklist does not cover
Live verification of the production buckets and scanner (not done; Driver Events stays inert until step 12), and the two other CI workflows that already pin a ledger count of 34 (`contracts-foundation-ci.yml`, `evidence-payload-lifecycle-ci.yml`), which were stale on `main` before this release (the chain was 39 there) and are outside this correction.
