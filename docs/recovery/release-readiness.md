# Release readiness

**Nothing here has been executed. No merge, deployment, production migration, production grant or production data change is authorized by this document.**

| Item | Value |
| --- | --- |
| PR | [#20](https://github.com/mehbobhq/TESPortal/pull/20) (supersedes #19; the IAM-reconciliation branch is untouched) |
| Branch | `claude/company-recovery-clean`, based on `main` (includes PR #18) |
| Commit SHA | the head of the PR at approval time; the code state described in `verification-report.md` is the commit recorded in the PR description |
| Migrations | none added or edited; ledger unchanged (32) |
| Infrastructure | none touched (Cloud SQL, WIF, IAM, GCS, scanner, Eventarc, Vercel configuration, secrets) |

## Before approval (read-only)

1. Re-check CI on the final head (`Company Recovery CI` on PostgreSQL 17, the TypeScript gate, the other triggered jobs).
2. Run `scripts/database/assessment/creator-capability-check.sql` as a read-only identity: which actors can create and edit a complete company. A TES_STAFF creator needs `ORGANIZATION_CREATE`, `COMPANY_PROFILE_MANAGE`, `CUSTOMER_ESTABLISH`, `ORGANIZATION_UPDATE`, `CONTACT_MANAGE`, `TAX_REGISTRATION_MANAGE` (and the read capabilities listed in `docs/company-recovery.md` to open every section); Master Account actors pass. **If a gap exists, the least-privilege correction (only the missing codes, for the named actor, through the reviewed change process, with before/after output and approval) is the only permitted fix; it is not performed here.**
3. Run `scripts/database/assessment/company-recovery-assessment.sql` and `power-way-identification.sql` read-only and keep the output. Confirm Power Way Logistics Inc is identified by its canonical organization id and that no duplicate exists. Values the old creation form discarded before saving are not in the database and **must not be described as recovered**; only a source document or the original submission can justify re-entering them, through the normal edit screens.
4. Identify the database a Vercel preview is wired to. **Prove it cannot modify production before any write test**; if it points at production, perform read-only checks only. Then run the preview checklist in `docs/company-recovery.md` with a real creator account.

## Deployment (only after explicit approval)

1. Deploy the approved commit to a **preview** and complete the checklist above (sign-in with Clerk, create a test company only if the database target is proven safe).
2. Promote through the normal Vercel promotion. **No migration is run.**
3. Post-deployment, read-only: re-run the assessment SQL; counts must be unchanged until users act; open one existing company in every workspace; confirm the browser-local banners appear on the original workspaces and that no company was duplicated.

## Rollback

Rollback = promote the previous Vercel deployment. Because nothing in the database schema changed, the previous code runs against the current schema.
**Data written after deployment is not undone by redeploying old code**: companies, contacts, addresses, authorities, registrations, scope periods, ended engagements and Master Register events created or edited by this version are ordinary canonical rows (append-only history, corrections flagged, nothing deleted). The previous version reads identity only and will simply not display the additional records; it will not corrupt them. A mistaken record is corrected through the domain's own correction operations (flagged, never deleted); an ended engagement is never reopened (migration 0015), so **ending a customer's service from Edit is irreversible by design**: use it only on confirmed requests.

## Known limitations and unresolved decisions

See `docs/company-recovery.md`, `canonical-field-ownership.md`, `functional-regression-matrix.md` and `verification-report.md` section 4. In short:
legacy Vehicles not restored (approved evidence-store ratchet); ten creation fields without a canonical owner and the mandatory Cargo rule; Block 01 D/E replaced the rich pages (not reversed, originals reachable as browser-local tabs for Business, Insurance, Authorities, Tax Filing, Credentials, Drivers, Contacts, Settings, Citations); driver/person creation, vehicle registration and archive operations, medical qualification operations, tax filing calendar/records and insurance evidence have no canonical operations; the `send-invitation` route has no TES capability check (open finding, unchanged); 40 database tests and 3 static tests fail identically on `main`.
