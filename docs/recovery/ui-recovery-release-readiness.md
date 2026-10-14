# UI recovery release readiness

**Status: not ready to merge or deploy.** Nothing was merged or deployed.

Ready: domain behavior, authorization, isolation, history and Master Register semantics of the restored workspaces (full DB suite, zero new failures versus main), type baseline, build, static boundaries.

Blocking before release:
1. Browser verification and screenshots of every restored workspace on a disposable database (not yet done; see verification report).
2. Human review of decisions that needed judgement, listed per workspace in `matrix/*.md`, in particular: insurance archive reason stored in the existing event `outcome.reason` and new `organizationId` scope guards in `lib/insurance/operations.ts`; new Business identifier operations (`lib/corporate-identity/business-identifiers.ts`) over `organization_identifiers`; new vehicle and driver operations (no migration); PDF preview sandbox restored on the dedicated recovery branch (`5b4ad2e`), still requires browser rendering/security verification; registration-type and vehicle-type mappings; Settings save is per-item not atomic.
3. Existing blockers unchanged: ten company fields without an owner, citations domain, evidence links, filing/obligation domain, legacy-data import, inherited failures on main (40 DB, 3 static).
4. No production migration, IAM, GCS, RLS or grant change is part of this branch; none is needed for it.

## October 14 preservation and bounded recovery decision

- Verified original October 8 local head `db0b478` is present in this repository history; the user's local working tree has an untracked `docs/architecture/` directory, backed up separately. User created `TES-local-history.bundle` (10,552,672 bytes, 3,112 Git objects reported) and copied the architecture directory. Bundle verification and independent restore have not yet been reported.
- Original rich UI reference `2644183` has a 1,062-line Vehicles page, 110-line Drivers list, 1,924-line Insurance page, and 1,259-line Credentials page. These are entry points, not total module size; do not use route line counts as completeness evidence. Historical per-module components and all workflows must be compared.
- Principal cutover commits on October 12, 2026: `a36acf191` (Authorities/Tax), `0ba94364e` (Insurance), `e4fa3366e` (Credentials), `0e8e8c30f` (Vehicles/Drivers). These are code-change timestamps, not proof of production deployment time.
- Dedicated preservation branch `recovery/baseline-preservation-20261014` starts at PR #21 (`claude/ui-recovery`) and is not merged. PR #20, PR #21, and main remain untouched by branch-only fixes.
- **Recovery scope:** preserve and restore original screens, field visibility, navigation, and behavior where canonical operations already exist; explicitly refuse unsupported writes. Do not import browser-local persistence, create unapproved canonical domains, rewrite schema or access controls, or reset main to the October 8 snapshot.
- **Stage 2 first code fix:** commit `5b4ad2e` restores `sandbox=""` and `referrerPolicy="no-referrer"` to the unsaved Business PDF preview iframe. Rendering needs browser verification; no claim of E2E verification.
- **Decision gate:** visual/UI recovery and canonical-domain implementation are distinct workstreams. Stop broad restoration after the first targeted pass; enumerate unsupported workflows and decide which need new approved domains, rather than spending unlimited time attempting to simulate persistence.
- **Not release-ready:** no browser screenshots or end-to-end validation, production authorization not proven, historical UI parity not proven, and known domain gaps remain. No merge or deployment authorized.
