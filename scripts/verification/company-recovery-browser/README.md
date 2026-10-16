# Company recovery browser harness (test-only)

Throwaway tooling used for `docs/evidence/company-recovery/`. Nothing here runs in production and none of it is imported by the app.

1. `bash db.sh` – disposable PostgreSQL on 127.0.0.1:55432 with the repository migrations; then apply `seed.sql` as the migrator role (two staff actors).
2. `git worktree add --detach /tmp/tes-e2e/app HEAD`, symlink `node_modules`, copy `next.config.e2e.mjs` over `next.config.mjs`, and overwrite `lib/database/postgres.ts` in **that worktree only** with a `pg.Pool` on `E2E_RUNTIME_DATABASE_URL` (`postgres://tes-backend%40tes-production-510007.iam@127.0.0.1:55432/tes_prod`). `stubs/` replaces Clerk (the signed-in subject is the content of `/tmp/tes-e2e/actor.txt`).
3. `next dev --webpack -p 3100`, then in `pw/` (with `playwright-core` and the Chromium in `/opt/pw-browsers`): `node create.mjs && node edit.mjs && node workspaces.mjs && node isolation.mjs && node failed-ui.mjs && node legacy.mjs`.

Never point it at a shared or production database.
