# Company recovery browser harness (test-only)

Throwaway tooling used for `docs/evidence/company-recovery/`. Nothing here runs in production and none of it is imported by the app.

1. `bash db.sh` – disposable PostgreSQL on 127.0.0.1:55432 with the repository migrations; then apply `seed.sql` as the migrator role (three staff actors: full, limited, none).
2. `git worktree add --detach /tmp/tes-e2e/app HEAD`, symlink `node_modules`, copy `next.config.e2e.mjs` over `next.config.mjs`, and overwrite `lib/database/postgres.ts` in **that worktree only** with a `pg.Pool` on `E2E_RUNTIME_DATABASE_URL` (`postgres://tes-backend%40tes-production-510007.iam@127.0.0.1:55432/tes_prod`). `stubs/` replaces Clerk (the signed-in subject is the content of `/tmp/tes-e2e/actor.txt`).
3. `next dev --webpack -p 3100`, then in `pw/` (with `playwright-core` and the Chromium in `/opt/pw-browsers`): `node create.mjs && node edit.mjs && node workspaces.mjs && node isolation.mjs && node failed-ui.mjs && node legacy.mjs`.
4. Batch 2 (restored workspaces): `node b2-a.mjs` (Authorities), `b2-b.mjs` (Business, Settings, Tax Filing), `b2-c.mjs` (Contacts), `b2-d.mjs` (Insurance), `b2-e.mjs` (Credentials), `b2-f.mjs` (denial, signed-out, legacy and unknown ids). `b2-a.mjs` creates the two companies the others reuse (`/tmp/tes-e2e/b2-ids.json`), so run it first. `features.mjs` no longer drives the replaced Contacts/Authorities/Insurance/Credentials interfaces.

Never point it at a shared or production database.
5. Batch 3 (Vehicles and Drivers): from a fresh database run `node b3-a.mjs` (Vehicles; it creates the two companies the others reuse in `/tmp/tes-e2e/b3-ids.json`), then `b3-b.mjs` (Drivers), `b3-c.mjs` (denial, signed-out, legacy and unknown ids, driver-application containment), `b3-d.mjs` (edit flows: unit-number correction, archive, driver profile correction, licence and relationship history, hiring refusal). They share `b2-common.mjs`.
6. Evidence Phase 2: `node ev2-insurance.mjs` (Insurance policy attachments; seeds stored evidence rows; uses the `user_e2e_readonly` and `user_e2e_noevidence` actors of `seed.sql`). Run `b2-a.mjs` and `b2-d.mjs` before it only to re-check the Insurance create/edit flows.
